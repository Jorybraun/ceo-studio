"use strict";
/**
 * Goal review cycle.
 *
 * This is the first deterministic review pass the CEO can run daily/weekly/etc.
 * It does not dispatch work. It reads durable goals + Hermes board state,
 * writes a review artifact, and proposes next actions for the planner/CEO.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const brain = require("./brain");
const goals = require("./goals");
const hermes = require("./hermes");
const provenance = require("./provenance");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function reviewsDir(slug) {
  const dir = path.join(goals.goalsDir(slug), "reviews");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _id(layer = "review") {
  return `review_${layer}_${crypto.randomBytes(5).toString("hex")}`;
}

function flattenBoard(boardState = {}) {
  const tasks = [];
  for (const [status, rows] of Object.entries(boardState.columns || {})) {
    for (const task of rows || []) tasks.push({ ...task, status: task.status || status });
  }
  return tasks;
}

function statusCounts(tasks = []) {
  const counts = {};
  for (const task of tasks) counts[task.status || "unknown"] = (counts[task.status || "unknown"] || 0) + 1;
  return counts;
}

function taskById(tasks = []) {
  const map = new Map();
  for (const task of tasks) if (task.id) map.set(task.id, task);
  return map;
}

function linkedTasks(goal = {}, taskMap = new Map()) {
  return (goal.links || [])
    .filter((l) => ["brief", "bug", "task"].includes(l.workKind))
    .map((l) => ({ link: l, task: taskMap.get(l.workId) || null }));
}

function suggestedActions(goal, linked, counts) {
  const actions = [];
  if (!linked.length) {
    actions.push({
      type: "create_brief",
      reason: "Goal has no linked briefs, bugs, or tasks.",
      title: `Create a brief for ${goal.title}`,
    });
  }
  const blocked = linked.filter((x) => x.task && x.task.status === "blocked");
  if (blocked.length) {
    actions.push({
      type: "analyze_blocked_work",
      reason: `${blocked.length} linked item(s) are blocked.`,
      taskIds: blocked.map((x) => x.task.id),
    });
  }
  const active = linked.filter((x) => x.task && !["done", "completed", "archived", "blocked"].includes(x.task.status));
  if (linked.length && !active.length && !blocked.length) {
    actions.push({
      type: "create_child_task",
      reason: "Goal has linked work, but nothing active is moving.",
      title: `Plan the next task for ${goal.title}`,
    });
  }
  if ((counts.triage || 0) > 0 && goal.layer === "daily") {
    actions.push({
      type: "triage",
      reason: "Daily goal review should clear or route triage work.",
    });
  }
  return actions;
}

function buildReview({ layer = "", domain = "", board = "", goals: goalList = [], boardState = {} } = {}) {
  const tasks = flattenBoard(boardState);
  const counts = statusCounts(tasks);
  const map = taskById(tasks);
  const goalReviews = goalList.map((goal) => {
    const linked = linkedTasks(goal, map);
    const blocked = linked.filter((x) => x.task && x.task.status === "blocked");
    const done = linked.filter((x) => x.task && ["done", "completed"].includes(x.task.status));
    return {
      goal,
      linkedCount: linked.length,
      visibleLinkedCount: linked.filter((x) => x.task).length,
      doneCount: done.length,
      blockedCount: blocked.length,
      actions: suggestedActions(goal, linked, counts),
    };
  });
  const orphanedBlocked = tasks.filter((t) => t.status === "blocked" && !goalList.some((g) => (g.links || []).some((l) => l.workId === t.id)));
  const unalignedActive = tasks.filter((t) =>
    !["done", "completed", "archived"].includes(t.status) &&
    !goalList.some((g) => (g.links || []).some((l) => l.workId === t.id)));
  const review = {
    id: _id(layer || "all"),
    layer: layer || "all",
    domain: domain || "All",
    board: board || boardState.slug || "",
    createdAt: new Date().toISOString(),
    boardCounts: counts,
    goalReviews,
    orphanedBlocked: orphanedBlocked.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    unalignedActive: unalignedActive.map((t) => ({ id: t.id, title: t.title, status: t.status })).slice(0, 20),
  };
  review.markdown = renderReview(review);
  return review;
}

function renderReview(review) {
  const lines = [
    `# Goal Review: ${review.layer}`,
    "",
    `- Board: ${review.board || "unknown"}`,
    `- Domain: ${review.domain || "All"}`,
    `- Created: ${review.createdAt}`,
    "",
    "## Board Counts",
    ...Object.entries(review.boardCounts || {}).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Goals",
  ];
  if (!review.goalReviews.length) lines.push("- No matching goals. Create daily/weekly/monthly/quarterly/roadmap goals before autonomous review can steer work.");
  for (const item of review.goalReviews) {
    lines.push(
      "",
      `### ${item.goal.title}`,
      `- Goal ID: ${item.goal.id}`,
      `- Layer: ${item.goal.layer}`,
      `- Linked work: ${item.linkedCount}`,
      `- Visible on board: ${item.visibleLinkedCount}`,
      `- Done: ${item.doneCount}`,
      `- Blocked: ${item.blockedCount}`,
      "- Proposed actions:",
      ...(item.actions.length ? item.actions.map((a) => `  - ${a.type}: ${a.reason}`) : ["  - none"]),
    );
  }
  lines.push("", "## Orphaned Blocked Work");
  lines.push(...(review.orphanedBlocked.length ? review.orphanedBlocked.map((t) => `- ${t.id}: ${t.title}`) : ["- none"]));
  lines.push("", "## Unaligned Active Work");
  lines.push(...(review.unalignedActive.length ? review.unalignedActive.map((t) => `- ${t.id} [${t.status}]: ${t.title}`) : ["- none"]));
  return lines.join("\n");
}

function writeReview(slug, review) {
  const file = path.join(reviewsDir(slug), `${review.id}.json`);
  fs.writeFileSync(file, JSON.stringify(review, null, 2));
  const artifact = brain.writeArtifact(slug, {
    type: "dream_cycle",
    title: `Goal review: ${review.layer}`,
    summary: `${review.goalReviews.length} goal(s), ${review.orphanedBlocked.length} orphaned blocked item(s), ${review.unalignedActive.length} unaligned active item(s).`,
    source: { system: "goal-review", path: file, actor: "scheduler-or-agent" },
    status: "active",
  });
  for (const item of review.goalReviews) {
    provenance.recordAsset(slug, {
      parentKind: "goal",
      parentId: item.goal.id,
      assetKind: "goal_review",
      assetId: review.id,
      title: `Goal review: ${review.layer}`,
      path: file,
      summary: artifact.summary,
      source: { system: "goal-review", actor: "scheduler-or-agent" },
    });
  }
  return { file, artifact };
}

function run({ projectSlug, board, layer = "", domain = "", dryRun = false } = {}) {
  if (!projectSlug) return { ok: false, reason: "project slug required" };
  const boardSlug = board || hermes.currentBoard();
  if (!boardSlug) return { ok: false, reason: "No board specified" };
  const boardState = hermes.getBoard(boardSlug);
  if (!boardState || !boardState.ok) return boardState || { ok: false, reason: "Could not read board" };
  const goalList = goals.all(projectSlug, { layer, status: "active", domain });
  const review = buildReview({ layer, domain, board: boardSlug, goals: goalList, boardState });
  const written = dryRun ? null : writeReview(projectSlug, review);
  return { ok: true, review, dryRun: !!dryRun, artifactId: written && written.artifact && written.artifact.id, path: written && written.file };
}

module.exports = {
  reviewsDir,
  flattenBoard,
  statusCounts,
  buildReview,
  renderReview,
  writeReview,
  run,
};
