"use strict";
/**
 * Unit tests for the autonomy runner's DECISION LOGIC.
 *
 * These use injected fakes (deps + policy) so we can assert the loop's
 * branching deterministically WITHOUT spending Devin credits, touching a real
 * board, or starting the gateway. The production path uses the real Devin CLI
 * and the real `npm run check` / `npm test` (see defaultSpawnWorker / defaultVerify);
 * these tests do NOT mock the feature to fake a pass — they verify that, given a
 * board state, the runner makes the correct real calls (assign, spawn, gate).
 */
const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CEO_STUDIO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-runner-"));
const runner = require("../main/core/autonomy-runner");
const boardOverlay = require("../main/core/board-overlay");
const notifications = require("../main/core/notifications");
const unblocker = require("../main/core/unblocker");

let passed = 0;
const ok = (n, c) => { if (!c) { console.error("FAIL", n); process.exitCode = 1; } else { console.log("PASS", n); passed++; } };

const SLUG = "test-proj";
const PROJECT_PATH = "/tmp/fake-repo";

// A reusable fake-deps factory. `calls` records side effects for assertions.
function makeDeps(overrides = {}) {
  const calls = {
    assign: [],
    setStatus: [],
    comment: [],
    spawn: [],
    taskAction: [],
    decompose: [],
    selfRepair: [],
    verify: 0,
    work: [],
    unblock: [],
    goals: 0,
    standupReconcile: [],
    standupDue: [],
    terminate: [],
  };
  const board = overrides.board || { ok: true, columns: {} };
  const deps = {
    hermes: {
      ensureUp: () => ({ ok: true, up: true }),
      listBoards: () => (overrides.boards || [{ slug: "ceo-studio" }]),
      getBoard: () => board,
      getTask: overrides.getTask || ((_b, id) => ({ ok: true, task: { id, title: "T " + id, body: "do the thing" } })),
      taskAction: (a) => { calls.taskAction.push(a); if (a.action === "decompose") calls.decompose.push(a); return { ok: true }; },
      assignTask: (a) => { calls.assign.push(a); return { ok: true }; },
      setTaskStatus: (a) => { calls.setStatus.push(a); return { ok: true }; },
      addComment: (a) => { calls.comment.push(a); return { ok: true }; },
    },
    org: { route: () => ({ ok: true, assignee: "builder", team: "execution-builders" }) },
    registry: { read: () => ({ ok: true, agents: [{ id: "builder", provider: "devin", model: "swe-1.6", persona: "builder" }] }) },
    autonomyLoop: { runCycle: () => { calls.goals++; return { ok: true }; } },
    standups: {
      reconcile: (a) => {
        calls.standupReconcile.push(a);
        return overrides.standupReconcileResult || { ok: true, checked: 0, completed: [] };
      },
      runDue: (a) => {
        calls.standupDue.push(a);
        return overrides.standupDueResult || { ok: true, due: 0, started: [] };
      },
    },
    unblocker: { run: (a) => { calls.unblock.push(a); return overrides.unblockResult || { ok: true, planned: 0, results: [] }; } },
    selfRepair: { reportSystemBug: (a) => { calls.selfRepair.push(a); return { ok: true }; } },
    isAlive: () => !!overrides.workerAlive,
    terminateWorker: (pid) => { calls.terminate.push(pid); return { ok: true }; },
    spawnWorker: (a) => { calls.spawn.push(a); return { ok: true, pid: 4242 }; },
    readLogTail: () => "worker finished cleanly",
    prepareReviewBranch: () => ({ ok: true, rebased: false, baselineRef: null }),
    verify: () => { calls.verify++; return overrides.verifyResult || { ok: true, results: [{ cmd: "npm test", ok: true, tail: "" }] }; },
    postWork: (a) => { calls.work.push(a); return { ok: true }; },
  };
  return { deps, calls };
}

function basePolicy(extra = {}) {
  return { enabled: true, boards: ["ceo-studio"], dryRun: false, allowDecompose: true, allowAssign: true, execute: true, allowReviewGate: true, maxDispatchPerCycle: 5, maxConcurrentWorkers: 0, ...extra };
}

ok("runner request accepts the documented policy envelope",
  runner.policyFromRequest({ policy: { boards: ["pipe-os"], targetTaskIds: ["t1"] } }).targetTaskIds[0] === "t1");
ok("runner request also accepts a flat policy object without widening scope",
  runner.policyFromRequest({ boards: ["pipe-os"], targetTaskIds: ["t1"] }).boards[0] === "pipe-os");
{
  const ready = { ok: true, columns: { ready: [{ id: "owned-task", title: "Owned", assignee: "builder" }] } };
  const { deps, calls } = makeDeps({
    board: ready,
    boards: [
      { slug: "test-proj", default_workdir: PROJECT_PATH },
      { slug: "ceo-studio", default_workdir: "/tmp/ceo-studio" },
    ],
  });
  const result = runner.runCycle({
    projectSlug: SLUG + "-owned-boards",
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({
      boards: "all",
      allowStandups: false,
      allowGoalReview: false,
      allowUnblocker: false,
      allowTriage: false,
      allowDecompose: false,
      allowAssign: false,
      allowReviewGate: false,
      maxDispatchPerCycle: 1,
    }),
  });
  const ownedBoardOnly = result.boards.length === 1
    && result.boards[0] === "test-proj"
    && calls.spawn.length === 1
    && calls.spawn[0].board === "test-proj";
  ok("all-board mode dispatches only boards owned by the active project", ownedBoardOnly);
}
ok("browser E2E completion rejects unexecuted test structure",
  runner._defaults.assessWorkerCompletion({
    title: "End-to-end QA",
    body: "Run Playwright with two contexts",
  }, "Created E2E test structure. Full browser automation would require setup and was not run.").ok === false);
