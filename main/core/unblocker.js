"use strict";
/**
 * Blocked-lane unblocker.
 *
 * Blocked is a side state, not a destination. This module keeps Hermes as the
 * canonical board ledger while storing CEO Studio's richer unblock metadata in
 * the board overlay.
 */
const boardOverlay = require("./board-overlay");
const autonomy = require("./autonomy");
const domainBoard = require("./domain-board");
const hermes = require("./hermes");
const notifications = require("./notifications");
const org = require("./orchestration-org");
const selfRepair = require("./self-repair");

const UNBLOCK_MARKER = "CEO Studio Unblock Plan";

function text(v) {
  return String(v == null ? "" : v).trim();
}

// An unblocker-generated meta-task: a clarification / CEO-decision / [Unblock]
// task that THIS module created off some other blocked task (see the titles
// produced in createUnblockWork). Detecting them is the recursion guard that
// stops the "Clarify blocker for [Clarify blocker for ...]" churn: when such a
// meta-task is itself blocked, spawning yet another clarify/unblock layer is
// exactly what fanned a swarm of paid workers out over the same dead end. A
// blocked meta-task is escalated to a human decision instead of recursing.
const META_TASK_TITLE = /^\s*(?:clarify blocker for|ceo decision for|\[unblock\])/i;
function isUnblockMetaTask(task) {
  if (!task) return false;
  return META_TASK_TITLE.test(text(task.title));
}

function targetType(target) {
  const t = text(target).toLowerCase();
  if (t === "human") return "human_decision";
  if (t === "planner") return "requirements_clarification";
  if (t === "specialist") return "repair_or_specialist";
  return "ceo_decision";
}

function hasUnblockComment(detail) {
  return ((detail && detail.comments) || []).some((c) => text(c.body).includes(UNBLOCK_MARKER));
}

function buildPlan({ board, task, detail, route, now = new Date(), staleCount = 0 } = {}) {
  const fullTask = { ...(task || {}), ...((detail && detail.task) || {}) };
  const target = autonomy.escalationTarget(fullTask);
  const reason = autonomy.blockedReason(fullTask);
  const type = targetType(target);
  const owner = type === "repair_or_specialist"
    ? "self-repair-engineer"
    : type === "requirements_clarification"
      ? "planner"
      : target;
  return {
    status: type === "human_decision" ? "waiting_human" : "open",
    type,
    reason,
    escalationTarget: target,
    unblockOwner: owner,
    nextAction: nextActionFor(type, fullTask),
    retryAfter: now.toISOString(),
    staleCount,
    spawnedTaskId: null,
    sourceTaskTitle: text(fullTask.title),
    route,
    updatedBy: "unblocker",
  };
}

function nextActionFor(type, task = {}) {
  const title = text(task.title || task.id || "blocked task");
  switch (type) {
    case "human_decision":
      return `Ask the human for the missing external decision or access needed to unblock "${title}".`;
    case "requirements_clarification":
      return `Create a planner clarification task that rewrites "${title}" into dispatchable acceptance criteria.`;
    case "repair_or_specialist":
      return `Create a self-repair/specialist task to diagnose and remove the failure blocking "${title}".`;
    default:
      return `Ask Hermes CEO to decide whether to split, cancel, reprioritize, or unblock "${title}".`;
  }
}

function planComment({ board, task, plan, createdWork } = {}) {
  return [
    `## ${UNBLOCK_MARKER}`,
    "",
    `Task: ${text(task && task.id) || "unknown"} - ${text(task && task.title) || "(untitled)"}`,
    `Board: ${board}`,
    `Blocker type: ${plan.type}`,
    `Escalation target: ${plan.escalationTarget}`,
    `Unblock owner: ${plan.unblockOwner}`,
    "",
    "### Blocked Reason",
    `- ${plan.reason}`,
    "",
    "### Next Unblock Action",
    `- ${plan.nextAction}`,
    "",
    "### Created Work",
    createdWork && createdWork.taskId
      ? `- ${createdWork.kind || "task"}: ${createdWork.taskId}`
      : "- No new work created; waiting for the named owner/decision.",
  ].join("\n");
}

