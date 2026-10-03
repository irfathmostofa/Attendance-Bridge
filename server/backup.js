const fs = require("fs");
const path = require("path");
const store = require("./store");

let timer = null;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupDir() {
  const dir = path.join(store.getDataDir(), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshot() {
  return {
    version: 1,
    app: "attendance-bridge",
    createdAt: new Date().toISOString(),
    config: store.getConfig(),
    attendance: store.getAttendance(),
    students: store.getStudents(),
    events: store.getEvents()
  };
}

function fileName(reason) {
  return `backup-${stamp()}${reason ? "-" + reason : ""}.json`;
}

function writeBackupFile(targetPath, data) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
  return targetPath;
}

function createBackup(options) {
  const opts = options || {};
  const data = snapshot();
  const name = opts.fileName || fileName(opts.reason || "manual");
  const dest = opts.filePath || path.join(backupDir(), name);
  writeBackupFile(dest, data);
  store.saveConfig({ lastBackupAt: data.createdAt });
  pruneBackups();
  store.addEvent({
    type: "backup",
    level: "success",
    message: `Backup saved (${data.attendance.length} records) to ${path.basename(dest)}`
  });
  return {
    ok: true,
    file: dest,
    name: path.basename(dest),
    createdAt: data.createdAt,
    counts: {
      attendance: data.attendance.length,
      students: data.students.length,
      events: data.events.length,
      devices: (data.config.devices || []).length
    }
  };
}

function readBackup(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") throw new Error("Invalid backup file");
  if (!data.config && !data.attendance) throw new Error("Backup is missing config and attendance");
  return data;
}

function restoreBackup(filePath) {
  const data = readBackup(filePath);
  store.restoreSnapshot(data);
  store.addEvent({
    type: "backup",
    level: "success",
    message: `Restored backup ${path.basename(filePath)}`
  });
  return {
    ok: true,
    file: filePath,
    name: path.basename(filePath),
    createdAt: data.createdAt || null,
    counts: {
      attendance: (data.attendance || []).length,
      students: (data.students || []).length,
      events: (data.events || []).length,
      devices: ((data.config && data.config.devices) || []).length
    }
  };
}

function restoreFromObject(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid backup");
  store.restoreSnapshot(data);
  store.addEvent({
    type: "backup",
    level: "success",
    message: "Restored backup from uploaded file"
  });
  return { ok: true, createdAt: data.createdAt || null };
}

function listBackups() {
  const dir = backupDir();
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      let counts = null;
      let createdAt = stat.mtime.toISOString();
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        createdAt = data.createdAt || createdAt;
        counts = {
          attendance: (data.attendance || []).length,
          students: (data.students || []).length,
          devices: ((data.config && data.config.devices) || []).length
        };
      } catch (_) {}
      return { name, file, size: stat.size, createdAt, counts };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pruneBackups() {
  const days = Number(store.getConfig().backupRetainDays) || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  listBackups().forEach((item) => {
    const t = Date.parse(item.createdAt) || 0;
    if (t && t < cutoff) {
      try { fs.unlinkSync(item.file); } catch (_) {}
    }
  });
}

function attendanceCsv() {
  const rows = store.getAttendance();
  const keys = ["date", "empID", "empName", "inTime", "outTime", "total_time", "deviceName", "deviceId", "synced", "source"];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [keys.join(",")];
  rows.forEach((row) => {
    lines.push(keys.map((k) => esc(row[k])).join(","));
  });
  return lines.join("\n");
}

function maybeAutoBackup() {
  const config = store.getConfig();
  if (!config.autoBackup) return null;
  const last = Date.parse(config.lastBackupAt || 0) || 0;
  const hours = Number(config.backupIntervalHours) || 24;
  if (Date.now() - last < hours * 3600 * 1000) return null;
  return createBackup({ reason: "auto" });
}

function startBackupScheduler() {
  if (timer) clearInterval(timer);
  setTimeout(() => {
    try { maybeAutoBackup(); } catch (_) {}
  }, 8000);
  timer = setInterval(() => {
    try { maybeAutoBackup(); } catch (_) {}
  }, 60 * 60 * 1000);
}

module.exports = {
  snapshot,
  createBackup,
  restoreBackup,
  restoreFromObject,
  listBackups,
  backupDir,
  attendanceCsv,
  startBackupScheduler,
  maybeAutoBackup
};
