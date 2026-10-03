const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { createWriteStream } = require("fs");

const ROOT = __dirname;
const NODE_MIN = 18;

function log(msg) {
  console.log("[setup] " + msg);
}

function fail(msg) {
  console.error("[setup] ERROR: " + msg);
  process.exit(1);
}

function run(cmd, args, opts) {
  log(cmd + " " + args.join(" "));
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(cmd + " exited with " + result.status);
  return result;
}

function hasCmd(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [cmd], { encoding: "utf8", shell: process.platform === "win32" });
  return result.status === 0;
}

function nodeVersion() {
  const raw = process.versions.node || "0";
  return Number(String(raw).split(".")[0]);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function ensureNodeOnWindows() {
  if (hasCmd("node") && nodeVersion() >= NODE_MIN) return;
  if (process.platform !== "win32") {
    fail("Node.js " + NODE_MIN + "+ is required. Install it from https://nodejs.org and re-run setup.");
  }
  log("Node.js not found. Downloading Node.js LTS installer...");
  const installer = path.join(os.tmpdir(), "node-lts.msi");
  await download("https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi", installer);
  run("msiexec", ["/i", installer, "/qn", "/norestart"]);
  log("Node.js installed. Re-run setup from a new terminal if PATH is not updated.");
}

function installNpmPackages() {
  log("Installing npm packages (express, cors, axios, mysql, node-zklib, electron)...");
  const extra = process.platform === "win32" ? [] : ["--no-optional"];
  run("npm", ["install", "--no-fund", "--no-audit", ...extra]);
}

function tryInstallElectron() {
  log("Ensuring Electron is available...");
  const localBin = process.platform === "win32"
    ? path.join(ROOT, "node_modules", ".bin", "electron.cmd")
    : path.join(ROOT, "node_modules", ".bin", "electron");
  if (fs.existsSync(localBin)) {
    log("Electron is installed locally.");
    return;
  }
  try {
    run("npm", ["install", "electron@33.2.1", "--save", "--no-fund", "--no-audit"]);
  } catch (err) {
    log("Local Electron install failed. Trying global: " + err.message);
    run("npm", ["install", "-g", "electron@33.2.1", "--no-fund", "--no-audit"]);
  }
}

function writeDataFiles() {
  const dataDir = path.join(ROOT, "data");
  ensureDir(dataDir);
  const configPath = path.join(dataDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      listenPort: 3780,
      iclockEnabled: true,
      syncUrl: "https://server.roohschool.edu.bd/server/postAttendence",
      syncIntervalMinutes: 15,
      autoSync: false,
      devices: []
    }, null, 2));
  }
  const att = path.join(dataDir, "attendance.json");
  const events = path.join(dataDir, "events.json");
  const students = path.join(dataDir, "students.json");
  if (!fs.existsSync(att)) fs.writeFileSync(att, "[]");
  if (!fs.existsSync(events)) fs.writeFileSync(events, "[]");
  if (!fs.existsSync(students)) fs.writeFileSync(students, "[]");
  log("Data folder ready at " + dataDir);
}

function printDone() {
  log("All essential software is installed.");
  log("Desktop app:  npm start");
  log("Windows:      start.bat");
  log("Packaged app: npm run dist");
  log("API only:     npm run server");
}

async function main() {
  log("Attendance Bridge setup on " + process.platform + " / Node " + process.versions.node);
  if (nodeVersion() < NODE_MIN) {
    await ensureNodeOnWindows();
  } else {
    log("Node.js " + process.versions.node + " OK");
  }
  if (!hasCmd("npm")) fail("npm is not on PATH");
  installNpmPackages();
  tryInstallElectron();
  writeDataFiles();
  printDone();
}

main().catch((err) => fail(err.message));
