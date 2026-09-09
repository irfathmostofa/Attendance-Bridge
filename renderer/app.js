const state = {
  api: "",
  devices: [],
  attendance: [],
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
  document.getElementById("settingsForm").syncUrl.value = state.config.syncUrl || "";
}

async function refresh() {
  const [devices, attendance, events, config] = await Promise.all([
    api("/api/devices"),
    api("/api/attendance"),
    api("/api/events"),
    api("/api/config")
  ]);
  state.devices = devices;
  state.attendance = attendance;
  state.events = events;
  state.config = config;
  renderDevices();
  renderAttendance();
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

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/config", { method: "PUT", body: JSON.stringify({ syncUrl: formData(e.target).syncUrl }) });
  await refresh();
});

boot();
setInterval(() => { refresh().catch(() => {}); }, 15000);