ok("browser E2E completion accepts executed Playwright evidence",
  runner._defaults.assessWorkerCompletion({
    title: "End-to-end QA",
    body: "Run Playwright with two contexts",
  }, "npx playwright test e2e/contact.spec.ts\n2 passed (8.2s)\nTwo browser contexts joined and completed the flow.").ok === true);
ok("browser E2E completion rejects API-only Playwright substitution",
  runner._defaults.assessWorkerCompletion({
    title: "End-to-end QA",
    body: "Run Playwright with separate recruiter and recipient browser contexts",
  }, "npx playwright test e2e/contact.spec.ts\n7 passed\nUpdated tests to use API-level validation instead of UI automation.").ok === false);
ok("two-context browser contract requires context execution evidence",
  runner._defaults.assessWorkerCompletion({
    title: "End-to-end QA",
    body: "Run Playwright with two contexts",
  }, "npx playwright test e2e/contact.spec.ts\n7 passed").ok === false);
(() => {
  const children = new Map([
    [100, [200, 300]],
    [200, [400]],
    [300, []],
    [400, []],
  ]);
  const signals = [];
  const terminated = runner._defaults.terminateProcessTree(100, {
    listChildren: (pid) => children.get(pid) || [],
    kill: (pid, signal) => { signals.push([pid, signal]); },
  });
  ok("worker termination enumerates nested descendants",
    JSON.stringify(terminated.descendants) === JSON.stringify([400, 300, 200]));
  ok("worker termination signals child groups before the parent group",
    JSON.stringify(signals.map(([pid]) => pid)) === JSON.stringify([-400, -300, -200, -100]));
})();

// 0. recurring standup cadence is owned by the runner and stays policy-gated
(() => {
  const { deps, calls } = makeDeps();
  const r = runner.runCycle({
    projectSlug: SLUG + "-standups",
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({ execute: false, allowReviewGate: false, maxStandupsPerCycle: 1 }),
  });
  ok("runner reconciles completed standup rooms", calls.standupReconcile.length === 1);
  ok("runner starts due standups through the cadence phase", calls.standupDue.length === 1 && calls.standupDue[0].limit === 1);
  ok("standup cadence is recorded in the run result", r.phases.standups && r.phases.standups.due.ok === true);
})();

(() => {
  const { deps, calls } = makeDeps();
  runner.runCycle({
    projectSlug: SLUG + "-standups-dry",
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({ dryRun: true, execute: false, allowReviewGate: false }),
  });
  ok("runner dry-run keeps standup execution dry", calls.standupDue.length === 1 && calls.standupDue[0].dryRun === true && calls.standupReconcile[0].dryRun === true);
})();

(() => {
  const { deps, calls } = makeDeps();
  const r = runner.runCycle({
    projectSlug: SLUG + "-standups-targeted",
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({ targetTaskIds: ["focus-task"], execute: false, allowReviewGate: false }),
  });
  ok("targeted task cycles skip unrelated standup cadence", calls.standupDue.length === 0 && r.phases.standups.skipped === "targeted-task-cycle");
})();

// 1. ready + devin assignee -> spawns a real worker + marks running
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { ready: [{ id: "t1", title: "Ready task", assignee: "builder" }] } } });
  const r = runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy() });
  ok("ready devin task spawns a worker", calls.spawn.length === 1 && calls.spawn[0].model === "swe-1.6");
  ok("spawned task is set to running", calls.setStatus.some((s) => s.taskId === "t1" && s.status === "running"));
  ok("run record reports a spawn", r.spawned === 1);
  ok("spawn posts a 'started' work-event to the team log", calls.work.some((w) => w.board === "ceo-studio" && w.speaker === "builder" && /started/.test(w.body)));
})();

// 1b. dispatch prompt carries recent Kanban comments/evidence
(() => {
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { ready: [{ id: "evidence-task", title: "Fix gate", assignee: "builder" }] } },
    getTask: (_b, id) => ({
      ok: true,
      task: { id, title: "Fix gate", body: "repair the failing gate" },
      comments: [{ author: "review-gate", body: "npm run check failed because the check script is missing" }],
    }),
  });
  runner.runCycle({ projectSlug: SLUG + "-prompt-comments", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ maxDispatchPerCycle: 1 }) });
  ok("worker prompt includes recent task comments", /Recent Kanban comments/.test(calls.spawn[0].prompt) && /check script is missing/.test(calls.spawn[0].prompt));
})();

// 2. unassigned actionable task -> assigned to orchestration-routed registry agent
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { todo: [{ id: "t2", title: "Unowned", assignee: null }] } } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("unassigned task is routed + assigned", calls.assign.length === 1 && calls.assign[0].assignee === "builder");
})();

// 2b. blocked lane invokes the unblocker phase before work sits idle
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { blocked: [{ id: "tb", title: "Blocked", status: "blocked" }] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-unblock-phase", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("runner invokes unblocker phase", calls.unblock.length === 1 && calls.unblock[0].board === "ceo-studio");
  ok("run record includes unblock phase", Array.isArray(r.phases.unblock) && r.phases.unblock.length === 1);
})();

