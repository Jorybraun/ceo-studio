"use strict";
/**
 * Domain board intake helpers.
 *
 * Briefs and bugs are first-class work records that still land on Hermes
 * Kanban as real tasks. This module keeps the body shape deterministic so
 * voice/planner agents cannot create vague cards that bypass the brief rules.
 */
const brain = require("./brain");
const hermes = require("./hermes");
const provenance = require("./provenance");
const goals = require("./goals");
const org = require("./orchestration-org");

// Sectional decomposer (new capability for breaking briefs into well-scoped plans)
const briefDecomposer = require("./brief-decomposer");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function list(v) {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  return String(v == null ? "" : v)
    .split(/\r?\n|,/)
    .map(text)
    .filter(Boolean);
}

function fallback(v, value = "Not stated.") {
  const s = text(v);
  return s || value;
}

function bullets(items, empty = "Not stated.") {
  const rows = list(items);
  return rows.length ? rows.map((x) => `- ${x}`).join("\n") : `- ${empty}`;
}

function checklist(items, empty = "Define acceptance criteria.") {
  const rows = list(items);
  return rows.length ? rows.map((x) => `- [ ] ${x}`).join("\n") : `- [ ] ${empty}`;
}

function missingBriefFields(input = {}) {
  const missing = [];
  if (!text(input.title)) missing.push("title");
  if (!text(input.goal)) missing.push("goal");
  if (!text(input.domain)) missing.push("domain");
  if (!text(input.currentRenderedState)) missing.push("currentRenderedState");
  if (!text(input.problemMismatch)) missing.push("problemMismatch");
  if (!list(input.acceptanceCriteria).length) missing.push("acceptanceCriteria");
  if (!text(input.nextAction)) missing.push("nextAction");
  return missing;
}

function missingBugFields(input = {}) {
  const missing = [];
  if (!text(input.title)) missing.push("title");
  if (!text(input.domain)) missing.push("domain");
  if (!text(input.observedBehavior)) missing.push("observedBehavior");
  if (!text(input.expectedBehavior)) missing.push("expectedBehavior");
  if (!list(input.reproductionSteps).length) missing.push("reproductionSteps");
  if (!text(input.severity)) missing.push("severity");
  return missing;
}

function normalizeBoard(board) {
  return text(board) || hermes.currentBoard() || "ceo-studio";
}

function briefBody(input = {}) {
  const board = normalizeBoard(input.board);
  const domain = fallback(input.domain, "All");
  const title = fallback(input.title, "Untitled brief");
  const routing = input.routing || org.route(null, { domain, status: input.status || "triage", kind: "brief" });
  return [
    "# Brief",
    "",
    "## Intake Metadata",
    "- Type: brief",
    `- Board: ${board}`,
    `- Domain: ${domain}`,
    `- Goal Link: ${fallback(input.goalId || input.goalLayer, "Not linked")}`,
    `- Source: ${fallback(input.source, "CEO Studio intake")}`,
    `- Created At: ${new Date().toISOString()}`,
    "",
    "### Goal",
    `- ${fallback(input.goal)}`,
    "",
    "### Board",
    `- Board: ${board}`,
    `- Task / Epic: ${title}`,
    `- Link / Reference: ${fallback(input.reference)}`,
    "",
    "### Domain",
    `- ${domain}`,
    "",
    "### Current Rendered State",
    `- ${fallback(input.currentRenderedState)}`,
    "",
    "### Problem / Mismatch",
    `- ${fallback(input.problemMismatch)}`,
    "",
    "### Constraints",
    bullets(input.constraints, "No constraints stated."),
    "",
    "### Acceptance Criteria",
    checklist(input.acceptanceCriteria),
    "",
    "### Next Action",
    `- ${fallback(input.nextAction)}`,
    "",
    "### Owner / Persona",
    `- Owner: ${fallback(input.owner, "Unassigned")}`,
    `- Persona: ${fallback(input.persona, "Unassigned")}`,
    "",
    org.routingMarkdown(routing),
    "",
    "## Planning Contract",
    "- Do not dispatch this brief until every section above is still true.",
    "- Planner decomposition must create child tasks that reference this brief title or task id.",
    "- Generated assets must reference this brief in their source/provenance metadata.",
    "- Queryable provenance is stored in the project brain when CEO Studio creates child tasks or assets.",
  ].join("\n");
}

