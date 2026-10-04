const store = require("./store");
const { pushZkUsers, deleteZkUsers, listZkUsers } = require("./protocols/zk");
const { inferType } = require("./deviceTypes");

function isZkDevice(device) {
  return inferType(device, {}) === "zkteco";
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

function normalizeStudents(body, fieldMap) {
  const rows = Array.isArray(body) ? body : body && Array.isArray(body.students) ? body.students : [body];
  return rows.map((row) => normalizeStudent(row, fieldMap)).filter(Boolean);
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
        message: `${device.type || device.protocol} does not support writing users from this bridge`
      });
      continue;
    }
    try {
      const result = await pushZkUsers(device, students);
      deviceResults.push({
        deviceId: device.id,
        ip: device.ip,
        ...result
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

async function ingestStudents(body, options) {
  const fieldMap = (options && options.fieldMap) || store.getConfig().studentFieldMap;
  const students = normalizeStudents(body, fieldMap);
  if (!students.length) {
    throw new Error("No students found. Send studentId (or mapped field) and optional name, cardNo.");
  }
  const saved = store.upsertStudents(students);
  const shouldPush = options && options.push === false ? false : true;
  let push = { ok: true, devices: [], skipped: true };
  if (shouldPush) {
    push = await pushToDevices(students, options && options.deviceId);
  }
  store.addEvent({
    type: "students",
    level: push.ok ? "success" : "warn",
    message: `ERP sent ${students.length} student(s)` + (shouldPush ? `, device write ${push.ok ? "ok" : "failed"}` : " (stored only)")
  });
  return {
    ok: true,
    count: students.length,
    students: saved.filter((s) => students.some((n) => n.studentId === s.studentId)),
    push
  };
}

async function pushStoredStudents(deviceId) {
  const students = store.getStudents();
  if (!students.length) throw new Error("No students stored");
  const push = await pushToDevices(students, deviceId);
  store.addEvent({
    type: "students",
    level: push.ok ? "success" : "warn",
    message: `Pushed ${students.length} stored student(s) to device(s)`
  });
  return { ok: push.ok, count: students.length, push };
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
  pushStoredStudents,
  removeStudentEverywhere,
  listDeviceUsers,
  pushToDevices
};