// 2c. triage intake is researched/specified by Hermes, then promoted for planning
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { triage: [{ id: "tr1", title: "Raw intake", status: "triage" }] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-research", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false, allowReviewGate: false }) });
  ok("triage intake asks Hermes to specify", calls.taskAction.some((a) => a.taskId === "tr1" && a.action === "specify"));
  ok("specified intake is promoted toward planning", calls.taskAction.some((a) => a.taskId === "tr1" && a.action === "promote"));
  ok("run record includes research phase", r.phases.research.some((a) => a.taskId === "tr1" && /specify/i.test(a.would || "")));
})();

// 2c.1. triage research is capped per cycle
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { triage: [
    { id: "tr-cap-1", title: "Raw 1", status: "triage" },
    { id: "tr-cap-2", title: "Raw 2", status: "triage" },
  ] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-research-cap", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false, allowReviewGate: false, maxTriagePerCycle: 1 }) });
  ok("triage research cap limits specify calls", calls.taskAction.filter((a) => a.action === "specify").length === 1);
  ok("triage research cap limits phase records", r.phases.research.length === 1);
})();

// 2d. stale running tasks with no live/tracked worker are made visible
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { running: [{ id: "stale1", title: "Dead worker", status: "running", workerAlive: false }] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-stale-running", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false, allowReviewGate: false, allowTriage: false }) });
  ok("stale running task is blocked", calls.setStatus.some((s) => s.taskId === "stale1" && s.status === "blocked"));
  ok("stale running task gets an audit comment", calls.comment.some((c) => c.taskId === "stale1" && /no live or tracked worker/i.test(c.body || "")));
  ok("run record includes stale-running phase", r.phases.staleRunning.some((a) => a.taskId === "stale1" && /blocked-stale/.test(a.outcome || "")));
})();

// 2e. reaping is idempotent after a crash between board mutation and state save
(() => {
  const slug = SLUG + "-idempotent-reap";
  const workerFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "workers.json");
  fs.mkdirSync(path.dirname(workerFile), { recursive: true });
  fs.writeFileSync(workerFile, JSON.stringify({
    workers: [{
      board: "ceo-studio",
      taskId: "reaped-on-board",
      agentId: "builder",
      model: "swe-1.6",
      pid: 999999,
      logPath: "/tmp/worker.log",
      worktree: "/tmp/wt-reaped",
      branch: "auto/ceo-studio-reaped-on-board",
    }],
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { review: [{ id: "reaped-on-board", title: "Already in review" }] } },
    getTask: (_b, id) => ({ ok: true, task: { id, title: "Already in review", body: "done once", status: "review" } }),
  });
  const r = runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false, allowReviewGate: false, allowTriage: false, allowStaleRunningCleanup: false }) });
  const state = runner.getState(slug);
  ok("already-reaped worker tracker is removed", runner.getWorkers(slug).length === 0);
  ok("already-reaped worker does not duplicate finished comment/status", calls.comment.length === 0 && calls.setStatus.length === 0);
  ok("already-reaped review metadata is restored", state.reviews["ceo-studio:reaped-on-board"].branch === "auto/ceo-studio-reaped-on-board");
  ok("run record reports already-reaped outcome", r.phases.reap.some((x) => x.taskId === "reaped-on-board" && x.outcome === "already-review"));
})();

// 2f. reaping checkpoints worker + review state before a potentially long gate
(() => {
  const slug = SLUG + "-reap-checkpoint";
  const workerFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "workers.json");
  fs.mkdirSync(path.dirname(workerFile), { recursive: true });
  fs.writeFileSync(workerFile, JSON.stringify({
    workers: [{
      board: "ceo-studio",
      taskId: "checkpoint-review",
      agentId: "builder",
      model: "swe-1.6",
      pid: 999998,
      logPath: "/tmp/checkpoint-worker.log",
      worktree: "/tmp/checkpoint-worktree",
      branch: "auto/ceo-studio-checkpoint-review",
      baseCommit: "abc123",
    }],
  }));
  let checkpointSeen = false;
  const { deps } = makeDeps({
    board: { ok: true, columns: { review: [{ id: "checkpoint-review", title: "Checkpoint review" }] } },
    getTask: (_b, id) => ({ ok: true, task: { id, title: "Checkpoint review", body: "done", status: "running" } }),
  });
  deps.verify = () => {
    const savedWorkers = JSON.parse(fs.readFileSync(workerFile, "utf8")).workers;
    const savedState = runner.getState(slug);
    checkpointSeen = savedWorkers.length === 0
      && savedState.reviews["ceo-studio:checkpoint-review"].branch === "auto/ceo-studio-checkpoint-review";
    return { ok: false, results: [{ cmd: "npm test", ok: false, tail: "intentional checkpoint test failure" }] };
  };
  runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({ execute: false, allowGoalReview: false, allowUnblocker: false, allowTriage: false, allowStaleRunningCleanup: false }),
  });
  ok("reap state is checkpointed before review verification begins", checkpointSeen);
})();

