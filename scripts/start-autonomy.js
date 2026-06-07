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
 *   --report          print the oversight inventory (no cycle, no spend) and exit
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

// Oversight report — read-only inventory of every task's true disposition
// (delivered / open-pr / in-review / needs-human / stranded / DIVERGED / live).
// No cycle is run and nothing is spawned: this is the "what is the swarm doing
// and what got abandoned?" surface.
function printReport() {
  const rep = runner.report({ projectSlug: slug, projectPath });
  if (!rep.ok) { console.log(JSON.stringify(rep, null, 2)); return rep; }
  const s = rep.summary || { byDisposition: {} };
  console.log(`\n[autonomy report] slug=${slug} running=${rep.running} mode=${rep.integrationMode} tasks=${s.tasks}`);
  const order = ["live", "diverged", "open-pr", "delivered", "in-review", "needs-human", "stranded", "blocked"];
  console.log("disposition: " + order.map((d) => `${d}=${s.byDisposition[d] || 0}`).join("  "));
  if ((rep.workers || []).length) {
    console.log(`live workers (${rep.workers.length}): ` + rep.workers.map((w) => `${w.board}/${w.taskId}${w.alive ? "" : "(dead)"}`).join(", "));
  }
  for (const b of rep.boards || []) {
    if (!b.ok) { console.log(`\n== ${b.board} == (read failed: ${b.reason})`); continue; }
    console.log(`\n== ${b.board} == (${b.tasks.length} tasks)`);
    // Lead with the rows a human must act on; deliver/archived noise goes last.
    const rank = (t) => order.indexOf(t.disposition) === -1 ? order.length : order.indexOf(t.disposition);
    for (const t of [...b.tasks].sort((x, y) => rank(x) - rank(y))) {
      const flags = [t.diverged ? "DIVERGED" : "", t.escalated ? "escalated" : "", t.humanRequired ? "human-required" : "", t.repairGeneration ? `repairGen=${t.repairGeneration}` : ""].filter(Boolean).join(" ");
      console.log(`  ${t.disposition.padEnd(12)} ${t.id.padEnd(12)} ahead=${String(t.ahead).padEnd(3)} ${flags ? `[${flags}] ` : ""}${t.title.slice(0, 52)}`);
    }
  }
  return rep;
}

console.log(`[autonomy] slug=${slug} path=${projectPath} dryRun=${dryRun} loop=${loop} model=${policy.model}`);
if (has("report")) {
  printReport();
} else {
  cycle();
  if (loop) {
    const ms = Math.max(1, runner.getPolicy(slug).intervalMinutes) * 60 * 1000;
    console.log(`[autonomy] looping every ${ms / 60000} minutes (Ctrl-C to stop)`);
    setInterval(cycle, ms);
  }
}
