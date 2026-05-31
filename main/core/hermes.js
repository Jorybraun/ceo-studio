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
function profilesDir() {
  return path.join(home(), "profiles");
}
function profileConfigPath(profileId = profile()) {
  const id = String(profileId || "").trim();
  return id ? path.join(profilesDir(), id, "config.yaml") : path.join(home(), "config.yaml");
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

/**
 * Filter boards for a specific domain. Returns boards relevant to the domain:
 * - If domain has a specific kanban board, return that + main project board
 * - Otherwise, return all boards (for "All" domains or unmapped domains)
 */
function filterBoardsForDomain(domainName, allBoards) {
  if (!domainName || domainName === "All") {
    return allBoards; // Show all boards when "All" domains selected
  }
  
  // If no boards provided, get all boards
  const boards = allBoards || listBoards();
  if (!boards.length) return [];
  
  // For now, return all boards since domain-to-board mapping
  // is handled at a higher level (in main process with domain context)
  // This function can be enhanced later to do direct filtering
  return boards;
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

/** Full detail for a single task: body + recent comments. For the planner. */
function getTask(slug, id) {
  if (!slug) slug = currentBoard();
  if (!slug || !id) return { ok: false, reason: "board + task id required" };
  const rows = _query(slug,
    `SELECT id,title,body,status,assignee,priority,created_at,last_failure_error
     FROM tasks WHERE id='${String(id).replace(/'/g, "''")}' LIMIT 1;`);
  if (!rows.length) return { ok: false, reason: "task not found" };
  const comments = _query(slug,
    `SELECT author,body,created_at FROM task_comments
     WHERE task_id='${String(id).replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 10;`);
  return { ok: true, slug, task: rows[0], comments };
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
function _profileArgs(profileId = profile()) {
  const prof = String(profileId || "").trim();
  return prof ? ["-p", prof] : [];
}

function _run(args, timeout = 15000, profileId = profile()) {
  try {
    return { ok: true, out: execFileSync(bin(), [..._profileArgs(profileId), ...args], { encoding: "utf-8", timeout, maxBuffer: 4 * 1024 * 1024 }) };
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
function currentModel(profileId = profile()) {
  const r = _run(["config", "show"], 15000, profileId);
  if (!r.ok) return {};
  const line = (r.out.match(/Model:\s*\{[^}]*\}/) || [])[0] || r.out;
  const grab = (k) => (line.match(new RegExp(`'${k}':\\s*'([^']*)'`)) || [])[1] || null;
  return { default: grab("default"), provider: grab("provider"), base_url: grab("base_url") };
}

function currentPersonality(profileId = profile()) {
  const r = _run(["config", "show"], 15000, profileId);
  if (!r.ok) return null;
  return (r.out.match(/Personality:\s*([^\n]+)/) || [])[1]?.trim() || null;
}

function availablePersonalities(profileId = profile()) {
  const defaults = ["helpful", "concise", "technical", "creative", "teacher"];
  try {
    const text = fs.readFileSync(profileConfigPath(profileId), "utf-8");
    const names = [];
    const lines = text.split(/\r?\n/);
    let inPersonalities = false;
    for (const line of lines) {
      if (/^\s{2}personalities:\s*$/.test(line)) {
        inPersonalities = true;
        continue;
      }
      if (inPersonalities) {
        if (/^\S/.test(line) || /^\s{0,2}[a-zA-Z0-9_-]+:\s*/.test(line)) break;
        const m = line.match(/^\s{4}([A-Za-z0-9_-]+):/);
        if (m) names.push(m[1]);
      }
    }
    return [...new Set([...names, ...defaults])];
  } catch {
    return defaults;
  }
}

/** Everything the Config panel needs to render. */
function getConfig() {
  const providers = authedProviders();
  const models = {};
  for (const p of providers) {
    models[p] = p === "openai-codex" ? codexModels() : (PROVIDER_MODELS[p] || []);
  }
  const activeProfile = profile();
  return {
    ok: true,
    model: currentModel(activeProfile),
    personality: currentPersonality(activeProfile),
    personalities: availablePersonalities(activeProfile),
    providers,
    models,
    profiles: listProfiles(),
    activeProfile,
    ceo: ceoStatus(),
  };
}

/** Available Hermes profiles. Empty id means the default CEO profile. */
function listProfiles() {
  const decorate = (p) => ({
    ...p,
    model: currentModel(p.id),
    personality: currentPersonality(p.id),
    personalities: availablePersonalities(p.id),
  });
  const profiles = [decorate({ id: "", name: "Default Hermes CEO", path: home(), active: profile() === "" })];
  try {
    for (const entry of fs.readdirSync(profilesDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      profiles.push(decorate({
        id,
        name: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        path: path.join(profilesDir(), id),
        active: profile() === id,
      }));
    }
  } catch { /* profiles are optional */ }
  return profiles;
}

/** Switch the conversational CEO profile for this app process. */
function setProfile(profileId = "") {
  const next = String(profileId || "").trim();
  if (next) {
    const dir = path.join(profilesDir(), next);
    if (!fs.existsSync(dir)) return { ok: false, reason: `Hermes profile not found: ${next}` };
    process.env.HERMES_PROFILE = next;
  } else {
    delete process.env.HERMES_PROFILE;
  }
  _sessionId = null;
  return { ok: true, activeProfile: profile(), profiles: listProfiles(), ceo: ceoStatus() };
}

/** Switch the active provider/model (sets the matching base_url too). */
function setModel({ provider, model, profileId = profile() } = {}) {
  if (!provider) return { ok: false, reason: "provider required" };
  const r1 = _run(["config", "set", "model.provider", provider], 15000, profileId);
  if (!r1.ok) return r1;
  if (model) { const r2 = _run(["config", "set", "model.default", model], 15000, profileId); if (!r2.ok) return r2; }
  const base = PROVIDER_BASE[provider];
  if (base) _run(["config", "set", "model.base_url", base], 15000, profileId);
  return { ok: true, model: currentModel(profileId), profileId };
}

function setPersonality({ personality, profileId = profile() } = {}) {
  if (!personality) return { ok: false, reason: "personality required" };
  const allowed = new Set(availablePersonalities(profileId));
  if (!allowed.has(personality)) return { ok: false, reason: `unknown personality: ${personality}` };
  const r = _run(["config", "set", "display.personality", personality], 15000, profileId);
  if (!r.ok) return r;
  return { ok: true, personality: currentPersonality(profileId), personalities: availablePersonalities(profileId), profileId };
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

// Task focus: when a user clicks a task in the dashboard, we store it here
// so the CEO knows what we're talking about. Held in memory for the main-process lifetime.
let _focusedTask = null;

/**
 * Focus the CEO's attention on a specific task. When the user clicks a task
 * in the dashboard, we call this so subsequent CEO conversations include context.
 */
function focusTask(taskInfo) {
  _focusedTask = taskInfo;
  return { ok: true, focusedTask: _focusedTask };
}

/**
 * Add a new task to the kanban board. Uses the Hermes CLI to create the task.
 */
function addTask({ board, status, title, body, assignee, persona }) {
  if (!installed()) return { ok: false, reason: "Hermes CLI not found" };
  if (!board) board = currentBoard();
  if (!board) return { ok: false, reason: "No board specified" };
  if (!title) return { ok: false, reason: "Task title is required" };

  try {
    const args = ["kanban", ...(board ? ["--board", board] : []), "create", title];
    const finalBody = body || (persona ? `**Persona:** ${persona}` : "");
    if (finalBody) args.push("--body", finalBody);
    if (assignee) args.push("--assignee", assignee);
    if (status === "triage" || status === "planning") args.push("--triage");
    if (status === "blocked" || status === "running") args.push("--initial-status", status);

    const result = _run(args, 30000);
    if (!result.ok) return { ok: false, reason: result.reason };

    return { ok: true, message: "Task created successfully" };
  } catch (e) {
    return { ok: false, reason: `Failed to create task: ${e.message}` };
  }
}

function _kanban(board, args, timeout = 30000) {
  return _run(["kanban", ...(board ? ["--board", board] : []), ...args], timeout);
}

function assignees({ board } = {}) {
  const r = _kanban(board || currentBoard(), ["assignees", "--json"], 15000);
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.out || "[]");
    return { ok: true, assignees: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { ok: true, assignees: [] };
  }
}

function assignTask({ board, taskId, assignee, reclaim = false, reason = "reassigned from CEO Studio" } = {}) {
  if (!taskId) return { ok: false, reason: "task id required" };
  const profile = assignee || "none";
  const args = reclaim
    ? ["reassign", "--reclaim", "--reason", reason, taskId, profile]
    : ["assign", taskId, profile];
  return _kanban(board || currentBoard(), args, 30000);
}

function taskAction({ board, taskId, action, reason } = {}) {
  if (!taskId) return { ok: false, reason: "task id required" };
  const why = reason || "updated from CEO Studio";
  switch (action) {
    case "promote": return _kanban(board || currentBoard(), ["promote", taskId, why], 30000);
    case "block": return _kanban(board || currentBoard(), ["block", taskId, why], 30000);
    case "unblock": return _kanban(board || currentBoard(), ["unblock", "--reason", why, taskId], 30000);
    case "specify": return _kanban(board || currentBoard(), ["specify", taskId], 120000);
    case "decompose": return _kanban(board || currentBoard(), ["decompose", taskId], 120000);
    default: return { ok: false, reason: `unsupported task action: ${action}` };
  }
}

function dispatch({ board, max = 1, dryRun = false } = {}) {
  const args = ["dispatch", "--max", String(Math.max(1, Number(max) || 1))];
  if (dryRun) args.push("--dry-run");
  return _kanban(board || currentBoard(), args, 60000);
}

function taskLog({ board, taskId } = {}) {
  if (!taskId) return { ok: false, reason: "task id required" };
  const r = _kanban(board || currentBoard(), ["log", taskId], 15000);
  if (!r.ok) return r;
  return { ok: true, out: r.out || "" };
}

/** Append a durable Kanban comment to a task. */
function addComment({ board, taskId, body, author = "CEO Studio" }) {
  if (!installed()) return { ok: false, reason: "Hermes CLI not found" };
  if (!board) board = currentBoard();
  if (!board) return { ok: false, reason: "No board specified" };
  if (!taskId) return { ok: false, reason: "Task id is required" };
  if (!body) return { ok: false, reason: "Comment body is required" };
  const args = ["kanban", "comment", "--board", board, "--author", author, taskId, body];
  return _run(args, 30000);
}

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
 * Streaming variant of _runChat: invokes `hermes chat` and calls onDelta(text)
 * for each stdout chunk as it arrives. Resolves with the same shape as _runChat
 * once the process closes. Used by the AGUI server to stream TEXT_MESSAGE_CONTENT.
 */
function _streamChat(msg, resume, timeoutMs, onDelta) {
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
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      try { onDelta && onDelta(s); } catch { /* renderer-side concern */ }
    });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: false, reason: `Failed to reach CEO: ${e.message}` });
    });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(timer);
      const combined = out + "\n" + err;
      const sessionMiss = /No session found/i.test(combined);
      const sessionId = _extractSession(combined);
      const text = _clean(out);
      if (code !== 0 && !text) return resolve({ ok: false, reason: _clean(err) || `CEO exited ${code}`, sessionId, sessionMiss });
      resolve({ ok: true, reply: text, sessionId, sessionMiss });
    });
  });
}

