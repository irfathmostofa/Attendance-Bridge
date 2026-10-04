const STELLARBD_API = "https://rumytechnologies.com/rams/json_api";

const DEVICE_TYPES = [
  {
    id: "stellarbd",
    name: "StellarBD",
    protocol: "stellarbd",
    ready: true,
    description: "Rumy RAMS JSON API. Pulls attendance with fetch_log."
  },
  {
    id: "tipsoi",
    name: "Tipsoi",
    protocol: "tipsoi",
    ready: false,
    description: "Tipsoi connection will be added next."
  },
  {
    id: "zkteco",
    name: "ZKTeco / IP device",
    protocol: "auto",
    ready: true,
    description: "Connect by IP, port, and optional comm key."
  }
];

function typeId(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "stellar" || raw === "stellarbd" || raw === "rams") return "stellarbd";
  if (raw === "tipsoi") return "tipsoi";
  if (raw === "zk" || raw === "zkteco" || raw === "iclock" || raw === "http" || raw === "tcp") return "zkteco";
  if (raw === "auto" || !raw) return "zkteco";
  return raw;
}

function inferType(src, prev) {
  const row = src || {};
  const old = prev || {};
  const raw = row.type || (row.protocol && String(row.protocol).toLowerCase() !== "auto" ? row.protocol : "") || old.type || "";
  if (raw) return typeId(raw);
  if (row.authUser || row.authCode || /rams|rumy|stellar/i.test(row.apiUrl || old.apiUrl || "")) return "stellarbd";
  if (row.ip || old.ip) return "zkteco";
  if (old.protocol) return typeId(old.protocol);
  return "stellarbd";
}

function typeMeta(value) {
  const id = typeId(value);
  return DEVICE_TYPES.find((t) => t.id === id) || DEVICE_TYPES[0];
}

function protocolFor(type, fallback) {
  const meta = typeMeta(type);
  if (type === "zkteco") return fallback || "auto";
  return meta.protocol;
}

function buildDevice(body, existing) {
  const src = body || {};
  const prev = existing || {};
  const type = inferType(src, prev);
  const meta = typeMeta(type);
  const device = {
    id: prev.id || Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
    name: String(src.name || prev.name || src.ip || meta.name).trim(),
    type,
    protocol: protocolFor(type, src.protocol || prev.protocol),
    timeout: Number(src.timeout || prev.timeout) || (type === "stellarbd" ? 20000 : 8000)
  };

  if (type === "stellarbd") {
    device.apiUrl = String(src.apiUrl || prev.apiUrl || STELLARBD_API).trim() || STELLARBD_API;
    device.authUser = src.authUser != null && src.authUser !== ""
      ? String(src.authUser)
      : (prev.authUser || src.username || prev.username || "");
    const nextCode = src.authCode != null && src.authCode !== ""
      ? String(src.authCode)
      : (src.password != null && src.password !== "" ? String(src.password) : "");
    device.authCode = nextCode || prev.authCode || "";
    device.startTime = src.startTime || prev.startTime || "00:00:00";
    device.endTime = src.endTime || prev.endTime || "23:59:59";
    device.startDate = src.startDate || prev.startDate || "";
    device.endDate = src.endDate || prev.endDate || "";
    return device;
  }

  if (type === "tipsoi") {
    device.apiUrl = src.apiUrl != null ? String(src.apiUrl) : (prev.apiUrl || "");
    device.username = src.username != null ? String(src.username) : (prev.username || "");
    device.password = src.password != null ? String(src.password) : (prev.password || "");
    device.token = src.token != null ? String(src.token) : (prev.token || "");
    return device;
  }

  device.ip = src.ip || prev.ip || "";
  device.port = src.port != null ? Number(src.port) : (prev.port != null ? Number(prev.port) : 4370);
  device.username = src.username != null ? src.username : (prev.username || "");
  device.password = src.password != null ? src.password : (prev.password || "");
  device.commKey = src.commKey != null ? Number(src.commKey) : (Number(prev.commKey) || 0);
  device.token = src.token != null ? src.token : (prev.token || "");
  if (!device.name || device.name === meta.name) device.name = device.ip || device.name;
  return device;
}

function publicDevice(device) {
  if (!device) return device;
  const out = { ...device };
  if (out.authCode) out.authCodeSet = true;
  if (out.password) out.passwordSet = true;
  delete out.authCode;
  delete out.password;
  return out;
}

module.exports = {
  STELLARBD_API,
  DEVICE_TYPES,
  typeId,
  inferType,
  typeMeta,
  buildDevice,
  publicDevice
};
