#!/usr/bin/env node
"use strict";
/**
 * CLI entry point for the autonomy runner (the in-app cockpit is the primary
 * surface; this is a headless fallback for servers / cron / debugging).
 *
 * Usage:
 *   node scripts/start-autonomy.js --slug <project-slug> --path <repo> [options]
 *   npm run autonomy:dry-run      # one cycle, propose only (no spend, no mutations)
 *   npm run autonomy:once         # one live cycle (capped)
 *   npm run autonomy:start        # loop on the policy interval
 *
 * Options:
 *   --slug <s>        project slug (brain namespace). Default: ceo-studio
 *   --path <dir>      project repo path. Default: cwd
 *   --dry-run         propose only; never spawn Devin or mutate the board
 *   --once            run a single cycle and exit
 *   --loop            run forever on the policy interval
 *   --max <n>         maxDispatchPerCycle (0 = unlimited)
 *   --concurrent <n>  maxConcurrentWorkers (0 = unlimited)
 *   --model <m>       Devin model (default swe-1.6)
 *   --interval <m>    minutes between cycles in --loop mode
 */
const path = require("path");
const runner = require("../main/core/autonomy-runner");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const has = (name) => process.argv.includes(`--${name}`);

const slug = String(arg("slug", "ceo-studio"));
const projectPath = path.resolve(String(arg("path", process.cwd())));
const dryRun = has("dry-run");
const loop = has("loop");

const policy = {
  enabled: true,
  dryRun,
  model: String(arg("model", "swe-1.6")),
};
if (arg("max") !== undefined) policy.maxDispatchPerCycle = Number(arg("max"));
if (arg("concurrent") !== undefined) policy.maxConcurrentWorkers = Number(arg("concurrent"));
if (arg("interval") !== undefined) policy.intervalMinutes = Number(arg("interval"));

function cycle() {
  const r = runner.runCycle({ projectSlug: slug, projectPath, force: true, policy });
  const phases = r.phases || {};
  const sum = (a) => (Array.isArray(a) ? a.length : 0);
  console.log(JSON.stringify({
    ok: r.ok,
    skipped: r.skipped || false,
    reason: r.reason,
    boards: r.boards,
    plan: sum(phases.plan),
    assign: sum(phases.assign),
    spawned: r.spawned,
    reviewed: sum(phases.review),
    liveWorkers: r.liveWorkers,
    errors: (r.errors || []).length,
    runFile: r.runFile,
  }, null, 2));
  return r;
}

console.log(`[autonomy] slug=${slug} path=${projectPath} dryRun=${dryRun} loop=${loop} model=${policy.model}`);
cycle();

if (loop) {
  const ms = Math.max(1, runner.getPolicy(slug).intervalMinutes) * 60 * 1000;
  console.log(`[autonomy] looping every ${ms / 60000} minutes (Ctrl-C to stop)`);
  setInterval(cycle, ms);
}
