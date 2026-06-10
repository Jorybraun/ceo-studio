#!/usr/bin/env node
"use strict";
/**
 * Smoke-test the running Electron app through Chrome DevTools Protocol.
 *
 * This is the same debug transport used by Chrome/Electron MCP servers: start
 * CEO Studio with `npm run start:debug`, then run this script.
 */
const CDP = require("chrome-remote-interface");

const PORT = Number(process.env.CEO_STUDIO_REMOTE_DEBUG_PORT || process.env.ELECTRON_REMOTE_DEBUG_PORT || 9222);
const EXPECTED_PROJECT_SUFFIX = process.env.CEO_STUDIO_SMOKE_PROJECT_SUFFIX || "CEO_STUDIO";

function pass(name, detail) {
  return { name, ok: true, detail };
}

function fail(name, detail) {
  return { name, ok: false, detail };
}

function hasColumn(board, column) {
  return !!(board && board.ok && board.columns && Object.prototype.hasOwnProperty.call(board.columns, column));
}

async function main() {
  const targets = await CDP.List({ port: PORT });
  const target = targets.find((t) => /CEO Studio/i.test(t.title || "")) || targets.find((t) => t.type === "page") || targets[0];
  if (!target) throw new Error(`No debuggable Electron target found on port ${PORT}`);

  const client = await CDP({ port: PORT, target });
  const { Runtime } = client;
  const checks = [];

  async function ev(expression) {
    const result = await Runtime.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(description || result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result.value;
  }

  try {
    await Runtime.enable();

    const title = await ev("document.title");
    checks.push(title === "CEO Studio" ? pass("renderer title", title) : fail("renderer title", title));

    const hasCeo = await ev("!!window.ceo");
    checks.push(hasCeo ? pass("preload bridge", "window.ceo is available") : fail("preload bridge", "window.ceo is missing"));

    const ceoLabel = await ev("(document.querySelector('#ceo-label') || {}).textContent || ''");
    const ceoStatus = await ev("window.ceo.ceoStatus()");
    checks.push(ceoStatus && ceoStatus.up ? pass("Hermes CEO online", { label: ceoLabel, pid: ceoStatus.pid }) : fail("Hermes CEO online", ceoStatus));

    const projects = await ev("window.ceo.listProjects()");
    const project = (projects || []).find((p) => String(p.path || "").endsWith(EXPECTED_PROJECT_SUFFIX)) || (projects || [])[0];
    checks.push(project ? pass("project discovered", { id: project.id, name: project.name, path: project.path }) : fail("project discovered", projects));

    let opened = null;
    if (project) {
      opened = await ev(`window.ceo.openProject(${JSON.stringify(project.id)})`);
      checks.push(opened && opened.project ? pass("project opened", { id: opened.project.id, providerId: opened.providerId }) : fail("project opened", opened));
    }

    const context = await ev("window.ceo.getCurrentContext ? window.ceo.getCurrentContext() : null");
    if (context && context.project) checks.push(pass("current project context", context.project));

    const org = await ev("window.ceo.orchestrationSummary({ domain: 'Engineering' })");
    const bugLane = org && org.lanes && org.lanes.find((lane) => lane.lane === "bug");
    checks.push(org && org.ok ? pass("orchestration summary", { lanes: (org.lanes || []).map((lane) => lane.lane), issues: org.issues || [] }) : fail("orchestration summary", org));
    checks.push(bugLane && bugLane.team === "self-repair" ? pass("bug lane routes to self-repair", bugLane) : fail("bug lane routes to self-repair", bugLane || org));

    const autonomy = await ev("window.ceo.autonomyStatus()");
    checks.push(autonomy && autonomy.ok ? pass("autonomy status", { running: autonomy.running, enabled: autonomy.policy && autonomy.policy.enabled }) : fail("autonomy status", autonomy));

    const board = await ev("window.ceo.ceoBoard ? window.ceo.ceoBoard('ceo-studio') : null");
    checks.push(board && board.ok ? pass("ceo-studio board readable", { columns: Object.keys(board.columns || {}) }) : fail("ceo-studio board readable", board));
    checks.push(hasColumn(board, "bug") ? pass("board exposes bug column", "bug") : fail("board exposes bug column", board && board.columns ? Object.keys(board.columns) : board));

    const thinBrief = await ev("window.ceo.createBrief({ title: 'Smoke brief', domain: 'Engineering' })");
    checks.push(thinBrief && thinBrief.ok === false && Array.isArray(thinBrief.missing) && thinBrief.missing.includes("goal")
      ? pass("brief intake enforces required fields", thinBrief.missing)
      : fail("brief intake enforces required fields", thinBrief));

    const thinBug = await ev("window.ceo.createBug({ title: 'Smoke bug', domain: 'Engineering' })");
    checks.push(thinBug && thinBug.ok === false && Array.isArray(thinBug.missing) && thinBug.template && /Lane: bug/.test(thinBug.template)
      ? pass("bug intake enforces bug template/lane", thinBug.missing)
      : fail("bug intake enforces bug template/lane", thinBug));

    const convai = await ev("window.ceo.convaiStatus()");
    checks.push(convai && convai.available !== undefined ? pass("voice agent status reachable", {
      available: convai.available,
      mode: convai.mode || null,
      maxMinutes: convai.maxMinutes,
      maxTokens: convai.maxTokens || null,
    }) : fail("voice agent status reachable", convai));

    const failed = checks.filter((check) => !check.ok);
    for (const check of checks) {
      const suffix = check.detail == null ? "" : ` ${JSON.stringify(check.detail)}`;
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${suffix}`);
    }
    console.log(`\n${checks.length - failed.length}/${checks.length} Electron CDP smoke checks passed.`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`Electron CDP smoke failed: ${err.message}`);
  console.error(`Start the app with: CEO_STUDIO_REMOTE_DEBUG_PORT=${PORT} npm run start:debug`);
  process.exit(1);
});
