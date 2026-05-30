"use strict";
/**
 * Hermes bridge — the seam between CEO Studio (the cockpit) and the live
 * Hermes CEO daemon that actually runs the Kanban board + agent swarm.
 *
 * Design rules (mirror the rest of main/core):
 *   - Main process owns ALL logic; the renderer is thin and talks via IPC.
 *   - READ paths hit the durable SQLite boards directly (~/.hermes/kanban/
 *     boards/<slug>/kanban.db) via the `sqlite3` CLI. No model call, no cost,
 *     works even when Hermes' LLM provider is out of credits.
 *   - WRITE / think paths shell out to the `hermes` CLI.
 *   - Everything degrades gracefully: if Hermes isn't installed or sqlite3 is
 *     missing, functions return a clear {ok:false, reason} instead of throwing.
 *
 * The CEO's brain, memory, soul (~/.hermes/SOUL.md), and tools all live in
 * Hermes. CEO Studio is a face + a cockpit on top of it.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFileSync, spawn } = require("child_process");

function home() {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}
function bin() {
  return process.env.HERMES_BIN || path.join(os.homedir(), ".local", "bin", "hermes");
}
// The conversational CEO is the DEFAULT Hermes profile — the same one the
// WhatsApp gateway uses (authed for openai-codex). The "pipe" profile is the
// Kanban *worker* profile (Grok-only) that executes board tasks, not the CEO
// you talk to. Empty string = default profile (no -p flag).
function profile() {
  return process.env.HERMES_PROFILE || "";
}
function boardsDir() {
  return path.join(home(), "kanban", "boards");
}
function boardDb(slug) {
  return path.join(boardsDir(), slug, "kanban.db");
}

/** Is the `hermes` CLI present? */
function installed() {
  try { return fs.existsSync(bin()); } catch { return false; }
}

/** Run a read-only query against a board DB; returns parsed rows or []. */
function _query(slug, sql) {
  const db = boardDb(slug);
  if (!fs.existsSync(db)) return [];
  try {
    // NOTE: no -readonly — with WAL journaling the read-only opener can't
    // attach the -shm/-wal sidecars (SQLITE_CANTOPEN/14). A plain open for a
    // SELECT never mutates data and WAL supports concurrent readers.
    const out = execFileSync("sqlite3", ["-json", db, sql], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const trimmed = (out || "").trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch {
    return [];
  }
}

/** Is a pid alive? */
function _alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// ---------------------------------------------------------------------------
// CEO (gateway) lifecycle
// ---------------------------------------------------------------------------

/** Non-secret CEO status for the UI: is the daemon up, which platforms, etc. */
function ceoStatus() {
  if (!installed()) {
    return { ok: false, up: false, installed: false, reason: "Hermes not installed" };
  }
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(home(), "gateway_state.json"), "utf-8"));
  } catch { /* no state file yet */ }

  const pid = state && state.pid;
  const up = _alive(pid) && (!state.gateway_state || state.gateway_state === "running");
  const platforms = {};
  if (state && state.platforms) {
    for (const [k, v] of Object.entries(state.platforms)) {
      platforms[k] = v && v.state ? v.state : String(v);
    }
  }
  return { ok: true, installed: true, up: !!up, pid: pid || null, platforms, profile: profile() };
}

/**
 * Ensure the CEO (gateway) is running. If it's down, start the background
 * service. Best-effort and non-blocking; returns the status afterward.
 */
