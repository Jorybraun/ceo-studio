"use strict";
/**
 * Meetings bridge — the seam between CEO Studio (cockpit) and the harness A2A
 * meeting engine (`runtime/harness/bin/agent meeting`).
 *
 * Mirrors main/core/hermes.js conventions:
 *   - READ paths (agents/teams/personas, room transcript) shell out to small,
 *     model-free harness helpers or read the durable room log directly. No cost.
 *   - START spawns `bin/agent meeting` detached; it runs the real A2A meeting
 *     and writes progress to the room's chat.log (the human-visible bus) and a
 *     requirements.md when done. The cockpit polls those.
 *
 * Free `echo` provider = zero cost. Real providers (devin/grok) require the
 * caller to opt into paid spend. Now always enabled (CEO_ALLOW_PAID=1 hardcoded).
 */
const path = require("path");
const fs = require("fs");
const { execFileSync, spawn, execSync } = require("child_process");
const { resolvePython, envWithPython } = require("./pybin");

function harnessRoot(projectPath) {
  return path.join(projectPath || process.cwd(), "runtime", "harness");
}
function bundledHarnessRoot() {
  return path.join(__dirname, "..", "..", "runtime", "harness");
}
function executableHarnessRoot(projectPath) {
  const projectHarness = harnessRoot(projectPath);
  const hasProjectHarness =
    fs.existsSync(path.join(projectHarness, "bin", "agent")) &&
    fs.existsSync(path.join(projectHarness, "agents", "agent_config.py"));
  return hasProjectHarness ? projectHarness : bundledHarnessRoot();
}
function agentBin(projectPath) {
  return path.join(executableHarnessRoot(projectPath), "bin", "agent");
}
function roomsDir(projectPath) {
  // Rooms are the human-visible A2A bus and MUST match where the registry/mount
  // path writes (main/core/mount.js sets HARNESS_WORKSPACE=projectPath, so the
  // harness resolves rooms to <project>/brain/rooms — see runtime/harness/config/paths.py).
  // Previously this pointed at <project>/runtime/harness/brain/rooms, which split
  // the read path (this module) from the write path (mount.js): messages sent to
  // an agent never appeared in the feed, and the feed showed stale harness data.
  return path.join(projectPath || process.cwd(), "brain", "rooms");
}
function roomDir(projectPath, room) {
  return path.join(roomsDir(projectPath), room);
}
// Env for spawned harness processes. Pin HARNESS_WORKSPACE to the project root so
// rooms written by meeting/room-loop daemons land in the SAME tree this module
// reads (and that mount.js writes). Without this, the harness defaults to its own
// install dir and recreates the split-brain room storage.
function harnessEnv(projectPath, extra = {}) {
  const env = envWithPython();
  if (projectPath) env.HARNESS_WORKSPACE = projectPath;
  const pyPath = executableHarnessRoot(projectPath);
  env.PYTHONPATH = env.PYTHONPATH ? `${pyPath}${path.delimiter}${env.PYTHONPATH}` : pyPath;
  return Object.assign(env, extra);
}
function meetingsDir(projectPath) {
  return path.join(harnessRoot(projectPath), "brain", "meetings");
}
function schedulePath(projectPath) {
  return path.join(meetingsDir(projectPath), "scheduled.json");
}

/** Get list of currently mounted agents (active tmux sessions). */
function mountedAgents() {
  try {
    const out = execSync("tmux list-sessions", { encoding: "utf8", env: envWithPython() });
    const sessions = out.split("\n").filter(Boolean);
    // Extract agent IDs from session names like "pipe-pm", "pipe-ba", "agent-chat", etc.
    // Filter out non-agent sessions like "agent-chat", "agent-orchestration"
    return sessions
      .map(line => line.split(":")[0].trim())
      .filter(name => name.startsWith("pipe-"))
      .map(name => name.replace("pipe-", ""));
  } catch {
    return [];
  }
}

/** Run a model-free harness python helper module and parse its JSON stdout. */
function _pyJson(projectPath, moduleName) {
  try {
    const execRoot = executableHarnessRoot(projectPath);
    const out = execFileSync(resolvePython(), ["-m", moduleName], {
      cwd: execRoot,
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024,
      env: harnessEnv(projectPath),
    });
    return JSON.parse(out || "null");
  } catch (e) {
    return null;
  }
}

