const axios = require("axios");
const { normalizePunches } = require("../fields");

const COMMON_PATHS = [
  "/api/attendance",
  "/att/api/transaction/",
  "/iclock/cdata",
  "/cgi-bin/Attendance.cgi",
  "/"
];

function baseUrl(device) {
  const port = Number(device.port) || 80;
  const proto = port === 443 ? "https" : "http";
  return `${proto}://${device.ip}:${port}`;
}

function authHeaders(device) {
  const headers = { "Content-Type": "application/json" };
  if (device.username && device.password) {
    const token = Buffer.from(`${device.username}:${device.password}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }
  if (device.token) {
    headers.Authorization = device.token.startsWith("Bearer ") || device.token.startsWith("JWT ")
      ? device.token
      : `Bearer ${device.token}`;
  }
  return headers;
}

function normalizeRows(payload, device) {
  return normalizePunches(payload, { ...device, protocol: "http" });
}

async function tryPath(device, path) {
  const url = `${baseUrl(device)}${path}`;
  const res = await axios.get(url, {
    headers: authHeaders(device),
    timeout: Number(device.timeout) || 8000,
    validateStatus: () => true
  });
  return { url, status: res.status, data: res.data };
}

async function testHttp(device) {
  const path = device.path || "";
  const paths = path ? [path, ...COMMON_PATHS.filter((p) => p !== path)] : COMMON_PATHS;
  const errors = [];
  for (const p of paths) {
    try {
      const result = await tryPath(device, p);
      if (result.status >= 200 && result.status < 500) {
        return {
          ok: true,
          protocol: "http",
          message: `HTTP ${result.status} from ${result.url}`,
          status: result.status,
          path: p
        };
      }
      errors.push(`${p} -> ${result.status}`);
    } catch (err) {
      errors.push(`${p} -> ${err.message}`);
    }
  }
  return { ok: false, protocol: "http", message: errors.join("; ") };
}

async function connectHttp(device) {
  const path = device.path || "/api/attendance";
  const result = await tryPath(device, path);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status} from ${result.url}`);
  }
  const punches = normalizeRows(result.data, device);
  return {
    protocol: "http",
    connected: true,
    path,
    logCount: punches.length,
    punches
  };
}

module.exports = { testHttp, connectHttp, normalizeRows, baseUrl };
