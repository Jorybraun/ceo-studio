"use strict";
/**
 * Studio sessions — first-class build/deep-dive containers.
 * Persisted per project under ~/.ceo-studio/<slug>/brain/studio-sessions/.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir } = require("./paths");
const mount = require("./mount");
const meetings = require("./meetings");

const PHASES = ["explore", "assets", "plan", "approve", "decompose", "execute", "done"];

let _activeId = null;
let _projectSlug = null;
let _projectPath = null;

function sessionsDir(slug) {
  const dir = path.join(brainDir(slug), "studio-sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(slug, id) {
  return path.join(sessionsDir(slug), `${id}.json`);
}

function _read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function _write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function _newId() {
  return crypto.randomBytes(4).toString("hex");
}

function bindProject(slug, projectPath) {
  _projectSlug = slug;
  _projectPath = projectPath;
}

function getActiveId() {
  return _activeId;
}

function setActive(id) {
  _activeId = id || null;
}

function list(slug) {
  const dir = sessionsDir(slug);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const rows = files.map((f) => _read(path.join(dir, f))).filter(Boolean);
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { ok: true, sessions: rows };
}

function get(slug, id) {
  const s = _read(sessionPath(slug, id));
  return s
    ? { ok: true, session: s, decomposition: getDecompositionSummary(s) }
    : { ok: false, reason: "session not found" };
}

function normalizeBriefRef(value = {}) {
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

function create(slug, { title, leadAgentId, allowPaid, briefRef } = {}) {
  const id = _newId();
  const now = Date.now();
  const room = `sess-${id}`;
  const lead = String(leadAgentId || "ceo").trim() || "ceo";
  const session = {
    id,
    title: String(title || "New session").trim() || "New session",
    leadAgentId: lead,
    phase: "explore",
    room,
    workers: [],
    plannedTeam: [],
    planDoc: null,
    decompositionDoc: null,
    taskTree: [],
    planApprovedAt: null,
    transcript: [],
    briefRef: normalizeBriefRef(briefRef),
    allowPaid: allowPaid === true,
    roomLoop: {
      mode: "manual",
      status: "stopped",
      allowPaid: false,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastError: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  _write(sessionPath(slug, id), session);
  return { ok: true, session };
}

function _needsPlanApproval(phase) {
  return phase === "execute" || phase === "done";
}

function update(slug, id, patch = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  if (patch.title != null) session.title = String(patch.title).trim() || session.title;
  if (patch.phase != null && PHASES.includes(patch.phase)) {
    if (_needsPlanApproval(patch.phase) && !session.planApprovedAt) {
      return { ok: false, reason: "Approve the plan before moving to execute or done" };
    }
    session.phase = patch.phase;
  }
  if (Array.isArray(patch.taskTree)) session.taskTree = patch.taskTree;
  if (patch.planApprovedAt != null) session.planApprovedAt = patch.planApprovedAt;
  if (patch.allowPaid != null) {
    session.allowPaid = patch.allowPaid === true;
    session.roomLoop = {
      ...(session.roomLoop || {}),
      allowPaid: patch.allowPaid === true,
    };
  }
  if (patch.plannedTeam != null && Array.isArray(patch.plannedTeam)) session.plannedTeam = patch.plannedTeam;
  if (patch.briefRef !== undefined) session.briefRef = normalizeBriefRef(patch.briefRef);
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function setPlan(slug, id, planDoc = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const body = String(planDoc.body || planDoc.content || "").trim();
  if (!body) return { ok: false, reason: "plan body required" };
  session.planDoc = {
    title: String(planDoc.title || "Plan").trim() || "Plan",
    overview: String(planDoc.overview || "").trim(),
    body,
    updatedAt: Date.now(),
  };
  session.planApprovedAt = null;
  if (session.phase === "explore" || session.phase === "assets") session.phase = "plan";
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function approvePlan(slug, id) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  if (!session.planDoc || !session.planDoc.body) {
    return { ok: false, reason: "no plan to approve — set a plan first" };
  }
  session.planApprovedAt = Date.now();
  session.phase = session.phase === "approve" || session.phase === "plan" ? "decompose" : session.phase;
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function rejectPlan(slug, id, { reason } = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  session.planApprovedAt = null;
  session.phase = "plan";
  if (reason) {
    session.planDoc = session.planDoc || {};
    session.planDoc.rejectionNote = String(reason).trim();
  }
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function setPlannedTeam(slug, id, team = []) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  if (!Array.isArray(team)) return { ok: false, reason: "team must be an array" };
  session.plannedTeam = team
    .map((m) => ({
      agentId: String(m.agentId || "").trim(),
      role: String(m.role || m.agentId || "").trim(),
    }))
    .filter((m) => m.agentId && m.agentId !== session.leadAgentId);
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function _normalizeDecompositionItem(raw, depth = 0) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || raw.label || "").trim();
  if (!title) return null;
  return {
    id: String(raw.id || `item-${depth}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`).trim(),
    title,
    type: String(raw.type || (depth === 0 ? "decomposition" : "step")).trim() || "decomposition",
    status: String(raw.status || "proposed").trim() || "proposed",
    actionItems: Array.isArray(raw.actionItems) ? raw.actionItems.map((x) => String(x).trim()).filter(Boolean) : [],
    routing: raw.routing && typeof raw.routing === "object" ? raw.routing : null,
    children: Array.isArray(raw.children)
      ? raw.children.map((c, i) => _normalizeDecompositionItem(c, depth + 1)).filter(Boolean)
      : [],
  };
}

function _taskTreeToDecompositionItems(tree, depth = 0) {
  if (!Array.isArray(tree)) return [];
  return tree
    .map((n) => {
      const title = String((n && n.title) || "").trim();
      if (!title) return null;
      const children = _taskTreeToDecompositionItems(n.children || [], depth + 1);
      return {
        id: String(n.id || `step-${depth}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`),
        title,
        type: depth === 0 ? "decomposition" : "step",
        status: String(n.status || "pending").trim() || "pending",
        actionItems: [],
        routing: null,
        children,
      };
    })
    .filter(Boolean);
}

/** Unified decomposition view for UI + agent prompts (explicit doc or task tree). */
function getDecompositionSummary(session) {
  if (!session) return { title: "Decomposition", overview: "", items: [], source: "empty" };
  const explicit = session.decompositionDoc;
  if (explicit && Array.isArray(explicit.items) && explicit.items.length) {
    return {
      title: explicit.title || "Decomposition",
      overview: explicit.overview || "",
      body: explicit.body || "",
      items: explicit.items,
      source: explicit.source || "decompositionDoc",
      updatedAt: explicit.updatedAt || null,
    };
  }
  const fromTree = _taskTreeToDecompositionItems(session.taskTree || []);
  const plan = session.planDoc || {};
  return {
    title: "Decomposition",
    overview: plan.overview || (plan.body ? String(plan.body).split("\n")[0].slice(0, 200) : ""),
    body: "",
    items: fromTree,
    source: fromTree.length ? "taskTree" : "empty",
    updatedAt: null,
  };
}

