const state = {
  api: "",
  devices: [],
  attendance: [],
  students: [],
  events: [],
  config: {}
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

function devicePayload(data) {
  return {
    ip: data.ip,
    port: Number(data.port) || 4370,
    protocol: "auto",
    name: data.ip,
    username: data.username || "",
    password: data.password || "",
    commKey: Number(data.commKey) || 0
  };
}

function renderDevices() {
  const body = document.getElementById("deviceTable");
  body.innerHTML = state.devices.map((d) => `
    <tr>
      <td>${d.ip}</td>
      <td>${d.port}</td>
      <td>${d.username || "-"}</td>
      <td>${d.commKey || 0}</td>
      <td class="actions">
        <button data-act="test" data-id="${d.id}">Test</button>
        <button data-act="pull" data-id="${d.id}">Pull</button>
        <button class="ghost" data-act="del" data-id="${d.id}">Remove</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">No devices yet</td></tr>`;
}

function renderAttendance() {
  const body = document.getElementById("attTable");
  body.innerHTML = state.attendance.slice(0, 300).map((r) => `
    <tr>
      <td>${r.date || ""}</td>
      <td>${r.empID || ""}</td>
      <td>${r.empName || ""}</td>
      <td>${r.inTime || ""}</td>
      <td>${r.outTime || ""}</td>
      <td>${r.total_time || ""}</td>
      <td>${r.deviceName || r.ip || r.deviceId || ""}</td>
      <td><span class="badge ${r.synced ? "ok" : "no"}">${r.synced ? "yes" : "no"}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="8">No attendance records</td></tr>`;
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

function fillSettings() {
  const form = document.getElementById("settingsForm");
  const map = state.config.studentFieldMap || {};
  form.syncUrl.value = state.config.syncUrl || "";
  form.studentIdField.value = map.studentId || "studentId";
  form.studentNameField.value = map.name || "name";
  form.studentCardField.value = map.cardNo || "cardNo";
}

async function refresh() {
  const [devices, attendance, students, events, config] = await Promise.all([
    api("/api/devices"),
    api("/api/attendance"),
    api("/api/students"),
    api("/api/events"),
    api("/api/config")
  ]);
  state.devices = devices;
  state.attendance = attendance;
  state.students = students;
  state.events = events;
  state.config = config;
  renderDevices();
  renderAttendance();
  renderStudents();
  renderEvents();
  renderStats();
  fillSettings();
}

async function boot() {
  const info = await (window.bridge ? window.bridge.getApiInfo() : Promise.resolve({ url: "" }));
  state.api = info.url || "";
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

document.getElementById("deviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/devices", { method: "POST", body: JSON.stringify(devicePayload(formData(e.target))) });
  e.target.reset();
  e.target.port.value = 4370;
  e.target.commKey.value = 0;
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
  out.textContent = "Testing...";
  try {
    const result = await api("/api/test", { method: "POST", body: JSON.stringify(devicePayload(formData(e.target))) });
    out.textContent = result.message || JSON.stringify(result);
  } catch (err) {
    out.textContent = err.message;
  }
});

document.getElementById("quickPull").addEventListener("click", async () => {
  const out = document.getElementById("quickResult");
  out.textContent = "Pulling logs...";
  try {
    const result = await api("/api/pull", { method: "POST", body: JSON.stringify(devicePayload(formData(document.getElementById("quickForm")))) });
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
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      syncUrl: data.syncUrl,
      studentFieldMap: {
        studentId: data.studentIdField || "studentId",
        name: data.studentNameField || "name",
        cardNo: data.studentCardField || "cardNo"
      }
    })
  });
  await refresh();
});

boot();
setInterval(() => { refresh().catch(() => {}); }, 15000);
