const axios = require("axios");
const store = require("./store");
const { pushZkUsers, deleteZkUsers, listZkUsers } = require("./protocols/zk");
const { inferType } = require("./deviceTypes");
const { buildAuthHeaders } = require("./auth");

function isZkDevice(device) {
  return inferType(device, {}) === "zkteco";
}

function sameId(a, b) {
  return String(a || "").trim().slice(0, 9) === String(b || "").trim().slice(0, 9) && String(a || "").trim() !== "";
}

function sameCard(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  const n1 = Number(left);
  const n2 = Number(right);
  if (Number.isFinite(n1) && Number.isFinite(n2) && n1 >= 0 && n2 >= 0) return n1 === n2;
  return left === right;
}

function userKey(student) {
  return String((student && (student.studentId || student.userId)) || "").trim();
}

function findDuplicate(list, student) {
  const id = userKey(student);
  const card = student && student.cardNo;
  return (list || []).find((row) => {
    if (row === student) return false;
    if (id && sameId(row.studentId || row.userId, id)) return true;
    if (card && sameCard(row.cardNo || row.cardno, card)) return true;
    return false;
  }) || null;
}

function splitNewAndDuplicates(incoming, existing) {
  const seen = [];
  const unique = [];
  const duplicates = [];
  (incoming || []).forEach((student) => {
    const fromExisting = findDuplicate(existing, student);
    const fromBatch = findDuplicate(seen, student);
    if (fromExisting) {
      duplicates.push({
        studentId: student.studentId,
        name: student.name,
        cardNo: student.cardNo,
        reason: sameId(fromExisting.studentId || fromExisting.userId, student.studentId) ? "studentId" : "cardNo",
        existingId: fromExisting.studentId || fromExisting.userId || ""
      });
      return;
    }
    if (fromBatch) {
      duplicates.push({
        studentId: student.studentId,
        name: student.name,
        cardNo: student.cardNo,
        reason: "batch",
        existingId: fromBatch.studentId
      });
      return;
    }
    unique.push(student);
    seen.push(student);
  });
  return { unique, duplicates };
}

const FIELD_ALIASES = {
  studentId: ["studentId", "student_id", "stuId", "stu_id", "empID", "empId", "emp_id", "userId", "user_id", "pin", "id"],
  name: ["name", "empName", "studentName", "fullName", "full_name", "student_name"],
  cardNo: ["cardNo", "card_no", "cardNumber", "card_number", "rfid", "rfidNo", "rfid_no", "card", "cardno"]
};

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
}

function normalizeStudent(row, fieldMap) {
  if (!row || typeof row !== "object") return null;
  const map = fieldMap || store.getConfig().studentFieldMap || {};
  const studentId = pickValue(row, [map.studentId, ...FIELD_ALIASES.studentId].filter(Boolean));
  if (!studentId) return null;
  return {
    studentId: studentId.slice(0, 9),
    name: pickValue(row, [map.name, ...FIELD_ALIASES.name].filter(Boolean)) || studentId,
    cardNo: pickValue(row, [map.cardNo, ...FIELD_ALIASES.cardNo].filter(Boolean)),
    password: row.password != null ? String(row.password) : "",
    updatedAt: new Date().toISOString(),
    source: row.source || "erp"
  };
}

function extractUserRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const keys = ["users", "students", "data", "records", "items", "rows", "results"];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.users)) return value.users;
    if (value && Array.isArray(value.students)) return value.students;
  }
  if (payload.studentId || payload.empID || payload.userId) return [payload];
  return [];
}

function normalizeStudents(body, fieldMap) {
  const rows = extractUserRows(body);
  if (!rows.length && body && !Array.isArray(body)) {
    const fallback = Array.isArray(body.students) ? body.students : [body];
    return fallback.map((row) => normalizeStudent(row, fieldMap)).filter(Boolean);
  }
  return rows.map((row) => normalizeStudent(row, fieldMap)).filter(Boolean);
}

function publicUser(row) {
  return {
    studentId: row.studentId,
    name: row.name || "",
    cardNo: row.cardNo || ""
  };
}

function usersContract(users, extra) {
  const list = (users || []).map(publicUser);
  return {
    ok: true,
    count: list.length,
    users: list,
    ...(extra || {})
  };
}

function demoUsersResponse() {
  return usersContract([
    { studentId: "1001", name: "John Doe", cardNo: "12345678" },
    { studentId: "1002", name: "Jane Smith", cardNo: "87654321" }
  ], {
    demo: true,
    message: "Required bridge format. Admin Get Users / Get New Users API must return this shape. Extra keys and aliases (empID, rfid, card_no) are accepted and mapped."
  });
}