function setDecomposition(slug, id, decompositionDoc = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const items = Array.isArray(decompositionDoc.items)
    ? decompositionDoc.items.map((it) => _normalizeDecompositionItem(it)).filter(Boolean)
    : [];
  if (!items.length && !String(decompositionDoc.body || "").trim()) {
    return { ok: false, reason: "decomposition items or body required" };
  }
  session.decompositionDoc = {
    title: String(decompositionDoc.title || "Session decomposition").trim() || "Session decomposition",
    overview: String(decompositionDoc.overview || "").trim(),
    body: String(decompositionDoc.body || decompositionDoc.content || "").trim(),
    items,
    source: String(decompositionDoc.source || "lead-agent").trim() || "lead-agent",
    updatedAt: Date.now(),
  };
  if (session.phase === "approve" || session.phase === "decompose") {
    /* keep phase */
  } else if (session.planApprovedAt && session.phase === "plan") {
    session.phase = "decompose";
  }
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session, decomposition: getDecompositionSummary(session) };
}

function setTaskTree(slug, id, taskTree = []) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  if (!Array.isArray(taskTree)) return { ok: false, reason: "taskTree must be an array" };
  session.taskTree = taskTree;
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session, decomposition: getDecompositionSummary(session) };
}

async function launchTeam(slug, projectPath, id) {
  const p = sessionPath(slug, id);
  let session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const team = session.plannedTeam || [];
  if (!team.length) return { ok: false, reason: "planned team is empty — add agents first" };
  if (!session.planApprovedAt) {
    return { ok: false, reason: "Approve the plan before launching the team" };
  }
  const results = [];
  for (const m of team) {
    const r = await spawnWorker(slug, projectPath, id, { agentId: m.agentId, role: m.role });
    results.push({ agentId: m.agentId, ok: !!(r && r.ok), reason: r && r.reason });
    if (r && r.ok) session = r.session;
  }
  session.phase = "execute";
  session.updatedAt = Date.now();
  _write(p, session);
  meetings.post({
    projectPath,
    room: session.room,
    speaker: "Facilitator",
    body: `Team launched (${team.length} worker(s)). Phase → execute.`,
  });
  return { ok: true, session, results };
}

function appendTranscript(slug, id, entry) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  session.transcript = session.transcript || [];
  session.transcript.push({ ...entry, at: Date.now() });
  if (session.transcript.length > 200) session.transcript = session.transcript.slice(-200);
  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session };
}

function _memberList(session) {
  const ids = new Set([session.leadAgentId]);
  for (const w of session.workers || []) {
    if (w.agentId) ids.add(w.agentId);
  }
  return [...ids].join(",");
}

