const dot = document.getElementById("dot");
const title = document.getElementById("status-title");
const sub = document.getElementById("status-sub");
const pairBtn = document.getElementById("pair-btn");
const unpairBtn = document.getElementById("unpair-btn");
const versionEl = document.getElementById("version");

const recordCard = document.getElementById("record-card");
const nameInput = document.getElementById("meeting-name");
const deviceSel = document.getElementById("device");
const recDot = document.getElementById("rec-dot");
const timerEl = document.getElementById("timer");
const recordBtn = document.getElementById("record-btn");
const openMeetingBtn = document.getElementById("open-meeting-btn");
const recStatus = document.getElementById("rec-status");
const captureInfo = document.getElementById("capture-info");

let paired = false;
let mediaRecorder = null;
let chunks = [];
let micStream = null;
let systemStream = null;
let audioContext = null;
let startedAtIso = null;
let timerHandle = null;
let timerStart = 0;
let lastMeetingId = null;

function pad(n) { return String(n).padStart(2, "0"); }
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
function tickTimer() { timerEl.textContent = fmt(Date.now() - timerStart); }

function defaultName(d) {
  return `Desktop recording — ${d.toLocaleString()}`;
}

// Prefill the name with a date/time default, refreshing it until the user
// types their own. Once they edit it, we leave their text alone.
let nameEdited = false;
function refreshDefaultName() {
  if (!nameEdited) nameInput.value = defaultName(new Date());
}
nameInput.addEventListener("input", () => { nameEdited = nameInput.value.trim().length > 0; });
refreshDefaultName();

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const current = deviceSel.value;
    deviceSel.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Default microphone";
    deviceSel.appendChild(def);
    inputs.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      deviceSel.appendChild(opt);
    });
    if (current) deviceSel.value = current;
  } catch (err) {
    recStatus.textContent = "Could not list microphones.";
  }
}

// Capture the system / output audio (the remote participants) via loopback.
// The Electron main process intercepts getDisplayMedia and supplies the
// 'loopback' audio source. We must request video (the API requires it) and
// then drop it — only the audio track is kept. Returns a MediaStream with
// just the system audio, or null if unavailable / denied.
async function captureSystemAudio() {
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    display.getVideoTracks().forEach((t) => t.stop());
    const audioTracks = display.getAudioTracks();
    if (audioTracks.length === 0) return null;
    return new MediaStream(audioTracks);
  } catch (err) {
    return null;
  }
}

async function startRecording() {
  recStatus.textContent = "";
  recStatus.className = "muted";
  openMeetingBtn.style.display = "none";
  refreshDefaultName(); // freshen the timestamp if the user hasn't named it
  const deviceId = deviceSel.value;

  // 1) Microphone (your voice). Disable AEC/NS/AGC — otherwise Chromium's echo
  //    canceller treats the loopback as an echo of the mic and silences it.
  const micConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) micConstraints.deviceId = { exact: deviceId };
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
  } catch (err) {
    recStatus.textContent = "Microphone access denied or unavailable.";
    return;
  }
  listDevices();

  // 2) System / meeting audio (loopback). Best-effort — fall back to mic-only.
  systemStream = await captureSystemAudio();
  const systemCaptured = Boolean(systemStream);

  // 3) Mix mic + system into one track via Web Audio.
  let recordStream;
  if (systemCaptured) {
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(micStream).connect(dest);
    audioContext.createMediaStreamSource(systemStream).connect(dest);
    recordStream = dest.stream;
  } else {
    recordStream = micStream;
  }

  const mimeType = pickMimeType();
  chunks = [];
  mediaRecorder = new MediaRecorder(
    recordStream,
    Object.assign({ audioBitsPerSecond: 96000 }, mimeType ? { mimeType } : {}),
  );
  startedAtIso = new Date().toISOString();

  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(1000); // 1s timeslice so chunks flush regularly

  recDot.classList.add("rec");
  recordBtn.textContent = "Stop & upload";
  recordBtn.classList.add("danger");
  deviceSel.disabled = true;
  nameInput.disabled = true;
  if (systemCaptured) {
    captureInfo.textContent = "● Capturing microphone + meeting audio";
    captureInfo.className = "muted ok-text";
  } else {
    captureInfo.textContent = "⚠ Meeting audio unavailable — recording microphone only. The other participants will NOT be captured.";
    captureInfo.className = "muted warn";
  }
  timerStart = Date.now();
  tickTimer();
  timerHandle = setInterval(tickTimer, 500);
}

function stopAllStreams() {
  [micStream, systemStream].forEach((s) => {
    if (s) s.getTracks().forEach((t) => t.stop());
  });
  micStream = null;
  systemStream = null;
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}

async function onRecordingStop() {
  clearInterval(timerHandle);
  recDot.classList.remove("rec");
  recordBtn.classList.remove("danger");

  const mimeType = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  stopAllStreams();

  if (blob.size === 0) {
    recStatus.textContent = "Nothing was recorded.";
    resetRecordButton();
    return;
  }

  recordBtn.disabled = true;
  recStatus.textContent = "Uploading…";
  try {
    const buffer = await blob.arrayBuffer();
    const title = nameInput.value.trim() || defaultName(new Date(startedAtIso));
    const res = await window.callcap.uploadRecording({
      buffer,
      mimeType,
      title,
      startedAt: startedAtIso,
    });
    lastMeetingId = res && res.meeting_id;
    recStatus.textContent = "Uploaded — processing. Transcription will appear in your dashboard.";
    if (lastMeetingId) openMeetingBtn.style.display = "block";
  } catch (err) {
    recStatus.textContent = "Upload failed: " + (err && err.message ? err.message : "unknown error");
  } finally {
    resetRecordButton();
  }
}

function resetRecordButton() {
  recordBtn.disabled = false;
  recordBtn.textContent = "Start recording";
  deviceSel.disabled = false;
  nameInput.disabled = false;
  timerEl.textContent = "00:00";
  captureInfo.textContent = "";
  // Ready the field for the next recording with a fresh default.
  nameEdited = false;
  refreshDefaultName();
}

recordBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  } else {
    startRecording();
  }
});

openMeetingBtn.addEventListener("click", () => {
  if (lastMeetingId) window.callcap.openMeeting(lastMeetingId);
});

pairBtn.addEventListener("click", () => window.callcap.openDashboard());
unpairBtn.addEventListener("click", async () => { await window.callcap.unpair(); refresh(); });
window.callcap.onPaired(() => { refresh(); listDevices(); });

async function refresh() {
  const s = await window.callcap.getStatus();
  versionEl.textContent = "v" + s.version;
  paired = s.paired;
  if (s.paired) {
    dot.classList.add("ok");
    title.textContent = "Paired" + (s.label ? ` — ${s.label}` : "");
    sub.textContent = s.pairedAt ? `Connected ${new Date(s.pairedAt).toLocaleString()}` : "Ready to record.";
    pairBtn.textContent = "Re-pair";
    unpairBtn.style.display = "block";
    recordCard.classList.remove("disabled");
  } else {
    dot.classList.remove("ok");
    title.textContent = "Not paired";
    sub.textContent = "Connect this app to your Callcap account.";
    pairBtn.textContent = "Pair with my account";
    unpairBtn.style.display = "none";
    recordCard.classList.add("disabled");
  }
}

refresh();
listDevices();
navigator.mediaDevices.addEventListener("devicechange", listDevices);
// Poll status so pairing via the OS deep link reflects without a restart.
setInterval(refresh, 3000);