/**
 * Streaming relay used by the AGUI server. Keeps the same rolling session as
 * ask() (shared _sessionId), prepends focused-task context, and forwards raw
 * stdout deltas via onDelta. Resolves { ok, reply, session } on completion.
 */
async function askStream(message, { timeoutMs = 180000, onDelta } = {}) {
  if (!installed()) return { ok: false, reason: "Hermes CLI not found" };
  let msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "Empty message" };
  if (_focusedTask) {
    msg = `[Context: We're discussing task "${_focusedTask.taskTitle}" (ID: ${_focusedTask.taskId}, status: ${_focusedTask.taskStatus}, board: ${_focusedTask.board})]\n\n${msg}`;
  }
  let res = await _streamChat(msg, _sessionId, timeoutMs, onDelta);
  if (_sessionId && res.sessionMiss) {
    _sessionId = null;
    res = await _streamChat(msg, null, timeoutMs, onDelta);
  }
  if (res.sessionId) _sessionId = res.sessionId;
  if (!res.ok) return { ok: false, reason: _friendly(res.reason), raw: res.reason, partial: res.partial };
  return { ok: true, reply: res.reply, session: _sessionId };
}

/**
 * Relay a message to the live Hermes CEO and return its reply. Keeps a single
 * rolling session so context persists. This is what the voice agent calls —
 * the voice is just a face; Hermes thinks.
 */
async function ask(message, { timeoutMs = 180000 } = {}) {
  if (!installed()) return { ok: false, reason: "Hermes CLI not found" };
  let msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "Empty message" };

  // If there's a focused task, prepend context about it
  if (_focusedTask) {
    msg = `[Context: We're discussing task "${_focusedTask.taskTitle}" (ID: ${_focusedTask.taskId}, status: ${_focusedTask.taskStatus}, board: ${_focusedTask.board})]\n\n${msg}`;
  }

  let res = await _runChat(msg, _sessionId, timeoutMs);
  // Stored session vanished (restart, gc) → start fresh once.
  if (_sessionId && res.sessionMiss) {
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
  listBoards, currentBoard, filterBoardsForDomain, getBoard, getTask, getStats, getSwarm, getRoom,
  getConfig, setModel, listProfiles, setProfile, gatewayStart, gatewayStop,
  setPersonality,
  focusTask, addTask, assignTask, taskAction, dispatch, taskLog, assignees, addComment,
  ask, askStream,
};
