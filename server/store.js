const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const LOGS_FILE = path.join(DATA_DIR, "attendance.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const STUDENTS_FILE = path.join(DATA_DIR, "students.json");

const DEFAULT_CONFIG = {
  listenPort: 3780,
  iclockEnabled: true,
  syncUrl: "https://server.roohschool.edu.bd/server/postAttendence",
  syncMethod: "POST",
  syncHeaders: {
    "Content-Type": "application/json"
  },
  syncAuthHeader: "",
  authType: "api-key",
  authApiKey: "",
  authHeaderName: "Authorization",
  authPrefix: "Bearer",
  authLoginUrl: "",
  authUsername: "",
  authPassword: "",
  authUsernameField: "username",
  authPasswordField: "password",
  authTokenPath: "token",
  authTokenTtlMinutes: 50,
  syncSendArray: false,
  syncIntervalMinutes: 15,
  autoSync: false,
  fieldMap: {
    empID: "empID",
    empName: "empName",
    date: "date",
    inTime: "inTime",
    outTime: "outTime",
    total_time: "total_time"
  },
  extraFields: {},
  discoveredFields: ["empID", "empName", "date", "inTime", "outTime", "total_time"],
  studentFieldMap: {
    studentId: "studentId",
    name: "name",
    cardNo: "cardNo"
  },
  devices: []
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, "[]");
  }
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, "[]");
  }
  if (!fs.existsSync(STUDENTS_FILE)) {
    fs.writeFileSync(STUDENTS_FILE, "[]");
  }
}

function readJson(file, fallback) {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, DEFAULT_CONFIG) };
}

function isMasked(value) {
  return value === "********" || value === undefined;
}

function saveConfig(next) {
  const current = getConfig();
  const merged = { ...current, ...next };
  if (isMasked(next.authApiKey)) merged.authApiKey = current.authApiKey;
  if (isMasked(next.authPassword)) merged.authPassword = current.authPassword;
  if (isMasked(next.syncAuthHeader)) merged.syncAuthHeader = current.syncAuthHeader;
  if (next.fieldMap) {
    merged.fieldMap = { ...DEFAULT_CONFIG.fieldMap, ...current.fieldMap, ...next.fieldMap };
  }
  if (next.syncHeaders) {
    merged.syncHeaders = { ...current.syncHeaders, ...next.syncHeaders };
  }
  if (next.extraFields) {
    merged.extraFields = { ...current.extraFields, ...next.extraFields };
  }
  if (next.studentFieldMap) {
    merged.studentFieldMap = { ...DEFAULT_CONFIG.studentFieldMap, ...current.studentFieldMap, ...next.studentFieldMap };
  }
  if (next.discoveredFields) {
    const seen = new Set([...(current.discoveredFields || []), ...next.discoveredFields]);
    merged.discoveredFields = Array.from(seen);
  }
  writeJson(CONFIG_FILE, merged);
  return merged;
}

function getStudents() {
  return readJson(STUDENTS_FILE, []);
}

function saveStudents(rows) {
  writeJson(STUDENTS_FILE, rows);
  return rows;
}

function upsertStudents(rows) {
  const existing = getStudents();
  const index = new Map();
  existing.forEach((row, i) => {
    index.set(String(row.studentId), i);
  });
  (rows || []).forEach((row) => {
    const id = String(row.studentId || "").trim();
    if (!id) return;
    const next = { ...row, studentId: id };
    if (index.has(id)) {
      existing[index.get(id)] = { ...existing[index.get(id)], ...next };
    } else {
      existing.push(next);
      index.set(id, existing.length - 1);
    }
  });
  existing.sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));
  return saveStudents(existing);
}

function removeStudent(studentId) {
  const id = String(studentId);
  return saveStudents(getStudents().filter((row) => String(row.studentId) !== id));
}

function getAttendance() {
  return readJson(LOGS_FILE, []);
}

function saveAttendance(rows) {
  writeJson(LOGS_FILE, rows);
  return rows;
}

function upsertAttendance(rows) {
  const existing = getAttendance();
  const index = new Map();
  existing.forEach((row, i) => {
    index.set(`${row.empID}|${row.date}|${row.inTime}|${row.deviceId || ""}`, i);
  });
  rows.forEach((row) => {
    const key = `${row.empID}|${row.date}|${row.inTime}|${row.deviceId || ""}`;
    if (index.has(key)) {
      const prev = existing[index.get(key)];
      existing[index.get(key)] = {
        ...prev,
        ...row,
        params: { ...(prev.params || {}), ...(row.params || {}) }
      };
    } else {
      existing.push(row);
    }
  });
  existing.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.inTime).localeCompare(String(a.inTime)));
  return saveAttendance(existing);
}

function getEvents() {
  return readJson(EVENTS_FILE, []);
}

function addEvent(event) {
  const events = getEvents();
  events.unshift({
    id: Date.now() + "-" + Math.random().toString(16).slice(2),
    time: new Date().toISOString(),
    ...event
  });
  writeJson(EVENTS_FILE, events.slice(0, 500));
  return events[0];
}

module.exports = {
  DATA_DIR,
  getConfig,
  saveConfig,
  getAttendance,
  saveAttendance,
  upsertAttendance,
  getEvents,
  addEvent,
  getStudents,
  saveStudents,
  upsertStudents,
  removeStudent
};
