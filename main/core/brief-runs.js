"use strict";
/**
 * Brief Run workspace.
 *
 * A Brief Run is the durable product object that sits between "we have a brief"
 * and "agents may decompose/dispatch work". Hermes Kanban remains the board
 * ledger; this store keeps CEO Studio's document validation and run context.
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");

const REQUIRED_FIELDS = [
  "title",
  "goal",
  "domain",
  "currentRenderedState",
  "problemMismatch",
  "acceptanceCriteria",
  "nextAction",
];
const RUN_STATUSES = ["planning", "approved", "executing", "review", "blocked", "done"];

function text(v) {
  return String(v == null ? "" : v).trim();
}

function list(v) {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  return text(v).split(/\r?\n|,/).map(text).filter(Boolean);
}

function safeSegment(v, fallback) {
  const s = text(v) || fallback;
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function dir(projectSlug) {
  if (!projectSlug) throw new Error("projectSlug required");
  const d = path.join(brainDir(projectSlug), "brief-runs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function boardDir(projectSlug, board) {
  const d = path.join(dir(projectSlug), safeSegment(board, "board"));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function runPath(projectSlug, board, taskId) {
  if (!text(taskId)) throw new Error("taskId required");
  return path.join(boardDir(projectSlug, board), `${safeSegment(taskId, "task")}.json`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function stripBullet(v) {
  return text(v).replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, "").trim();
}

function section(body, heading) {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|\\n##\\s+|$)`, "i");
  const m = re.exec(String(body || ""));
  return m ? text(m[1]) : "";
}

function firstLine(sectionText) {
  const line = text(sectionText).split(/\r?\n/).map(stripBullet).find(Boolean);
  return line || "";
}

function sectionList(sectionText) {
  return text(sectionText).split(/\r?\n/).map(stripBullet).filter(Boolean);
}

function normalizeTaskTitle(title) {
  return text(title).replace(/^\[Brief\]\s*/i, "");
}

function inputSnapshot(input = {}) {
  return {
    title: text(input.title),
    goal: text(input.goal),
    domain: text(input.domain),
    currentRenderedState: text(input.currentRenderedState),
    problemMismatch: text(input.problemMismatch),
    constraints: list(input.constraints),
    acceptanceCriteria: list(input.acceptanceCriteria),
    nextAction: text(input.nextAction),
    owner: text(input.owner),
    persona: text(input.persona),
    goalId: text(input.goalId || input.goalLayer),
    source: text(input.source),
    sourceRefs: list(input.reference || input.sourceRefs),
  };
}

function snapshotFromTask(task = {}) {
  const body = text(task.body);
  const ownerPersona = section(body, "Owner / Persona");
  const owner = (ownerPersona.match(/Owner:\s*([^\n]+)/i) || [])[1] || "";
  const persona = (ownerPersona.match(/Persona:\s*([^\n]+)/i) || [])[1] || "";
  const metadata = section(body, "Intake Metadata");
  const source = (metadata.match(/Source:\s*([^\n]+)/i) || [])[1] || "";
  const goalLink = (metadata.match(/Goal Link:\s*([^\n]+)/i) || [])[1] || "";
  const boardSection = section(body, "Board");
  const reference = (boardSection.match(/Link \/ Reference:\s*([^\n]+)/i) || [])[1] || "";
  return {
    title: normalizeTaskTitle(task.title) || firstLine(boardSection),
    goal: firstLine(section(body, "Goal")),
    domain: firstLine(section(body, "Domain")),
    currentRenderedState: firstLine(section(body, "Current Rendered State")),
    problemMismatch: firstLine(section(body, "Problem / Mismatch")),
    constraints: sectionList(section(body, "Constraints")),
    acceptanceCriteria: sectionList(section(body, "Acceptance Criteria")),
    nextAction: firstLine(section(body, "Next Action")),
    owner: stripBullet(owner),
    persona: stripBullet(persona),
    goalId: stripBullet(goalLink),
    source: stripBullet(source),
    sourceRefs: list(stripBullet(reference)),
  };
}

