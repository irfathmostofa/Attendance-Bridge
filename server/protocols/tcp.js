const net = require("net");

function testTcp(device) {
  const timeout = Number(device.timeout) || 5000;
  const port = Number(device.port);
  return new Promise((resolve) => {
    if (!device.ip || !port) {
      resolve({ ok: false, protocol: "tcp", message: "IP and port are required" });
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      finish({
        ok: true,
        protocol: "tcp",
        message: `TCP connected to ${device.ip}:${port}`
      });
    });
    socket.once("timeout", () => {
      finish({ ok: false, protocol: "tcp", message: `Timeout connecting to ${device.ip}:${port}` });
    });
    socket.once("error", (err) => {
      finish({ ok: false, protocol: "tcp", message: err.message });
    });
    socket.connect(port, device.ip);
  });
}

function connectTcp(device) {
  const timeout = Number(device.timeout) || 5000;
  const port = Number(device.port);
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(data);
    };
    socket.setTimeout(timeout);
    socket.connect(port, device.ip);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
    });
    socket.once("connect", () => {
      setTimeout(() => {
        finish(null, {
          protocol: "tcp",
          connected: true,
          bytes: buffer.length,
          preview: buffer.slice(0, 200).toString("utf8"),
          punches: []
        });
      }, 800);
    });
    socket.once("timeout", () => finish(new Error(`Timeout connecting to ${device.ip}:${port}`)));
    socket.once("error", (err) => finish(err));
  });
}

module.exports = { testTcp, connectTcp };
