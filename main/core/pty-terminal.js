"use strict";
/**
 * Live terminal bridge.
 *
 * Main owns node-pty and attaches a temporary tmux client to an existing agent
 * session/window. Closing this bridge detaches only the UI client; it never
 * kills the durable tmux session.
 */
const { randomUUID } = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const { envWithPython } = require("./pybin");

const terminals = new Map();
const watchedWebContents = new Set();
let cachedTmux = null;

function loadPty() {
  try {
    return require("node-pty");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { error: `node-pty unavailable: ${msg}` };
  }
}

function size(n, fallback, min, max) {
  const value = Number.parseInt(n, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function resolveTmux() {
  if (cachedTmux) return cachedTmux;
  const candidates = [
    process.env.TMUX_BIN,
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
    "/bin/tmux",
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) {
        execFileSync(bin, ["-V"], { stdio: "ignore", timeout: 2000 });
        cachedTmux = bin;
        return cachedTmux;
      }
    } catch { /* keep trying */ }
  }
  for (const finder of ["/usr/bin/which", "/bin/which"]) {
    try {
      const found = execFileSync(finder, ["tmux"], { encoding: "utf8", timeout: 2000 }).trim();
      if (found) {
        execFileSync(found, ["-V"], { stdio: "ignore", timeout: 2000 });
        cachedTmux = found;
        return cachedTmux;
      }
    } catch { /* keep trying */ }
  }
  return "tmux";
}

function watchWebContents(webContents) {
  if (!webContents || watchedWebContents.has(webContents.id)) return;
  watchedWebContents.add(webContents.id);
  webContents.once("destroyed", () => {
    watchedWebContents.delete(webContents.id);
    closeForWebContents(webContents.id);
  });
}

function sendToWebContents(webContents, channel, payload) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    webContents.send(channel, payload);
    return true;
  } catch {
    // Electron can dispose the frame before WebContents reports destroyed.
    return false;
  }
}

function open({ webContents, agentId, session, window = "main", cwd, cols, rows } = {}) {
  if (!webContents || webContents.isDestroyed()) return { ok: false, reason: "renderer is unavailable" };
  if (!agentId) return { ok: false, reason: "agentId required" };
  if (!session) return { ok: false, reason: "tmux session required" };

  const pty = loadPty();
  if (pty.error) return { ok: false, reason: pty.error };

  const terminalId = randomUUID();
  const terminalCols = size(cols, 100, 20, 400);
  const terminalRows = size(rows, 30, 8, 120);
  const target = `=${session}:${window || "main"}`;

  let proc;
  try {
    proc = pty.spawn(resolveTmux(), ["attach-session", "-t", target], {
      name: "xterm-256color",
      cols: terminalCols,
      rows: terminalRows,
      cwd: cwd || process.cwd(),
      env: { ...envWithPython(), TERM: "xterm-256color" },
    });
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }

  const record = {
    terminalId,
    agentId,
    session,
    window: window || "main",
    pty: proc,
    webContentsId: webContents.id,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  terminals.set(terminalId, record);
  watchWebContents(webContents);

  proc.onData((data) => {
    const current = terminals.get(terminalId);
    if (!current) return;
    current.lastActiveAt = Date.now();
    if (!sendToWebContents(webContents, "terminal:data", { terminalId, data })) {
      close(terminalId);
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    terminals.delete(terminalId);
    sendToWebContents(webContents, "terminal:exit", { terminalId, exitCode, signal });
  });

  return {
    ok: true,
    terminalId,
    agentId,
    session,
    window: window || "main",
    cols: terminalCols,
    rows: terminalRows,
  };
}

function input(terminalId, data) {
  const record = terminals.get(terminalId);
  if (!record) return { ok: false, reason: "terminal not open" };
  record.pty.write(String(data || ""));
  record.lastActiveAt = Date.now();
  return { ok: true };
}

function resize(terminalId, cols, rows) {
  const record = terminals.get(terminalId);
  if (!record) return { ok: false, reason: "terminal not open" };
  try {
    record.pty.resize(size(cols, 100, 20, 400), size(rows, 30, 8, 120));
    record.lastActiveAt = Date.now();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}

function close(terminalId) {
  const record = terminals.get(terminalId);
  if (!record) return { ok: true, already: true };
  terminals.delete(terminalId);
  try { record.pty.kill(); } catch { /* detach best effort */ }
  return { ok: true };
}

function closeForWebContents(webContentsId) {
  for (const record of [...terminals.values()]) {
    if (record.webContentsId === webContentsId) close(record.terminalId);
  }
}

function closeAll() {
  for (const record of [...terminals.values()]) close(record.terminalId);
}

module.exports = {
  open,
  input,
  resize,
  close,
  closeForWebContents,
  closeAll,
  _defaults: { sendToWebContents },
};
