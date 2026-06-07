"use strict";
/**
 * Project notification inbox.
 *
 * This is for human-attention items the app owns. Hermes comments remain the
 * board log; this inbox is the cockpit interrupt surface.
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function dir(projectSlug) {
  if (!projectSlug) throw new Error("projectSlug required");
  const d = path.join(brainDir(projectSlug), "notifications");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function inboxPath(projectSlug) {
  return path.join(dir(projectSlug), "inbox.json");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function list(projectSlug, { includeRead = false, type = null, limit = 50 } = {}) {
  if (!projectSlug) return { ok: false, reason: "projectSlug required" };
  const inbox = readJson(inboxPath(projectSlug), { notifications: [] });
  let items = Array.isArray(inbox.notifications) ? inbox.notifications : [];
  if (type) items = items.filter((n) => n.type === type);
  if (!includeRead) items = items.filter((n) => !n.readAt && n.status !== "acknowledged");
  items = items
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, Math.max(1, Number(limit) || 50));
  return { ok: true, notifications: items, unread: items.filter((n) => !n.readAt && n.status !== "acknowledged").length };
}

function stableKey(input = {}) {
  return [
    text(input.type || "notification"),
    text(input.board),
    text(input.taskId),
    text(input.kind || input.title),
  ].join(":");
}

function create(projectSlug, input = {}, { now = new Date() } = {}) {
  if (!projectSlug) return { ok: false, reason: "projectSlug required" };
  const file = inboxPath(projectSlug);
  const inbox = readJson(file, { notifications: [] });
  const notifications = Array.isArray(inbox.notifications) ? inbox.notifications : [];
  const key = text(input.dedupeKey) || stableKey(input);
  const existing = notifications.find((n) => n.dedupeKey === key && !n.readAt && n.status !== "acknowledged");
  if (existing) {
    const updated = {
      ...existing,
      count: Number(existing.count || 1) + 1,
      updatedAt: now.toISOString(),
      lastReason: text(input.reason || existing.reason),
    };
    const next = notifications.map((n) => n.id === existing.id ? updated : n);
    writeJson(file, { notifications: next });
    return { ok: true, notification: updated, deduped: true };
  }
  const createdAt = now.toISOString();
  const notification = {
    id: text(input.id) || `notif-${createdAt.replace(/[^0-9A-Za-z]+/g, "-")}-${Math.random().toString(16).slice(2, 8)}`,
    type: text(input.type) || "human_escalation",
    severity: text(input.severity) || "high",
    status: text(input.status) || "unread",
    title: text(input.title) || "Human attention needed",
    body: text(input.body),
    actionLabel: text(input.actionLabel) || "Open task",
    board: text(input.board),
    taskId: text(input.taskId),
    taskTitle: text(input.taskTitle),
    reason: text(input.reason),
    decisionId: text(input.decisionId),
    dedupeKey: key,
    count: 1,
    createdAt,
    updatedAt: createdAt,
    readAt: null,
    metadata: input.metadata || {},
  };
  writeJson(file, { notifications: [notification, ...notifications].slice(0, 500) });
  return { ok: true, notification, deduped: false };
}

function acknowledge(projectSlug, id, { now = new Date() } = {}) {
  if (!projectSlug) return { ok: false, reason: "projectSlug required" };
  if (!text(id)) return { ok: false, reason: "notification id required" };
  const file = inboxPath(projectSlug);
  const inbox = readJson(file, { notifications: [] });
  const notifications = Array.isArray(inbox.notifications) ? inbox.notifications : [];
  let found = null;
  const next = notifications.map((n) => {
    if (n.id !== id) return n;
    found = { ...n, status: "acknowledged", readAt: now.toISOString(), updatedAt: now.toISOString() };
    return found;
  });
  if (!found) return { ok: false, reason: "notification not found" };
  writeJson(file, { notifications: next });
  return { ok: true, notification: found };
}

module.exports = {
  inboxPath,
  create,
  list,
  acknowledge,
};