/** Agents + teams (from agents.json) and discoverable personas. For the UI form. */
function options(projectPath) {
  const cfg = _pyJson(projectPath, "agents.agent_config") || { agents: {}, teams: {} };
  const personas = _pyJson(projectPath, "agents.personas") || [];
  const allAgents = Object.values(cfg.agents || {});
  const mounted = mountedAgents();
  const mountedSet = new Set(mounted);
  const agents = allAgents.map((agent) => ({
    ...agent,
    mounted: mountedSet.has(agent.id),
  }));
  return {
    ok: true,
    agents,
    teams: Object.entries(cfg.teams || {}).map(([name, ids]) => ({ name, members: ids })),
    personas: Array.isArray(personas) ? personas : [],
    rooms: listRooms(projectPath, allAgents),
    scheduled: listScheduled(projectPath).meetings,
    mounted, // Include mounted list for UI debugging
  };
}

function _readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function _writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function _meetingId() {
  return `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _normalizeBriefRef(value) {
  if (!value || typeof value !== "object") return null;
  const board = String(value.board || "").trim();
  const taskId = String(value.taskId || "").trim();
  if (!board || !taskId) return null;
  return {
    board,
    taskId,
    runId: String(value.runId || `${board}:${taskId}`).trim(),
  };
}

function _normalizeScheduled(info = {}) {
  const now = new Date().toISOString();
  const title = String(info.title || "").trim() || "Untitled meeting";
  const scheduledFor = String(info.scheduledFor || "").trim() || now;
  return {
    id: String(info.id || _meetingId()),
    title,
    domain: String(info.domain || "All"),
    scheduledFor,
    recurrence: String(info.recurrence || "none"),
    status: String(info.status || "scheduled"),
    agenda: String(info.agenda || ""),
    criteria: String(info.criteria || ""),
    team: String(info.team || ""),
    members: String(info.members || ""),
    allowPaid: !!info.allowPaid,
    sourceContext: Array.isArray(info.sourceContext) ? info.sourceContext : [],
    briefRef: _normalizeBriefRef(info.briefRef),
    room: String(info.room || ""),
    roomPrefix: String(info.roomPrefix || ""),
    lastOccurrenceRoom: String(info.lastOccurrenceRoom || ""),
    lastStartedAt: String(info.lastStartedAt || ""),
    createdAt: String(info.createdAt || now),
    updatedAt: now,
  };
}

function listScheduled(projectPath) {
  const data = _readJson(schedulePath(projectPath), []);
  const meetings = (Array.isArray(data) ? data : [])
    .map((m) => _normalizeScheduled(m))
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  return { ok: true, meetings };
}

function saveScheduled(projectPath, meetings) {
  _writeJson(schedulePath(projectPath), meetings);
  return { ok: true, meetings };
}

function scheduleMeeting({ projectPath, meeting } = {}) {
  const current = listScheduled(projectPath).meetings;
  const next = _normalizeScheduled(meeting || {});
  if (!next.agenda.trim()) return { ok: false, reason: "agenda required" };
  if (!next.team && !next.members.trim()) return { ok: false, reason: "pick members or a team" };
  const updated = current.filter((m) => m.id !== next.id).concat(next);
  saveScheduled(projectPath, updated);
  return { ok: true, meeting: next };
}

function updateScheduled({ projectPath, id, patch } = {}) {
  const current = listScheduled(projectPath).meetings;
  const idx = current.findIndex((m) => m.id === id);
  if (idx < 0) return { ok: false, reason: "scheduled meeting not found" };
  const next = _normalizeScheduled({ ...current[idx], ...(patch || {}), id });
  current[idx] = next;
  saveScheduled(projectPath, current);
  return { ok: true, meeting: next };
}

function deleteScheduled({ projectPath, id } = {}) {
  const current = listScheduled(projectPath).meetings;
  const next = current.filter((m) => m.id !== id);
  saveScheduled(projectPath, next);
  return { ok: true, deleted: current.length !== next.length };
}

function _nextRecurringTime(iso, recurrence) {
  if (!recurrence || recurrence === "none") return "";
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  else return "";
  return d.toISOString();
}

function _occurrenceRoom(meeting) {
  if (!meeting || meeting.recurrence === "none") {
    return _safeRoom(meeting && meeting.room) || _safeRoom(`${meeting && meeting.title}-${Date.now()}`);
  }
  const prefix = _safeRoom(meeting.roomPrefix || meeting.room || meeting.title) || "meeting";
  const occurrence = String(meeting.scheduledFor || new Date().toISOString())
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[^0-9a-z]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return _safeRoom(`${prefix}-${occurrence}`) || `${prefix}-${Date.now()}`;
}

function startScheduled({ projectPath, id, agendaAppend } = {}) {
  const current = listScheduled(projectPath).meetings;
  const meeting = current.find((m) => m.id === id);
  if (!meeting) return { ok: false, reason: "scheduled meeting not found" };
  if (meeting.status !== "scheduled") {
    return { ok: false, reason: `scheduled meeting is ${meeting.status || "not ready"}` };
  }
  const room = _occurrenceRoom(meeting);
  const started = start({
    projectPath,
    room,
    agenda: `${meeting.agenda}${String(agendaAppend || "").trim() ? `\n${String(agendaAppend).trim()}` : ""}`,
    criteria: meeting.criteria,
    members: meeting.members,
    team: meeting.team,
    allowPaid: meeting.allowPaid,
  });
  if (!started || !started.ok) return started;
  const now = new Date().toISOString();
  const next = current.filter((m) => m.id !== id);
  const nextTime = _nextRecurringTime(meeting.scheduledFor, meeting.recurrence);
  if (nextTime) {
    next.push(_normalizeScheduled({
      ...meeting,
      id: meeting.id,
      room: "",
      roomPrefix: meeting.roomPrefix || meeting.room || _safeRoom(meeting.title),
      lastOccurrenceRoom: started.room,
      lastStartedAt: now,
      status: "scheduled",
      scheduledFor: nextTime,
      createdAt: meeting.createdAt || now,
    }));
  } else {
    next.push({
      ...meeting,
      status: "started",
      room: started.room,
      lastOccurrenceRoom: started.room,
      lastStartedAt: now,
      startedAt: now,
      updatedAt: now,
    });
  }
  saveScheduled(projectPath, next);
  return { ...started, meeting: { ...meeting, status: "started", room: started.room, startedAt: now } };
}

function listRooms(projectPath, allAgents = []) {
  const root = roomsDir(projectPath);
  if (!fs.existsSync(root)) return [];
  const agentIds = new Set((allAgents || []).map((a) => a && a.id).filter(Boolean));
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(Boolean);
  } catch {
    return [];
  }
  return names.map((name) => {
    const dir = roomDir(projectPath, name);
    const logPath = path.join(dir, "chat.log");
    const reqPath = path.join(dir, "requirements.md");
    let feed = [];
    let mtimeMs = 0;
    try {
      const stat = fs.statSync(logPath);
      mtimeMs = stat.mtimeMs || 0;
      feed = _parseLog(fs.readFileSync(logPath, "utf-8"));
    } catch { /* ignore */ }
    const speakers = [...new Set(feed.map((e) => e.speaker).filter(Boolean))];
    const participants = speakers.filter((s) => agentIds.has(s));
    const done = fs.existsSync(reqPath) || feed.some((e) => /MEETING SYNTHESIS/.test(e.body || ""));
    return {
      room: name,
      messages: feed.length,
      speakers,
      participants,
      updatedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
      done,
      hasRequirements: fs.existsSync(reqPath),
      channel: name.startsWith("chan-"),
    };
  }).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function _safeRoom(room) {
  return String(room || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Deterministic room name for a board's team-log channel. The autonomy runner
 * posts work milestones here and the cockpit opens the same room when you click
 * the board's channel — so a channel literally IS the team's shared work log.
 */
function boardRoom(board) {
  return _safeRoom(`chan-board-${board}`) || "chan-board";
}

/**
 * Start a meeting (detached). Returns immediately with the room name; the
 * cockpit polls room() for the live transcript + requirements.
 */
function start({ projectPath, room, agenda, criteria, members, team, orchestrator, allowPaid } = {}) {
  const bin = agentBin(projectPath);
  if (!fs.existsSync(bin)) return { ok: false, reason: "harness bin/agent not found" };
  const safeRoom = _safeRoom(room) || `meeting-${Date.now()}`;
  if (!agenda || !String(agenda).trim()) return { ok: false, reason: "agenda required" };
  if (!team && !(members && String(members).trim())) {
    return { ok: false, reason: "pick members or a team" };
  }

  const args = ["meeting", "--room", safeRoom, "--agenda", String(agenda)];
  if (criteria && String(criteria).trim()) args.push("--criteria", String(criteria));
  if (team) args.push("--team", String(team));
  else args.push("--members", String(members));
  if (orchestrator) args.push("--orchestrator", String(orchestrator));

  const env = harnessEnv(projectPath);
  env.CEO_ALLOW_PAID = "1"; // always enable real models (user: on all the time)

  // Fresh room each start: clear any stale transcript/requirements for this name.
  try { fs.rmSync(roomDir(projectPath, safeRoom), { recursive: true, force: true }); } catch { /* ignore */ }

  try {
    const child = spawn(bin, args, { cwd: executableHarnessRoot(projectPath), env, detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, room: safeRoom, members: members || null, team: team || null };
  } catch (e) {
    return { ok: false, reason: `failed to start meeting: ${e.message}` };
  }
}

// Track live room-loop daemons by safe room name so we can stop them and avoid
// double-spawning. Children are NOT detached, so they die with the app.
const roomLoops = new Map();

/**
 * Start a persistent live room loop so a channel becomes a real A2A
 * conversation: agents reply to messages posted into the room until it is
 * stopped. Idempotent per room. Real providers require allowPaid.
 */
function startRoomLoop({ projectPath, room, members, team, criteria, allowPaid, maxFollowups, idleExit, gbrain } = {}) {
  const bin = agentBin(projectPath);
  if (!fs.existsSync(bin)) return { ok: false, reason: "harness bin/agent not found" };
  const safeRoom = _safeRoom(room);
  if (!safeRoom) return { ok: false, reason: "room required" };
  if (!team && !(members && String(members).trim())) {
    return { ok: false, reason: "pick members or a team" };
  }
  const existing = roomLoops.get(safeRoom);
  if (existing && existing.exitCode === null && existing.signalCode === null) {
    return { ok: true, room: safeRoom, already: true };
  }

  const args = ["room", "--room", safeRoom];
  if (team) args.push("--team", String(team));
  else args.push("--members", String(members));
  if (criteria && String(criteria).trim()) args.push("--criteria", String(criteria));
  if (Number.isFinite(maxFollowups)) args.push("--max-followups", String(maxFollowups));
  if (Number.isFinite(idleExit)) args.push("--idle-exit", String(idleExit));
  // gbrain shared memory is on by default; pass --no-gbrain only when explicitly disabled.
  if (gbrain === false) args.push("--no-gbrain");

  const env = harnessEnv(projectPath);
  env.CEO_ALLOW_PAID = "1"; // always enable real models (user: on all the time)

  try {
    const child = spawn(bin, args, { cwd: executableHarnessRoot(projectPath), env, stdio: "ignore" });
    roomLoops.set(safeRoom, child);
    child.on("exit", () => { if (roomLoops.get(safeRoom) === child) roomLoops.delete(safeRoom); });
    return { ok: true, room: safeRoom, started: true };
  } catch (e) {
    return { ok: false, reason: `failed to start room loop: ${e.message}` };
  }
}

/** Stop a live room loop for a room (if running). */
function stopRoomLoop({ room } = {}) {
  const safeRoom = _safeRoom(room);
  if (!safeRoom) return { ok: false, reason: "room required" };
  const child = roomLoops.get(safeRoom);
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    roomLoops.delete(safeRoom);
    return { ok: true, room: safeRoom, stopped: true };
  }
  return { ok: true, room: safeRoom, stopped: false };
}

/** Whether a live room loop is currently running for a room. */
function roomLoopStatus({ room } = {}) {
  const safeRoom = _safeRoom(room);
  const child = roomLoops.get(safeRoom);
  const running = !!(child && child.exitCode === null && child.signalCode === null);
  return { ok: true, room: safeRoom, running };
}

/** Stop every live room loop (call on app shutdown). */
function stopAllRoomLoops() {
  for (const [, child] of roomLoops) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
  roomLoops.clear();
}

/** Parse a harness chat.log into structured entries.
 * Entries start with an ISO timestamp header: `[2026-..T..Z] Speaker: body`.
 * Anchoring on the timestamp (not any `[...]`) avoids splitting on bracketed
 * text inside a body (e.g. an echo reply like `[echo:ba] ...`). */
function _parseLog(text) {
  const TS = /\[\d{4}-\d{2}-\d{2}T[^\]]+\]/; // ISO-ish timestamp header
  const headerRe = new RegExp(`^(${TS.source})\\s+([^:\\n]+):\\s?`);
  const out = [];
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(headerRe);
    if (m) {
      if (cur) out.push(cur);
      cur = { ts: m[1].slice(1, -1), speaker: m[2].trim(), body: line.slice(m[0].length) };
    } else if (cur) {
      cur.body += "\n" + line;
    }
  }
  if (cur) out.push(cur);
  for (const e of out) e.body = e.body.trim();
  // Drop the file's leading "# <room> Team Room" header lines (no header match -> ignored).
  // Also drop watcher presence heartbeats ("heartbeat at <iso>") — these are liveness
  // pings, not conversation, and historically flooded the room (~95% of entries),
  // burying real A2A messages. Presence/liveness is tracked separately via the
  // room's presence/ dir (domain-room who), so the human-visible feed stays clean.
  return out.filter((e) => !/^heartbeat at\b/i.test(e.body || ""));
}

/**
 * Append a human/CEO message directly into a room's chat.log so it shows up in
 * the live transcript alongside the agents. This is how a person (or the CEO)
 * drops into a team channel mid-discussion to steer it. Writes the same
 * `[<iso>] <speaker>: <body>` format _parseLog reads.
 */
function post({ projectPath, room, speaker, body } = {}) {
  const safeRoom = _safeRoom(room);
  if (!safeRoom) return { ok: false, reason: "room required" };
  if (!String(body || "").trim()) return { ok: false, reason: "message required" };
  const dir = roomDir(projectPath, safeRoom);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, "chat.log");
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, `# ${safeRoom} Team Room\n\n`, "utf-8");
    const line = `[${new Date().toISOString()}] ${String(speaker || "You").trim()}: ${String(body).trim()}\n`;
    fs.appendFileSync(logPath, line, "utf-8");
    return { ok: true, room: safeRoom };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Live transcript + requirements + running state for a meeting room. */
function room({ projectPath, room } = {}) {
  const safeRoom = _safeRoom(room);
  if (!safeRoom) return { ok: false, reason: "room required" };
  const dir = roomDir(projectPath, safeRoom);
  const logPath = path.join(dir, "chat.log");
  const reqPath = path.join(dir, "requirements.md");
  if (!fs.existsSync(logPath)) {
    return { ok: true, room: safeRoom, feed: [], requirements: null, running: true, started: false };
  }
  let text = "";
  try { text = fs.readFileSync(logPath, "utf-8"); } catch { /* ignore */ }
  let requirements = null;
  try { if (fs.existsSync(reqPath)) requirements = fs.readFileSync(reqPath, "utf-8"); } catch { /* ignore */ }
  const feed = _parseLog(text);
  const done = !!requirements || /MEETING SYNTHESIS/.test(text);
  return { ok: true, room: safeRoom, feed, requirements, running: !done, started: true };
}

module.exports = {
  options, start, post, room, roomDir, harnessRoot, mountedAgents, boardRoom,
  listScheduled, scheduleMeeting, updateScheduled, deleteScheduled, startScheduled,
  startRoomLoop, stopRoomLoop, roomLoopStatus, stopAllRoomLoops,
};
