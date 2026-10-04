const LOGICAL_FIELDS = ["empID", "empName", "date", "inTime", "outTime", "total_time"];

const FIELD_ALIASES = {
  empID: [
    "empID", "empId", "emp_id", "emp_code", "empCode", "pin", "PIN",
    "userId", "user_id", "uid", "UID", "employeeId", "employee_id",
    "deviceUserId", "userSn", "userid", "UserID", "enrollId", "enrollid",
    "registration_id", "registrationId", "access_id", "accessId"
  ],
  empName: [
    "empName", "emp_name", "name", "userName", "user_name", "employeeName",
    "employee_name", "fullName", "full_name", "person_name", "personName"
  ],
  date: ["date", "att_date", "attDate", "workDate", "work_date", "punchDate", "access_date", "accessDate"],
  time: ["time", "punchTime", "recordTime", "attTime", "timestamp", "DateTime", "dateTime", "access_time", "accessTime", "att_datetime"],
  inTime: ["inTime", "in_time", "first_punch", "firstPunch", "checkIn", "check_in", "clockIn"],
  outTime: ["outTime", "out_time", "last_punch", "lastPunch", "checkOut", "check_out", "clockOut"],
  total_time: ["total_time", "totalTime", "worked", "duration", "workHours", "work_hours"]
};

const INTERNAL_KEYS = new Set([
  "punches", "synced", "syncedAt", "syncError", "id", "raw", "params",
  "deviceId", "deviceName", "source", "serial", "punchTime"
]);

const ALIAS_KEYS = new Set(Object.values(FIELD_ALIASES).flat());

function pick(row, keys) {
  for (const key of keys) {
    if (!key || row[key] == null) continue;
    const value = row[key];
    if (typeof value === "object") continue;
    if (String(value).trim() === "") continue;
    return value;
  }
  return undefined;
}

function extractTime(value) {
  if (value == null) return "";
  const s = String(value).trim();
  const match = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (match) {
    const parts = match[1].split(":");
    const hh = String(parts[0]).padStart(2, "0");
    const mm = String(parts[1] || "00").padStart(2, "0");
    const ss = String(parts[2] || "00").padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return s.slice(0, 8);
}

function splitStamp(stamp) {
  if (stamp == null || stamp === "") return { date: "", time: "" };
  const s = String(stamp).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /T|-/.test(s) && /\d{4}/.test(s)) {
    const date = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
    return { date, time: d.toTimeString().slice(0, 8) };
  }
  return {
    date: s.slice(0, 10),
    time: extractTime(s.slice(11) || s)
  };
}

function extraParams(row) {
  const params = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (INTERNAL_KEYS.has(key) || ALIAS_KEYS.has(key) || LOGICAL_FIELDS.includes(key)) return;
    if (value == null || typeof value === "function") return;
    if (typeof value === "object") return;
    params[key] = value;
  });
  return params;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const keys = ["data", "records", "items", "rows", "results", "attendance", "logs", "log", "punches", "selectResult"];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.records)) return value.records;
    if (value && Array.isArray(value.items)) return value.items;
  }
  return [payload];
}

function combinedName(row) {
  const first = row.first_name || row.firstName || row.firstname || "";
  const last = row.last_name || row.lastName || row.lastname || "";
  return `${first} ${last}`.trim();
}

function normalizePunch(row, device) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const empID = String(pick(row, FIELD_ALIASES.empID) || "").trim();
  if (!empID) return null;

  const empName = String(pick(row, FIELD_ALIASES.empName) || combinedName(row) || empID);

  const stamp = pick(row, ["punchTime", "recordTime", "timestamp", "attTime", "DateTime", "dateTime", "att_datetime"]);
  const split = splitStamp(stamp);
  const date = String(pick(row, FIELD_ALIASES.date) || split.date || "").slice(0, 10);
  const time = extractTime(pick(row, FIELD_ALIASES.time) || split.time || "");
  const inRaw = pick(row, FIELD_ALIASES.inTime);
  const outRaw = pick(row, FIELD_ALIASES.outTime);
  const inTime = inRaw != null ? extractTime(inRaw) || String(inRaw) : (time || null);
  const outTime = outRaw != null ? extractTime(outRaw) || String(outRaw) : null;
  const totalTime = pick(row, FIELD_ALIASES.total_time);

  return {
    empID,
    empName,
    date,
    time: time || inTime || "",
    punchTime: stamp ? String(stamp) : (date && (time || inTime) ? `${date} ${time || inTime}` : ""),
    inTime: inTime || null,
    outTime: outTime || null,
    total_time: totalTime != null ? String(totalTime) : null,
    params: extraParams(row),
    deviceId: (device && (device.id || device.serial)) || row.deviceId,
    deviceName: (device && device.name) || row.deviceName,
    source: row.source || (device && device.protocol) || "device",
    serial: row.serial || (device && device.serial)
  };
}