// 2g. E2E structure without an executed browser flow blocks + creates repair
(() => {
  const slug = SLUG + "-e2e-acceptance";
  const workerFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "workers.json");
  fs.mkdirSync(path.dirname(workerFile), { recursive: true });
  fs.writeFileSync(workerFile, JSON.stringify({
    workers: [{
      board: "ceo-studio",
      taskId: "e2e-missing-run",
      agentId: "self-repair-engineer",
      model: "swe-1.6",
      pid: 999997,
      logPath: "/tmp/e2e-missing-run.log",
      worktree: "/tmp/e2e-missing-run",
      branch: "auto/ceo-studio-e2e-missing-run",
    }],
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { running: [{ id: "e2e-missing-run", title: "End-to-end QA", status: "running" }] } },
    getTask: (_b, id) => ({
      ok: true,
      task: {
        id,
        status: "running",
        title: "End-to-end QA",
        body: "Run Playwright or Chrome DevTools with two contexts and attach the report.",
      },
    }),
  });
  deps.readLogTail = () => "Created structural E2E test coverage. Full browser automation would require setup and was not run.";
  const result = runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({
      execute: false,
      allowReviewGate: false,
      allowGoalReview: false,
      allowUnblocker: false,
      allowTriage: false,
      allowStaleRunningCleanup: false,
    }),
  });
  const linked = runner.getState(slug).completionRepairs["ceo-studio:e2e-missing-run"];
  ok("missing browser E2E evidence blocks task and creates linked repair",
    calls.setStatus.some((item) => item.taskId === "e2e-missing-run" && item.status === "blocked")
      && calls.selfRepair.length === 1
      && linked
      && result.phases.reap.some((item) => item.outcome === "blocked-acceptance-evidence"));
  ok("browser E2E repair handoff requires executable two-context evidence",
    /actual Playwright or Chrome DevTools browser flow/.test(calls.selfRepair[0].output)
      && /separate recruiter and recipient browser contexts/.test(calls.selfRepair[0].output)
      && /Do not redefine the acceptance criteria/.test(calls.selfRepair[0].output));
})();

// 3.0.1b repair-chain cap: once a failing task is already at maxRepairGenerations,
// the runner ESCALATES to a human instead of filing yet another paid repair
// worker. This is the guard that stops the self-repair $-spiral.
(() => {
  const slug = SLUG + "-repair-cap";
  const dir = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workers.json"), JSON.stringify({
    workers: [{
      board: "ceo-studio",
      taskId: "e2e-capped",
      agentId: "self-repair-engineer",
      model: "swe-1.6",
      pid: 999996,
      logPath: "/tmp/e2e-capped.log",
      worktree: "/tmp/e2e-capped",
      branch: "auto/ceo-studio-e2e-capped",
    }],
  }));
  // Pre-seed lineage: this task is itself a generation-1 auto-repair task.
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    lastRunAt: null, decomposed: {}, lastResult: null,
    repairChains: { "e2e-capped": 1 },
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { running: [{ id: "e2e-capped", title: "End-to-end QA", status: "running" }] } },
    getTask: (_b, id) => ({
      ok: true,
      task: { id, status: "running", title: "End-to-end QA", body: "Run Playwright or Chrome DevTools with two contexts and attach the report." },
    }),
  });
  deps.readLogTail = () => "Created structural E2E test coverage. Full browser automation would require setup and was not run.";
  const result = runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({
      execute: false,
      allowReviewGate: false,
      allowGoalReview: false,
      allowUnblocker: false,
      allowTriage: false,
      allowStaleRunningCleanup: false,
    }),
  });
  const linked = runner.getState(slug).completionRepairs["ceo-studio:e2e-capped"];
  ok("repair cap escalates instead of spawning another paid repair worker",
    calls.selfRepair.length === 0
      && linked && linked.escalated === true
      && calls.comment.some((c) => c.author === "autonomy-runner/repair-cap")
      && calls.setStatus.some((s) => s.taskId === "e2e-capped" && s.status === "blocked"));
})();

// 3.0.1c safe defaults: an UNCONFIGURED runner must not default to unlimited
// concurrency or an unbounded repair chain (the two settings that let the
// runaway burn happen). 0 remains a valid explicit opt-in for both.
(() => {
  const fresh = runner.getPolicy(SLUG + "-fresh-defaults");
  ok("default concurrency is a finite cap, not unlimited", fresh.maxConcurrentWorkers === 3);
  ok("default repair generations is bounded to 1", fresh.maxRepairGenerations === 1);
  ok("repair generations accepts an explicit 0 (always escalate)",
    runner.setPolicy(SLUG + "-zero-repair", { maxRepairGenerations: 0 }).policy.maxRepairGenerations === 0);
  ok("unlimited concurrency is still an explicit opt-in (0)",
    runner.setPolicy(SLUG + "-unlimited", { maxConcurrentWorkers: 0 }).policy.maxConcurrentWorkers === 0);
})();

// 3.0.2 timed-out workers are terminated with their process group and repaired
(() => {
  const slug = SLUG + "-worker-timeout";
  const workersFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "workers.json");
  fs.mkdirSync(path.dirname(workersFile), { recursive: true });
  fs.writeFileSync(workersFile, JSON.stringify({
    workers: [{
      board: "ceo-studio",
      taskId: "hung-worker",
      agentId: "builder",
      model: "swe-1.6",
      pid: 4242,
      logPath: "/tmp/hung-worker.log",
      startedAt: "2026-06-06T11:00:00.000Z",
      branch: "auto/ceo-studio-hung-worker",
      worktree: "/tmp/hung-worker",
    }],
  }));
  const { deps, calls } = makeDeps({
    workerAlive: true,
    getTask: (_board, id) => ({
      ok: true,
      task: {
        id,
        status: "running",
        title: "Browser E2E",
        body: "Run Playwright with two contexts",
      },
    }),
  });
  deps.readLogTail = () => "";
  const result = runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    now: new Date("2026-06-06T11:10:00.000Z"),
    deps,
    policy: basePolicy({
      workerTimeoutMinutes: 5,
      execute: false,
      allowReviewGate: false,
      allowGoalReview: false,
      allowUnblocker: false,
      allowTriage: false,
      allowStaleRunningCleanup: false,
    }),
  });
  ok("timed-out worker process group is terminated", calls.terminate[0] === 4242);
  ok("timed-out worker is blocked and routed to repair",
    calls.setStatus.some((item) => item.taskId === "hung-worker" && item.status === "blocked")
      && calls.selfRepair.length === 1
      && result.phases.reap.some((item) => item.outcome === "timed-out"));
})();

