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
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CEO_STUDIO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-runner-"));
const runner = require("../main/core/autonomy-runner");

let passed = 0;
const ok = (n, c) => { if (!c) { console.error("FAIL", n); process.exitCode = 1; } else { console.log("PASS", n); passed++; } };

const SLUG = "test-proj";
const PROJECT_PATH = "/tmp/fake-repo";

// A reusable fake-deps factory. `calls` records side effects for assertions.
function makeDeps(overrides = {}) {
  const calls = { assign: [], setStatus: [], comment: [], spawn: [], decompose: [], selfRepair: [], verify: 0 };
  const board = overrides.board || { ok: true, columns: {} };
  const deps = {
    hermes: {
      ensureUp: () => ({ ok: true, up: true }),
      listBoards: () => (overrides.boards || [{ slug: "ceo-studio" }]),
      getBoard: () => board,
      getTask: (_b, id) => ({ ok: true, task: { id, title: "T " + id, body: "do the thing" } }),
      taskAction: (a) => { calls.decompose.push(a); return { ok: true }; },
      assignTask: (a) => { calls.assign.push(a); return { ok: true }; },
      setTaskStatus: (a) => { calls.setStatus.push(a); return { ok: true }; },
      addComment: (a) => { calls.comment.push(a); return { ok: true }; },
    },
    org: { route: () => ({ ok: true, assignee: "builder", team: "execution-builders" }) },
    registry: { read: () => ({ ok: true, agents: [{ id: "builder", provider: "devin", model: "swe-1.6", persona: "builder" }] }) },
    autonomyLoop: { runCycle: () => ({ ok: true }) },
    selfRepair: { reportSystemBug: (a) => { calls.selfRepair.push(a); return { ok: true }; } },
    isAlive: () => false,
    spawnWorker: (a) => { calls.spawn.push(a); return { ok: true, pid: 4242 }; },
    readLogTail: () => "worker finished cleanly",
    verify: () => { calls.verify++; return overrides.verifyResult || { ok: true, results: [{ cmd: "npm test", ok: true, tail: "" }] }; },
  };
  return { deps, calls };
}

function basePolicy(extra = {}) {
  return { enabled: true, boards: ["ceo-studio"], dryRun: false, allowDecompose: true, allowAssign: true, execute: true, allowReviewGate: true, maxDispatchPerCycle: 5, maxConcurrentWorkers: 0, ...extra };
}

// 1. ready + devin assignee -> spawns a real worker + marks running
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { ready: [{ id: "t1", title: "Ready task", assignee: "builder" }] } } });
  const r = runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy() });
  ok("ready devin task spawns a worker", calls.spawn.length === 1 && calls.spawn[0].model === "swe-1.6");
  ok("spawned task is set to running", calls.setStatus.some((s) => s.taskId === "t1" && s.status === "running"));
  ok("run record reports a spawn", r.spawned === 1);
})();

// 2. unassigned actionable task -> assigned to orchestration-routed registry agent
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { todo: [{ id: "t2", title: "Unowned", assignee: null }] } } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("unassigned task is routed + assigned", calls.assign.length === 1 && calls.assign[0].assignee === "builder");
})();

// 3a. review + verify PASS -> Done (real gate)
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { review: [{ id: "t3", title: "In review" }] } }, verifyResult: { ok: true, results: [{ cmd: "npm test", ok: true, tail: "ok" }] } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("review gate runs verification", calls.verify === 1);
  ok("passing verify promotes to done", calls.setStatus.some((s) => s.taskId === "t3" && s.status === "done"));
  ok("passing verify files no self-repair bug", calls.selfRepair.length === 0);
})();

// 3b. review + verify FAIL -> blocked + self-repair (never a fake pass)
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { review: [{ id: "t4", title: "In review" }] } }, verifyResult: { ok: false, results: [{ cmd: "npm test", ok: false, tail: "1 failing" }] } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ execute: false }) });
  ok("failing verify blocks the task", calls.setStatus.some((s) => s.taskId === "t4" && s.status === "blocked"));
  ok("failing verify files a self-repair bug", calls.selfRepair.length >= 1);
  ok("failing verify NEVER marks done", !calls.setStatus.some((s) => s.taskId === "t4" && s.status === "done"));
})();

// 4. dry-run -> proposes, never mutates
(() => {
  const { deps, calls } = makeDeps({ board: { ok: true, columns: { ready: [{ id: "t5", assignee: "builder" }], todo: [{ id: "t6", assignee: null }] } } });
  runner.runCycle({ projectSlug: SLUG, projectPath: PROJECT_PATH, force: true, deps, policy: basePolicy({ dryRun: true }) });
  ok("dry-run spawns no workers", calls.spawn.length === 0);
  ok("dry-run sets no statuses", calls.setStatus.length === 0);
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

console.log(`\n${passed} autonomy-runner checks passed.`);
