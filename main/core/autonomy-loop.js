"use strict";
/**
 * Autonomy loop policy and run cycle.
 *
 * This module is the explicit boundary between "the system may observe/propose"
 * and "the system may mutate the board". Defaults are conservative:
 * - write goal review artifacts
 * - write blocked-analysis comments
 * - never create new briefs/tasks automatically
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");
const autonomy = require("./autonomy");
const goalReview = require("./goal-review");

const DEFAULT_POLICY = {
  enabled: false,
  intervalMinutes: 60,
  cooldownMinutes: 30,
  reviewLayers: ["daily", "weekly"],
  writeReviews: true,
  analyzeBlocked: true,
  allowBoardComments: true,
  allowCreateWork: false,
  maxBlockedPerRun: 10,
  mode: "propose",
};

function dir(slug) {
  const d = path.join(brainDir(slug), "autonomy");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function policyPath(slug) {
  return path.join(dir(slug), "policy.json");
}

function statePath(slug) {
  return path.join(dir(slug), "state.json");
}

function runsDir(slug) {
  const d = path.join(dir(slug), "runs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clampPositive(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function normalizePolicy(input = {}) {
  const merged = { ...DEFAULT_POLICY, ...(input || {}) };
  const reviewLayers = Array.isArray(merged.reviewLayers) ? merged.reviewLayers : String(merged.reviewLayers || "").split(",");
  return {
    ...merged,
    enabled: !!merged.enabled,
    intervalMinutes: clampPositive(merged.intervalMinutes, DEFAULT_POLICY.intervalMinutes),
    cooldownMinutes: clampPositive(merged.cooldownMinutes, DEFAULT_POLICY.cooldownMinutes),
    reviewLayers: reviewLayers.map((x) => String(x || "").trim()).filter(Boolean),
    writeReviews: merged.writeReviews !== false,
    analyzeBlocked: merged.analyzeBlocked !== false,
    allowBoardComments: merged.allowBoardComments !== false,
    allowCreateWork: !!merged.allowCreateWork,
    maxBlockedPerRun: Math.max(1, Number(merged.maxBlockedPerRun) || DEFAULT_POLICY.maxBlockedPerRun),
    mode: merged.allowCreateWork ? "assist" : "propose",
  };
}

function getPolicy(slug) {
  return normalizePolicy(readJson(policyPath(slug), DEFAULT_POLICY));
}

function setPolicy(slug, patch = {}) {
  const next = normalizePolicy({ ...getPolicy(slug), ...(patch || {}) });
  writeJson(policyPath(slug), next);
  return { ok: true, policy: next };
}

function getState(slug) {
  return readJson(statePath(slug), { lastRunAt: null, lastResult: null });
}

function saveState(slug, state) {
  writeJson(statePath(slug), state);
  return state;
}

function minutesSince(iso, now = new Date()) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (now.getTime() - t) / 60000;
}

function canRun(slug, { force = false, now = new Date() } = {}) {
  const policy = getPolicy(slug);
  const state = getState(slug);
  if (!force && !policy.enabled) return { ok: false, reason: "autonomy disabled", policy, state };
  const elapsed = minutesSince(state.lastRunAt, now);
  if (!force && elapsed < policy.cooldownMinutes) {
    return { ok: false, reason: `cooldown active (${elapsed.toFixed(1)}m / ${policy.cooldownMinutes}m)`, policy, state };
  }
  return { ok: true, policy, state };
}

function summarizeActions(reviews = []) {
  const actions = [];
  for (const r of reviews) {
    for (const item of (r.review && r.review.goalReviews) || []) {
      for (const action of item.actions || []) {
        actions.push({
          layer: r.review.layer,
          goalId: item.goal.id,
          goalTitle: item.goal.title,
          ...action,
        });
      }
    }
  }
  return actions;
}

function runCycle({ projectSlug, board, domain = "All", force = false, now = new Date() } = {}) {
  if (!projectSlug) return { ok: false, reason: "project slug required" };
  const gate = canRun(projectSlug, { force, now });
  if (!gate.ok) return { ok: true, skipped: true, reason: gate.reason, policy: gate.policy, state: gate.state };
  const policy = gate.policy;
  const startedAt = now.toISOString();
  const reviews = [];
  for (const layer of policy.reviewLayers) {
    const result = goalReview.run({
      projectSlug,
      board,
      layer,
      domain,
      dryRun: !policy.writeReviews,
    });
    reviews.push(result);
  }
  const blocked = policy.analyzeBlocked
    ? autonomy.analyzeBlocked({
      board,
      projectSlug,
      dryRun: !policy.allowBoardComments,
      limit: policy.maxBlockedPerRun,
    })
    : { ok: true, skipped: true, reason: "blocked analysis disabled" };
  const proposedActions = summarizeActions(reviews.filter((r) => r && r.ok));
  const result = {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    board: board || null,
    domain,
    policy,
    mode: policy.mode,
    reviews,
    blocked,
    proposedActions,
    createdWork: [],
    creationPolicy: policy.allowCreateWork
      ? "creation flag is enabled, but this deterministic cycle still requires a planner/CEO tool to create work from proposals"
      : "automatic work creation disabled; proposals only",
  };
  const runFile = path.join(runsDir(projectSlug), `${startedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(runFile, result);
  saveState(projectSlug, { lastRunAt: result.finishedAt, lastResult: { ...result, runFile } });
  return { ...result, runFile };
}

module.exports = {
  DEFAULT_POLICY,
  dir,
  policyPath,
  statePath,
  runsDir,
  getPolicy,
  setPolicy,
  getState,
  canRun,
  runCycle,
  summarizeActions,
};
