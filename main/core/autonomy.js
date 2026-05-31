"use strict";
/**
 * Autonomy control helpers.
 *
 * This is intentionally not a polling loop. It is a deterministic board pass
 * that can be triggered by voice, planner, or a future scheduler. Its first job
 * is to stop blocked cards from silently rotting: inspect the blocked lane,
 * add a visible escalation comment, and log the issue into project memory.
 */
const brain = require("./brain");
const hermes = require("./hermes");

const BLOCKER_MARKER = "CEO Studio Blocker Analysis";

function text(v) {
  return String(v == null ? "" : v).trim();
}

function recentComments(detail, limit = 4) {
  return ((detail && detail.comments) || [])
    .slice(0, limit)
    .map((c) => `- ${c.author || "comment"}: ${text(c.body).slice(0, 500)}`)
    .join("\n");
}

function hasRecentBlockerAnalysis(detail) {
  return ((detail && detail.comments) || []).some((c) =>
    /CEO Studio Autonomy/i.test(c.author || "") || text(c.body).includes(BLOCKER_MARKER));
}

function escalationTarget(task = {}) {
  const title = `${task.title || ""} ${task.body || ""} ${task.last_failure_error || ""}`.toLowerCase();
  if (/acceptance|scope|requirement|brief|unclear|ambiguous|spec/.test(title)) return "planner";
  if (/permission|credential|api key|oauth|secret|access|blocked by human/.test(title)) return "human";
  if (/test|build|exception|stack|crash|failure|bug|error/.test(title)) return "specialist";
  return "CEO";
}

function blockedReason(task = {}) {
  if (text(task.last_failure_error)) return text(task.last_failure_error);
  const body = text(task.body);
  const blockerLine = body.split(/\r?\n/).find((line) => /block|fail|error|stuck|waiting/i.test(line));
  return blockerLine ? blockerLine.replace(/^[-*]\s*/, "") : "No explicit blocker reason is recorded on the task.";
}

function buildBlockedAnalysis({ board, task, detail } = {}) {
  const fullTask = { ...(task || {}), ...((detail && detail.task) || {}) };
  const target = escalationTarget(fullTask);
  const reason = blockedReason(fullTask);
  const comments = recentComments(detail);
  return [
    `## ${BLOCKER_MARKER}`,
    "",
    `Task: ${fullTask.id || "unknown"} — ${fullTask.title || "(untitled)"}`,
    `Board: ${board || "unknown"}`,
    `Status: ${fullTask.status || "blocked"}`,
    `Escalation target: ${target}`,
    "",
    "### What is blocked",
    `- ${reason}`,
    "",
    "### Evidence checked",
    comments || "- No recent comments were available.",
    "",
    "### Discussion needed",
    "- Decide whether this needs clearer requirements, a specialist repair pass, human input, or CEO reprioritization.",
    "",
    "### Proposed next action",
    `- Route to ${target}; add the missing decision/evidence, then unblock or split the work into a smaller task.`,
  ].join("\n");
}

function memorySummary(task = {}, target) {
  return [
    `Blocked task ${task.id || "unknown"} needs ${target} escalation.`,
    `Title: ${task.title || "(untitled)"}.`,
    text(task.last_failure_error) ? `Failure: ${text(task.last_failure_error).slice(0, 300)}.` : "No machine failure reason recorded.",
  ].join(" ");
}

function analyzeBlocked({ board, projectSlug, dryRun = false, limit = 20 } = {}) {
  const slug = board || hermes.currentBoard();
  if (!slug) return { ok: false, reason: "No board specified" };
  const boardState = hermes.getBoard(slug);
  if (!boardState || !boardState.ok) return boardState || { ok: false, reason: "Could not read board" };
  const blocked = (boardState.columns && boardState.columns.blocked) || [];
  const results = [];
  for (const task of blocked.slice(0, Math.max(1, Number(limit) || 20))) {
    const detail = hermes.getTask(slug, task.id);
    if (detail && detail.ok && hasRecentBlockerAnalysis(detail)) {
      results.push({ taskId: task.id, skipped: true, reason: "already has blocker analysis" });
      continue;
    }
    const analysis = buildBlockedAnalysis({ board: slug, task, detail: detail && detail.ok ? detail : null });
    const target = escalationTarget({ ...task, ...((detail && detail.task) || {}) });
    let comment = { ok: true, dryRun: true };
    let artifact = null;
    if (!dryRun) {
      comment = hermes.addComment({
        board: slug,
        taskId: task.id,
        body: analysis,
        author: "CEO Studio Autonomy",
      });
      if (projectSlug) {
        artifact = brain.writeArtifact(projectSlug, {
          type: "open_question",
          title: `Blocked task escalation: ${task.title || task.id}`.slice(0, 140),
          summary: memorySummary(task, target),
          source: { system: "autonomy-blocked-analyzer", path: null, actor: "scheduler-or-agent" },
          provenance: { raw_refs: [`kanban:${slug}:${task.id}`], related_artifacts: [] },
          status: "active",
        });
      }
    }
    results.push({
      taskId: task.id,
      title: task.title,
      escalationTarget: target,
      comment: comment && comment.ok ? "written" : "failed",
      reason: comment && comment.ok ? null : comment && comment.reason,
      brainArtifactId: artifact && artifact.id,
      analysis,
    });
  }
  return {
    ok: true,
    board: slug,
    blocked: blocked.length,
    analyzed: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    dryRun: !!dryRun,
    results,
  };
}

module.exports = {
  BLOCKER_MARKER,
  analyzeBlocked,
  buildBlockedAnalysis,
  hasRecentBlockerAnalysis,
  escalationTarget,
  blockedReason,
};