function resolveUserApi(options) {
  const config = store.getConfig();
  const newOnly = options && options.newOnly;
  const url = (options && options.url)
    || (newOnly && config.userNewFetchUrl)
    || config.userFetchUrl;
  const method = String(
    (options && options.method)
    || (newOnly && config.userNewFetchMethod)
    || config.userFetchMethod
    || "GET"
  ).toLowerCase();
  return { config, url, method };
}

async function fetchUsersFromApi(options) {
  const { config, url, method } = resolveUserApi(options);
  if (!url) {
    throw new Error(options && options.newOnly
      ? "Get New Users API URL is not configured. Set it in Settings."
      : "User fetch URL is not configured. Set it in Settings.");
  }
  const headers = await buildAuthHeaders(config);
  const res = await axios.request({
    url,
    method,
    headers,
    timeout: 20000,
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`User API HTTP ${res.status} from ${url}`);
  }
  const fieldMap = (options && options.fieldMap) || config.studentFieldMap;
  const users = normalizeStudents(res.data, fieldMap);
  const contract = usersContract(users, { source: url });
  if (!users.length) {
    contract.message = "API responded but no users were found. Required format: { ok: true, count: N, users: [{ studentId, name, cardNo }] }";
  }
  return {
    ...contract,
    rawCount: extractUserRows(res.data).length
  };
}

function targetDevices(deviceId) {
  const devices = store.getConfig().devices || [];
  if (deviceId) {
    const found = devices.find((d) => d.id === deviceId);
    if (!found) throw new Error("Device not found");
    return [found];
  }
  return devices;
}

async function pushToDevices(students, deviceId) {
  return pushNewUsersToDevices(students, deviceId);
}

async function ingestStudents(body, options) {
  const fieldMap = (options && options.fieldMap) || store.getConfig().studentFieldMap;
  const students = normalizeStudents(body, fieldMap);
  if (!students.length) {
    throw new Error("No students found. Send studentId (or mapped field) and optional name, cardNo.");
  }
  const stored = store.getStudents();
  const split = splitNewAndDuplicates(students, stored);
  if (!split.unique.length && split.duplicates.length) {
    store.addEvent({
      type: "students",
      level: "info",
      message: `Skipped ${split.duplicates.length} duplicate user(s)`
    });
    return {
      ok: true,
      count: 0,
      newCount: 0,
      duplicateCount: split.duplicates.length,
      students: [],
      duplicates: split.duplicates,
      push: { ok: true, skipped: true, devices: [] }
    };
  }
  const saved = split.unique.length ? store.upsertStudents(split.unique) : store.getStudents();
  const shouldPush = options && options.push === false ? false : true;
  let push = { ok: true, devices: [], skipped: true };
  if (shouldPush && split.unique.length) {
    push = await pushNewUsersToDevices(split.unique, options && options.deviceId);
  }
  store.addEvent({
    type: "students",
    level: push.ok ? "success" : "warn",
    message: `ERP sent ${students.length} user(s), new ${split.unique.length}, duplicate ${split.duplicates.length}` + (shouldPush ? `, device write ${push.ok ? "ok" : "failed"}` : " (stored only)")
  });
  return {
    ok: true,
    count: split.unique.length,
    newCount: split.unique.length,
    duplicateCount: split.duplicates.length,
    students: saved.filter((s) => split.unique.some((n) => n.studentId === s.studentId)),
    duplicates: split.duplicates,
    push
  };
}

function deviceUserList(listed) {
  return (listed && listed.users) || [];
}

function mapDeviceAsStudent(user) {
  return {
    studentId: String(user.userId || user.uid || "").trim(),
    name: user.name || "",
    cardNo: user.cardNo || user.cardno || ""
  };
}

async function ingestFromUserApi(options) {
  const fetched = await fetchUsersFromApi(options);
  if (!fetched.users.length) {
    store.addEvent({
      type: "students",
      level: "info",
      message: fetched.message || "User API returned no users"
    });
    return {
      ...fetched,
      newCount: 0,
      duplicateCount: 0,
      duplicates: [],
      students: [],
      push: { ok: true, skipped: true, devices: [] }
    };
  }
  const ingested = await ingestStudents({ users: fetched.users }, {
    push: options && options.push === false ? false : true,
    deviceId: options && options.deviceId
  });
  return {
    ...usersContract(ingested.students || fetched.users, {
      source: fetched.source,
      fetchedCount: fetched.count,
      newCount: ingested.newCount,
      duplicateCount: ingested.duplicateCount,
      duplicates: ingested.duplicates,
      students: ingested.students,
      push: ingested.push
    })
  };
}

