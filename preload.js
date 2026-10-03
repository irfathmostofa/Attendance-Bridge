const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  getApiInfo: () => ipcRenderer.invoke("get-api-info"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openPath: (target) => ipcRenderer.invoke("open-path", target),
  backupNow: (reason) => ipcRenderer.invoke("backup-now", reason),
  restoreDialog: () => ipcRenderer.invoke("backup-restore-dialog"),
  exportJson: () => ipcRenderer.invoke("backup-export-json"),
  exportCsv: () => ipcRenderer.invoke("backup-export-csv")
});
