"use strict";
/**
 * CEO Studio board overlay.
 *
 * Hermes Kanban is the board ledger. This file stores CEO Studio-owned task
 * metadata that Hermes does not expose as first-class fields: unblock plans,
 * provenance pointers, retry state, decision requests, and future UI details.
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function safeSegment(v, fallback) {
  const s = text(v) || fallback;
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function boardDir(projectSlug, board) {
  if (!projectSlug) throw new Error("projectSlug required");
  if (!text(board)) throw new Error("board required");
  const d = path.join(brainDir(projectSlug), "boards", safeSegment(board, "board"), "tasks");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function taskPath(projectSlug, board, taskId) {
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

function readTask(projectSlug, board, taskId) {
  if (!projectSlug || !text(board) || !text(taskId)) return null;
  return readJson(taskPath(projectSlug, board, taskId), null);
}

function writeTask(projectSlug, board, taskId, patch = {}, { now = new Date() } = {}) {
  const file = taskPath(projectSlug, board, taskId);
  const prev = readJson(file, {});
  const createdAt = prev.createdAt || now.toISOString();
  const next = {
    ...prev,
    ...patch,
    board: text(board),
    taskId: text(taskId),
    createdAt,
    updatedAt: now.toISOString(),
  };
  writeJson(file, next);
  return next;
}

function appendEvent(projectSlug, board, taskId, event = {}, { now = new Date() } = {}) {
  const prev = readTask(projectSlug, board, taskId) || {};
  const events = Array.isArray(prev.events) ? prev.events : [];
  return writeTask(projectSlug, board, taskId, {
    ...prev,
    events: [...events, { at: now.toISOString(), ...event }].slice(-100),
  }, { now });
}

function columnsWithOverlay(projectSlug, board, columns = {}) {
  const out = {};
  for (const [lane, tasks] of Object.entries(columns || {})) {
    out[lane] = (tasks || []).map((task) => ({
      ...task,
      ceoOverlay: readTask(projectSlug, board, task.id) || null,
    }));
  }
  return out;
}

function boardView({ projectSlug, board, boardState } = {}) {
  if (!boardState || !boardState.ok) return boardState || { ok: false, reason: "board state required" };
  const slug = text(board || boardState.board || boardState.slug);
  if (!projectSlug || !slug) return { ...boardState, overlay: { ok: false, reason: "projectSlug and board required" } };
  return {
    ...boardState,
    columns: columnsWithOverlay(projectSlug, slug, boardState.columns || {}),
    overlay: { ok: true, projectSlug, board: slug },
  };
}

module.exports = {
  boardDir,
  taskPath,
  readTask,
  writeTask,
  appendEvent,
  boardView,
};