function createUnblockWork({ projectSlug, projectPath, board, task, plan, dryRun = false, deps } = {}) {
  if (dryRun) return { ok: true, dryRun: true, kind: "none", taskId: null };
  const title = text(task.title || task.id || "blocked task");
  if (plan.type === "human_decision") {
    const decisionId = `decision:${board}:${task.id}:${Date.now()}`;
    return { ok: true, kind: "human_decision", taskId: null, decisionId };
  }
  if (plan.type === "repair_or_specialist") {
    const repair = deps.selfRepair.reportSystemBug({
      board,
      source: `blocked task ${task.id}`,
      title: `[Unblock] ${title}`,
      observedBehavior: `Hermes task ${task.id} is blocked: ${plan.reason}`,
      expectedBehavior: "The blocker should be diagnosed, repaired or converted into a clear human decision, then the original task should be unblocked or split.",
      reproductionSteps: [`Open Hermes task ${task.id} on board ${board}`, "Review the blocker comments and current failure evidence."],
      severity: "high",
      impact: "The board runner cannot safely move this work forward while the blocker remains unresolved.",
      evidence: [plan.reason],
      acceptanceCriteria: [
        "The blocker root cause is documented on the original task.",
        "A repair, split, or explicit human decision request is created.",
        "The original task is unblocked or left blocked with a concrete next retry condition.",
      ],
      requestedBy: "unblocker",
      createRepairTask: true,
    }, { projectSlug, projectPath });
    const repairTaskId = repair && repair.repairTask && repair.repairTask.task && repair.repairTask.task.taskId;
    const bugTaskId = repair && repair.bug && repair.bug.task && repair.bug.task.taskId;
    return { ok: !!(repair && repair.ok), kind: "self_repair", taskId: repairTaskId || bugTaskId || null, raw: repair };
  }
  const child = deps.domainBoard.createChildTask({
    board,
    projectPath,
    parentKind: "blocked_task",
    parentId: task.id,
    childKind: "unblock_task",
    relationship: "unblocks",
    title: plan.type === "requirements_clarification" ? `Clarify blocker for ${title}` : `CEO decision for ${title}`,
    outcome: plan.nextAction,
    status: "todo",
    domain: "All",
    owner: plan.unblockOwner,
    persona: plan.unblockOwner,
    acceptanceCriteria: [
      "State the blocker in one sentence.",
      "Record evidence already checked.",
      "Choose exactly one next action: unblock, split, repair, cancel, or ask human.",
      "Post the result back to the original blocked task.",
    ],
    verification: ["Original task has an explicit unblock/split/decision comment."],
    workspace: "Use the CEO Studio repo or Hermes board context as needed.",
    requestedBy: "unblocker",
  }, { projectSlug });
  return { ok: !!(child && child.ok), kind: "unblock_task", taskId: child && child.task && child.task.taskId, raw: child };
}