// 3a. review + verify PASS -> Done (real gate)
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { review: [{ id: "t3", title: "In review" }] } }, verifyResult: { ok: true, results: [{ cmd: "npm test", ok: true, tail: "ok" }] } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("review gate runs verification", calls.verify === 1);
  ok("passing verify promotes to done", calls.setStatus.some((s) => s.taskId === "t3" && s.status === "done"));
  ok("passing verify files no self-repair bug", calls.selfRepair.length === 0);
  ok("done posts a 'Done' work-event to the team log", calls.work.some((w) => /Done/.test(w.body)));
})();

// 3a.1. integration conflicts create one durable focused repair handoff
(() => {
  const slug = SLUG + "-integration-repair";
  const stateFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    reviews: {
      "ceo-studio:conflicted-review": {
        worktree: "/tmp/conflicted-worktree",
        branch: "auto/ceo-studio-conflicted-review",
        agentId: "builder",
      },
    },
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { review: [{ id: "conflicted-review", title: "Overlapping feature" }] } },
  });
  deps.prepareReviewBranch = () => ({ ok: false, reason: "CONFLICT in InterviewCard.tsx" });
  const policy = basePolicy({
    execute: false,
    allowGoalReview: false,
    allowUnblocker: false,
    allowTriage: false,
    allowStaleRunningCleanup: false,
  });
  runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy });
  runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy });
  const saved = runner.getState(slug).integrationRepairs["ceo-studio:conflicted-review"];
  ok("integration conflict files a focused repair with branch evidence",
    calls.selfRepair.length === 1
      && /auto\/ceo-studio-conflicted-review/.test(calls.selfRepair[0].output || "")
      && /InterviewCard/.test(calls.selfRepair[0].output || "")
      && saved.branch === "auto/ceo-studio-conflicted-review");
})();

// 3a.2. a merged conflict repair closes its blocked parent without replaying
// the obsolete pre-repair branch
(() => {
  const slug = SLUG + "-integration-parent-close";
  const stateFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    reviews: {
      "ceo-studio:original-conflict": {
        worktree: "/tmp/original-conflict",
        branch: "auto/ceo-studio-original-conflict",
        agentId: "builder",
      },
    },
    integrationRepairs: {
      "ceo-studio:original-conflict": {
        repairTaskId: "repair-done",
        branch: "auto/ceo-studio-original-conflict",
      },
    },
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { blocked: [{ id: "original-conflict", title: "Original conflicted feature" }] } },
    getTask: (_b, id) => id === "repair-done"
      ? { ok: true, task: { id, status: "done", title: "Integrated repair" } }
      : { ok: true, task: { id, status: "blocked", title: "Original conflicted feature" } },
  });
  let prepareCalls = 0;
  deps.prepareReviewBranch = () => { prepareCalls += 1; return { ok: false, reason: "must not replay" }; };
  deps.cleanupWorktree = () => ({ ok: true });
  const result = runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({
      execute: false,
      targetTaskIds: ["original-conflict"],
      allowGoalReview: false,
      allowUnblocker: false,
      allowTriage: false,
      allowStaleRunningCleanup: false,
    }),
  });
  ok("integrated repair closes blocked parent without replaying obsolete branch",
    prepareCalls === 0
      && calls.setStatus.some((item) => item.taskId === "original-conflict" && item.status === "done")
      && result.phases.review.some((item) => item.outcome === "done-via-integration-repair"));
})();

// 3b. review + verify FAIL -> blocked + self-repair (never a fake pass)
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { review: [{ id: "t4", title: "In review" }] } }, verifyResult: { ok: false, results: [{ cmd: "npm test", ok: false, tail: "1 failing" }] } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("failing verify blocks the task", calls.setStatus.some((s) => s.taskId === "t4" && s.status === "blocked"));
  ok("failing verify files a self-repair bug", calls.selfRepair.length >= 1);
  ok("failing verify NEVER marks done", !calls.setStatus.some((s) => s.taskId === "t4" && s.status === "done"));
  ok("blocked posts a 'blocked' work-event to the team log", calls.work.some((w) => /blocked/.test(w.body)));
})();

// 3c. review failures preserve failed branch/worktree in self-repair evidence
(() => {
  const slug = SLUG + "-review-context";
  const stateFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    reviews: {
      "ceo-studio:t-branch": {
        worktree: "/tmp/pipe-os/.worktrees/pipe-os-t-branch",
        branch: "auto/pipe-os-t-branch",
        agentId: "self-repair-engineer",
      },
    },
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { review: [{ id: "t-branch", title: "Repair review" }] } },
    verifyResult: { ok: false, results: [{ cmd: "npm run check", ok: false, tail: "lint still failing" }] },
  });
  runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  const filed = calls.selfRepair[0] || {};
  ok("review self-repair includes failed branch evidence", /auto\/pipe-os-t-branch/.test(filed.output || "") && /pipe-os-t-branch/.test(filed.output || ""));
})();

