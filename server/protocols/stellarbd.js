const axios = require("axios");
const { normalizePunches, extractRows } = require("../fields");
const { STELLARBD_API } = require("../deviceTypes");

function pad(n) {
  return String(n).padStart(2, "0");
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function apiUrl(device) {
  const url = String((device && (device.apiUrl || device.url)) || STELLARBD_API).trim();
  return url.replace(/\/$/, "") || STELLARBD_API;
}

function authUser(device) {
  return String((device && (device.authUser || device.username)) || "").trim();
}

function authCode(device) {
  return String((device && (device.authCode || device.password || device.token)) || "").trim();
}

function fetchBody(device, extras) {
  const extra = extras || {};
  return {
    operation: extra.operation || "fetch_log",
    auth_user: authUser(device),
    auth_code: authCode(device),
    start_date: extra.start_date || extra.startDate || device.startDate || today(),
    end_date: extra.end_date || extra.endDate || device.endDate || today(),
    start_time: extra.start_time || extra.startTime || device.startTime || "00:00:00",
    end_time: extra.end_time || extra.endTime || device.endTime || "23:59:59"
  };
}

function parsePayload(data) {
  if (data == null) return null;
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return data;
}

function errorMessage(data, status) {
  if (typeof data === "string") {
    const text = data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/not authorized/i.test(text)) return "Not authorized. Check auth_user and auth_code.";
    if (text) return text.slice(0, 240);
  }
  if (data && typeof data === "object") {
    const msg = data.error || data.Error || data.message || data.Message || data.result || data.status;
    if (msg && typeof msg === "string" && !Array.isArray(data.log) && !Array.isArray(data.logs)) {
      return String(msg);
    }
  }
  if (status && (status < 200 || status >= 300)) return `HTTP ${status} from StellarBD API`;
  return "";
}

function extractLogs(payload) {
  const data = parsePayload(payload);
  if (data == null) return [];
  if (typeof data === "string") return [];
  if (Array.isArray(data)) return data;
  const direct = data.log || data.logs || data.Log || data.LOG;
  if (typeof direct === "string") {
    const parsed = parsePayload(direct);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return extractLogs(parsed);
  }
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") {
    if (Array.isArray(direct.log)) return direct.log;
    if (Array.isArray(direct.item)) return direct.item;
  }
  return extractRows(data);
}

function mapLogs(rows, device) {
  return (rows || []).map((row) => {
    if (!row || typeof row !== "object") return row;
    return {
      ...row,
      empID: row.empID || row.registration_id || row.registrationId || row.access_id || row.user_id,
      empName: row.empName || row.user_name || row.person_name || row.name || row.registration_id,
      date: row.date || row.access_date || row.accessDate,
      time: row.time || row.access_time || row.accessTime,
      punchTime: row.punchTime || row.access_time || row.att_datetime
    };
  });
}

async function callRams(device, extras) {
  const user = authUser(device);
  const code = authCode(device);
  if (!user) throw new Error("StellarBD auth_user is required");
  if (!code) throw new Error("StellarBD auth_code is required");
  const url = apiUrl(device);
  const body = fetchBody(device, extras);
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: Number(device.timeout) || 20000,
    validateStatus: () => true
  });
  const data = parsePayload(res.data);
  const err = errorMessage(data, res.status);
  if (res.status === 401 || res.status === 403) {
    throw new Error("Not authorized. Check auth_user and auth_code.");
  }
  if (err && (res.status < 200 || res.status >= 300)) {
    throw new Error(err);
  }
  if (err && typeof data === "string") {
    throw new Error(err);
  }
  if (data && typeof data === "object" && (data.error || data.Error) && !extractLogs(data).length) {
    throw new Error(String(data.error || data.Error));
  }
  return { url, status: res.status, data, body };
}

async function testStellarbd(device) {
  try {
    const result = await callRams(device, { operation: "fetch_log" });
    const logs = extractLogs(result.data);
    return {
      ok: true,
      protocol: "stellarbd",
      message: `Connected to StellarBD RAMS. ${logs.length} log(s) for today.`,
      logCount: logs.length
    };
  } catch (err) {
    return { ok: false, protocol: "stellarbd", message: err.message };
  }
}

async function connectStellarbd(device) {
  const result = await callRams(device, { operation: "fetch_log" });
  const rows = mapLogs(extractLogs(result.data), device);
  const punches = normalizePunches(rows, { ...device, protocol: "stellarbd" });
  return {
    protocol: "stellarbd",
    connected: true,
    logCount: punches.length,
    punches,
    message: `Fetched ${punches.length} punch(es) from StellarBD`
  };
}

module.exports = {
  testStellarbd,
  connectStellarbd,
  fetchBody,
  extractLogs,
  today
};
