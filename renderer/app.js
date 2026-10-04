const state = {
  api: "",
  devices: [],
  attendance: [],
  students: [],
  events: [],
  backups: [],
  backupMeta: {},
  config: {},
  electron: false
};

async function api(path, options) {
  const res = await fetch(state.api + path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function setView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + name));
  document.querySelectorAll(".nav-btn").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function currentType(form) {
  return (form && form.type && form.type.value) || "stellarbd";
}

function applyDeviceType(form) {
  if (!form) return;
  const type = currentType(form);
  form.querySelectorAll("[data-fields]").forEach((el) => {
    el.classList.toggle("hidden", el.getAttribute("data-fields") !== type);
  });
  const stellar = type === "stellarbd";
  const zk = type === "zkteco";
  const name = form.querySelector('[name="name"]');
  const authUser = form.querySelector('[name="authUser"]');
  const authCode = form.querySelector('[name="authCode"]');
  const ip = form.querySelector('[name="ip"]');
  const port = form.querySelector('[name="port"]');
  if (name) name.required = true;
  if (authUser) authUser.required = stellar;
  if (authCode) authCode.required = stellar;
  if (ip) ip.required = zk;
  if (port) port.required = zk;
  const hint = form.querySelector("#quickResult");
  if (hint && form.id === "quickForm") {
    if (type === "stellarbd") hint.textContent = "Select StellarBD, enter auth_user and auth_code, then test or pull.";
    else if (type === "tipsoi") hint.textContent = "Tipsoi is not connected yet. Choose StellarBD.";
    else hint.textContent = "Leave username, password, and comm key empty if the device has none.";
  }
}

function devicePayload(data) {
  const type = data.type || "stellarbd";
  const name = (data.name || "").trim();
  if (type === "stellarbd") {
    return {
      type: "stellarbd",
      protocol: "stellarbd",
      name: name || "StellarBD",
      apiUrl: data.apiUrl || "https://rumytechnologies.com/rams/json_api",
      authUser: data.authUser || "",
      authCode: data.authCode || ""
    };
  }
  if (type === "tipsoi") {
    return {
      type: "tipsoi",
      protocol: "tipsoi",
      name: name || "Tipsoi",
      apiUrl: data.apiUrl || "",
      username: data.username || "",
      password: data.password || ""
    };
  }
  return {
    type: "zkteco",
    protocol: "auto",
    name: name || data.ip,
    ip: data.ip,
    port: Number(data.port) || 4370,
    username: data.username || "",
    password: data.password || "",
    commKey: Number(data.commKey) || 0
  };
}

function deviceTarget(d) {
  if (d.type === "stellarbd" || d.protocol === "stellarbd") return d.apiUrl || "RAMS API";
  if (d.type === "tipsoi") return d.apiUrl || "-";
  return d.ip ? `${d.ip}:${d.port || 4370}` : "-";
}

function deviceUser(d) {
  return d.authUser || d.username || "-";
}