function bugBody(input = {}) {
  const board = normalizeBoard(input.board);
  const domain = fallback(input.domain, "All");
  const title = fallback(input.title, "Untitled bug");
  const routing = input.routing || org.route(null, { domain, status: input.status || org.defaultLaneForKind("bug"), kind: "bug" });
  return [
    "# Bug",
    "",
    "## Intake Metadata",
    "- Type: bug",
    `- Board: ${board}`,
    `- Domain: ${domain}`,
    `- Goal Link: ${fallback(input.goalId || input.goalLayer, "Not linked")}`,
    `- Severity: ${fallback(input.severity)}`,
    `- Source: ${fallback(input.source, "CEO Studio intake")}`,
    `- Created At: ${new Date().toISOString()}`,
    "",
    "### Summary",
    `- ${title}`,
    "",
    "### Observed Behavior",
    `- ${fallback(input.observedBehavior)}`,
    "",
    "### Expected Behavior",
    `- ${fallback(input.expectedBehavior)}`,
    "",
    "### Reproduction Steps",
    bullets(input.reproductionSteps),
    "",
    "### Impact",
    `- ${fallback(input.impact)}`,
    "",
    "### Evidence",
    bullets(input.evidence, "No evidence attached yet."),
    "",
    "### Acceptance Criteria",
    checklist(input.acceptanceCriteria, "Bug is reproduced, fixed, and verified with named evidence."),
    "",
    "### Owner / Persona",
    `- Owner: ${fallback(input.owner, "Unassigned")}`,
    `- Persona: ${fallback(input.persona, "Unassigned")}`,
    "",
    org.routingMarkdown(routing),
    "",
    "## Triage Contract",
    "- Confirm the reproduction before assigning implementation.",
    "- If blocked, add a board comment with the blocker, attempted evidence, and next escalation target.",
    "- If this bug reveals a systemic issue, create or link a follow-up brief for prevention.",
  ].join("\n");
}

function recordBrainArtifact(projectSlug, { kind, input, taskResult }) {
  if (!projectSlug) return null;
  return brain.writeArtifact(projectSlug, {
    type: kind === "bug" ? "contradiction" : "proposal",
    title: `${kind === "bug" ? "Bug" : "Brief"} intake: ${fallback(input.title, "Untitled")}`.slice(0, 140),
    domain: text(input.domain) || null,
    summary: `${kind} created for board ${normalizeBoard(input.board)}${taskResult && taskResult.taskId ? ` as ${taskResult.taskId}` : ""}.`,
    source: { system: "domain-board", path: null, actor: input.requestedBy || "voice-or-planner" },
    provenance: { raw_refs: list(input.reference), related_artifacts: [] },
  });
}