function newUsersContract(newUsers, extra) {
  const contract = usersContract(newUsers, extra);
  contract.newUsers = contract.users;
  return contract;
}

async function checkNewUsers(deviceId) {
  const config = store.getConfig();
  const previousStored = store.getStudents();
  let fetchedUsers = [];
  let source = "";
  let fetchMessage = "";
  let fetchedOk = true;

  const fetchUrl = config.userNewFetchUrl || config.userFetchUrl;
  if (fetchUrl) {
    try {
      const fetched = await fetchUsersFromApi({ newOnly: true });
      fetchedUsers = (fetched.users || []).map((u) => ({ ...u, source: "user-api" }));
      source = fetched.source || fetchUrl;
      const splitIncoming = splitNewAndDuplicates(fetchedUsers, previousStored);
      if (splitIncoming.unique.length) store.upsertStudents(splitIncoming.unique);
    } catch (err) {
      fetchedOk = false;
      fetchMessage = err.message;
      store.addEvent({ type: "students", level: "warn", message: "User API fetch failed: " + err.message });
    }
  }

  const stored = store.getStudents();
  const devices = targetDevices(deviceId);

  if (!devices.length) {
    const split = fetchedUsers.length
      ? splitNewAndDuplicates(fetchedUsers, previousStored)
      : { unique: [], duplicates: [] };
    return newUsersContract(split.unique, {
      ok: fetchedOk,
      source,
      storedCount: stored.length,
      fetchedCount: fetchedUsers.length,
      newCount: split.unique.length,
      duplicateCount: split.duplicates.length,
      duplicates: split.duplicates,
      devices: [],
      ...(fetchMessage
        ? { message: fetchMessage }
        : fetchUrl
          ? {}
          : { message: "Set Get Users / Get New Users API URL in Settings. Admin API must return { ok, count, users: [{ studentId, name, cardNo }] }." })
    });
  }

  const results = [];
  for (const device of devices) {
    if (!isZkDevice(device)) {
      const split = fetchedUsers.length
        ? splitNewAndDuplicates(fetchedUsers, previousStored)
        : splitNewAndDuplicates(stored, []);
      results.push({
        deviceId: device.id,
        name: device.name,
        type: device.type || device.protocol,
        ok: true,
        skipped: true,
        message: `${device.type || device.protocol} cannot read onboard users; returning new users from admin API`,
        newUsers: split.unique.map(publicUser),
        duplicates: split.duplicates
      });
      continue;
    }
    try {
      const listed = await listZkUsers(device);
      const onDevice = deviceUserList(listed).map(mapDeviceAsStudent);
      const candidates = fetchedUsers.length ? fetchedUsers : stored;
      const split = splitNewAndDuplicates(candidates, onDevice);
      results.push({
        deviceId: device.id,
        name: device.name,
        ip: device.ip,
        ok: true,
        deviceUserCount: onDevice.length,
        newCount: split.unique.length,
        duplicateCount: split.duplicates.length,
        newUsers: split.unique.map(publicUser),
        duplicates: split.duplicates
      });
    } catch (err) {
      results.push({
        deviceId: device.id,
        name: device.name,
        ip: device.ip,
        ok: false,
        message: err.message,
        newUsers: [],
        duplicates: []
      });
    }
  }
  const pool = fetchedUsers.length ? fetchedUsers : stored;
  const newUsers = results.length === 1 ? results[0].newUsers : pool.filter((student) => {
    return results.some((row) => (row.newUsers || []).some((u) => u.studentId === student.studentId));
  });
  const duplicates = results.flatMap((row) => (row.duplicates || []).map((dup) => ({ ...dup, deviceId: row.deviceId })));
  return newUsersContract(newUsers, {
    ok: fetchedOk && results.every((row) => row.ok),
    source,
    storedCount: stored.length,
    fetchedCount: fetchedUsers.length,
    newCount: newUsers.length,
    duplicateCount: duplicates.length,
    duplicates,
    devices: results,
    ...(fetchMessage ? { message: fetchMessage } : {})
  });
}