// 3d. verification uses the base project's script contract
(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verify-base-"));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verify-worktree-"));
  fs.writeFileSync(path.join(base, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
  fs.writeFileSync(path.join(worktree, "package.json"), JSON.stringify({ scripts: { check: "node -e \"process.exit(1)\"" } }));
  const verified = runner._defaults.verify({
    projectPath: base,
    cwd: worktree,
    commands: [["npm", ["run", "check"]]],
    timeoutMs: 5000,
  });
  ok("verification skips npm scripts absent from the base project", verified.ok && verified.results[0].skipped === true);
})();

// 3e. verification accepts matching inherited failures but rejects new ones
(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verify-inherited-base-"));
  const matching = fs.mkdtempSync(path.join(os.tmpdir(), "verify-inherited-worktree-"));
  const regressed = fs.mkdtempSync(path.join(os.tmpdir(), "verify-regressed-worktree-"));
  const inherited = "node -e \"console.error('Error: inherited failure'); console.error('workers/api/src/lib/ai/__tests__/retryHelper.test.ts:43:17'); console.error('baseline-only runner frame'); process.exit(1)\"";
  const inheritedWithNoise = "node -e \"console.error('Error: inherited failure'); console.error('workers/api/src/lib/ai/__tests__/retryHelper.test.ts:82:42'); console.error('worker-only source excerpt'); process.exit(1)\"";
  const changed = "node -e \"console.error('Error: new regression'); console.error('workers/api/src/lib/newFeature.test.ts'); process.exit(1)\"";
  fs.writeFileSync(path.join(base, "package.json"), JSON.stringify({ scripts: { test: inherited } }));
  fs.writeFileSync(path.join(matching, "package.json"), JSON.stringify({ scripts: { test: inheritedWithNoise } }));
  fs.writeFileSync(path.join(regressed, "package.json"), JSON.stringify({ scripts: { test: changed } }));
  const inheritedResult = runner._defaults.verify({
    projectPath: base,
    cwd: matching,
    commands: [["npm", ["test"]]],
    timeoutMs: 5000,
  });
  const regressionResult = runner._defaults.verify({
    projectPath: base,
    cwd: regressed,
    commands: [["npm", ["test"]]],
    timeoutMs: 5000,
  });
  ok("matching base failure is recorded as inherited evidence", inheritedResult.ok && inheritedResult.results[0].baselineFailure === true);
  ok("new worker failure still blocks verification", regressionResult.ok === false && regressionResult.results[0].ok === false);
})();

// 3f. baselineRef verifies against a clean committed checkout, not dirty project state
(() => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "verify-clean-base-"));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verify-clean-worker-"));
  const inherited = "node -e \"console.error('Error: inherited failure'); console.error('workers/api/src/lib/ai/__tests__/retryHelper.test.ts'); process.exit(1)\"";
  const polluted = "node -e \"console.error('Error: polluted working tree'); process.exit(1)\"";
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner@example.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: inherited } }));
  execFileSync("git", ["add", "package.json"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: repo, stdio: "ignore" });
  const baselineRef = String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo })).trim();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: polluted } }));
  fs.writeFileSync(path.join(worktree, "package.json"), JSON.stringify({ scripts: { test: inherited } }));
  const result = runner._defaults.verify({
    projectPath: repo,
    cwd: worktree,
    baselineRef,
    commands: [["npm", ["test"]]],
    timeoutMs: 5000,
  });
  ok("baselineRef ignores dirty mounted project verification state", result.ok && result.results[0].baselineFailure === true);
})();

// 4. dry-run -> proposes, never mutates
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { ready: [{ id: "t5", assignee: "builder" }], todo: [{ id: "t6", assignee: null }] } } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ dryRun: true }) });
  ok("dry-run spawns no workers", calls.spawn.length === 0);
  ok("dry-run sets no statuses", calls.setStatus.length === 0);
})();

// 4b. unreadable boards fail the cycle instead of looking like empty work
(() => {
  const { deps, calls } = makeDeps({ board: { ok: false, reason: "Hermes board read failed for pipe-os" } });
  const r = runner.runCycle({ projectSlug: SLUG + "-board-fail", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ dryRun: true, boards: ["pipe-os"] }) });
  ok("board read failure is recorded as a runner error", r.ok === false && r.errors.some((e) => e.board === "pipe-os" && /board read failed/i.test(e.error || "")));
  ok("dry-run board failures do not file self-repair work", calls.selfRepair.length === 0);
})();

// 5. decompose planning briefs; protected board is skipped
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { planning: [{ id: "p1", title: "Big brief" }] } } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("planning brief is decomposed", calls.decompose.some((d) => d.taskId === "p1" && d.action === "decompose"));

  const { deps: d2, calls: c2 } = makeDeps({ board: { ok: true, columns: { planning: [{ id: "p2" }] } } });
  runner.runCycle({ projectSlug: SLUG + "-prot", projectPath: PROJECT_PATH, force: true, deps: d2, policy: basePolicy({ boards: ["domain-lifecycle"], protectedBoards: ["domain-lifecycle"], execute: false }) });
  ok("protected board is NOT auto-decomposed", c2.decompose.length === 0);
})();

