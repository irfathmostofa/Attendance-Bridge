const axios = require("axios");
const store = require("./store");
const { buildAuthHeaders } = require("./auth");

const LOGICAL_FIELDS = ["empID", "empName", "date", "inTime", "outTime", "total_time"];

function buildPayload(config, row) {
  const map = config.fieldMap || {};
  const payload = {};
  for (const key of LOGICAL_FIELDS) {
    const outKey = map[key];
    if (outKey) payload[outKey] = row[key];
  }
  return { ...payload, ...(config.extraFields || {}) };
}

async function postOne(config, row) {
  const payload = buildPayload(config, row);
  const method = String(config.syncMethod || "POST").toLowerCase();
  const headers = await buildAuthHeaders(config);
  const res = await axios.request({
    url: config.syncUrl,
    method,
    headers,
    data: payload,
    timeout: 15000
  });
  return { response: res.data, payload };
}

async function syncAttendance(limit) {
  const config = store.getConfig();
  const url = config.syncUrl;
  if (!url) {
    throw new Error("Sync URL is not configured");
  }
  const rows = store.getAttendance();
  const pending = rows.filter((r) => !r.synced).slice(0, Number(limit) || 500);
  let ok = 0;
  let fail = 0;
  let lastPayload = null;

  for (const row of pending) {
    try {
      const result = await postOne(config, row);
      lastPayload = result.payload;
      row.synced = true;
      row.syncedAt = new Date().toISOString();
      row.syncError = null;
      ok += 1;
    } catch (err) {
      row.syncError = err.response ? err.response.data : err.message;
      fail += 1;
    }
  }

  store.saveAttendance(rows);
  store.addEvent({
    type: "sync",
    level: fail ? "warn" : "success",
    message: `Synced ${ok} record(s), ${fail} failed`
  });
  return { ok, fail, total: pending.length, url, samplePayload: lastPayload };
}

module.exports = { syncAttendance };
