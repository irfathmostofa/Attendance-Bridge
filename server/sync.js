const axios = require("axios");
const store = require("./store");

function fixedPayload(row) {
  return {
    empID: row.empID,
    empName: row.empName,
    date: row.date,
    inTime: row.inTime,
    outTime: row.outTime,
    total_time: row.total_time
  };
}

async function postOne(config, row) {
  const payload = fixedPayload(row);
  const res = await axios.post(config.syncUrl, payload, {
    headers: { "Content-Type": "application/json" },
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