function renderDevices() {
  const body = document.getElementById("deviceTable");
  body.innerHTML = state.devices.map((d) => `
    <tr>
      <td>${d.name || "-"}</td>
      <td>${d.type || d.protocol || "-"}</td>
      <td>${deviceTarget(d)}</td>
      <td>${deviceUser(d)}</td>
      <td class="actions">
        <button data-act="test" data-id="${d.id}">Test</button>
        <button data-act="pull" data-id="${d.id}">Pull</button>
        <button class="ghost" data-act="del" data-id="${d.id}">Remove</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">No devices yet</td></tr>`;
}

const CORE_FIELDS = ["empID", "empName", "date", "inTime", "outTime", "total_time"];

function extraFromRow(row) {
  const params = row && row.params && typeof row.params === "object" ? row.params : {};
  const skip = new Set(["punches", "synced", "syncedAt", "syncError", "id", "raw", "params", "deviceId", "deviceName", "source", "serial", "punchTime", "time", ...CORE_FIELDS]);
  const extra = { ...params };
  Object.entries(row || {}).forEach(([key, value]) => {
    if (skip.has(key) || value == null || typeof value === "object") return;
    if (extra[key] === undefined) extra[key] = value;
  });
  return extra;
}

function discoveredFieldList() {
  const keys = new Set([...(state.config.discoveredFields || []), ...CORE_FIELDS]);
  state.attendance.forEach((row) => {
    Object.keys(extraFromRow(row)).forEach((key) => keys.add(key));
  });
  const extras = Array.from(keys).filter((key) => !CORE_FIELDS.includes(key)).sort();
  return [...CORE_FIELDS, ...extras];
}

function cellValue(row, key) {
  if (row[key] != null && row[key] !== "") return row[key];
  const extra = extraFromRow(row);
  if (extra[key] != null && extra[key] !== "") return extra[key];
  return "";
}

function renderAttendance() {
  const fields = discoveredFieldList();
  const extra = fields.filter((key) => !CORE_FIELDS.includes(key));
  document.getElementById("attHead").innerHTML = `<tr>
    <th>Date</th>
    <th>Emp ID</th>
    <th>Name</th>
    <th>In</th>
    <th>Out</th>
    <th>Total</th>
    ${extra.map((key) => `<th>${key}</th>`).join("")}
    <th>Device</th>
    <th>Synced</th>
  </tr>`;
  const body = document.getElementById("attTable");
  const colspan = 8 + extra.length;
  body.innerHTML = state.attendance.slice(0, 300).map((r) => `
    <tr>
      <td>${r.date || ""}</td>
      <td>${r.empID || ""}</td>
      <td>${r.empName || ""}</td>
      <td>${r.inTime || ""}</td>
      <td>${r.outTime || ""}</td>
      <td>${r.total_time || ""}</td>
      ${extra.map((key) => `<td>${cellValue(r, key)}</td>`).join("")}
      <td>${r.deviceName || r.ip || r.deviceId || ""}</td>
      <td><span class="badge ${r.synced ? "ok" : "no"}">${r.synced ? "yes" : "no"}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="${colspan}">No attendance records</td></tr>`;
}

function renderStudents() {
  const body = document.getElementById("studentTable");
  body.innerHTML = state.students.map((s) => `
    <tr>
      <td>${s.studentId || ""}</td>
      <td>${s.name || ""}</td>
      <td>${s.cardNo || ""}</td>
      <td>${s.updatedAt || ""}</td>
      <td class="actions">
        <button class="ghost" data-act="del" data-id="${s.studentId}">Remove</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">No students yet</td></tr>`;
}

function renderEvents() {
  document.getElementById("eventList").innerHTML = state.events.slice(0, 20).map((e) => `
    <li><strong>${e.level}</strong> ${e.message}<br /><small>${e.time || ""}</small></li>
  `).join("") || "<li>No activity yet</li>";
}

function renderStats() {
  document.getElementById("statDevices").textContent = state.devices.length;
  document.getElementById("statRecords").textContent = state.attendance.length;
  document.getElementById("statPending").textContent = state.attendance.filter((r) => !r.synced).length;
  document.getElementById("statEvents").textContent = state.events.length;
}

function fillFieldMap() {
  const box = document.getElementById("fieldMapBox");
  const map = state.config.fieldMap || {};
  const fields = discoveredFieldList();
  box.innerHTML = fields.map((key) => `
    <label>${key}
      <input data-src="${key}" value="${map[key] != null ? map[key] : key}" placeholder="${key}" />
    </label>
  `).join("");
}

function fillSettings() {
  const form = document.getElementById("settingsForm");
  const map = state.config.studentFieldMap || {};
  form.syncUrl.value = state.config.syncUrl || "";
  form.studentIdField.value = map.studentId || "studentId";
  form.studentNameField.value = map.name || "name";
  form.studentCardField.value = map.cardNo || "cardNo";
  form.extraFields.value = JSON.stringify(state.config.extraFields || {}, null, 2);
  fillFieldMap();
  fillBackupForm();
}

function fillBackupForm() {
  const form = document.getElementById("backupForm");
  if (!form) return;
  form.autoBackup.checked = state.config.autoBackup !== false;
  form.backupRetainDays.value = state.config.backupRetainDays || 30;
  form.backupIntervalHours.value = state.config.backupIntervalHours || 24;
  form.minimizeToTray.checked = state.config.minimizeToTray !== false;
  form.startMinimized.checked = !!state.config.startMinimized;
  const hint = document.getElementById("backupHint");
  const dir = state.backupMeta.dir || "";
  hint.textContent = dir
    ? "Backups folder: " + dir + (state.config.lastBackupAt ? " | last: " + state.config.lastBackupAt : "")
    : "Backups are stored in the app data folder.";
}

function renderBackups() {
  const body = document.getElementById("backupTable");
  if (!body) return;
  body.innerHTML = (state.backups || []).map((b, i) => `
    <tr>
      <td><input type="radio" name="backupPick" value="${b.name}" ${i === 0 ? "checked" : ""} /></td>
      <td>${b.createdAt || ""}</td>
      <td>${b.name || ""}</td>
      <td>${b.counts && b.counts.attendance != null ? b.counts.attendance : "-"}</td>
      <td>${b.counts && b.counts.students != null ? b.counts.students : "-"}</td>
      <td>${b.counts && b.counts.devices != null ? b.counts.devices : "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">No backups yet</td></tr>`;
}

function selectedBackupFile() {
  const picked = document.querySelector("input[name=backupPick]:checked");
  return picked ? picked.value : "";
}

function downloadUrl(path) {
  const a = document.createElement("a");
  a.href = state.api + path;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function readFieldMap() {
  const map = {};
  document.querySelectorAll("#fieldMapBox input[data-src]").forEach((input) => {
    map[input.dataset.src] = input.value.trim();
  });
  return map;
}

async function fillPreview() {
  const el = document.getElementById("payloadPreview");
  try {
    const preview = await api("/api/sync/preview");
    el.textContent = JSON.stringify(preview.samplePayload || {}, null, 2);
  } catch (err) {
    el.textContent = err.message;
  }
}

async function refresh() {
  const [devices, attendance, students, events, config, backups] = await Promise.all([
    api("/api/devices"),
    api("/api/attendance"),
    api("/api/students"),
    api("/api/events"),
    api("/api/config"),
    api("/api/backups")
  ]);
  state.devices = devices;
  state.attendance = attendance;
  state.students = students;
  state.events = events;
  state.config = config;
  state.backups = backups.items || [];
  state.backupMeta = backups;
  renderDevices();
  renderAttendance();
  renderStudents();
  renderEvents();
  renderStats();
  renderBackups();
  fillSettings();
  await fillPreview();
}

async function boot() {
  const info = await (window.bridge ? window.bridge.getApiInfo() : Promise.resolve({ url: "" }));
  state.api = info.url || "";
  state.electron = !!(window.bridge && info.electron);
  try {
    await api("/api/health");
    document.getElementById("serverDot").className = "dot ok";
    document.getElementById("serverStatus").textContent = "Ready";
    await refresh();
  } catch (err) {
    document.getElementById("serverDot").className = "dot err";
    document.getElementById("serverStatus").textContent = "Server offline";
  }
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

document.querySelectorAll("[data-type-select]").forEach((select) => {
  select.addEventListener("change", () => applyDeviceType(select.form));
});
applyDeviceType(document.getElementById("quickForm"));
applyDeviceType(document.getElementById("deviceForm"));

document.getElementById("deviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = devicePayload(formData(e.target));
  if (payload.type === "tipsoi") {
    alert("Tipsoi is not connected yet. Choose StellarBD.");
    return;
  }
  await api("/api/devices", { method: "POST", body: JSON.stringify(payload) });
  e.target.reset();
  if (e.target.type) e.target.type.value = "stellarbd";
  if (e.target.apiUrl) e.target.apiUrl.value = "https://rumytechnologies.com/rams/json_api";
  if (e.target.port) e.target.port.value = 4370;
  if (e.target.commKey) e.target.commKey.value = 0;
  applyDeviceType(e.target);
  await refresh();
});

document.getElementById("deviceTable").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "del") {
    await api("/api/devices/" + id, { method: "DELETE" });
  }
  if (btn.dataset.act === "test") {
    const result = await api("/api/devices/" + id + "/test", { method: "POST" });
    alert(result.message || JSON.stringify(result));
  }
  if (btn.dataset.act === "pull") {
    const result = await api("/api/devices/" + id + "/pull", { method: "POST" });
    alert((result.message || "Pulled") + " (" + (result.logCount || 0) + " records)");
  }
  await refresh();
});

document.getElementById("quickForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("quickResult");
  const payload = devicePayload(formData(e.target));
  if (payload.type === "tipsoi") {
    out.textContent = "Tipsoi is not connected yet. Choose StellarBD.";
    return;
  }
  out.textContent = "Testing...";
  try {
    const result = await api("/api/test", { method: "POST", body: JSON.stringify(payload) });
    out.textContent = result.message || JSON.stringify(result);
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("quickPull").addEventListener("click", async () => {
  const out = document.getElementById("quickResult");
  const payload = devicePayload(formData(document.getElementById("quickForm")));
  if (payload.type === "tipsoi") {
    out.textContent = "Tipsoi is not connected yet. Choose StellarBD.";
    return;
  }
  out.textContent = "Pulling logs...";
  try {
    const result = await api("/api/pull", { method: "POST", body: JSON.stringify(payload) });
    out.textContent = (result.message || "Done") + " | records: " + (result.logCount || 0);
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("syncBtn").addEventListener("click", async () => {
  const result = await api("/api/sync", { method: "POST", body: "{}" });
  alert("Synced " + result.ok + ", failed " + result.fail);
  await refresh();
});

document.getElementById("studentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("studentResult");
  out.textContent = "Saving...";
  try {
    const data = formData(e.target);
    const result = await api("/api/students", {
      method: "POST",
      body: JSON.stringify({ studentId: data.studentId, name: data.name, cardNo: data.cardNo })
    });
    const push = result.push || {};
    out.textContent = `Saved ${result.count}. Device write: ${push.ok ? "ok" : (push.message || "failed")}`;
    e.target.reset();
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("pushStudentsBtn").addEventListener("click", async () => {
  const out = document.getElementById("studentResult");
  out.textContent = "Pushing to device...";
  try {
    const result = await api("/api/students/push", { method: "POST", body: "{}" });
    out.textContent = "Pushed " + result.count + " student(s). " + (result.push && result.push.ok ? "Device OK" : "Device write failed");
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("studentTable").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.dataset.act !== "del") return;
  await api("/api/students/" + encodeURIComponent(btn.dataset.id), { method: "DELETE" });
  await refresh();
});

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formData(e.target);
  let extraFields = {};
  try {
    extraFields = data.extraFields ? JSON.parse(data.extraFields) : {};
  } catch (err) {
    alert("Extra fields must be valid JSON");
    return;
  }
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      syncUrl: data.syncUrl,
      fieldMap: readFieldMap(),
      extraFields,
      studentFieldMap: {
        studentId: data.studentIdField || "studentId",
        name: data.studentNameField || "name",
        cardNo: data.studentCardField || "cardNo"
      }
    })
  });
  await refresh();
});

document.getElementById("backupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      autoBackup: form.autoBackup.checked,
      backupRetainDays: Number(form.backupRetainDays.value) || 30,
      backupIntervalHours: Number(form.backupIntervalHours.value) || 24,
      minimizeToTray: form.minimizeToTray.checked,
      startMinimized: form.startMinimized.checked
    })
  });
  document.getElementById("backupResult").textContent = "Backup settings saved";
  await refresh();
});

