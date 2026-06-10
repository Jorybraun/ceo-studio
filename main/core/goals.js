"use strict";
/**
 * Layered project goals.
 *
 * The CEO needs durable daily/weekly/monthly/quarterly/roadmap targets so
 * briefs, bugs, tasks, and assets can be judged against an explicit direction.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir } = require("./paths");
const provenance = require("./provenance");

const LAYERS = ["daily", "weekly", "monthly", "quarterly", "roadmap"];
const STATUSES = ["active", "planned", "done", "paused", "archived"];

function goalsDir(slug) {
  const dir = path.join(brainDir(slug), "goals");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function goalsPath(slug) {
  return path.join(goalsDir(slug), "goals.json");
}

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

function slug(s) {
  return text(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function _id(layer, title) {
  const base = slug(title) || crypto.randomBytes(3).toString("hex");
  return `goal_${layer}_${base}_${crypto.randomBytes(3).toString("hex")}`;
}

function _readFile(slugName) {
  try {
    const parsed = JSON.parse(fs.readFileSync(goalsPath(slugName), "utf-8"));
    return { goals: Array.isArray(parsed.goals) ? parsed.goals : [] };
  } catch {
    return { goals: [] };
  }
}

function _writeFile(slugName, data) {
  fs.writeFileSync(goalsPath(slugName), JSON.stringify({ goals: data.goals || [] }, null, 2));
}

function normalize(input = {}, existing = {}) {
  const layer = LAYERS.includes(text(input.layer).toLowerCase()) ? text(input.layer).toLowerCase() : (existing.layer || "daily");
  const status = STATUSES.includes(text(input.status).toLowerCase()) ? text(input.status).toLowerCase() : (existing.status || "active");
  const now = new Date().toISOString();
  return {
    id: text(input.id) || existing.id || _id(layer, input.title || existing.title),
    layer,
    title: text(input.title) || existing.title || "Untitled goal",
    outcome: text(input.outcome) || existing.outcome || "",
    domain: text(input.domain) || existing.domain || "All",
    status,
    horizonStart: text(input.horizonStart) || existing.horizonStart || "",
    horizonEnd: text(input.horizonEnd) || existing.horizonEnd || "",
    roadmapRef: text(input.roadmapRef) || existing.roadmapRef || "",
    parentGoalId: text(input.parentGoalId) || existing.parentGoalId || "",
    successCriteria: list(input.successCriteria).length ? list(input.successCriteria) : (existing.successCriteria || []),
    links: Array.isArray(existing.links) ? existing.links : [],
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

function upsert(slugName, input = {}) {
  if (!slugName) return { ok: false, reason: "project slug required" };
  if (!text(input.title) && !text(input.id)) return { ok: false, reason: "goal title or id required" };
  const data = _readFile(slugName);
  const idx = data.goals.findIndex((g) => g.id === input.id);
  const goal = normalize(input, idx >= 0 ? data.goals[idx] : {});
  if (idx >= 0) data.goals[idx] = goal;
  else data.goals.push(goal);
  _writeFile(slugName, data);
  return { ok: true, goal };
}

function all(slugName, filters = {}) {
  const layer = text(filters.layer).toLowerCase();
  const status = text(filters.status).toLowerCase();
  const domain = text(filters.domain);
  let goals = _readFile(slugName).goals;
  if (layer) goals = goals.filter((g) => g.layer === layer);
  if (status) goals = goals.filter((g) => g.status === status);
  if (domain && domain !== "All") goals = goals.filter((g) => !g.domain || g.domain === "All" || g.domain.toLowerCase() === domain.toLowerCase());
  return goals.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function get(slugName, id) {
  return _readFile(slugName).goals.find((g) => g.id === id) || null;
}

function linkWork(slugName, { goalId, workKind = "task", workId, board, title, relationship = "supports", source } = {}) {
  if (!slugName) return { ok: false, reason: "project slug required" };
  if (!text(goalId)) return { ok: false, reason: "goalId required" };
  if (!text(workId)) return { ok: false, reason: "workId required" };
  const data = _readFile(slugName);
  const idx = data.goals.findIndex((g) => g.id === goalId);
  if (idx < 0) return { ok: false, reason: `goal not found: ${goalId}` };
  const now = new Date().toISOString();
  const link = {
    id: `goal_link_${crypto.randomBytes(5).toString("hex")}`,
    workKind: text(workKind) || "task",
    workId: text(workId),
    board: text(board),
    title: text(title),
    relationship: text(relationship) || "supports",
    createdAt: now,
  };
  data.goals[idx] = {
    ...data.goals[idx],
    links: [...(data.goals[idx].links || []), link],
    updatedAt: now,
  };
  _writeFile(slugName, data);
  const event = provenance.append(slugName, {
    type: "goal_link",
    source: source || { system: "goals", actor: null },
    parent: provenance.ref("goal", goalId, { layer: data.goals[idx].layer, title: data.goals[idx].title }),
    child: provenance.ref(link.workKind, link.workId, { board: link.board, title: link.title }),
    metadata: { relationship: link.relationship },
  });
  return { ok: true, goal: data.goals[idx], link, provenanceEventId: event && event.id };
}

function summary(slugName, filters = {}) {
  const goals = all(slugName, filters);
  const byLayer = {};
  for (const goal of goals) {
    if (!byLayer[goal.layer]) byLayer[goal.layer] = [];
    byLayer[goal.layer].push(goal);
  }
  return { ok: true, goals, byLayer };
}

module.exports = {
  LAYERS,
  STATUSES,
  goalsDir,
  goalsPath,
  upsert,
  all,
  get,
  linkWork,
  summary,
};