function createBrief(input = {}, { projectSlug } = {}) {
  const missing = missingBriefFields(input);
  if (missing.length) {
    return {
      ok: false,
      reason: `Brief is missing required field(s): ${missing.join(", ")}`,
      missing,
      template: briefBody(input),
    };
  }
  const board = normalizeBoard(input.board);
  const routing = org.route(input.projectPath, { domain: input.domain, status: input.status || "triage", kind: "brief" });
  const body = briefBody({ ...input, board, routing });
  const result = hermes.addTask({
    board,
    status: input.status || routing.lane || "triage",
    title: `[Brief] ${text(input.title)}`,
    body,
    assignee: text(input.assignee || input.owner || routing.assignee),
    persona: text(input.persona || (routing.defaultPersonas || [])[0]),
  });
  if (!result.ok) return result;
  const artifact = recordBrainArtifact(projectSlug, { kind: "brief", input: { ...input, board }, taskResult: result });
  if (projectSlug) {
    provenance.recordWorkItem(projectSlug, {
      kind: "brief",
      board,
      taskId: result.taskId || text(input.title),
      title: text(input.title),
      domain: text(input.domain),
      source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
    });
    if (artifact && artifact.id) {
      provenance.recordAsset(projectSlug, {
        parentKind: "brief",
        parentId: result.taskId || text(input.title),
        assetKind: "brain_artifact",
        assetId: artifact.id,
        title: artifact.title,
        summary: artifact.summary,
        source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
      });
    }
    if (text(input.goalId)) {
      goals.linkWork(projectSlug, {
        goalId: text(input.goalId),
        workKind: "brief",
        workId: result.taskId || text(input.title),
        board,
        title: text(input.title),
        source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
      });
    }
  }
  return { ok: true, kind: "brief", board, body, task: result, brainArtifactId: artifact && artifact.id };
}

function createBug(input = {}, { projectSlug } = {}) {
  const missing = missingBugFields(input);
  if (missing.length) {
    return {
      ok: false,
      reason: `Bug is missing required field(s): ${missing.join(", ")}`,
      missing,
      template: bugBody(input),
    };
  }
  const board = normalizeBoard(input.board);
  const routing = org.route(input.projectPath, { domain: input.domain, status: input.status || org.defaultLaneForKind("bug"), kind: "bug" });
  const body = bugBody({ ...input, board, routing });
  const result = hermes.addTask({
    board,
    status: input.status || routing.lane || "bug",
    title: `[Bug] ${text(input.title)}`,
    body,
    assignee: text(input.assignee || input.owner || routing.assignee),
    persona: text(input.persona || (routing.defaultPersonas || [])[0]),
  });
  if (!result.ok) return result;
  const artifact = recordBrainArtifact(projectSlug, { kind: "bug", input: { ...input, board }, taskResult: result });
  if (projectSlug) {
    provenance.recordWorkItem(projectSlug, {
      kind: "bug",
      board,
      taskId: result.taskId || text(input.title),
      title: text(input.title),
      domain: text(input.domain),
      source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
    });
    if (artifact && artifact.id) {
      provenance.recordAsset(projectSlug, {
        parentKind: "bug",
        parentId: result.taskId || text(input.title),
        assetKind: "brain_artifact",
        assetId: artifact.id,
        title: artifact.title,
        summary: artifact.summary,
        source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
      });
    }
    if (text(input.goalId)) {
      goals.linkWork(projectSlug, {
        goalId: text(input.goalId),
        workKind: "bug",
        workId: result.taskId || text(input.title),
        board,
        title: text(input.title),
        source: { system: "domain-board", actor: input.requestedBy || "voice-or-planner" },
      });
    }
  }
  return { ok: true, kind: "bug", board, body, task: result, brainArtifactId: artifact && artifact.id };
}

function childTaskBody(input = {}) {
  const parentId = fallback(input.parentId, "Unlinked");
  const routing = input.routing || org.route(null, { domain: input.domain, status: input.status || org.defaultLaneForKind("child_task"), kind: "child_task" });
  return [
    "# Child Task",
    "",
    "## Parent",
    `- Parent Type: ${fallback(input.parentKind, "brief")}`,
    `- Parent ID: ${parentId}`,
    `- Goal Link: ${fallback(input.goalId, "Not linked")}`,
    `- Board: ${fallback(input.board, normalizeBoard(input.board))}`,
    "",
    "## Work",
    `- Outcome: ${fallback(input.outcome || input.title)}`,
    `- Workspace: ${fallback(input.workspace, "Not assigned.")}`,
    `- Owner / Persona: ${fallback(input.persona || input.owner, "Unassigned")}`,
    "",
    "## Acceptance Criteria",
    checklist(input.acceptanceCriteria),
    "",
    "## Verification",
    bullets(input.verification, "Verification evidence must be added before Done."),
    "",
    org.routingMarkdown(routing),
  ].join("\n");
}

