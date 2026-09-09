const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { startServer } = require("./server/index");

let mainWindow;
let apiPort = 3780;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0f172a",
    icon: path.join(__dirname, "asset", "mPairLogo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL(`http://127.0.0.1:${apiPort}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const started = await startServer(apiPort);
    apiPort = started.port;
  } catch (err) {
    console.error("Failed to start local API:", err.message);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-api-info", () => ({
  port: apiPort,
  url: `http://127.0.0.1:${apiPort}`
}));

ipcMain.handle("open-external", (_event, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    return shell.openExternal(url);
  }
});
