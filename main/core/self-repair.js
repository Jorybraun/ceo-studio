"use strict";
/**
 * Self-repair intake.
 *
 * When CEO Studio observes a concrete system failure, this turns it into a
 * first-class bug plus an optional linked repair task. The actual code repair
 * remains delegated to a repair/planner path; this module makes the failure
 * visible, queryable, and tied to verification evidence.
 */
const domainBoard = require("./domain-board");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function list(v) {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  return String(v == null ? "" : v).split(/\r?\n|,/).map(text).filter(Boolean);
}

function buildSystemBug(input = {}) {
  const source = text(input.source) || "CEO Studio self-observation";
  const observed = text(input.observedBehavior || input.failure || input.output);
  const expected = text(input.expectedBehavior) || "CEO Studio should complete the requested operation and preserve its verified behavior.";
  return {
    board: input.board,
    title: text(input.title) || `Self-repair: ${source} failed`,
    domain: text(input.domain) || "Engineering",
    observedBehavior: observed || "A system failure was observed but no output was captured.",
    expectedBehavior: expected,
    reproductionSteps: list(input.reproductionSteps).length ? list(input.reproductionSteps) : [
      `Run or trigger: ${source}`,
      "Observe the captured failure output.",
    ],
    severity: text(input.severity) || "high",
    impact: text(input.impact) || "Autonomous operation cannot safely continue without triage.",
    evidence: list(input.evidence).length ? list(input.evidence) : [observed || source],
    acceptanceCriteria: list(input.acceptanceCriteria).length ? list(input.acceptanceCriteria) : [
      "The failure is reproduced or explained from evidence.",
      "A repair is implemented or a clear external blocker is recorded.",
      "Verification commands pass and evidence is attached to the bug.",
    ],
    owner: text(input.owner) || "self-repair-engineer",
    persona: text(input.persona) || "self-repair-engineer",
    goalId: text(input.goalId),
    requestedBy: input.requestedBy || "self-repair",
  };
}

function buildRepairTask({ bugId, bugTitle, board, goalId, workspace, verification, evidence } = {}) {
  const evidenceItems = Array.isArray(evidence) ? evidence.map(text).filter(Boolean) : list(evidence);
  return {
    board,
    parentKind: "bug",
    parentId: text(bugId || bugTitle),
    childKind: "repair_task",
    relationship: "repairs",
    title: `Repair ${text(bugTitle || bugId || "system bug")}`,
    outcome: "Diagnose the bug, implement the smallest safe fix, and attach verification evidence.",
    acceptanceCriteria: [
      "Root cause is documented on the bug.",
      "Fix is implemented without bypassing tests or adding mocks.",
      "Verification evidence is recorded as a bug asset.",
      "Documentation is updated, or docs-steward explicitly signs off that no docs update is needed.",
      "All file changes are committed with a focused git commit.",
      "The commit hash and verification output are posted back to the bug/task.",
    ],
    verification: list(verification).length ? list(verification) : ["npm test", "npm run check"],
    evidence: evidenceItems,
    workspace: text(workspace) || "Use the CEO_STUDIO repo or an isolated worktree if dispatching to a worker.",
    owner: "self-repair-engineer",
    persona: "self-repair-engineer",
    goalId: text(goalId),
    requestedBy: "self-repair",
  };
}

function buildConsultMessage({ request, bugId, repairTaskId, bugTitle, severity, evidence, source } = {}) {
  const lines = [
    "## Self-Repair Request",
    "",
    `Request: ${text(request) || "Diagnose and repair the logged issue or improvement."}`,
    `Source: ${text(source) || "voice-agent"}`,
    `Bug: ${text(bugId) || "not created"}`,
    `Repair task: ${text(repairTaskId) || "not created"}`,
    `Title: ${text(bugTitle) || "Self-repair request"}`,
    `Severity: ${text(severity) || "medium"}`,
  ];
  const ev = list(evidence);
  if (ev.length) {
    lines.push("", "### Evidence");
    for (const item of ev) lines.push(`- ${item}`);
  }
  lines.push(
    "",
    "### Required Operating Contract",
    "- Diagnose root cause before editing.",
    "- Implement the smallest safe repair or improvement.",
    "- Run `npm run check` and `npm test` unless explicitly blocked.",
    "- Update docs when behavior changes, or ask `docs-steward` to sign off no docs change is needed.",
    "- Commit every file change with a focused git commit.",
    "- Post the commit hash and verification evidence back to the bug/task before claiming done.",
  );
  return lines.join("\n");
}

function reportSystemBug(input = {}, { projectSlug, projectPath } = {}) {
  const bugInput = { ...buildSystemBug(input), projectPath };
  const bug = domainBoard.createBug(bugInput, { projectSlug });
  if (!bug.ok) return { ok: false, stage: "create_bug", bugInput, reason: bug.reason, missing: bug.missing, template: bug.template };
  const bugId = (bug.task && bug.task.taskId) || bugInput.title;
  let repairTask = null;
  if (input.createRepairTask !== false) {
    const repairInput = buildRepairTask({
      bugId,
      bugTitle: bugInput.title,
      board: bug.board,
      goalId: bugInput.goalId,
      workspace: input.workspace || projectPath,
      verification: input.verification,
      evidence: input.output ? [text(input.output).slice(0, 5000)] : bugInput.evidence,
    });
    repairTask = domainBoard.createChildTask({ ...repairInput, projectPath }, { projectSlug });
  }
  let evidence = null;
  if (projectSlug && text(input.evidencePath || input.output)) {
    evidence = domainBoard.recordAsset({
      parentKind: "bug",
      parentId: bugId,
      assetKind: input.evidencePath ? "file" : "log",
      assetId: text(input.evidencePath || `failure-log:${bugId}`),
      title: "Failure evidence",
      path: text(input.evidencePath),
      summary: text(input.output || input.failure).slice(0, 500),
      requestedBy: "self-repair",
    }, { projectSlug });
  }
  return { ok: true, bug, repairTask, evidence };
}

module.exports = {
  buildSystemBug,
  buildRepairTask,
  buildConsultMessage,
  reportSystemBug,
};
