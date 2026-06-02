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
 * caller to opt into paid spend (allowPaid -> CEO_ALLOW_PAID=1).
 */
const path = require("path");
const fs = require("fs");
const { execFileSync, spawn, execSync } = require("child_process");
const { resolvePython, envWithPython } = require("./pybin");

function harnessRoot(projectPath) {
  return path.join(projectPath || process.cwd(), "runtime", "harness");
}
function agentBin(projectPath) {
  return path.join(harnessRoot(projectPath), "bin", "agent");
}
function roomsDir(projectPath) {
  return path.join(harnessRoot(projectPath), "brain", "rooms");
}
function roomDir(projectPath, room) {
  return path.join(roomsDir(projectPath), room);
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
    const out = execFileSync(resolvePython(), ["-m", moduleName], {
      cwd: harnessRoot(projectPath),
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024,
      env: envWithPython(),
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
    mounted, // Include mounted list for UI debugging
  };
}

function _safeRoom(room) {
  return String(room || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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

  const env = envWithPython();
  if (allowPaid) env.CEO_ALLOW_PAID = "1";

  // Fresh room each start: clear any stale transcript/requirements for this name.
  try { fs.rmSync(roomDir(projectPath, safeRoom), { recursive: true, force: true }); } catch { /* ignore */ }

  try {
    const child = spawn(bin, args, { cwd: harnessRoot(projectPath), env, detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, room: safeRoom, members: members || null, team: team || null };
  } catch (e) {
    return { ok: false, reason: `failed to start meeting: ${e.message}` };
  }
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
  return out;
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

module.exports = { options, start, room, roomDir, harnessRoot, mountedAgents };
