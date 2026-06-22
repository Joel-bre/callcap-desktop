const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("callcap", {
  getStatus: () => ipcRenderer.invoke("get-status"),
  openDashboard: () => ipcRenderer.invoke("open-dashboard"),
  unpair: () => ipcRenderer.invoke("unpair"),
  onPaired: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("paired", handler);
    return () => ipcRenderer.removeListener("paired", handler);
  },
});