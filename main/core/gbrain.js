"use strict";
/**
 * GBrain bridge.
 *
 * Uses the same local gbrain CLI and env setup as the Hermes MCP server
 * (see ~/.gbrain/serve-mcp.sh). This makes CEO Studio's gbrain usage
 * consistent with the rest of the system.
 *
 * No separate HTTP server is needed for the bridge; the CLI + MCP stdio
 * is the canonical way.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function cfg(env = process.env) {
  return {
    bin: env.GBRAIN_BIN || "gbrain",
    timeoutMs: Number(env.GBRAIN_TIMEOUT_MS) > 0 ? Number(env.GBRAIN_TIMEOUT_MS) : 30000,
  };
}

function configured() {
  return true;
}

function prepareEnv(baseEnv = process.env) {
  const env = { ...baseEnv };

  // Add bun to PATH (critical for finding gbrain)
  env.PATH = `${process.env.HOME}/.bun/bin:${env.PATH || ""}`;

  // Unset DATABASE_URL to avoid conflicts (same as serve-mcp.sh)
  delete env.DATABASE_URL;

  // Load Google embedding key from PIPE-OS .env (for vector search)
  try {
    const pipeEnvPath = path.join(process.env.HOME, "Code", "PIPE", "PIPE-OS", ".env");
    if (fs.existsSync(pipeEnvPath)) {
      const envContent = fs.readFileSync(pipeEnvPath, "utf-8");
      const match = envContent.match(/^VERTEX_API_KEY=(.+)$/m);
      if (match) {
        const key = match[1].trim().replace(/"/g, "");
        env.GOOGLE_GENERATIVE_AI_API_KEY = key;
      }
    }
  } catch (e) {
    // non-fatal
  }

  return env;
}

function _run(args, { input, env = process.env, timeoutMs } = {}) {
  const preparedEnv = prepareEnv(env);
  const c = cfg(preparedEnv);

  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let child;
    try {
      child = spawn(c.bin, args, { env: preparedEnv });
    } catch (e) {
      return resolve({ ok: false, reason: `failed to start gbrain: ${e.message}` });
    }
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ ok: false, reason: "gbrain timed out", stdout: out, stderr: err });
    }, timeoutMs || c.timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: `gbrain error: ${e.message}`, stdout: out, stderr: err });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, reason: (err || out || `gbrain exited ${code}`).trim().slice(0, 600), stdout: out, stderr: err });
      resolve({ ok: true, stdout: out, stderr: err });
    });
    if (input != null) child.stdin.end(String(input));
    else child.stdin.end();
  });
}

async function status(env = process.env) {
  const r = await _run(["stats"], { env, timeoutMs: 12000 });
  return {
    ok: true,
    available: !!r.ok,
    configured: true,
    mode: "cli",
    bin: cfg(env).bin,
    reason: r.ok ? null : r.reason,
    stats: r.ok ? r.stdout.trim() : null,
  };
}

async function query({ query, domain, filters } = {}, env = process.env) {
  if (!query) return { ok: false, reason: "query required" };
  const args = ["query", query, "--limit", String(filters?.limit || 8), "--detail", filters?.detail || "medium"];
  if (filters?.sourceId) args.push("--source-id", filters.sourceId);
  if (filters?.since) args.push("--since", filters.since);
  if (filters?.adaptiveReturn) args.push("--adaptive-return");
  const r = await _run(args, { env, timeoutMs: 45000 });
  if (!r.ok) return r;
  return { ok: true, result: r.stdout.trim(), endpoint: "gbrain query", domain: domain || null };
}

async function ingest({ title, content, project, domain, metadata } = {}, env = process.env) {
  if (!title || !content) return { ok: false, reason: "title and content required" };
  const slugBase = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "ceo-studio-note";
  const slug = `ceo-studio/${new Date().toISOString().slice(0, 10)}/${slugBase}`;
  const body = [
    `# ${title}`,
    "",
    `Project: ${project?.slug || project?.name || "unknown"}`,
    `Domain: ${domain || "All"}`,
    metadata && Object.keys(metadata).length ? `Metadata: ${JSON.stringify(metadata)}` : "",
    "",
    content,
  ].filter(Boolean).join("\n");
  const r = await _run(["capture", "--stdin", "--slug", slug, "--type", "ceo-studio", "--json"], { input: body, env, timeoutMs: 30000 });
  if (!r.ok) return r;
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = r.stdout.trim(); }
  return { ok: true, result: parsed, endpoint: "gbrain capture", slug };
}

// Relative path (POSIX, repo-root anchored) to the committed gbrain MCP
// launcher. Devin reads mcpServers from .devin/config.json and runs the command
// from the repo root, so a relative command resolves correctly.
const PROJECT_MCP_REL = "runtime/harness/bin/gbrain-mcp";

/**
 * Ensure the project's .devin/config.json wires the gbrain MCP server so every
 * Devin agent working in this repo auto-connects to the shared project brain
 * (no per-agent setup). Idempotent + non-destructive: only adds the `gbrain`
 * entry when missing and preserves any existing config. Only wires when the
 * project actually ships the launcher, so we never point Devin at a missing
 * command in unrelated projects opened by the cockpit.
 */
function ensureProjectWiring(projectPath) {
  if (!projectPath) return { ok: false, reason: "no project path" };
  const launcher = path.join(projectPath, PROJECT_MCP_REL.split("/").join(path.sep));
  if (!fs.existsSync(launcher)) {
    return { ok: true, wired: false, reason: "project has no gbrain-mcp launcher" };
  }
  const cfgDir = path.join(projectPath, ".devin");
  const cfgPath = path.join(cfgDir, "config.json");
  let cfg = {};
  try {
    if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) || {};
  } catch { cfg = {}; }
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers.gbrain) return { ok: true, wired: true, alreadyPresent: true };
  cfg.mcpServers.gbrain = { command: `./${PROJECT_MCP_REL}`, transport: "stdio" };
  try {
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    return { ok: true, wired: true, created: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { cfg, configured, prepareEnv, status, query, ingest, ensureProjectWiring, PROJECT_MCP_REL };
