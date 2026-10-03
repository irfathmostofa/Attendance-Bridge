const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const store = require("./server/store");
const { startServer } = require("./server/index");
const backup = require("./server/backup");

let mainWindow = null;
let tray = null;
let apiPort = 3780;
let quitting = false;

function iconPath(file) {
  return path.join(__dirname, "asset", file);
}

function appIcon() {
  const ico = iconPath("mPairLogo.ico");
  const png = iconPath("mPairLogo.png");
  if (process.platform === "win32" && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function apiUrl() {
  return `http://127.0.0.1:${apiPort}`;
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0b1220",
    show: !store.getConfig().startMinimized,
    icon: appIcon(),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadURL(apiUrl());
  mainWindow.on("close", (event) => {
    if (!quitting && store.getConfig().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Backup now", click: () => runBackup("manual") },
        { label: "Restore backup...", click: () => runRestoreDialog() },
        { type: "separator" },
        { label: "Export backup JSON...", click: () => exportJsonDialog() },
        { label: "Export attendance CSV...", click: () => exportCsvDialog() },
        { type: "separator" },
        { label: "Open data folder", click: () => shell.openPath(store.getDataDir()) },
        { label: "Open backups folder", click: () => shell.openPath(backup.backupDir()) },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { label: "Show Attendance Bridge", click: () => showWindow() }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Local API",
          click: () => shell.openExternal(apiUrl())
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(appIcon() || iconPath("mPairLogo.png"));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Attendance Bridge");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: () => showWindow() },
    { label: "Backup now", click: () => runBackup("tray") },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", () => showWindow());
}

async function runBackup(reason) {
  try {
    const result = createNamedBackup(reason);
    dialog.showMessageBox({
      type: "info",
      title: "Backup",
      message: "Backup saved",
      detail: result.file
    });
    return result;
  } catch (err) {
    dialog.showErrorBox("Backup failed", err.message);
    throw err;
  }
}

function createNamedBackup(reason) {
  return backup.createBackup({ reason: reason || "manual" });
}

async function runRestoreDialog() {
  const picked = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "Restore backup",
    filters: [{ name: "Backup JSON", extensions: ["json"] }],
    defaultPath: backup.backupDir(),
    properties: ["openFile"]
  });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const confirm = await dialog.showMessageBox(mainWindow || undefined, {
    type: "warning",
    buttons: ["Restore", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Restore backup",
    message: "Replace current config, attendance, and students with this backup?"
  });
  if (confirm.response !== 0) return { canceled: true };
  const result = backup.restoreBackup(picked.filePaths[0]);
  if (mainWindow) mainWindow.reload();
  return result;
}

async function exportJsonDialog() {
  const picked = await dialog.showSaveDialog(mainWindow || undefined, {
    title: "Export backup",
    defaultPath: path.join(app.getPath("documents"), `attendance-bridge-${Date.now()}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (picked.canceled || !picked.filePath) return { canceled: true };
  return backup.createBackup({ filePath: picked.filePath, reason: "export" });
}

async function exportCsvDialog() {
  const picked = await dialog.showSaveDialog(mainWindow || undefined, {
    title: "Export attendance CSV",
    defaultPath: path.join(app.getPath("documents"), `attendance-${Date.now()}.csv`),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (picked.canceled || !picked.filePath) return { canceled: true };
  fs.writeFileSync(picked.filePath, backup.attendanceCsv());
  return { ok: true, file: picked.filePath };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    store.setDataDir(path.join(app.getPath("userData"), "data"));
    try {
      const started = await startServer(apiPort);
      apiPort = started.port;
    } catch (err) {
      if (String(err.message || "").includes("EADDRINUSE")) {
        apiPort = 3780;
      } else {
        dialog.showErrorBox("Attendance Bridge", "Failed to start local API: " + err.message);
      }
    }
    createMenu();
    createTray();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !store.getConfig().minimizeToTray) {
    app.quit();
  }
});

ipcMain.handle("get-api-info", () => ({
  port: apiPort,
  url: apiUrl(),
  dataDir: store.getDataDir(),
  backupDir: backup.backupDir(),
  electron: true
}));

ipcMain.handle("open-external", (_event, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    return shell.openExternal(url);
  }
});

ipcMain.handle("open-path", (_event, target) => {
  const allowed = [store.getDataDir(), backup.backupDir()];
  if (!allowed.includes(target)) return false;
  return shell.openPath(target);
});

ipcMain.handle("backup-now", (_event, reason) => createNamedBackup(reason || "manual"));
ipcMain.handle("backup-restore-dialog", () => runRestoreDialog());
ipcMain.handle("backup-export-json", () => exportJsonDialog());
ipcMain.handle("backup-export-csv", () => exportCsvDialog());