function normalizePunches(payload, device) {
  return extractRows(payload).map((row) => normalizePunch(row, device)).filter(Boolean);
}

function mergeParams(target, extra) {
  if (!extra || typeof extra !== "object") return target || {};
  return { ...(target || {}), ...extra };
}

function groupPunches(punches) {
  const map = new Map();
  punches.forEach((p) => {
    const key = `${p.empID}|${p.date}|${p.deviceId || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        empID: p.empID,
        empName: p.empName,
        date: p.date,
        inTime: p.time || p.inTime || null,
        outTime: p.outTime || null,
        total_time: p.total_time || null,
        punches: [],
        params: mergeParams({}, p.params),
        deviceId: p.deviceId,
        deviceName: p.deviceName,
        source: p.source,
        synced: false
      });
    }
    const row = map.get(key);
    const t = p.time || p.inTime;
    if (t) row.punches.push(t);
    if (p.outTime) row.punches.push(p.outTime);
    if (!row.empName && p.empName) row.empName = p.empName;
    if (p.total_time && !row.total_time) row.total_time = p.total_time;
    row.params = mergeParams(row.params, p.params);
  });
  return Array.from(map.values()).map((row) => {
    const times = Array.from(new Set(row.punches.filter(Boolean))).sort();
    row.inTime = times[0] || row.inTime;
    row.outTime = times.length > 1 ? times[times.length - 1] : (row.outTime || null);
    if (row.inTime && row.outTime) {
      const a = new Date(`1970-01-01T${String(row.inTime).slice(0, 8)}`);
      const b = new Date(`1970-01-01T${String(row.outTime).slice(0, 8)}`);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b > a) {
        const mins = Math.round((b - a) / 60000);
        const h = String(Math.floor(mins / 60)).padStart(2, "0");
        const m = String(mins % 60).padStart(2, "0");
        row.total_time = `${h}:${m}`;
      }
    }
    return row;
  });
}

function readMapped(row, extras, src) {
  if (row[src] != null && typeof row[src] !== "object") return row[src];
  if (extras && extras[src] != null && typeof extras[src] !== "object") return extras[src];
  return undefined;
}

function collectExtras(row) {
  const extras = { ...(row && row.params && typeof row.params === "object" ? row.params : {}) };
  Object.entries(row || {}).forEach(([key, value]) => {
    if (INTERNAL_KEYS.has(key) || LOGICAL_FIELDS.includes(key) || key === "time") return;
    if (value == null || typeof value === "function" || typeof value === "object") return;
    if (extras[key] === undefined) extras[key] = value;
  });
  return extras;
}

function discoveredFields(rows) {
  const keys = new Set();
  (rows || []).forEach((row) => {
    LOGICAL_FIELDS.forEach((key) => {
      if (row[key] != null && row[key] !== "") keys.add(key);
    });
    Object.keys(collectExtras(row)).forEach((key) => keys.add(key));
  });
  return Array.from(keys);
}

function buildSyncPayload(config, row) {
  const map = config.fieldMap || {};
  const payload = {};
  const extras = collectExtras(row);

  LOGICAL_FIELDS.forEach((key) => {
    const dest = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
    if (!dest) return;
    if (row[key] != null && row[key] !== "") payload[dest] = row[key];
  });

  Object.entries(extras).forEach(([key, value]) => {
    const dest = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
    if (!dest || payload[dest] !== undefined) return;
    payload[dest] = value;
  });

  Object.entries(map).forEach(([src, dest]) => {
    if (!dest || payload[dest] !== undefined || LOGICAL_FIELDS.includes(src)) return;
    const value = readMapped(row, extras, src);
    if (value !== undefined) payload[dest] = value;
  });

  return { ...payload, ...(config.extraFields || {}) };
}

module.exports = {
  LOGICAL_FIELDS,
  FIELD_ALIASES,
  pick,
  extractRows,
  extractTime,
  normalizePunch,
  normalizePunches,
  buildSyncPayload,
  extraParams,
  collectExtras,
  discoveredFields,
  groupPunches
};
