const dot = document.getElementById("dot");
const title = document.getElementById("status-title");
const sub = document.getElementById("status-sub");
const pairBtn = document.getElementById("pair-btn");
const unpairBtn = document.getElementById("unpair-btn");
const versionEl = document.getElementById("version");

const recordCard = document.getElementById("record-card");
const deviceSel = document.getElementById("device");
const recDot = document.getElementById("rec-dot");
const timerEl = document.getElementById("timer");
const recordBtn = document.getElementById("record-btn");
const openMeetingBtn = document.getElementById("open-meeting-btn");
const recStatus = document.getElementById("rec-status");

let paired = false;
let mediaRecorder = null;
let chunks = [];
let activeStream = null;
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

async function startRecording() {
  recStatus.textContent = "";
  openMeetingBtn.style.display = "none";
  const deviceId = deviceSel.value;
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (err) {
    recStatus.textContent = "Microphone access denied or unavailable.";
    return;
  }
  // Labels become available once permission is granted.
  listDevices();

  const mimeType = pickMimeType();
  chunks = [];
  mediaRecorder = new MediaRecorder(activeStream, mimeType ? { mimeType } : undefined);
  startedAtIso = new Date().toISOString();

  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start();

  recDot.classList.add("rec");
  recordBtn.textContent = "Stop & upload";
  recordBtn.classList.add("danger");
  deviceSel.disabled = true;
  timerStart = Date.now();
  tickTimer();
  timerHandle = setInterval(tickTimer, 500);
}

async function onRecordingStop() {
  clearInterval(timerHandle);
  recDot.classList.remove("rec");
  recordBtn.classList.remove("danger");
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }

  const mimeType = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];

  if (blob.size === 0) {
    recStatus.textContent = "Nothing was recorded.";
    resetRecordButton();
    return;
  }

  recordBtn.disabled = true;
  recStatus.textContent = "Uploading…";
  try {
    const buffer = await blob.arrayBuffer();
    const title = `Desktop recording — ${new Date(startedAtIso).toLocaleString()}`;
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
  timerEl.textContent = "00:00";
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
