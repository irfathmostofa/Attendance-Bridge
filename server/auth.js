const axios = require("axios");

let cachedJwt = {
  token: null,
  expiresAt: 0,
  fingerprint: ""
};

function configFingerprint(config) {
  return [
    config.authType,
    config.authLoginUrl,
    config.authUsername,
    config.authPassword,
    config.authTokenPath
  ].join("|");
}

function readPath(obj, path) {
  if (!path) return obj && (obj.token || obj.access_token || obj.accessToken);
  return String(path).split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function normalizeHeaderValue(prefix, value) {
  const token = String(value || "").trim();
  if (!token) return "";
  if (/^(Bearer|JWT|Token|Basic)\s+/i.test(token)) return token;
  const p = String(prefix || "Bearer").trim();
  return p ? p + " " + token : token;
}

async function getJwtToken(config) {
  const fingerprint = configFingerprint(config);
  if (cachedJwt.token && cachedJwt.fingerprint === fingerprint && Date.now() < cachedJwt.expiresAt - 15000) {
    return cachedJwt.token;
  }
  if (!config.authLoginUrl) {
    throw new Error("JWT login URL is not set");
  }
  if (!config.authUsername) {
    throw new Error("JWT username is not set");
  }
  const userKey = config.authUsernameField || "username";
  const passKey = config.authPasswordField || "password";
  const res = await axios.post(config.authLoginUrl, {
    [userKey]: config.authUsername,
    [passKey]: config.authPassword || ""
  }, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000
  });
  const token = readPath(res.data, config.authTokenPath);
  if (!token || typeof token !== "string") {
    throw new Error("Login succeeded but no token was found in the response");
  }
  const ttl = Number(config.authTokenTtlMinutes) || 50;
  cachedJwt = {
    token,
    fingerprint,
    expiresAt: Date.now() + ttl * 60 * 1000
  };
  return token;
}

async function buildAuthHeaders(config) {
  const headers = { "Content-Type": "application/json", ...(config.syncHeaders || {}) };
  const headerName = config.authHeaderName || "Authorization";
  const type = String(config.authType || "api-key").toLowerCase();

  if (type === "none") {
    return headers;
  }

  if (type === "jwt") {
    const token = await getJwtToken(config);
    headers[headerName] = normalizeHeaderValue(config.authPrefix || "JWT", token);
    return headers;
  }

  const key = config.authApiKey || config.syncAuthHeader || "";
  if (key) {
    headers[headerName] = normalizeHeaderValue(config.authPrefix || "Bearer", key);
  }
  return headers;
}

async function testAuth(config) {
  const type = String(config.authType || "api-key").toLowerCase();
  if (type === "none") {
    return { ok: true, authType: "none", message: "No authentication" };
  }
  if (type === "jwt") {
    const token = await getJwtToken(config);
    return {
      ok: true,
      authType: "jwt",
      message: "JWT login OK. Token cached.",
      tokenPreview: String(token).slice(0, 8) + "..."
    };
  }
  const key = config.authApiKey || config.syncAuthHeader || "";
  if (!key) {
    return { ok: false, authType: "api-key", message: "API key is empty" };
  }
  return {
    ok: true,
    authType: "api-key",
    message: "API key will be sent as " + (config.authHeaderName || "Authorization")
  };
}

function clearTokenCache() {
  cachedJwt = { token: null, expiresAt: 0, fingerprint: "" };
}

function publicConfig(config) {
  const copy = { ...config };
  if (copy.authApiKey) copy.authApiKey = copy.authApiKey ? "********" : "";
  if (copy.authPassword) copy.authPassword = copy.authPassword ? "********" : "";
  if (copy.syncAuthHeader) copy.syncAuthHeader = copy.syncAuthHeader ? "********" : "";
  return copy;
}

module.exports = { buildAuthHeaders, testAuth, clearTokenCache, publicConfig };
