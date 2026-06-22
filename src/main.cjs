const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// Edit if your dashboard moves.
const CALLCAP_BASE_URL = "https://callcap.lovable.app";
const PAIR_ENDPOINT = `${CALLCAP_BASE_URL}/api/public/recorder/pair`;

const PROTOCOL = "callcap";

// --- single-instance + protocol registration -----------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// --- config (device token) -----------------------------------------------

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// --- window --------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    title: "Callcap",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// --- pairing flow --------------------------------------------------------

async function exchangePairingToken(pairingToken) {
  const res = await fetch(PAIR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_token: pairingToken, device_label: `Desktop (${process.platform})` }),
  });
  if (!res.ok) throw new Error(`Pairing failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const cfg = readConfig();
  cfg.device_token = json.device_token;
  cfg.upload_url = json.upload_url;
  cfg.label = json.label;
  cfg.paired_at = new Date().toISOString();
  writeConfig(cfg);
  sendToRenderer("paired", { label: json.label });
  return json;
}

function handleProtocolUrl(url) {
  try {
    const u = new URL(url);
    if (u.host !== "pair") return;
    const token = u.searchParams.get("token");
    if (!token) return;
    exchangePairingToken(token).catch((err) => {
      dialog.showErrorBox("Pairing failed", err.message);
    });
  } catch (err) {
    console.error("Bad protocol URL", url, err);
  }
}

// --- protocol handlers (mac vs win/linux differ) -------------------------

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

app.on("second-instance", (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const protoArg = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (protoArg) handleProtocolUrl(protoArg);
});

// --- IPC -----------------------------------------------------------------

ipcMain.handle("get-status", () => {
  const cfg = readConfig();
  return {
    paired: Boolean(cfg.device_token),
    label: cfg.label || null,
    pairedAt: cfg.paired_at || null,
    version: app.getVersion(),
  };
});

ipcMain.handle("open-dashboard", () => shell.openExternal(`${CALLCAP_BASE_URL}/pair`));
ipcMain.handle("unpair", () => { writeConfig({}); return true; });

// --- lifecycle -----------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(null);

  // Handle protocol URL passed at cold start (Windows/Linux)
  const cold = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (cold) handleProtocolUrl(cold);

  // Auto-updates (no-op in dev)
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error("update check failed", e));
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});