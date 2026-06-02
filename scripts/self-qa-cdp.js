#!/usr/bin/env node
"use strict";
/**
 * CEO Studio self-QA runner.
 *
 * Start the app with `npm run start:debug`, then run:
 *   npm run qa:self
 *
 * The runner attaches through Chrome DevTools Protocol, exercises the app's
 * real preload/IPC surface, writes a report, and files confirmed failures to
 * the Hermes `ceo-studio` bug lane through `window.ceo.createBug`.
 */
const fs = require("fs");
const path = require("path");
const CDP = require("chrome-remote-interface");
const projects = require("../main/core/projects");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.CEO_STUDIO_REMOTE_DEBUG_PORT || process.env.ELECTRON_REMOTE_DEBUG_PORT || 9222);
const OUTPUT_DIR = path.resolve(process.env.CEO_STUDIO_QA_OUTPUT || path.join(ROOT, "dogfood-output", "self-qa"));
const SELF_PROJECT_SUFFIX = process.env.CEO_STUDIO_QA_PROJECT_SUFFIX || "CEO_STUDIO";
const BOARD = process.env.CEO_STUDIO_QA_BOARD || "ceo-studio";
const CONTINUOUS = process.argv.includes("--continuous");
const MAX_PASSES = Number(process.env.CEO_STUDIO_QA_MAX_PASSES || (CONTINUOUS ? 10 : 1));
const LOG_KANBAN = !process.argv.includes("--no-kanban");
const BOOTSTRAP_SELF_PROJECT = !process.argv.includes("--no-bootstrap-self");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function signature(finding) {
  return `${finding.scenario}:${finding.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function severityRank(s) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[String(s || "").toLowerCase()] ?? 3;
}

function finding({ scenario, title, severity = "medium", category = "Functional", expected, actual, steps, evidence }) {
  return {
    scenario,
    title,
    severity,
    category,
    expected,
    actual,
    steps: Array.isArray(steps) ? steps : [steps].filter(Boolean),
    evidence: Array.isArray(evidence) ? evidence : [evidence].filter(Boolean),
  };
}

async function connect() {
  const targets = await CDP.List({ port: PORT });
  const target = targets.find((t) => /CEO Studio/i.test(t.title || "")) || targets.find((t) => t.type === "page") || targets[0];
  if (!target) throw new Error(`No debuggable CEO Studio target found on port ${PORT}`);
  const client = await CDP({ port: PORT, target });
  await Promise.all([client.Runtime.enable(), client.Page.enable(), client.Log.enable().catch(() => {})]);
  return client;
}

function makeEvaluator(Runtime) {
  return async function ev(expression) {
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
  };
}

async function screenshot(Page, name) {
  const file = path.join(OUTPUT_DIR, "screenshots", `${name}.png`);
  const shot = await Page.captureScreenshot({ format: "png" });
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function existingBugTitles(ev) {
  const board = await ev(`window.ceo.ceoBoard(${JSON.stringify(BOARD)})`);
  const titles = new Set();
  for (const tasks of Object.values((board && board.columns) || {})) {
    for (const task of tasks || []) titles.add(String(task.title || ""));
  }
  return titles;
}

function alreadyLogged(titles, f) {
  const marker = `[Self-QA] ${f.title}`;
  return [...titles].some((title) => title.includes(marker));
}

async function openSelfProject(ev, findings) {
  const projects = await ev("window.ceo.listProjects()");
  const self = (projects || []).find((p) => String(p.path || "").endsWith(SELF_PROJECT_SUFFIX));
  if (!self) {
    findings.push(finding({
      scenario: "project-open",
      title: "CEO Studio project is not mounted for self-QA",
      severity: "medium",
      category: "Functional",
      expected: `A project ending in ${SELF_PROJECT_SUFFIX} is available so the app can QA its own repo and write durable goals/provenance.`,
      actual: `Registered projects: ${(projects || []).map((p) => p.path).join(", ") || "none"}`,
      steps: ["Start CEO Studio in debug mode.", "Run npm run qa:self.", "Inspect project discovery."],
      evidence: ["window.ceo.listProjects() did not include the CEO Studio repo."],
    }));
    return null;
  }
  const opened = await ev(`window.ceo.openProject(${JSON.stringify(self.id)})`);
  if (!opened || !opened.project) {
    findings.push(finding({
      scenario: "project-open",
      title: "CEO Studio self project failed to open",
      severity: "high",
      category: "Functional",
      expected: "The self project opens and initializes context.",
      actual: JSON.stringify(opened),
      steps: ["Run npm run qa:self.", `Open project id ${self.id}.`],
      evidence: [JSON.stringify(opened)],
    }));
    return null;
  }
  return opened.project;
}

async function ensureSelfGoal(ev, project) {
  if (!project) return null;
  return ev(`window.ceo.upsertGoal(${JSON.stringify({
    id: "goal_roadmap_ceo_studio_self_qa_functional_state",
    layer: "roadmap",
    title: "Make CEO Studio self-QA to a functional state",
    outcome: "CEO Studio continuously dogfoods itself through Chrome MCP/CDP, files confirmed defects to Kanban, and uses Hermes/self-repair to drive the app toward a fully functional state.",
    domain: "Engineering",
    status: "active",
    successCriteria: [
      "Self-QA runner executes through Electron CDP without manual UI steps.",
      "Confirmed failures are filed to the ceo-studio bug lane with reproduction evidence.",
      "A pass with no new unlogged findings is recorded before claiming the app is stable.",
      "Self-repair and docs-steward contracts are invoked for system defects.",
    ],
  })})`);
}

async function runScenarios({ ev, Page, passNo }) {
  const findings = [];
  const screenshots = [];
  screenshots.push(await screenshot(Page, `pass-${passNo}-start`));

  const title = await ev("document.title");
  if (title !== "CEO Studio") {
    findings.push(finding({
      scenario: "renderer-boot",
      title: "Renderer title is not CEO Studio",
      severity: "high",
      category: "Functional",
      expected: "Electron renderer title is CEO Studio.",
      actual: title,
      steps: ["Start debug app.", "Run npm run qa:self."],
      evidence: [`document.title=${title}`],
    }));
  }

  const hasBridge = await ev("!!window.ceo");
  if (!hasBridge) {
    findings.push(finding({
      scenario: "preload",
      title: "Preload bridge window.ceo is unavailable",
      severity: "critical",
      category: "Functional",
      expected: "window.ceo exists so renderer can use IPC.",
      actual: "window.ceo is falsy",
      steps: ["Start debug app.", "Evaluate !!window.ceo."],
      evidence: ["CDP Runtime.evaluate returned false."],
    }));
    return { findings, screenshots };
  }

  const ceoStatus = await ev("window.ceo.ceoStatus()");
  if (!ceoStatus || !ceoStatus.up) {
    findings.push(finding({
      scenario: "hermes-ceo",
      title: "Hermes CEO is offline",
      severity: "critical",
      category: "Functional",
      expected: "Hermes CEO gateway is online at startup.",
      actual: JSON.stringify(ceoStatus),
      steps: ["Start CEO Studio.", "Run window.ceo.ceoStatus()."],
      evidence: [JSON.stringify(ceoStatus)],
    }));
  }

  const project = await openSelfProject(ev, findings);
  const goal = await ensureSelfGoal(ev, project);
  if (project && (!goal || !goal.ok)) {
    findings.push(finding({
      scenario: "self-goal",
      title: "Self-QA roadmap goal could not be saved",
      severity: "medium",
      category: "Functional",
      expected: "window.ceo.upsertGoal creates or updates the self-QA roadmap goal.",
      actual: JSON.stringify(goal),
      steps: ["Open CEO Studio self project.", "Call window.ceo.upsertGoal with fixed self-QA goal id."],
      evidence: [JSON.stringify(goal)],
    }));
  }

  const org = await ev("window.ceo.orchestrationSummary({ domain: 'Engineering' })");
  const bugLane = org && org.lanes && org.lanes.find((lane) => lane.lane === "bug");
  if (!org || !org.ok || !bugLane || bugLane.team !== "self-repair") {
    findings.push(finding({
      scenario: "orchestration",
      title: "Bug lane is not routed to self-repair",
      severity: "high",
      category: "Functional",
      expected: "Engineering bug lane exists and routes to self-repair.",
      actual: JSON.stringify({ ok: org && org.ok, bugLane }),
      steps: ["Open project.", "Call window.ceo.orchestrationSummary({domain:'Engineering'})."],
      evidence: [JSON.stringify(org)],
    }));
  }

  const board = await ev(`window.ceo.ceoBoard(${JSON.stringify(BOARD)})`);
  const columns = Object.keys((board && board.columns) || {});
  const required = ["triage", "bug", "planning", "todo", "ready", "running", "blocked", "scheduled", "review", "done"];
  const missing = required.filter((lane) => !columns.includes(lane));
  if (!board || !board.ok || missing.length) {
    findings.push(finding({
      scenario: "board",
      title: "CEO Studio board does not expose canonical lanes",
      severity: "high",
      category: "Functional",
      expected: `Board ${BOARD} exposes ${required.join(", ")}.`,
      actual: JSON.stringify({ ok: board && board.ok, columns, missing }),
      steps: [`Call window.ceo.ceoBoard('${BOARD}').`, "Inspect returned columns."],
      evidence: [JSON.stringify(board)],
    }));
  }

  const thinBug = await ev("window.ceo.createBug({ title: 'Self-QA validation probe', domain: 'Engineering', board: 'ceo-studio' })");
  if (!thinBug || thinBug.ok !== false || !(thinBug.missing || []).includes("observedBehavior")) {
    findings.push(finding({
      scenario: "bug-intake",
      title: "Bug intake accepts thin bug reports",
      severity: "high",
      category: "Functional",
      expected: "createBug rejects thin bug reports and returns missing required fields.",
      actual: JSON.stringify(thinBug),
      steps: ["Call window.ceo.createBug with only title/domain/board."],
      evidence: [JSON.stringify(thinBug)],
    }));
  }

  const convai = await ev("window.ceo.convaiStatus()");
  if (!convai || convai.mode !== "intake" || Number(convai.maxMinutes) > 2 || Number(convai.maxTokens) > 220) {
    findings.push(finding({
      scenario: "voice-cost",
      title: "Voice agent is not in cheap intake mode",
      severity: "medium",
      category: "Functional",
      expected: "convaiStatus reports mode=intake, maxMinutes<=2, maxTokens<=220.",
      actual: JSON.stringify(convai),
      steps: ["Call window.ceo.convaiStatus()."],
      evidence: [JSON.stringify(convai)],
    }));
  }

  const models = await ev("window.ceo.registryModels()");
  const devinModels = ((models && models.providers && models.providers.devin) || []).map((m) => m.id);
  for (const id of ["gemini-3-flash", "swe-1.6-fast", "claude-sonnet-4.6"]) {
    if (!devinModels.includes(id)) {
      findings.push(finding({
        scenario: "model-catalog",
        title: `Devin model missing from registry: ${id}`,
        severity: "medium",
        category: "Functional",
        expected: `Devin model catalog includes ${id}.`,
        actual: devinModels.join(", "),
        steps: ["Call window.ceo.registryModels().", "Inspect providers.devin."],
        evidence: [JSON.stringify(models)],
      }));
    }
  }

  screenshots.push(await screenshot(Page, `pass-${passNo}-end`));
  return { findings, screenshots, goal };
}

async function fileBugs(ev, findings, titles, reportPath) {
  const results = [];
  for (const f of findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) {
    if (alreadyLogged(titles, f)) {
      results.push({ title: f.title, skipped: true, reason: "already logged" });
      continue;
    }
    const payload = {
      board: BOARD,
      title: `[Self-QA] ${f.title}`,
      domain: "Engineering",
      observedBehavior: f.actual || f.title,
      expectedBehavior: f.expected || "CEO Studio should satisfy this self-QA scenario.",
      reproductionSteps: f.steps && f.steps.length ? f.steps : ["Start CEO Studio with npm run start:debug.", "Run npm run qa:self.", `Inspect scenario: ${f.scenario}.`],
      severity: String(f.severity || "medium").toLowerCase(),
      impact: "CEO Studio cannot safely claim autonomous functional readiness while this self-QA finding is open.",
      evidence: [...(f.evidence || []), `Self-QA report: ${reportPath}`],
      acceptanceCriteria: [
        "The finding is reproduced or invalidated with concrete evidence.",
        "The smallest safe repair is implemented without mocks or bypasses.",
        "The fix is verified with npm run qa:self, npm run smoke:electron, npm run check, and npm test when applicable.",
        "Relevant docs or skill instructions are updated, or docs-steward signs off no docs update is needed.",
      ],
      requestedBy: "self-qa-cdp",
      source: "CEO Studio self-QA CDP runner",
    };
    const result = await ev(`window.ceo.createBug(${JSON.stringify(payload)})`);
    results.push({ title: f.title, result });
    if (result && result.ok && result.task && result.task.taskId) {
      titles.add(`[Bug] ${payload.title}`);
    }
  }
  return results;
}

function writeReport({ passes, bugResults, reportPath }) {
  const allFindings = passes.flatMap((p) => p.findings.map((f) => ({ ...f, pass: p.pass })));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of allFindings) counts[String(f.severity || "low").toLowerCase()] = (counts[String(f.severity || "low").toLowerCase()] || 0) + 1;
  const lines = [
    "# CEO Studio Self-QA Report",
    "",
    `Date: ${new Date().toISOString()}`,
    `Board: ${BOARD}`,
    `Passes: ${passes.length}`,
    `Total findings: ${allFindings.length}`,
    "",
    "## Severity",
    "",
    `- Critical: ${counts.critical || 0}`,
    `- High: ${counts.high || 0}`,
    `- Medium: ${counts.medium || 0}`,
    `- Low: ${counts.low || 0}`,
    "",
    "## Findings",
    "",
  ];
  if (!allFindings.length) {
    lines.push("No findings in the executed scenario set.", "");
  } else {
    allFindings
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .forEach((f, idx) => {
        lines.push(`### QA-${String(idx + 1).padStart(3, "0")}: ${f.title}`);
        lines.push("");
        lines.push(`- Pass: ${f.pass}`);
        lines.push(`- Scenario: ${f.scenario}`);
        lines.push(`- Severity: ${f.severity}`);
        lines.push(`- Category: ${f.category}`);
        lines.push("");
        lines.push("Expected:");
        lines.push("");
        lines.push(f.expected || "");
        lines.push("");
        lines.push("Actual:");
        lines.push("");
        lines.push(f.actual || "");
        lines.push("");
        lines.push("Steps:");
        for (const step of f.steps || []) lines.push(`- ${step}`);
        lines.push("");
        lines.push("Evidence:");
        for (const item of f.evidence || []) lines.push(`- ${item}`);
        lines.push("");
      });
  }
  lines.push("## Bug Logging");
  lines.push("");
  for (const r of bugResults || []) {
    lines.push(`- ${r.title}: ${r.skipped ? `skipped (${r.reason})` : JSON.stringify(r.result)}`);
  }
  lines.push("");
  lines.push("## Screenshots");
  lines.push("");
  for (const pass of passes) {
    for (const file of pass.screenshots || []) lines.push(`- MEDIA:${file}`);
  }
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  mkdirp(path.join(OUTPUT_DIR, "screenshots"));
  const reportPath = path.join(OUTPUT_DIR, `report-${RUN_ID}.md`);
  const latestReportPath = path.join(OUTPUT_DIR, "report.md");
  if (BOOTSTRAP_SELF_PROJECT) {
    projects.addProject(ROOT);
  }
  const client = await connect();
  const ev = makeEvaluator(client.Runtime);
  const allPasses = [];
  let allBugResults = [];
  try {
    const titles = await existingBugTitles(ev).catch(() => new Set());
    const seenNew = new Set();
    for (let passNo = 1; passNo <= Math.max(1, MAX_PASSES); passNo++) {
      const pass = await runScenarios({ ev, Page: client.Page, passNo });
      allPasses.push({ pass: passNo, findings: pass.findings, screenshots: pass.screenshots });
      const newFindings = pass.findings.filter((f) => !alreadyLogged(titles, f) && !seenNew.has(signature(f)));
      for (const f of newFindings) seenNew.add(signature(f));
      if (LOG_KANBAN) {
        const bugResults = await fileBugs(ev, newFindings, titles, reportPath);
        allBugResults = allBugResults.concat(bugResults);
      }
      if (!CONTINUOUS || newFindings.length === 0) break;
    }
    writeReport({ passes: allPasses, bugResults: allBugResults, reportPath });
    fs.copyFileSync(reportPath, latestReportPath);
    const total = allPasses.reduce((n, p) => n + p.findings.length, 0);
    const newCount = allBugResults.filter((r) => !r.skipped && r.result && r.result.ok).length;
    console.log(JSON.stringify({
      ok: total === 0,
      reportPath,
      latestReportPath,
      passes: allPasses.length,
      findings: total,
      bugsFiled: newCount,
      kanban: LOG_KANBAN,
    }, null, 2));
    process.exitCode = total ? 1 : 0;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`Self-QA failed: ${err.stack || err.message}`);
  console.error(`Start the app with: CEO_STUDIO_REMOTE_DEBUG_PORT=${PORT} npm run start:debug`);
  process.exit(1);
});