function validateSnapshot(snapshot = {}) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (field === "acceptanceCriteria") {
      if (!Array.isArray(snapshot.acceptanceCriteria) || !snapshot.acceptanceCriteria.length) missing.push(field);
    } else if (!text(snapshot[field])) {
      missing.push(field);
    }
  }
  const warnings = [];
  if (!text(snapshot.owner)) warnings.push("owner is unassigned");
  if (!text(snapshot.persona)) warnings.push("persona is unassigned");
  if (!list(snapshot.sourceRefs).length && !text(snapshot.source)) warnings.push("no source reference recorded");
  if (!text(snapshot.goalId)) warnings.push("not linked to an active goal");
  return {
    ok: missing.length === 0,
    state: missing.length ? "dirty" : "clean",
    missing,
    warnings,
    checkedAt: new Date().toISOString(),
    requiredFields: REQUIRED_FIELDS,
  };
}

function validateInput(input = {}) {
  const snapshot = inputSnapshot(input);
  return { snapshot, validation: validateSnapshot(snapshot) };
}

function validateTask(task = {}) {
  const snapshot = snapshotFromTask(task);
  return { snapshot, validation: validateSnapshot(snapshot) };
}

function defaultChecklist(validation = {}) {
  return [
    { id: "brief-clean", label: "Brief has required fields", done: !!validation.ok },
    { id: "decomposition-ready", label: "Agenda/decomposition is approved", done: false },
    { id: "dispatch-policy", label: "Daily dispatch policy allows execution", done: false },
    { id: "qa-evidence", label: "QA evidence is attached before Done", done: false },
  ];
}

function normalizeChecklist(items, validation) {
  const source = Array.isArray(items) && items.length ? items : defaultChecklist(validation);
  const normalized = source.map((item, index) => ({
    id: text(item && item.id) || `check-${index + 1}`,
    label: text(item && item.label) || `Checklist item ${index + 1}`,
    done: !!(item && item.done),
  }));
  const briefClean = normalized.find((item) => item.id === "brief-clean");
  if (briefClean) briefClean.done = !!validation.ok;
  else normalized.unshift({ id: "brief-clean", label: "Brief has required fields", done: !!validation.ok });
  return normalized;
}