function ensureUp() {
  const status = ceoStatus();
  if (!status.installed) return status;
  if (status.up) return status;
  try {
    const child = spawn(bin(), ["gateway", "start", "--accept-hooks"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    return { ...ceoStatus(), starting: true };
  } catch (e) {
    return { ok: false, up: false, installed: true, reason: `Failed to start CEO: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Kanban board reads (direct SQLite — no model, no cost)
// ---------------------------------------------------------------------------

/** List all boards with metadata. */
function listBoards() {
  const dir = boardsDir();
  let slugs = [];
  try { slugs = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "board.json"))); }
  catch { return []; }
  return slugs.map((slug) => {
    let meta = { slug };
    try { meta = { ...JSON.parse(fs.readFileSync(path.join(dir, slug, "board.json"), "utf-8")), slug }; }
    catch { /* keep slug-only */ }
    return meta;
  }).filter((b) => !b.archived);
}

/** The board CEO Studio should show by default. */
function currentBoard() {
  try {
    const cur = fs.readFileSync(path.join(home(), "kanban", "current"), "utf-8").trim();
    if (cur) return cur;
  } catch { /* fall through */ }
  const boards = listBoards();
  return boards.length ? boards[0].slug : null;
}

/** Full board: tasks grouped by status, ordered by priority. */
function getBoard(slug) {
  if (!slug) slug = currentBoard();
  if (!slug) return { ok: false, reason: "No board" };
  const rows = _query(
    slug,
    `SELECT id,title,status,assignee,priority,worker_pid,current_run_id,
            last_failure_error,created_at,started_at,completed_at
     FROM tasks
     WHERE status != 'archived'
     ORDER BY priority DESC, created_at DESC;`
  );
  const columns = {};
  for (const t of rows) {
    t.workerAlive = _alive(t.worker_pid);
    (columns[t.status] = columns[t.status] || []).push(t);
  }
  return { ok: true, slug, columns, total: rows.length };
}

/** Per-status + per-assignee counts. */
function getStats(slug) {
  if (!slug) slug = currentBoard();
  if (!slug) return { ok: false, reason: "No board" };
  const byStatus = _query(slug, `SELECT status, COUNT(*) AS n FROM tasks WHERE status!='archived' GROUP BY status;`);
  const byAssignee = _query(slug, `SELECT COALESCE(assignee,'(unassigned)') AS assignee, COUNT(*) AS n
                                   FROM tasks WHERE status!='archived' GROUP BY assignee;`);
  return { ok: true, slug, byStatus, byAssignee };
}

/** Active swarm: running tasks with a live worker pid. */
function getSwarm(slug) {
  if (!slug) slug = currentBoard();
  if (!slug) return { ok: false, reason: "No board" };
  const running = _query(
    slug,
    `SELECT id,title,assignee,worker_pid,current_run_id,started_at,last_heartbeat_at
     FROM tasks WHERE status='running' ORDER BY started_at DESC;`
  );
  const workers = running.map((t) => ({ ...t, alive: _alive(t.worker_pid) }));
  return { ok: true, slug, workers, active: workers.filter((w) => w.alive).length };
}

/**
 * The "room": recent activity across the board — task events + comments,
 * merged newest-first. This is the swarm's live feed.
 */
function getRoom(slug, limit = 40) {
  if (!slug) slug = currentBoard();
  if (!slug) return { ok: false, reason: "No board" };
  const events = _query(
    slug,
    `SELECT e.created_at, e.kind, e.payload, e.task_id, t.title AS task_title
     FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id
     ORDER BY e.created_at DESC LIMIT ${Number(limit) || 40};`
  ).map((e) => ({ ...e, type: "event" }));
  const comments = _query(
    slug,
    `SELECT c.created_at, c.author, c.body, c.task_id, t.title AS task_title
     FROM task_comments c LEFT JOIN tasks t ON t.id = c.task_id
     ORDER BY c.created_at DESC LIMIT ${Number(limit) || 40};`
  ).map((c) => ({ ...c, type: "comment" }));
  const feed = [...events, ...comments]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, Number(limit) || 40);
  return { ok: true, slug, feed };
}

// ---------------------------------------------------------------------------
// Config & control (for the dashboard Config panel)
// ---------------------------------------------------------------------------

const PROVIDER_BASE = {
  "openai-codex": "https://chatgpt.com/backend-api/codex",
  "xai-oauth": "https://api.x.ai/v1",
};
const PROVIDER_MODELS = { "xai-oauth": ["grok-4.3", "grok-4"] };

/** Run a quick (non-model) hermes CLI command and capture output. */
function _run(args, timeout = 15000) {
  try {
    return { ok: true, out: execFileSync(bin(), args, { encoding: "utf-8", timeout, maxBuffer: 4 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, reason: String((e.stderr || e.message || "")).slice(0, 300) };
  }
}

/** Providers the user is authenticated with (from ~/.hermes/auth.json). */
function authedProviders() {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(home(), "auth.json"), "utf-8"));
    return Object.keys(a.providers || {});
  } catch { return []; }
}

/** Codex model slugs the account actually supports (from ~/.codex cache). */
function codexModels() {
  try {
    const p = path.join(os.homedir(), ".codex", "models_cache.json");
    const d = JSON.parse(fs.readFileSync(p, "utf-8"));
    return (d.models || [])
      .filter((m) => m && m.slug && !["hide", "hidden"].includes(String(m.visibility || "").toLowerCase()))
      .map((m) => m.slug);
  } catch { return []; }
}

/** Parse the active model/provider/base_url from `hermes config show`. */
function currentModel() {
  const r = _run(["config", "show"]);
  if (!r.ok) return {};
  const line = (r.out.match(/Model:\s*\{[^}]*\}/) || [])[0] || r.out;
  const grab = (k) => (line.match(new RegExp(`'${k}':\\s*'([^']*)'`)) || [])[1] || null;
  return { default: grab("default"), provider: grab("provider"), base_url: grab("base_url") };
}

/** Everything the Config panel needs to render. */
function getConfig() {
  const providers = authedProviders();
  const models = {};
  for (const p of providers) {
    models[p] = p === "openai-codex" ? codexModels() : (PROVIDER_MODELS[p] || []);
  }
  return { ok: true, model: currentModel(), providers, models, ceo: ceoStatus() };
}

/** Switch the active provider/model (sets the matching base_url too). */
function setModel({ provider, model } = {}) {
  if (!provider) return { ok: false, reason: "provider required" };
  const r1 = _run(["config", "set", "model.provider", provider]);
  if (!r1.ok) return r1;
  if (model) { const r2 = _run(["config", "set", "model.default", model]); if (!r2.ok) return r2; }
  const base = PROVIDER_BASE[provider];
  if (base) _run(["config", "set", "model.base_url", base]);
  return { ok: true, model: currentModel() };
}

/** Start the CEO gateway (detached so it outlives this call). */
function gatewayStart() {
  try {
    const c = spawn(bin(), ["gateway", "start", "--accept-hooks"], { detached: true, stdio: "ignore", env: process.env });
    c.unref();
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/** Stop the CEO gateway. */
function gatewayStop() { return _run(["gateway", "stop"]); }

// ---------------------------------------------------------------------------
// Talk to the CEO (think path — shells out to the agent; model-gated)
// ---------------------------------------------------------------------------

// Conversation continuity: the first ask() starts a fresh session and we
// capture its id from the -Q footer; subsequent asks --resume that id so the
// CEO keeps context across turns. Held in memory for the main-process lifetime.
let _sessionId = null;

/** One `hermes chat -q` invocation. Resolves with {ok, reply, sessionId, raw, sessionMiss, reason}. */
function _runChat(msg, resume, timeoutMs) {
  return new Promise((resolve) => {
    const prof = profile();
    const args = [...(prof ? ["-p", prof] : []), "chat", "-q", msg, "-Q", "--yolo", "--accept-hooks"];
    if (resume) args.push("--resume", resume);
    let out = "", err = "", done = false, child;
    try {
      child = spawn(bin(), args, { env: process.env });
    } catch (e) {
      return resolve({ ok: false, reason: `Failed to reach CEO: ${e.message}` });
    }
    const timer = setTimeout(() => {
      if (done) return; done = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ ok: false, reason: "CEO timed out", partial: _clean(out) });
    }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: false, reason: `Failed to reach CEO: ${e.message}` });
    });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(timer);
      const combined = out + "\n" + err;
      const sessionMiss = /No session found/i.test(combined);
      const sessionId = _extractSession(combined); // -Q prints session_id; capture from either stream
      const text = _clean(out);
      if (code !== 0 && !text) return resolve({ ok: false, reason: _clean(err) || `CEO exited ${code}`, sessionId, sessionMiss });
      resolve({ ok: true, reply: text, sessionId, sessionMiss });
    });
  });
}

