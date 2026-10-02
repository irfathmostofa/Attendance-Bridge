const net = require("net");
const ZKLib = require("node-zklib");
const { COMMANDS } = require("node-zklib/constants");
const { extraParams } = require("../fields");

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

function writeAscii(buf, offset, value, length) {
  buf.fill(0, offset, offset + length);
  buf.write(String(value || "").slice(0, length), offset, length, "ascii");
}

function parseCardNo(value) {
  if (value == null || value === "") return 0;
  const s = String(value).trim();
  if (!s) return 0;
  if (/^0x/i.test(s) || /[a-f]/i.test(s)) {
    const n = parseInt(s.replace(/^0x/i, ""), 16);
    return Number.isFinite(n) ? n >>> 0 : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n >>> 0 : 0;
}

function encodeUserData72(user) {
  const buf = Buffer.alloc(72);
  buf.writeUInt16LE(Number(user.uid) || 0, 0);
  buf.writeUInt8(Number(user.role) || 0, 2);
  writeAscii(buf, 3, user.password || "", 8);
  writeAscii(buf, 11, user.name || "", 24);
  buf.writeUInt32LE(parseCardNo(user.cardno), 35);
  buf.writeUInt8(Number(user.group) || 1, 39);
  writeAscii(buf, 48, String(user.userId || "").slice(0, 9), 9);
  return buf;
}

function commandOk(reply) {
  if (!reply || reply.length < 2) return false;
  const code = reply.readUInt16LE(0);
  return code === COMMANDS.CMD_ACK_OK || code === COMMANDS.CMD_ACK_DATA;
}

function nextUid(users) {
  let max = 0;
  (users || []).forEach((u) => {
    const id = Number(u.uid) || 0;
    if (id > max) max = id;
  });
  return Math.min(max + 1, 65535) || 1;
}

function matchUser(users, student) {
  const sid = String(student.studentId || student.userId || "").slice(0, 8);
  const card = parseCardNo(student.cardNo || student.cardno);
  return (users || []).find((u) => {
    const uid = String(u.userId || "").slice(0, 8);
    if (sid && uid && uid === sid) return true;
    if (card && Number(u.cardno) === card) return true;
    return false;
  }) || null;
}

function mapDeviceUser(user) {
  return {
    uid: user.uid,
    userId: user.userId,
    name: user.name,
    cardNo: user.cardno ? String(user.cardno) : "",
    role: user.role
  };
}

async function withZk(device, fn) {
  const timeout = Number(device.timeout) || 10000;
  const port = Number(device.port) || 4370;
  const reachable = await tcpReachable(device.ip, port, timeout);
  if (!reachable.ok) {
    throw new Error(`TCP ${device.ip}:${port} unreachable: ${reachable.error}`);
  }
  const zk = new ZKLib(device.ip, port, timeout, 4000, Number(device.commKey) || 0);
  try {
    await zk.createSocket();
    await zk.disableDevice().catch(() => {});
    const result = await fn(zk);
    await zk.enableDevice().catch(() => {});
    await zk.executeCmd(COMMANDS.CMD_REFRESHDATA, "").catch(() => {});
    await zk.disconnect().catch(() => {});
    return result;
  } catch (err) {
    try { await zk.enableDevice(); } catch (_) {}
    try { await zk.disconnect(); } catch (_) {}
    throw err;
  }
}

async function listZkUsers(device) {
  return withZk(device, async (zk) => {
    const usersRes = await zk.getUsers().catch(() => ({ data: [] }));
    const users = Array.isArray(usersRes.data) ? usersRes.data : [];
    return {
      ok: true,
      protocol: "zkteco",
      count: users.length,
      users: users.map(mapDeviceUser)
    };
  });
}

async function setZkUser(zk, user) {
  const packet = encodeUserData72(user);
  const reply = await zk.executeCmd(COMMANDS.CMD_USER_WRQ, packet);
  if (!commandOk(reply)) {
    throw new Error(`Device rejected user ${user.userId || user.uid}`);
  }
  return true;
}

async function deleteZkUserByUid(zk, uid) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(Number(uid) || 0, 0);
  const reply = await zk.executeCmd(COMMANDS.CMD_DELETE_USER, buf);
  if (!commandOk(reply)) {
    throw new Error(`Device rejected delete for uid ${uid}`);
  }
  return true;
}

async function pushZkUsers(device, students) {
  return withZk(device, async (zk) => {
    const usersRes = await zk.getUsers().catch(() => ({ data: [] }));
    const existing = Array.isArray(usersRes.data) ? usersRes.data : [];
    let uidCursor = nextUid(existing);
    const results = [];
    for (const student of students || []) {
      const userId = String(student.studentId || "").trim();
      if (!userId) {
        results.push({ ok: false, studentId: "", message: "studentId is required" });
        continue;
      }
      const found = matchUser(existing, student);
      const uid = found ? found.uid : uidCursor++;
      try {
        await setZkUser(zk, {
          uid,
          role: 0,
          password: student.password || "",
          name: student.name || userId,
          cardno: student.cardNo,
          group: 1,
          userId
        });
        if (!found) existing.push({ uid, userId, cardno: parseCardNo(student.cardNo) });
        results.push({ ok: true, studentId: userId, uid, cardNo: String(parseCardNo(student.cardNo) || "") });
      } catch (err) {
        results.push({ ok: false, studentId: userId, uid, message: err.message });
      }
    }
    return {
      ok: results.every((r) => r.ok),
      protocol: "zkteco",
      written: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results
    };
  });
}

async function deleteZkUsers(device, students) {
  return withZk(device, async (zk) => {
    const usersRes = await zk.getUsers().catch(() => ({ data: [] }));
    const existing = Array.isArray(usersRes.data) ? usersRes.data : [];
    const results = [];
    for (const student of students || []) {
      const found = matchUser(existing, student);
      if (!found) {
        results.push({ ok: true, studentId: student.studentId, message: "not on device" });
        continue;
      }
      try {
        await deleteZkUserByUid(zk, found.uid);
        results.push({ ok: true, studentId: student.studentId, uid: found.uid });
      } catch (err) {
        results.push({ ok: false, studentId: student.studentId, uid: found.uid, message: err.message });
      }
    }
    return {
      ok: results.every((r) => r.ok),
      protocol: "zkteco",
      deleted: results.filter((r) => r.ok && r.uid).length,
      results
    };
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
      params: extraParams(log),
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

module.exports = {
  connectZk,
  testZk,
  tcpReachable,
  listZkUsers,
  pushZkUsers,
  deleteZkUsers,
  encodeUserData72,
  parseCardNo
};
