"use strict";
/**
 * GBrain bridge.
 *
 * GBrain's `serve --http` mode is an MCP server, not a small REST API. CEO
 * Studio needs narrow app tools, so use the local `gbrain` CLI directly.
 */
const { spawn } = require("child_process");

function cfg(env = process.env) {
  return {
    bin: env.GBRAIN_BIN || "gbrain",
    timeoutMs: Number(env.GBRAIN_TIMEOUT_MS) > 0 ? Number(env.GBRAIN_TIMEOUT_MS) : 30000,
  };
}

function configured() {
  return true;
}

function _run(args, { input, env = process.env, timeoutMs } = {}) {
  const c = cfg(env);
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let child;
    try {
      child = spawn(c.bin, args, { env });
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

module.exports = { cfg, configured, status, query, ingest };
