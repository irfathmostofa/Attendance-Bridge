const { connectZk, testZk } = require("./protocols/zk");
const { connectHttp, testHttp } = require("./protocols/http");
const { testTcp, connectTcp } = require("./protocols/tcp");
const store = require("./store");
const { discoveredFields, groupPunches } = require("./fields");

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
    store.saveConfig({ discoveredFields: discoveredFields(grouped) });
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