async function ensureRoomLoop(projectPath, session, opts = {}) {
  const members = _memberList(session);
  return meetings.startRoomLoop({
    projectPath,
    room: session.room,
    members,
    allowPaid: opts.allowPaid === true || session.allowPaid === true,
    maxFollowups: 2,
    gbrain: true,
  });
}

async function startRoomLoop(slug, projectPath, id, { allowPaid = false } = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const r = await ensureRoomLoop(projectPath, session, { allowPaid: allowPaid === true });
  session.allowPaid = allowPaid === true;
  session.roomLoop = {
    ...(session.roomLoop || {}),
    mode: "manual",
    status: r && r.ok ? "running" : "error",
    allowPaid: allowPaid === true,
    lastStartedAt: r && r.ok ? Date.now() : ((session.roomLoop || {}).lastStartedAt || null),
    lastStoppedAt: (session.roomLoop || {}).lastStoppedAt || null,
    lastError: r && r.ok ? null : ((r && r.reason) || "failed to start room loop"),
  };
  session.updatedAt = Date.now();
  _write(p, session);
  if (r && r.ok) {
    meetings.post({
      projectPath,
      room: session.room,
      speaker: "Facilitator",
      body: `Live room loop started for ${_memberList(session)}${allowPaid ? " with paid-provider opt-in" : " in free/default mode"}.`,
    });
  }
  return { ...(r || { ok: false, reason: "failed to start room loop" }), session };
}

function stopRoomLoop(slug, projectPath, id) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const r = meetings.stopRoomLoop({ room: session.room });
  session.roomLoop = {
    ...(session.roomLoop || {}),
    mode: "manual",
    status: "stopped",
    lastStoppedAt: Date.now(),
    lastError: null,
  };
  session.updatedAt = Date.now();
  _write(p, session);
  if (projectPath) {
    meetings.post({
      projectPath,
      room: session.room,
      speaker: "Facilitator",
      body: "Live room loop stopped.",
    });
  }
  return { ...(r || { ok: true }), session };
}

function roomLoopStatus(slug, id) {
  const session = _read(sessionPath(slug, id));
  if (!session) return { ok: false, reason: "session not found" };
  const live = meetings.roomLoopStatus({ room: session.room });
  return {
    ok: true,
    room: session.room,
    running: !!(live && live.running),
    live,
    saved: session.roomLoop || null,
  };
}

async function spawnWorker(slug, projectPath, id, { agentId, role } = {}) {
  const p = sessionPath(slug, id);
  const session = _read(p);
  if (!session) return { ok: false, reason: "session not found" };
  const aid = String(agentId || "").trim();
  if (!aid) return { ok: false, reason: "agentId required" };
  const plan = mount.lookup(projectPath, aid);
  if (!plan) return { ok: false, reason: `agent not found: ${aid}` };

  const existing = (session.workers || []).find((w) => w.agentId === aid);
  if (!existing) {
    session.workers = session.workers || [];
    session.workers.push({
      agentId: aid,
      role: String(role || aid).trim(),
      status: "starting",
      mountedAt: null,
    });
  }

  const mountResult = mount.mount(projectPath, aid);
  const worker = session.workers.find((w) => w.agentId === aid);
  if (worker) {
    worker.status = mountResult.ok ? "running" : "error";
    worker.mountError = mountResult.ok ? null : (mountResult.reason || "mount failed");
    worker.mountedAt = mountResult.ok ? Date.now() : null;
    worker.tmuxSession = mountResult.session || null;
  }

  meetings.post({
    projectPath,
    room: session.room,
    speaker: "Facilitator",
    body: `@${aid} joined session "${session.title}" as ${worker?.role || role || aid}. ${mountResult.ok ? "Mounted." : `Mount failed: ${mountResult.reason || "unknown"}`}`,
  });

  session.updatedAt = Date.now();
  _write(p, session);
  return { ok: true, session, mount: mountResult };
}

function getActiveSession(slug) {
  if (!_activeId || !slug) return null;
  return _read(sessionPath(slug, _activeId));
}

function forBrief(slug, board, taskId) {
  const b = String(board || "").trim();
  const id = String(taskId || "").trim();
  if (!b || !id) return [];
  return list(slug).sessions.filter((session) =>
    session.briefRef
    && session.briefRef.board === b
    && session.briefRef.taskId === id);
}

function getProjectSlug() {
  return _projectSlug;
}

function getProjectPath() {
  return _projectPath;
}

module.exports = {
  PHASES,
  bindProject,
  getProjectSlug,
  getProjectPath,
  getActiveId,
  setActive,
  list,
  get,
  create,
  update,
  setPlan,
  approvePlan,
  rejectPlan,
  setPlannedTeam,
  setDecomposition,
  getDecompositionSummary,
  setTaskTree,
  launchTeam,
  appendTranscript,
  spawnWorker,
  ensureRoomLoop,
  startRoomLoop,
  stopRoomLoop,
  roomLoopStatus,
  getActiveSession,
  forBrief,
};