function createChildTask(input = {}, { projectSlug } = {}) {
  if (!text(input.parentId)) return { ok: false, reason: "parentId required" };
  if (!text(input.title)) return { ok: false, reason: "title required" };
  const board = normalizeBoard(input.board);
  const routing = org.route(input.projectPath, { domain: input.domain, status: input.status || org.defaultLaneForKind("child_task"), kind: "child_task" });
  const body = input.body || childTaskBody({ ...input, board, routing });
  const result = hermes.addTask({
    board,
    status: input.status || routing.lane || "todo",
    title: `[Task] ${text(input.title)}`,
    body,
    assignee: text(input.assignee || input.owner || routing.assignee),
    persona: text(input.persona || (routing.defaultPersonas || [])[0]),
  });
  if (!result.ok) return result;
  let relationship = null;
  if (projectSlug) {
    relationship = provenance.linkChild(projectSlug, {
      parentKind: input.parentKind || "brief",
      parentId: text(input.parentId),
      childKind: input.childKind || "task",
      childId: result.taskId || text(input.title),
      board,
      title: text(input.title),
      relationship: input.relationship || "decomposes_to",
      source: { system: "domain-board", actor: input.requestedBy || "planner" },
      metadata: {
        goalId: text(input.goalId),
        acceptanceCriteria: list(input.acceptanceCriteria),
        verification: list(input.verification),
        workspace: text(input.workspace),
      },
    });
    if (text(input.goalId)) {
      goals.linkWork(projectSlug, {
        goalId: text(input.goalId),
        workKind: input.childKind || "task",
        workId: result.taskId || text(input.title),
        board,
        title: text(input.title),
        source: { system: "domain-board", actor: input.requestedBy || "planner" },
      });
    }
  }
  return { ok: true, kind: "child_task", board, body, task: result, provenanceEventId: relationship && relationship.id };
}

function recordAsset(input = {}, { projectSlug } = {}) {
  if (!projectSlug) return { ok: false, reason: "open a project first" };
  if (!text(input.parentId)) return { ok: false, reason: "parentId required" };
  if (!text(input.assetId || input.path || input.title)) return { ok: false, reason: "assetId, path, or title required" };
  const event = provenance.recordAsset(projectSlug, {
    parentKind: input.parentKind || "brief",
    parentId: text(input.parentId),
    assetKind: input.assetKind || "artifact",
    assetId: text(input.assetId || input.path || input.title),
    title: text(input.title),
    path: text(input.path),
    summary: text(input.summary),
    source: { system: "domain-board", actor: input.requestedBy || "planner" },
    metadata: input.metadata || {},
  });
  return { ok: true, event };
}

function decomposeBrief({ board, taskId } = {}, { projectSlug } = {}) {
  if (!text(taskId)) return { ok: false, reason: "taskId required" };
  const result = hermes.taskAction({
    board: normalizeBoard(board),
    taskId: text(taskId),
    action: "decompose",
    reason: "planner decomposition requested from CEO Studio",
  });
  if (result.ok && projectSlug) {
    provenance.append(projectSlug, {
      type: "decomposition_requested",
      source: { system: "domain-board", actor: "planner" },
      parent: provenance.ref("brief", text(taskId), { board: normalizeBoard(board) }),
      metadata: { action: "hermes kanban decompose" },
    });
  }
  return result;
}

module.exports = {
  createBrief,
  createBug,
  createChildTask,
  recordAsset,
  decomposeBrief,
  briefBody,
  bugBody,
  childTaskBody,
  missingBriefFields,
  missingBugFields,

  // New sectional decomposition (see domains/domain-lifecycle/docs/features/brief-sectional-decomposer.md)
  proposeSectionalBreakdown: briefDecomposer.proposeSectionalBreakdown,
  applySectionalDecomposition: briefDecomposer.applySectionalDecomposition,
};