document.getElementById("backupNowBtn").addEventListener("click", async () => {
  const out = document.getElementById("backupResult");
  out.textContent = "Saving backup...";
  try {
    const result = window.bridge && window.bridge.backupNow
      ? await window.bridge.backupNow("manual")
      : await api("/api/backups", { method: "POST", body: JSON.stringify({ reason: "manual" }) });
    out.textContent = "Saved " + (result.name || result.file || "backup");
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("exportJsonBtn").addEventListener("click", async () => {
  if (window.bridge && window.bridge.exportJson) {
    await window.bridge.exportJson();
    return;
  }
  downloadUrl("/api/backups/export.json");
});

document.getElementById("exportCsvBtn").addEventListener("click", async () => {
  if (window.bridge && window.bridge.exportCsv) {
    await window.bridge.exportCsv();
    return;
  }
  downloadUrl("/api/backups/export.csv");
});

document.getElementById("restoreSelectedBtn").addEventListener("click", async () => {
  const file = selectedBackupFile();
  const out = document.getElementById("backupResult");
  if (!file) {
    out.textContent = "Select a backup first";
    return;
  }
  if (!confirm("Replace current data with this backup?")) return;
  out.textContent = "Restoring...";
  try {
    const result = await api("/api/backups/restore", { method: "POST", body: JSON.stringify({ name: file }) });
    out.textContent = "Restored " + (result.name || "backup");
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("restoreFileBtn").addEventListener("click", async () => {
  if (window.bridge && window.bridge.restoreDialog) {
    const result = await window.bridge.restoreDialog();
    if (!result || result.canceled) return;
    document.getElementById("backupResult").textContent = "Restored " + (result.name || "backup");
    await refresh();
    return;
  }
  document.getElementById("restoreFileInput").click();
});

document.getElementById("restoreFileInput").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!confirm("Replace current data with " + file.name + "?")) return;
  const out = document.getElementById("backupResult");
  out.textContent = "Restoring...";
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await api("/api/backups/restore", { method: "POST", body: JSON.stringify(data) });
    out.textContent = "Restored " + (result.name || file.name);
    await refresh();
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("openBackupDirBtn").addEventListener("click", async () => {
  const dir = state.backupMeta.dir;
  if (window.bridge && window.bridge.openPath && dir) {
    await window.bridge.openPath(dir);
    return;
  }
  document.getElementById("backupResult").textContent = dir || "Backup folder not available in browser mode";
});

boot();
setInterval(() => { refresh().catch(() => {}); }, 15000);