async function pushNewUsersToDevices(students, deviceId) {
  const devices = targetDevices(deviceId);
  if (!devices.length) {
    return { ok: false, message: "No device configured", devices: [] };
  }
  const deviceResults = [];
  for (const device of devices) {
    if (!isZkDevice(device)) {
      deviceResults.push({
        deviceId: device.id,
        ip: device.ip || device.apiUrl || "",
        ok: true,
        skipped: true,
        newCount: 0,
        duplicateCount: 0,
        message: `${device.type || device.protocol} does not support writing users from this bridge`
      });
      continue;
    }
    try {
      const listed = await listZkUsers(device);
      const onDevice = deviceUserList(listed).map(mapDeviceAsStudent);
      const split = splitNewAndDuplicates(students, onDevice);
      let written = { ok: true, written: 0, failed: 0, results: [] };
      if (split.unique.length) {
        written = await pushZkUsers(device, split.unique);
      }
      deviceResults.push({
        deviceId: device.id,
        ip: device.ip,
        ok: written.ok,
        newCount: split.unique.length,
        duplicateCount: split.duplicates.length,
        written: written.written || 0,
        failed: written.failed || 0,
        duplicates: split.duplicates,
        results: written.results || []
      });
    } catch (err) {
      deviceResults.push({
        deviceId: device.id,
        ip: device.ip,
        ok: false,
        message: err.message
      });
    }
  }
  return {
    ok: deviceResults.every((d) => d.ok),
    devices: deviceResults
  };
}

async function pushStoredStudents(deviceId) {
  const students = store.getStudents();
  if (!students.length) throw new Error("No students stored");
  const push = await pushNewUsersToDevices(students, deviceId);
  const newCount = (push.devices || []).reduce((n, d) => n + (Number(d.newCount) || 0), 0);
  const duplicateCount = (push.devices || []).reduce((n, d) => n + (Number(d.duplicateCount) || 0), 0);
  store.addEvent({
    type: "students",
    level: push.ok ? "success" : "warn",
    message: `Pushed ${newCount} new user(s), skipped ${duplicateCount} duplicate(s)`
  });
  return { ok: push.ok, count: newCount, newCount, duplicateCount, push };
}

async function pushNewUsers(deviceId) {
  const check = await checkNewUsers(deviceId);
  if (!check.newUsers.length) {
    store.addEvent({
      type: "students",
      level: "info",
      message: `No new users to push. ${check.duplicateCount} duplicate(s) skipped`
    });
    return newUsersContract([], {
      ok: true,
      newCount: 0,
      duplicateCount: check.duplicateCount,
      duplicates: check.duplicates,
      source: check.source,
      push: { ok: true, skipped: true, devices: check.devices }
    });
  }
  const push = await pushNewUsersToDevices(check.newUsers, deviceId);
  store.addEvent({
    type: "students",
    level: push.ok ? "success" : "warn",
    message: `Device requested new users: pushed ${check.newCount}, skipped ${check.duplicateCount} duplicate(s)`
  });
  return newUsersContract(check.newUsers, {
    ok: push.ok,
    newCount: check.newCount,
    duplicateCount: check.duplicateCount,
    duplicates: check.duplicates,
    source: check.source,
    push
  });
}

async function removeStudentEverywhere(studentId, options) {
  const student = store.getStudents().find((s) => String(s.studentId) === String(studentId));
  if (!student) throw new Error("Student not found");
  const shouldPush = options && options.device === false ? false : true;
  let device = { ok: true, devices: [], skipped: true };
  if (shouldPush) {
    const devices = targetDevices(options && options.deviceId);
    const deviceResults = [];
    for (const d of devices) {
      if (!isZkDevice(d)) {
        deviceResults.push({ deviceId: d.id, ip: d.ip || d.apiUrl || "", ok: true, skipped: true });
        continue;
      }
      try {
        deviceResults.push({ deviceId: d.id, ip: d.ip, ...(await deleteZkUsers(d, [student])) });
      } catch (err) {
        deviceResults.push({ deviceId: d.id, ip: d.ip, ok: false, message: err.message });
      }
    }
    device = { ok: deviceResults.every((r) => r.ok), devices: deviceResults };
  }
  store.removeStudent(studentId);
  store.addEvent({
    type: "students",
    level: "info",
    message: `Removed student ${studentId}`
  });
  return { ok: true, studentId, device };
}

async function listDeviceUsers(deviceId) {
  const [device] = targetDevices(deviceId);
  if (!isZkDevice(device)) {
    return {
      ok: false,
      protocol: device.protocol || device.type,
      users: [],
      message: "User list is only supported for ZKTeco devices"
    };
  }
  return listZkUsers(device);
}

module.exports = {
  normalizeStudent,
  normalizeStudents,
  ingestStudents,
  ingestFromUserApi,
  fetchUsersFromApi,
  demoUsersResponse,
  pushStoredStudents,
  pushNewUsers,
  checkNewUsers,
  removeStudentEverywhere,
  listDeviceUsers,
  pushToDevices,
  splitNewAndDuplicates
};
