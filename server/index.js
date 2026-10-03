const path = require("path");
const express = require("express");
const cors = require("cors");
const store = require("./store");
const { handleIclock } = require("./protocols/iclock");
const { testDevice, pullDevice } = require("./deviceManager");
const { syncAttendance } = require("./sync");
const { buildSyncPayload, discoveredFields } = require("./fields");
const { publicConfig, clearTokenCache } = require("./auth");
const backup = require("./backup");
const {
  ingestStudents,
  pushStoredStudents,
  removeStudentEverywhere,
  listDeviceUsers
} = require("./students");

const SYNC_CONFIG_KEYS = [
  "syncUrl",
  "syncMethod",
  "syncHeaders",
  "syncAuthHeader",
  "syncSendArray",
  "fieldMap",
  "extraFields",
  "discoveredFields",
  "authType",
  "authApiKey",
  "authHeaderName",
  "authPrefix",
  "authLoginUrl",
  "authUsername",
  "authPassword",
  "authUsernameField",
  "authPasswordField",
  "authTokenPath",
  "authTokenTtlMinutes",
  "studentFieldMap",
  "autoBackup",
  "backupRetainDays",
  "backupIntervalHours",
  "lastBackupAt",
  "minimizeToTray",
  "startMinimized"
];

function pickSyncConfig(body) {
  const patch = {};
  for (const key of SYNC_CONFIG_KEYS) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  return patch;
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.text({ type: ["text/*", "application/octet-stream"], limit: "5mb" }));
  app.use(express.raw({ type: "application/octet-stream", limit: "5mb" }));

  handleIclock(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "attendance-bridge" });
  });

  app.get("/api/config", (_req, res) => {
    const config = publicConfig(store.getConfig());
    const safe = {};
    for (const key of SYNC_CONFIG_KEYS) safe[key] = config[key];
    res.json(safe);
  });

  app.put("/api/config", (req, res) => {
    const patch = pickSyncConfig(req.body || {});
    const saved = store.saveConfig(patch);
    clearTokenCache();
    const config = publicConfig(saved);
    const safe = {};
    for (const key of SYNC_CONFIG_KEYS) safe[key] = config[key];
    res.json(safe);
  });

  app.get("/api/devices", (_req, res) => {
    res.json(store.getConfig().devices || []);
  });

  app.post("/api/devices", (req, res) => {
    const config = store.getConfig();
    const device = {
      id: Date.now().toString(36),
      name: req.body.ip,
      ip: req.body.ip,
      port: Number(req.body.port) || 4370,
      protocol: "auto",
      username: req.body.username || "",
      password: req.body.password || "",
      commKey: Number(req.body.commKey) || 0,
      token: req.body.token || "",
      timeout: 8000
    };
    config.devices = config.devices || [];
    config.devices.push(device);
    store.saveConfig(config);
    store.addEvent({ type: "device", level: "info", message: `Added device ${device.name} (${device.ip}:${device.port})` });
    res.status(201).json(device);
  });

  app.put("/api/devices/:id", (req, res) => {
    const config = store.getConfig();
    const idx = (config.devices || []).findIndex((d) => d.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Device not found" });
    const body = req.body || {};
    config.devices[idx] = {
      ...config.devices[idx],
      ip: body.ip || config.devices[idx].ip,
      port: body.port != null ? Number(body.port) : config.devices[idx].port,
      username: body.username != null ? body.username : config.devices[idx].username,
      password: body.password != null ? body.password : config.devices[idx].password,
      commKey: body.commKey != null ? Number(body.commKey) : config.devices[idx].commKey,
      token: body.token != null ? body.token : config.devices[idx].token,
      id: config.devices[idx].id,
      protocol: "auto",
      name: body.ip || config.devices[idx].name
    };
    store.saveConfig(config);
    res.json(config.devices[idx]);
  });

  app.delete("/api/devices/:id", (req, res) => {
    const config = store.getConfig();
    config.devices = (config.devices || []).filter((d) => d.id !== req.params.id);
    store.saveConfig(config);
    res.json({ ok: true });
  });

  app.post("/api/devices/:id/test", async (req, res) => {
    const device = (store.getConfig().devices || []).find((d) => d.id === req.params.id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    try {
      const result = await testDevice(device);
      store.addEvent({
        type: "test",
        level: result.ok ? "success" : "error",
        message: result.message
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/devices/:id/users", async (req, res) => {
    const device = (store.getConfig().devices || []).find((d) => d.id === req.params.id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    try {
      res.json(await listDeviceUsers(device.id));
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/devices/:id/users", async (req, res) => {
    const device = (store.getConfig().devices || []).find((d) => d.id === req.params.id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    try {
      const result = await ingestStudents(req.body, { deviceId: device.id, push: true });
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/devices/:id/pull", async (req, res) => {
    const device = (store.getConfig().devices || []).find((d) => d.id === req.params.id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    try {
      const result = await pullDevice(device);
      res.json(result);
    } catch (err) {
      store.addEvent({ type: "pull", level: "error", message: err.message });
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/test", async (req, res) => {
    try {
      const result = await testDevice(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/pull", async (req, res) => {
    try {
      const result = await pullDevice(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/attendance", (req, res) => {
    const rows = store.getAttendance();
    const { date, empID, synced } = req.query;
    const filtered = rows.filter((r) => {
      if (date && r.date !== date) return false;
      if (empID && String(r.empID) !== String(empID)) return false;
      if (synced === "true" && !r.synced) return false;
      if (synced === "false" && r.synced) return false;
      return true;
    });
    res.json(filtered);
  });

  app.post("/api/sync", async (req, res) => {
    try {
      const result = await syncAttendance(req.body?.limit);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/sync/preview", (_req, res) => {
    const config = store.getConfig();
    const rows = store.getAttendance();
    const sample = rows[0] || null;
    const fields = Array.from(new Set([
      ...(config.discoveredFields || []),
      ...discoveredFields(rows)
    ]));
    res.json({
      discoveredFields: fields,
      fieldMap: config.fieldMap || {},
      extraFields: config.extraFields || {},
      sampleRow: sample,
      samplePayload: sample ? buildSyncPayload(config, sample) : null
    });
  });

  app.get("/api/events", (_req, res) => {
    res.json(store.getEvents());
  });

  app.get("/api/students", (_req, res) => {
    res.json(store.getStudents());
  });

  app.post("/api/students", async (req, res) => {
    try {
      const push = req.body && req.body.push === false ? false : true;
      const result = await ingestStudents(req.body, { push, deviceId: req.body && req.body.deviceId });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/erp/students", async (req, res) => {
    try {
      const result = await ingestStudents(req.body, {
        push: req.body && req.body.push === false ? false : true,
        deviceId: req.body && req.body.deviceId
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/students/push", async (req, res) => {
    try {
      const result = await pushStoredStudents(req.body && req.body.deviceId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.delete("/api/students/:id", async (req, res) => {
    try {
      const result = await removeStudentEverywhere(req.params.id, {
        device: req.query.device !== "false",
        deviceId: req.query.deviceId
      });
      res.json(result);
    } catch (err) {
      res.status(404).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/attendance/push", (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const saved = store.upsertAttendance(rows.filter(Boolean));
    res.json({ ok: true, count: saved.length });
  });

  app.get("/api/backups", (_req, res) => {
    res.json({
      dir: backup.backupDir(),
      dataDir: store.getDataDir(),
      lastBackupAt: store.getConfig().lastBackupAt || "",
      autoBackup: !!store.getConfig().autoBackup,
      backupRetainDays: Number(store.getConfig().backupRetainDays) || 30,
      items: backup.listBackups()
    });
  });

  app.post("/api/backups", (req, res) => {
    try {
      res.status(201).json(backup.createBackup({ reason: (req.body && req.body.reason) || "manual" }));
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/backups/restore", (req, res) => {
    try {
      const body = req.body || {};
      if (body.name || body.file) {
        const dir = path.resolve(backup.backupDir());
        const target = path.resolve(dir, path.basename(body.name || body.file));
        const rel = path.relative(dir, target);
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
          return res.status(400).json({ ok: false, message: "Backup file must be in the backups folder" });
        }
        return res.json(backup.restoreBackup(target));
      }
      if (body.config || body.attendance) {
        return res.json(backup.restoreFromObject(body));
      }
      res.status(400).json({ ok: false, message: "Send backup name or backup JSON" });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/backups/export.json", (_req, res) => {
    res.setHeader("Content-Disposition", "attachment; filename=attendance-bridge-backup.json");
    res.json(backup.snapshot());
  });

  app.get("/api/backups/export.csv", (_req, res) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=attendance.csv");
    res.send(backup.attendanceCsv());
  });

  app.use("/asset", express.static(path.join(__dirname, "..", "asset")));
  app.use(express.static(path.join(__dirname, "..", "renderer")));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "renderer", "index.html"));
  });

  return app;
}

function startServer(port) {
  const config = store.getConfig();
  const listenPort = Number(port || config.listenPort || 3780);
  const app = createApp();
  backup.startBackupScheduler();
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, "0.0.0.0", () => {
      store.addEvent({
        type: "server",
        level: "success",
        message: `Attendance bridge listening on ${listenPort}`
      });
      resolve({ app, server, port: listenPort });
    });
    server.on("error", reject);
  });
}

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`Attendance bridge running on http://0.0.0.0:${port}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, startServer };