function collectionItem(value, fallbackPrefix) {
  if (value == null) return null;
  const item = typeof value === "string" ? { body: value } : { ...value };
  const body = text(item.body || item.text || item.summary || item.title);
  if (!body && !text(item.id)) return null;
  return {
    ...item,
    id: text(item.id) || `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    body,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function appendUnique(items, value, fallbackPrefix) {
  const item = collectionItem(value, fallbackPrefix);
  if (!item) return Array.isArray(items) ? items : [];
  const current = Array.isArray(items) ? items : [];
  const idx = current.findIndex((row) => text(row && row.id) === item.id);
  if (idx >= 0) {
    const next = current.slice();
    next[idx] = { ...next[idx], ...item };
    return next;
  }
  return [...current, item];
}

function read(projectSlug, board, taskId) {
  if (!projectSlug || !text(board) || !text(taskId)) return null;
  return readJson(runPath(projectSlug, board, taskId), null);
}

function write(projectSlug, run) {
  if (!projectSlug) return null;
  if (!text(run && run.board) || !text(run && run.taskId)) return null;
  writeJson(runPath(projectSlug, run.board, run.taskId), run);
  return run;
}

function buildRun({ projectSlug, board, taskId, snapshot, validation, previous = {}, source = {} } = {}) {
  const now = new Date().toISOString();
  return {
    ...previous,
    id: `${board}:${taskId}`,
    projectSlug,
    board,
    taskId,
    title: snapshot.title || previous.title || taskId,
    domain: snapshot.domain || previous.domain || "All",
    goalId: snapshot.goalId || previous.goalId || "",
    status: RUN_STATUSES.includes(previous.status) ? previous.status : "planning",
    source: {
      system: source.system || previous.source?.system || "domain-board",
      actor: source.actor || previous.source?.actor || "voice-or-planner",
      label: snapshot.source || source.label || previous.source?.label || "",
      refs: snapshot.sourceRefs || previous.source?.refs || [],
    },
    brief: snapshot,
    validation,
    progressChecklist: normalizeChecklist(previous.progressChecklist, validation),
    agendaItems: previous.agendaItems || [],
    meetings: previous.meetings || [],
    childTasks: previous.childTasks || [],
    assets: previous.assets || [],
    decisions: previous.decisions || [],
    evidence: previous.evidence || [],
    completionSummaries: previous.completionSummaries || [],
    meetingSyntheses: previous.meetingSyntheses || [],
    events: previous.events || [],
    linkedSessionIds: previous.linkedSessionIds || [],
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
}

function upsertFromBrief(projectSlug, input = {}, taskResult = {}, opts = {}) {
  if (!projectSlug) return null;
  const board = text(taskResult.board || input.board || opts.board || "ceo-studio");
  const taskId = text(taskResult.taskId || taskResult.id || input.taskId || opts.taskId || input.title);
  if (!taskId) return null;
  const prev = read(projectSlug, board, taskId) || {};
  const checked = validateInput(input);
  const run = buildRun({
    projectSlug,
    board,
    taskId,
    snapshot: {
      ...checked.snapshot,
      title: checked.snapshot.title || normalizeTaskTitle(taskResult.title) || taskId,
    },
    validation: checked.validation,
    previous: prev,
    source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
  });
  return write(projectSlug, run);
}

function ensureFromTask(projectSlug, board, task = {}) {
  if (!projectSlug || !text(board)) return null;
  const taskId = text(task.id || task.taskId);
  if (!taskId) return null;
  const previous = read(projectSlug, board, taskId);
  if (previous) return previous;
  if (!isBriefLike(task)) return null;
  const checked = validateTask(task);
  const run = buildRun({
    projectSlug,
    board,
    taskId,
    snapshot: checked.snapshot,
    validation: checked.validation,
    source: { system: "hermes-task", actor: "task-detail" },
  });
  return write(projectSlug, run);
}

function update(projectSlug, board, taskId, patch = {}) {
  const previous = read(projectSlug, board, taskId);
  if (!previous) return { ok: false, reason: "brief run not found" };
  const nextBriefInput = patch.brief && typeof patch.brief === "object"
    ? { ...previous.brief, ...patch.brief }
    : previous.brief;
  const snapshot = inputSnapshot(nextBriefInput);
  const validation = validateSnapshot(snapshot);
  const now = new Date().toISOString();
  const next = {
    ...previous,
    title: snapshot.title || previous.title,
    domain: snapshot.domain || previous.domain || "All",
    goalId: snapshot.goalId || previous.goalId || "",
    brief: snapshot,
    validation,
    progressChecklist: normalizeChecklist(
      patch.progressChecklist || previous.progressChecklist,
      validation,
    ),
    status: RUN_STATUSES.includes(text(patch.status)) ? text(patch.status) : previous.status,
    decisions: appendUnique(previous.decisions, patch.decision, "decision"),
    evidence: appendUnique(previous.evidence, patch.evidenceItem, "evidence"),
    assets: appendUnique(previous.assets, patch.asset, "asset"),
    childTasks: appendUnique(previous.childTasks, patch.childTask, "task"),
    meetings: appendUnique(previous.meetings, patch.meeting, "meeting"),
    agendaItems: appendUnique(previous.agendaItems, patch.agendaItem, "agenda"),
    completionSummaries: appendUnique(previous.completionSummaries, patch.completionSummary, "completion"),
    linkedSessionIds: patch.sessionId
      ? [...new Set([...(previous.linkedSessionIds || []), text(patch.sessionId)].filter(Boolean))]
      : (previous.linkedSessionIds || []),
    events: [
      ...(previous.events || []),
      {
        at: now,
        type: text(patch.eventType) || "brief_run_updated",
        actor: text(patch.actor) || "CEO Studio",
        summary: text(patch.summary),
      },
    ].slice(-200),
    updatedAt: now,
  };
  write(projectSlug, next);
  return { ok: true, run: next };
}

function upsertMeetingSynthesis(projectSlug, board, taskId, synthesis = {}) {
  const previous = read(projectSlug, board, taskId);
  if (!previous) return { ok: false, reason: "brief run not found" };
  if (!text(synthesis.id)) return { ok: false, reason: "synthesis id required" };
  const current = Array.isArray(previous.meetingSyntheses) ? previous.meetingSyntheses : [];
  const existing = current.find((item) => item && item.id === synthesis.id);
  if (existing && existing.sourceHash === synthesis.sourceHash) {
    return { ok: true, changed: false, synthesis: existing, run: previous };
  }
  const reviewedById = new Map((existing?.proposals || []).map((item) => [item.id, item]));
  const proposals = (synthesis.proposals || []).map((item) => {
    const reviewed = reviewedById.get(item.id);
    return reviewed
      ? { ...item, status: reviewed.status, reviewedAt: reviewed.reviewedAt, reviewedBy: reviewed.reviewedBy, result: reviewed.result }
      : item;
  });
  const nextProposalIds = new Set(proposals.map((item) => item.id));
  const historical = (existing?.proposals || [])
    .filter((item) => !nextProposalIds.has(item.id))
    .map((item) => item.status === "pending"
      ? { ...item, status: "superseded", reviewedAt: item.reviewedAt || new Date().toISOString() }
      : item);
  const now = new Date().toISOString();
  const nextSynthesis = {
    ...existing,
    ...synthesis,
    proposals: [...proposals, ...historical],
    sourceHistory: [
      ...(existing?.sourceHistory || []),
      ...(existing?.sourceHash && existing.sourceHash !== synthesis.sourceHash
        ? [{ sourceHash: existing.sourceHash, replacedAt: now }]
        : []),
    ].slice(-20),
    createdAt: existing?.createdAt || synthesis.createdAt || now,
    updatedAt: now,
  };
  const next = {
    ...previous,
    meetingSyntheses: [
      ...current.filter((item) => item && item.id !== synthesis.id),
      nextSynthesis,
    ],
    events: [
      ...(previous.events || []),
      {
        at: now,
        type: existing ? "meeting_synthesis_refreshed" : "meeting_synthesis_created",
        actor: "CEO Studio",
        summary: nextSynthesis.title,
      },
    ].slice(-200),
    updatedAt: now,
  };
  write(projectSlug, next);
  return { ok: true, changed: true, synthesis: nextSynthesis, run: next };
}

function updateMeetingProposal(projectSlug, board, taskId, synthesisId, proposalId, patch = {}) {
  const previous = read(projectSlug, board, taskId);
  if (!previous) return { ok: false, reason: "brief run not found" };
  const syntheses = Array.isArray(previous.meetingSyntheses) ? previous.meetingSyntheses : [];
  const synthesisIndex = syntheses.findIndex((item) => item && item.id === synthesisId);
  if (synthesisIndex < 0) return { ok: false, reason: "meeting synthesis not found" };
  const synthesis = syntheses[synthesisIndex];
  const proposalIndex = (synthesis.proposals || []).findIndex((item) => item && item.id === proposalId);
  if (proposalIndex < 0) return { ok: false, reason: "meeting proposal not found" };
  const now = new Date().toISOString();
  const proposals = synthesis.proposals.slice();
  proposals[proposalIndex] = {
    ...proposals[proposalIndex],
    ...patch,
    reviewedAt: patch.reviewedAt || now,
  };
  const pending = proposals.filter((item) => item.status === "pending").length;
  const nextSynthesis = {
    ...synthesis,
    proposals,
    status: pending ? "pending_review" : "reviewed",
    updatedAt: now,
  };
  const nextSyntheses = syntheses.slice();
  nextSyntheses[synthesisIndex] = nextSynthesis;
  const next = {
    ...previous,
    meetingSyntheses: nextSyntheses,
    events: [
      ...(previous.events || []),
      {
        at: now,
        type: `meeting_proposal_${patch.status || "updated"}`,
        actor: text(patch.reviewedBy) || "CEO Studio",
        summary: proposals[proposalIndex].title,
      },
    ].slice(-200),
    updatedAt: now,
  };
  write(projectSlug, next);
  return { ok: true, run: next, synthesis: nextSynthesis, proposal: proposals[proposalIndex] };
}

function appendEvent(projectSlug, board, taskId, event = {}) {
  const prev = read(projectSlug, board, taskId);
  if (!prev) return null;
  const events = Array.isArray(prev.events) ? prev.events : [];
  const next = {
    ...prev,
    events: [...events, { at: new Date().toISOString(), ...event }].slice(-200),
    updatedAt: new Date().toISOString(),
  };
  return write(projectSlug, next);
}

function isBriefLike(task = {}) {
  return /^\[Brief\]/i.test(text(task.title)) || /#\s*Brief\b/i.test(text(task.body));
}

function formatGateComment(gate = {}) {
  const validation = gate.validation || {};
  const missing = validation.missing || [];
  const warnings = validation.warnings || [];
  return [
    "## CEO Studio Document Validation Gate",
    "",
    `Brief Run: ${gate.runId || "not recorded"}`,
    `Validation state: ${validation.state || "unknown"}`,
    "",
    "### Required before decomposition/dispatch",
    missing.length
      ? missing.map((m) => `- Missing: ${m}`).join("\n")
      : "- All required brief fields are present.",
    "",
    "### Warnings",
    warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "- No warnings.",
    "",
    "### Next action",
    "- Return this item to planning/brief repair, update the Brief Run, then rerun the autonomy cycle.",
  ].join("\n");
}

function planningGate({ projectSlug, board, task } = {}) {
  const taskId = text(task && (task.id || task.taskId));
  const existing = projectSlug && board && taskId ? read(projectSlug, board, taskId) : null;
  if (existing && existing.validation && existing.validation.ok === false) {
    return {
      ok: true,
      allowed: false,
      reason: "brief run is dirty",
      runId: existing.id,
      validation: existing.validation,
      run: existing,
      comment: formatGateComment({ runId: existing.id, validation: existing.validation }),
    };
  }
  if (existing) {
    return { ok: true, allowed: true, reason: "brief run is clean", runId: existing.id, validation: existing.validation, run: existing };
  }
  if (!isBriefLike(task)) {
    return { ok: true, allowed: true, reason: "legacy/non-brief planning card" };
  }
  const checked = validateTask(task || {});
  if (!checked.validation.ok) {
    return {
      ok: true,
      allowed: false,
      reason: "brief body is dirty",
      runId: `${board || "board"}:${taskId || "task"}`,
      validation: checked.validation,
      comment: formatGateComment({ runId: `${board || "board"}:${taskId || "task"}`, validation: checked.validation }),
    };
  }
  return { ok: true, allowed: true, reason: "brief body is clean", validation: checked.validation };
}

module.exports = {
  REQUIRED_FIELDS,
  RUN_STATUSES,
  dir,
  runPath,
  read,
  write,
  validateInput,
  validateTask,
  validateSnapshot,
  upsertFromBrief,
  ensureFromTask,
  update,
  upsertMeetingSynthesis,
  updateMeetingProposal,
  appendEvent,
  planningGate,
  formatGateComment,
  isBriefLike,
};