function run({ projectSlug, projectPath, board, domain = "All", dryRun = false, limit = 10, now = new Date(), deps: depsIn = {} } = {}) {
  const deps = {
    hermes,
    overlay: boardOverlay,
    domainBoard,
    notifications,
    selfRepair,
    org,
    ...(depsIn || {}),
  };
  const slug = board || deps.hermes.currentBoard();
  if (!projectSlug) return { ok: false, reason: "projectSlug required" };
  if (!slug) return { ok: false, reason: "board required" };
  const boardState = deps.hermes.getBoard(slug);
  if (!boardState || !boardState.ok) return boardState || { ok: false, reason: "Could not read board" };
  const blocked = ((boardState.columns && boardState.columns.blocked) || []).slice(0, Math.max(1, Number(limit) || 10));
  const results = [];
  for (const task of blocked) {
    const detail = deps.hermes.getTask(slug, task.id);
    const prev = deps.overlay.readTask(projectSlug, slug, task.id) || {};
    const prevBlocker = prev.blocker || {};
    if (prevBlocker.status === "resolved") {
      if (!dryRun) deps.hermes.taskAction({ board: slug, taskId: task.id, action: "unblock", reason: "CEO Studio unblock plan resolved" });
      results.push({ taskId: task.id, action: "unblock", dryRun: !!dryRun });
      continue;
    }
    if (prevBlocker.spawnedTaskId || prevBlocker.status === "waiting_human") {
      const staleCount = Number(prevBlocker.staleCount || 0) + 1;
      if (!dryRun) deps.overlay.writeTask(projectSlug, slug, task.id, { blocker: { ...prevBlocker, staleCount } }, { now });
      results.push({ taskId: task.id, action: "monitor", status: prevBlocker.status || "open", staleCount });
      continue;
    }
    const route = deps.org.route(projectPath, { domain, status: "blocked", kind: "task" });
    const plan = buildPlan({ board: slug, task, detail: detail && detail.ok ? detail : null, route, now, staleCount: Number(prevBlocker.staleCount || 0) });
    // Recursion guard: a blocked task that is ITSELF an unblocker-generated
    // meta-task must never spawn another clarify/unblock/CEO layer. That nesting
    // ("Clarify blocker for [Clarify blocker for ...]") is the churn that burned
    // a swarm of paid workers. Coerce it to a human decision so it surfaces in
    // the review queue (createUnblockWork makes NO child task for human_decision).
    if (isUnblockMetaTask(task)) {
      plan.type = "human_decision";
      plan.status = "waiting_human";
      plan.escalationTarget = "human";
      plan.unblockOwner = "human";
      plan.metaRecursionGuard = true;
      plan.nextAction = `This is an unblocker-generated meta-task that is now itself blocked. Do NOT create another clarification/unblock layer — a human should directly resolve, re-scope, merge, or cancel "${text(task.title)}".`;
    }
    const createdWork = createUnblockWork({ projectSlug, projectPath, board: slug, task, plan, dryRun, deps });
    const nextPlan = {
      ...plan,
      spawnedTaskId: createdWork.taskId || null,
      decisionId: createdWork.decisionId || null,
      createdWorkKind: createdWork.kind || null,
      createWorkOk: createdWork.ok !== false,
    };
    if (!dryRun) {
      if (nextPlan.type === "human_decision") {
        const notice = deps.notifications.create(projectSlug, {
          type: "human_escalation",
          severity: "high",
          title: `Blocked: ${text(task.title || task.id)}`,
          body: nextPlan.nextAction,
          actionLabel: "Open blocked task",
          board: slug,
          taskId: task.id,
          taskTitle: task.title,
          reason: nextPlan.reason,
          decisionId: nextPlan.decisionId,
          dedupeKey: `human_escalation:${slug}:${task.id}`,
          metadata: {
            blockerType: nextPlan.type,
            escalationTarget: nextPlan.escalationTarget,
            unblockOwner: nextPlan.unblockOwner,
          },
        }, { now });
        nextPlan.notificationId = notice && notice.notification && notice.notification.id;
      }
      deps.overlay.writeTask(projectSlug, slug, task.id, { blocker: nextPlan }, { now });
      deps.overlay.appendEvent(projectSlug, slug, task.id, {
        type: "unblock_plan_created",
        blockerType: nextPlan.type,
        spawnedTaskId: nextPlan.spawnedTaskId,
        decisionId: nextPlan.decisionId,
      }, { now });
      if (!hasUnblockComment(detail && detail.ok ? detail : null)) {
        deps.hermes.addComment({
          board: slug,
          taskId: task.id,
          author: "CEO Studio Unblocker",
          body: planComment({ board: slug, task, plan: nextPlan, createdWork }),
        });
      }
    }
    results.push({
      taskId: task.id,
      title: task.title,
      action: "planned",
      blockerType: nextPlan.type,
      escalationTarget: nextPlan.escalationTarget,
      createdWorkKind: createdWork.kind,
      spawnedTaskId: createdWork.taskId || null,
      decisionId: createdWork.decisionId || null,
      metaRecursionGuard: !!nextPlan.metaRecursionGuard,
      dryRun: !!dryRun,
    });
  }
  return {
    ok: true,
    board: slug,
    blocked: blocked.length,
    dryRun: !!dryRun,
    planned: results.filter((r) => r.action === "planned").length,
    monitored: results.filter((r) => r.action === "monitor").length,
    unblocked: results.filter((r) => r.action === "unblock").length,
    results,
  };
}

module.exports = {
  UNBLOCK_MARKER,
  isUnblockMetaTask,
  buildPlan,
  planComment,
  createUnblockWork,
  run,
};