// 5b. dirty brief documents are blocked before decomposition
(() => {
  const dirtyBrief = { id: "dirty-plan", title: "[Brief] Missing acceptance", body: "# Brief\n\n### Goal\n- Build it" };
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { planning: [dirtyBrief] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-doc-gate-plan", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("dirty brief is not decomposed", calls.decompose.length === 0);
  ok("document gate comments on dirty planning brief", calls.comment.some((c) => c.taskId === "dirty-plan" && /Document Validation Gate/.test(c.body || "")));
  ok("run record shows document-validation block in plan phase", r.phases.plan.some((p) => p.taskId === "dirty-plan" && p.blocked === "document-validation"));
})();

// 5c. dirty brief documents are blocked before dispatch
(() => {
  const dirtyBrief = { id: "dirty-ready", title: "[Brief] Missing source", body: "# Brief\n\n### Goal\n- Build it", assignee: "builder" };
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { ready: [dirtyBrief] } } });
  const r = runner.runCycle({ projectSlug: SLUG + "-doc-gate-execute", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ allowDecompose: false, maxDispatchPerCycle: 1 }) });
  ok("dirty brief is not dispatched", calls.spawn.length === 0);
  ok("document gate comments on dirty ready brief", calls.comment.some((c) => c.taskId === "dirty-ready" && /Document Validation Gate/.test(c.body || "")));
  ok("run record shows document-validation block in execute phase", r.phases.execute.some((p) => p.taskId === "dirty-ready" && p.blocked === "document-validation"));
})();

// 6. no overlapping cycles for the same project (lock held by a live foreign pid)
(() => {
  const slug = SLUG + "-lock";
  runner.setPolicy(slug, basePolicy());
  // Simulate a live foreign lock by faking isAlive=true for a non-self pid.
  const { deps } = makeDeps({ board: { ok: true, columns: {} } });
  deps.isAlive = () => true;
  // Pre-write a lock owned by a different pid.
  const lockFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "lock.json");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid + 99999, at: new Date().toISOString() }));
  const r = runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy() });
  ok("overlapping cycle is skipped", r.skipped === true && /active/.test(r.reason || ""));
})();

// 7. concurrency cap (0 = unlimited; positive caps spawns)
(() => {
  const cols = { ready: [{ id: "a", assignee: "builder" }, { id: "b", assignee: "builder" }, { id: "c", assignee: "builder" }] };
  const { deps, calls } = makeDeps({ board: { ok: true, columns: cols } });
  runner.runCycle({ projectSlug: SLUG + "-cap", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ maxDispatchPerCycle: 2 }) });
  ok("maxDispatchPerCycle caps spawns", calls.spawn.length === 2);
})();

// 7b. targetTaskIds focuses a goal-specific runner pass
(() => {
  const cols = { ready: [{ id: "skip-me", assignee: "builder" }, { id: "target-me", assignee: "builder" }] };
  const { deps, calls } = makeDeps({ board: { ok: true, columns: cols } });
  runner.runCycle({ projectSlug: SLUG + "-target", projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ targetTaskIds: ["target-me"], maxDispatchPerCycle: 2 }) });
  ok("targetTaskIds dispatches only selected ready work", calls.spawn.length === 1 && calls.spawn[0].taskId === "target-me");
  ok("targeted task cycle skips unrelated portfolio goal review", calls.goals === 0);
})();

// 8. a reviewed worker branch with NO commits must be blocked, never Done
(() => {
  const slug = SLUG + "-nocommit";
  // Seed a pending review (as the reap phase would) pointing at a branch.
  const stateFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ reviews: { "ceo-studio:tx": { worktree: "/tmp/wt", branch: "auto/ceo-studio-tx" } } }));
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { review: [{ id: "tx", title: "Reviewed" }] } }, verifyResult: { ok: true, results: [{ cmd: "npm test", ok: true, tail: "" }] } });
  deps.mergeBranch = () => ({ ok: true, merged: false, reason: "branch has no new commits" });
  deps.cleanupWorktree = () => ({ ok: true });
  runner.runCycle({ projectSlug: slug, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("no-commits branch is blocked, not done", calls.setStatus.some((s) => s.taskId === "tx" && s.status === "blocked") && !calls.setStatus.some((s) => s.taskId === "tx" && s.status === "done"));
})();

// 8b. a specifically targeted blocked task with review metadata can be re-reviewed
(() => {
  const slug = SLUG + "-retry-blocked-review";
  const stateFile = path.join(process.env.CEO_STUDIO_HOME, slug, "brain", "autonomy", "runner", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    reviews: {
      "ceo-studio:retry-review": {
        worktree: "/tmp/retry-review",
        branch: "auto/ceo-studio-retry-review",
        agentId: "builder",
      },
    },
  }));
  const { deps, calls } = makeDeps({
    board: { ok: true, columns: { blocked: [{ id: "retry-review", title: "Retry this branch", status: "blocked" }] } },
    verifyResult: { ok: true, results: [{ cmd: "npm test", ok: true, tail: "ok" }] },
  });
  deps.mergeBranch = () => ({ ok: true, merged: true, commits: 1 });
  deps.cleanupWorktree = () => ({ ok: true });
  const r = runner.runCycle({
    projectSlug: slug,
    projectPath: PROJECT_PATH,
    force: true,
    deps,
    policy: basePolicy({ execute: false, allowUnblocker: false, targetTaskIds: ["retry-review"] }),
  });
  ok("targeted blocked branch is re-verified", calls.verify === 1 && r.phases.review.some((x) => x.taskId === "retry-review" && x.outcome === "done"));
  ok("passing targeted re-review promotes blocked task to done", calls.setStatus.some((s) => s.taskId === "retry-review" && s.status === "done"));
})();

