const net = require("net");
const ZKLib = require("node-zklib");

function tcpReachable(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, error: error || null });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "Connection timed out"));
    socket.once("error", (err) => finish(false, err.message));
    socket.connect(Number(port), ip);
  });
}

function mapZkLogs(logs, users, device) {
  const names = new Map();
  (users || []).forEach((user) => {
    const id = String(user.userId || user.uid || user.userid || "");
    const name = user.name || user.userName || id;
    if (id) names.set(id, name);
  });
  return (logs || []).map((log) => {
    const empID = String(log.deviceUserId || log.uid || log.userId || log.userSn || "");
    const stamp = log.recordTime || log.timestamp || log.attTime;
    const dt = stamp ? new Date(stamp) : new Date();
    const date = Number.isNaN(dt.getTime()) ? String(stamp).slice(0, 10) : dt.toISOString().slice(0, 10);
    const time = Number.isNaN(dt.getTime())
      ? String(stamp).slice(11, 19)
      : dt.toTimeString().slice(0, 8);
    return {
      empID,
      empName: names.get(empID) || empID,
      date,
      time,
      punchTime: Number.isNaN(dt.getTime()) ? String(stamp) : dt.toISOString(),
      deviceId: device.id,
      deviceName: device.name,
      source: "zkteco"
    };
  });
}

async function connectZk(device) {
  const timeout = Number(device.timeout) || 10000;
  const port = Number(device.port) || 4370;
  const reachable = await tcpReachable(device.ip, port, timeout);
  if (!reachable.ok) {
    throw new Error(`TCP ${device.ip}:${port} unreachable: ${reachable.error}`);
  }
  const zk = new ZKLib(device.ip, port, timeout, 4000, Number(device.commKey) || 0);
  try {
    await zk.createSocket();
    const info = await zk.getInfo().catch(() => null);
    const usersRes = await zk.getUsers().catch(() => ({ data: [] }));
    const attRes = await zk.getAttendances().catch(() => ({ data: [] }));
    await zk.disconnect().catch(() => {});
    const users = usersRes.data || usersRes || [];
    const logs = attRes.data || attRes || [];
    return {
      protocol: "zkteco",
      connected: true,
      info,
      userCount: Array.isArray(users) ? users.length : 0,
      logCount: Array.isArray(logs) ? logs.length : 0,
      punches: mapZkLogs(Array.isArray(logs) ? logs : [], Array.isArray(users) ? users : [], device)
    };
  } catch (err) {
    try {
      await zk.disconnect();
    } catch (_) {}
    throw new Error(`ZKTeco protocol failed on ${device.ip}:${port}: ${err.message}`);
  }
}

async function testZk(device) {
  const timeout = Number(device.timeout) || 8000;
  const port = Number(device.port) || 4370;
  const reachable = await tcpReachable(device.ip, port, timeout);
  if (!reachable.ok) {
    return { ok: false, protocol: "zkteco", message: reachable.error };
  }
  const zk = new ZKLib(device.ip, port, timeout, 4000, Number(device.commKey) || 0);
  try {
    await zk.createSocket();
    const info = await zk.getInfo().catch(() => ({ ip: device.ip }));
    await zk.disconnect().catch(() => {});
    return {
      ok: true,
      protocol: "zkteco",
      message: `Connected to ${device.ip}:${port}`,
      info
    };
  } catch (err) {
    try {
      await zk.disconnect();
    } catch (_) {}
    return {
      ok: true,
      protocol: "tcp",
      message: `Port open on ${device.ip}:${port}, ZK handshake failed: ${err.message}. Device may use iClock push or HTTP.`
    };
  }
}

module.exports = { connectZk, testZk, tcpReachable };
