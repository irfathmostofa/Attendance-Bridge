const store = require("../store");
const { extraParams, discoveredFields, groupPunches } = require("../fields");

function parseAttLog(body, serial) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const punches = [];
  lines.forEach((line) => {
    const parts = line.split(/\t+/);
    if (parts.length < 2) return;
    const empID = String(parts[0] || "").trim();
    const stamp = String(parts[1] || "").trim();
    if (!empID || !stamp) return;
    const date = stamp.slice(0, 10);
    const time = stamp.slice(11, 19);
    const extra = {};
    if (parts[2] != null && parts[2] !== "") extra.status = parts[2];
    if (parts[3] != null && parts[3] !== "") extra.verify = parts[3];
    parts.slice(4).forEach((value, i) => {
      if (value !== "") extra["col" + (i + 5)] = value;
    });
    punches.push({
      empID,
      empName: empID,
      date,
      time,
      punchTime: stamp,
      params: extraParams({ ...extra }),
      serial,
      source: "iclock"
    });
  });
  return punches;
}

function handleIclock(app) {
  app.get("/iclock/cdata", (req, res) => {
    const sn = req.query.SN || req.query.sn || "unknown";
    store.addEvent({
      type: "iclock",
      level: "info",
      message: `Device ${sn} requested config`
    });
    res.type("text/plain").send("OK");
  });

  app.post("/iclock/cdata", (req, res) => {
    const sn = req.query.SN || req.query.sn || "unknown";
    const table = String(req.query.table || "").toUpperCase();
    const raw = req.body;
    const body = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : "";
    if (table === "ATTLOG" || body.includes("\t")) {
      const punches = parseAttLog(body, sn);
      const config = store.getConfig();
      const device = (config.devices || []).find((d) => d.serial === sn || d.protocol === "iclock") || {
        id: sn,
        name: sn
      };
      const rows = groupPunches(punches.map((p) => ({
        ...p,
        deviceId: device.id,
        deviceName: device.name || sn
      })));
      if (rows.length) {
        store.upsertAttendance(rows);
        store.saveConfig({ discoveredFields: discoveredFields(rows) });
      }
      store.addEvent({
        type: "iclock",
        level: "success",
        message: `Received ${rows.length} punch(es) from ${sn}`
      });
    }
    res.type("text/plain").send("OK");
  });

  app.get("/iclock/getrequest", (_req, res) => {
    res.type("text/plain").send("OK");
  });

  app.post("/iclock/devicecmd", (_req, res) => {
    res.type("text/plain").send("OK");
  });

  app.get("/iclock/ping", (_req, res) => {
    res.type("text/plain").send("OK");
  });
}

module.exports = { handleIclock, parseAttLog };