// 8c. patch-equivalent specialist branches are recognized as already integrated
(() => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "merge-equivalent-"));
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner@example.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "feature.txt"), "base\n");
  execFileSync("git", ["add", "feature.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "base"], { cwd: repo, stdio: "ignore" });
  const mainBranch = String(execFileSync("git", ["branch", "--show-current"], { cwd: repo })).trim();
  execFileSync("git", ["checkout", "-b", "agent-branch"], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "feature.txt"), "base\nagent change\n");
  execFileSync("git", ["add", "feature.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "agent change"], { cwd: repo, stdio: "ignore" });
  const agentCommit = String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo })).trim();
  execFileSync("git", ["checkout", mainBranch], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "main.txt"), "unrelated\n");
  execFileSync("git", ["add", "main.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "unrelated main change"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["cherry-pick", agentCommit], { cwd: repo, stdio: "ignore" });
  const merge = runner._defaults.mergeBranch({ projectPath: repo, branch: "agent-branch" });
  ok("patch-equivalent agent branch is already integrated", merge.ok && merge.merged && merge.integrated && merge.equivalentCommits === 1);
})();

// 8d. concurrent worker branches are rebased onto current main before review
(() => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "review-rebase-"));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "review-rebase-wt-"));
  fs.rmSync(worktree, { recursive: true, force: true });
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner@example.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "base"], { cwd: repo, stdio: "ignore" });
  const mainBranch = String(execFileSync("git", ["branch", "--show-current"], { cwd: repo })).trim();
  execFileSync("git", ["checkout", "-b", "worker-branch"], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "worker.txt"), "worker\n");
  execFileSync("git", ["add", "worker.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "worker change"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["checkout", mainBranch], { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "main.txt"), "main advanced\n");
  execFileSync("git", ["add", "main.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "main advanced"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", worktree, "worker-branch"], { cwd: repo, stdio: "ignore" });
  const prepared = runner._defaults.prepareReviewBranch({ projectPath: repo, worktree, branch: "worker-branch" });
  const head = String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo })).trim();
  const mergeBase = String(execFileSync("git", ["merge-base", "HEAD", "worker-branch"], { cwd: repo })).trim();
  ok("review preparation rebases worker branch onto current main", prepared.ok && prepared.rebased && prepared.baselineRef === head && mergeBase === head);
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: repo, stdio: "ignore" });
})();

// 9. unblocker creates CEO Studio overlay metadata + self-repair work
(() => {
  const slug = SLUG + "-unblocker-direct";
  const calls = { selfRepair: [], comment: [], domainTask: [] };
  const deps = {
    hermes: {
      currentBoard: () => "ceo-studio",
      getBoard: () => ({ ok: true, columns: { blocked: [{ id: "blocked-fail", title: "Tests fail and worker is blocked", status: "blocked" }] } }),
      getTask: () => ({ ok: true, task: { id: "blocked-fail", title: "Tests fail and worker is blocked", body: "test failure blocks this task" }, comments: [] }),
      addComment: (a) => { calls.comment.push(a); return { ok: true }; },
      taskAction: () => ({ ok: true }),
    },
    overlay: boardOverlay,
    org: { route: () => ({ team: "review-guild", workflow: "review-loop", assignee: "planner" }) },
    selfRepair: {
      reportSystemBug: (input) => {
        calls.selfRepair.push(input);
        return { ok: true, bug: { task: { taskId: "bug-1" } }, repairTask: { task: { taskId: "repair-1" } } };
      },
    },
    domainBoard: {
      createChildTask: (input) => { calls.domainTask.push(input); return { ok: true, task: { taskId: "task-1" } }; },
    },
  };
  const r = unblocker.run({ projectSlug: slug, projectPath: PROJECT_PATH, board: "ceo-studio", deps });
  const overlay = boardOverlay.readTask(slug, "ceo-studio", "blocked-fail");
  ok("unblocker plans blocked task", r.planned === 1 && overlay.blocker.type === "repair_or_specialist");
  ok("unblocker creates self-repair work for failure blockers", calls.selfRepair.length === 1 && overlay.blocker.spawnedTaskId === "repair-1");
  ok("unblocker comments back to Hermes task", calls.comment.length === 1 && /CEO Studio Unblock Plan/.test(calls.comment[0].body));
})();

// 10. human blockers create an inbox notification that can be acknowledged
(() => {
  const slug = SLUG + "-human-notification";
  const deps = {
    hermes: {
      currentBoard: () => "ceo-studio",
      getBoard: () => ({ ok: true, columns: { blocked: [{ id: "blocked-human", title: "Blocked by human OAuth access", status: "blocked" }] } }),
      getTask: () => ({ ok: true, task: { id: "blocked-human", title: "Blocked by human OAuth access", body: "blocked by human access approval" }, comments: [] }),
      addComment: () => ({ ok: true }),
      taskAction: () => ({ ok: true }),
    },
    overlay: boardOverlay,
    notifications,
    org: { route: () => ({ team: "review-guild", workflow: "review-loop", assignee: "planner" }) },
    selfRepair: { reportSystemBug: () => ({ ok: true }) },
    domainBoard: { createChildTask: () => ({ ok: true, task: { taskId: "task-1" } }) },
  };
  const r = unblocker.run({ projectSlug: slug, projectPath: PROJECT_PATH, board: "ceo-studio", deps });
  const inbox = notifications.list(slug, { type: "human_escalation" });
  const notice = inbox.notifications[0];
  ok("human blocker creates human escalation notification", r.results[0].blockerType === "human_decision" && inbox.unread === 1 && notice.taskId === "blocked-human");
  const ack = notifications.acknowledge(slug, notice.id);
  ok("human escalation can be acknowledged", ack.ok && notifications.list(slug, { type: "human_escalation" }).unread === 0);
})();

console.log(`\n${passed} autonomy-runner checks passed.`);
