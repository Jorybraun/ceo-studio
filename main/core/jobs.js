"use strict";
/**
 * Durable local job queue for cockpit agent work.
 *
 * This is intentionally small: JSON files under the project brain, one file per
 * job. It gives the live voice agent an asynchronous mailbox for "prepare this"
 * work without pretending the voice session itself is the worker.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir } = require("./paths");

function jobsDir(slug) {
  const dir = path.join(brainDir(slug), "jobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _id() {
  return "job_" + crypto.randomBytes(5).toString("hex");
}

function _file(slug, id) {
  return path.join(jobsDir(slug), `${id}.json`);
}

function create(slug, { type, domain = "All", requestedBy = "voice", input = {} } = {}) {
  if (!type) throw new Error("job type required");
  const now = new Date().toISOString();
  const job = {
    id: _id(),
    type,
    status: "queued",
    domain,
    requestedBy,
    input,
    output: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(_file(slug, job.id), JSON.stringify(job, null, 2));
  return job;
}

function get(slug, id) {
  try { return JSON.parse(fs.readFileSync(_file(slug, id), "utf-8")); }
  catch { return null; }
}

function update(slug, id, patch) {
  const job = get(slug, id);
  if (!job) return null;
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(_file(slug, id), JSON.stringify(next, null, 2));
  return next;
}

function list(slug, { limit = 30 } = {}) {
  let files = [];
  try { files = fs.readdirSync(jobsDir(slug)).filter((f) => f.endsWith(".json")); }
  catch { return []; }
  return files
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(jobsDir(slug), f), "utf-8")); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

module.exports = { jobsDir, create, get, update, list };
