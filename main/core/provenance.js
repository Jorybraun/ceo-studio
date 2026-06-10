"use strict";
/**
 * Project-scoped work provenance.
 *
 * Hermes Kanban owns the durable board. This file records the relationships
 * CEO Studio needs across that board: brief -> child task, bug -> repair task,
 * and brief/task -> generated asset. It is append-only JSONL so planner and
 * voice agents can write facts without schema migrations.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir } = require("./paths");

function dir(slug) {
  const d = path.join(brainDir(slug), "provenance");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function eventsPath(slug) {
  return path.join(dir(slug), "events.jsonl");
}

function _id(prefix = "prov") {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function ref(kind, id, extra = {}) {
  return { kind: text(kind), id: text(id), ...extra };
}

function append(slug, event = {}) {
  if (!slug) return null;
  const record = {
    id: event.id || _id(),
    type: event.type || "event",
    createdAt: event.createdAt || new Date().toISOString(),
    source: event.source || { system: "ceo-studio", actor: null },
    parent: event.parent || null,
    child: event.child || null,
    asset: event.asset || null,
    metadata: event.metadata || {},
  };
  fs.appendFileSync(eventsPath(slug), JSON.stringify(record) + "\n");
  return record;
}

function read(slug) {
  const file = eventsPath(slug);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function recordWorkItem(slug, { kind, board, taskId, title, domain, source } = {}) {
  return append(slug, {
    type: "work_item",
    source: source || { system: "domain-board", actor: null },
    child: ref(kind || "task", taskId || title, { board, title, domain }),
  });
}

function linkChild(slug, { parentKind = "brief", parentId, childKind = "task", childId, board, title, relationship = "decomposes_to", source, metadata } = {}) {
  if (!parentId || !childId) return null;
  return append(slug, {
    type: "relationship",
    source: source || { system: "planner", actor: null },
    parent: ref(parentKind, parentId, { board }),
    child: ref(childKind, childId, { board, title }),
    metadata: { relationship, ...(metadata || {}) },
  });
}

function recordAsset(slug, { parentKind = "brief", parentId, assetKind = "artifact", assetId, title, path: assetPath, summary, source, metadata } = {}) {
  if (!parentId || !assetId) return null;
  return append(slug, {
    type: "asset",
    source: source || { system: "agent-output", actor: null },
    parent: ref(parentKind, parentId),
    asset: ref(assetKind, assetId, { title, path: assetPath, summary }),
    metadata: metadata || {},
  });
}

function forParent(slug, parentId) {
  const id = text(parentId);
  return read(slug).filter((e) => e.parent && e.parent.id === id);
}

function forChild(slug, childId) {
  const id = text(childId);
  return read(slug).filter((e) => e.child && e.child.id === id);
}

function graph(slug, parentId) {
  const events = parentId ? forParent(slug, parentId) : read(slug);
  return {
    ok: true,
    parentId: parentId || null,
    events,
    children: events.filter((e) => e.child).map((e) => e.child),
    assets: events.filter((e) => e.asset).map((e) => e.asset),
  };
}

module.exports = {
  dir,
  eventsPath,
  append,
  read,
  ref,
  recordWorkItem,
  linkChild,
  recordAsset,
  forParent,
  forChild,
  graph,
};
