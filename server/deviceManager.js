const { connectZk, testZk } = require("./protocols/zk");
const { connectHttp, testHttp } = require("./protocols/http");
const { testTcp, connectTcp } = require("./protocols/tcp");
const store = require("./store");

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
        deviceId: p.deviceId,
        deviceName: p.deviceName,
        source: p.source,
        synced: false
      });
    }
    const row = map.get(key);
    const t = p.time || p.inTime;
    if (t) row.punches.push(t);
    if (!row.empName && p.empName) row.empName = p.empName;
  });
  return Array.from(map.values()).map((row) => {
    const times = row.punches.filter(Boolean).sort();
    row.inTime = times[0] || row.inTime;
    row.outTime = times.length > 1 ? times[times.length - 1] : row.outTime;
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

async function autoDetect(device) {
  const protocol = (device.protocol || "auto").toLowerCase();
  if (protocol === "zkteco" || protocol === "zk") {
    return connectZk(device);
  }
  if (protocol === "http") {
    return connectHttp(device);
  }
  if (protocol === "tcp") {
    return connectTcp(device);
  }
  if (protocol === "iclock") {
    return {
      protocol: "iclock",
      connected: true,
      punches: store.getAttendance().filter((r) => r.deviceId === device.id || r.serial === device.serial),
      message: "iClock devices push data to this server. Set device ADMS/cloud server to this PC IP and port."
    };
  }

  const zkTry = await testZk(device);
  if (zkTry.ok && zkTry.protocol === "zkteco") {
    return connectZk(device);
  }
  const httpTry = await testHttp(device);
  if (httpTry.ok) {
    try {
      return await connectHttp({ ...device, path: httpTry.path });
    } catch (_) {}
  }
  const tcpTry = await testTcp(device);
  if (!tcpTry.ok) {
    throw new Error(tcpTry.message || zkTry.message || "Device not reachable");
  }
  return {
    protocol: "tcp",
    connected: true,
    punches: [],
    message: `Port ${device.port} is open but attendance protocol was not detected. Use HTTP path or enable iClock push.`
  };
}

async function testDevice(device) {
  const protocol = (device.protocol || "auto").toLowerCase();
  if (protocol === "zkteco" || protocol === "zk") return testZk(device);
  if (protocol === "http") return testHttp(device);
  if (protocol === "tcp") return testTcp(device);
  if (protocol === "iclock") {
    return {
      ok: true,
      protocol: "iclock",
      message: "Waiting for device to push. Point the device cloud/ADMS server to this PC."
    };
  }
  const zk = await testZk(device);
  if (zk.ok) return zk;
  const http = await testHttp(device);
  if (http.ok) return http;
  return testTcp(device);
}

async function pullDevice(device) {
  const result = await autoDetect(device);
  const grouped = groupPunches(result.punches || []);
  if (grouped.length) {
    store.upsertAttendance(grouped);
  }
  store.addEvent({
    type: "pull",
    level: grouped.length ? "success" : "info",
    message: `Pulled ${grouped.length} record(s) from ${device.name || device.ip}`
  });
  return {
    ...result,
    punches: grouped,
    logCount: grouped.length
  };
}

module.exports = { testDevice, pullDevice, groupPunches, autoDetect };
