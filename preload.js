const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  getApiInfo: () => ipcRenderer.invoke("get-api-info"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url)
});