/**
 * Relay a message to the live Hermes CEO and return its reply. Keeps a single
 * rolling session so context persists. This is what the voice agent calls —
 * the voice is just a face; Hermes thinks.
 */
async function ask(message, { timeoutMs = 180000 } = {}) {
  console.log("[hermes.ask] Called with:", message);
  if (!installed()) return { ok: false, reason: "Hermes CLI not found" };
  const msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "Empty message" };

  console.log("[hermes.ask] Calling _runChat...");
  let res = await _runChat(msg, _sessionId, timeoutMs);
  console.log("[hermes.ask] _runChat returned:", res);
  // Stored session vanished (restart, gc) → start fresh once.
  if (_sessionId && res.sessionMiss) {
    console.log("[hermes.ask] Session miss, retrying...");
    _sessionId = null;
    res = await _runChat(msg, null, timeoutMs);
  }
  if (res.sessionId) _sessionId = res.sessionId; // keep continuity even on error
  if (!res.ok) return { ok: false, reason: _friendly(res.reason), raw: res.reason, partial: res.partial };
  return { ok: true, reply: res.reply, session: _sessionId };
}

/** Turn common Hermes failures into something speakable. */
function _friendly(reason) {
  const r = String(reason || "");
  if (/out of credits|spending-limit|need a .*subscription|\b403\b/i.test(r)) {
    return "The CEO is out of model credits (Grok). Add credits, or switch the model with `hermes model`.";
  }
  if (/timed out/i.test(r)) return "The CEO took too long to respond.";
  if (/not found|ENOENT|not installed/i.test(r)) return "The CEO (Hermes) isn't reachable.";
  return r.slice(0, 240);
}

function _extractSession(raw) {
  const m = String(raw || "").match(/session_id:\s*(\S+)/i);
  return m ? m[1] : null;
}

/** Strip the trailing `session_id: ...` line and noise from -Q output. */
function _clean(s) {
  return String(s || "")
    .replace(/\n?session_id:\s*\S+\s*$/i, "")
    .trim();
}

module.exports = {
  home, bin, profile, installed,
  ceoStatus, ensureUp,
  listBoards, currentBoard, getBoard, getStats, getSwarm, getRoom,
  getConfig, setModel, gatewayStart, gatewayStop,
  ask,
};
