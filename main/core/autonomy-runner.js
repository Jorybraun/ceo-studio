"use strict";
/**
 * Autonomy Runner — the self-driving loop that makes the Kanban board actually
 * move work forward with agents from the registry.
 *
 * This is the connective tissue described in
 * runtime/harness/architecture/AUTONOMY_RUNNER_PLAN.md. One cycle, per board:
 *
 *   1. ensure the Hermes gateway (CEO brain) is up
 *   2. STANDUP  — reconcile completed rooms and start due proposal-only cadence
 *   3. REAP     — collect finished workers before optional portfolio work
 *   4. goal review + blocked analysis (delegated to autonomy-loop)
 *   5. RESEARCH — normalize raw triage intake through Hermes specify/promote
 *   6. CLEANUP  — detect stale running cards with no live worker
 *   7. PLAN     — decompose planning-lane briefs into linked child tasks
 *   8. ASSIGN   — route unassigned actionable work to the owning registry agent
 *   9. EXECUTE  — spawn capped, real Devin (swe-1.6) workers on ready work,
 *                 in the project repo, non-blocking (detached + reaped later)
 *  10. REVIEW   — a strong test gate: nothing reaches Done until the project's
 *                 verification commands pass; failures file self-repair bugs
 *  11. persist a run record; never run overlapping cycles for the same project
 *
 * Why Devin directly (not the Hermes profile-worker dispatcher)?
 * Hermes spawns workers as `hermes -p <profile>` agents and has no Devin model
 * provider, so a Hermes worker cannot run swe-1.6. The registry already models
 * `devin` as a provider (DevinProvider shells out to the Devin CLI), so the
 * runner executes `devin --model <model> -p` itself. The Hermes board remains
 * the single source of truth for lanes, claiming, comments, and lifecycle.
 *
 * Everything that touches the outside world is injected via `deps` so the loop
 * is fully testable without a live board, gateway, or Devin credits.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { brainDir } = require("./paths");

const hermes = require("./hermes");
const org = require("./orchestration-org");
const registry = require("./registry");
const autonomyLoop = require("./autonomy-loop");
const selfRepair = require("./self-repair");
const meetings = require("./meetings");
const standups = require("./standups");
const unblocker = require("./unblocker");
const briefRuns = require("./brief-runs");

const DEFAULT_POLICY = {
  enabled: false,
  intervalMinutes: 15,
  boards: "all", // "all" | [slugs]
  domain: "All",
  dryRun: false, // master switch: when true, no board mutations, just propose
  allowStandups: true, // start due proposal-only standups and reconcile completed rooms
  maxStandupsPerCycle: 2,
  allowGoalReview: true, // broad portfolio analysis; targeted cycles skip it
  allowUnblocker: true, // blocked-lane plans + unblock work
  maxBlockedUnblocksPerCycle: 10,
  allowTriage: true, // TRIAGE phase: ask Hermes to normalize intake/specify briefs
  maxTriagePerCycle: 3,
  allowStaleRunningCleanup: true,
  allowDecompose: true, // PLAN phase
  allowAssign: true, // ASSIGN phase
  execute: true, // EXECUTE phase (spawn real Devin workers). User chose live, capped.
  allowReviewGate: true, // REVIEW phase (test gate -> Done / self-repair)
  // How a green review gate LANDS work. "merge" = legacy local fast-forward
  // merge into the main checkout (no review surface; a diverged branch is left
  // orphaned). "pr" = the merge-manager: push the verified branch + open a
  // GitHub PR via `gh`, and only promote the task to Done once that PR actually
  // merges. PR mode gives a human/CI review surface and stops branches from
  // being silently orphaned when they cannot fast-forward-merge.
  integrationMode: "merge", // "merge" | "pr"
  model: "swe-1.6",
  // Force ALL workers onto ONE model regardless of their registry model. Empty
  // string = use each agent's own model. Set to a promo/cheap model (e.g.
  // "adaptive-promo") to keep the whole swarm off paid swe-1.6 credits.
  modelOverride: "",
  // Headcount safety caps. A positive number is a hard ceiling. 0 means
  // "unlimited" and must be opted into EXPLICITLY — it is deliberately NOT the
  // default, because an unconfigured runner defaulting to unlimited concurrency
  // is exactly how a runaway self-repair loop burned a large amount of spend.
  maxDispatchPerCycle: 3, // new workers spawned per cycle (0 = unlimited)
  maxConcurrentWorkers: 3, // total live Devin workers across all boards (0 = unlimited)
  // Self-repair $-spiral guard. A failed worker can file a repair task that is
  // dispatched to another paid worker; if that repair ALSO fails (e.g. an
  // unsatisfiable browser-E2E gate no headless `devin -p` worker can pass), the
  // naive behaviour files yet another repair forever. After this many repair
  // GENERATIONS, escalate to a human/CEO decision (leave the task blocked)
  // instead of dispatching more workers. 0 = never auto-repair (always escalate).
  maxRepairGenerations: 1,
  workerTimeoutMinutes: 45,
  // Unattended workers run non-interactively (`devin -p`): there is no human to
  // approve tool calls, so "auto" (read-only auto-approve) leaves them unable to
  // edit/commit/run tests. They are isolated in a per-task git worktree, so
  // "dangerous" (auto-approve all tools) is the correct default for autonomy.
  devinPermissionMode: "dangerous",
  protectedBoards: ["domain-lifecycle"], // human-only per its own design docs
  protectDecomposeOnProtected: true, // don't auto-decompose protected boards
  triageLanes: ["triage"],
  decomposeLanes: ["planning"],
  assignLanes: ["todo", "ready", "bug", "review"],
  executeLanes: ["ready"],
  targetTaskIds: [], // optional focus set for a goal-specific runner pass
  // Tasks that a headless `devin -p` worker can NEVER satisfy (real phone call,
  // two-way device audio, on-device Siri, manual dogfood, device/browser E2E).
  // The EXECUTE phase skips these so they never start the failure->repair spiral.
  // Tasks can also opt in with a `[human-required]` marker in their title/body.
  humanRequiredTaskIds: [],
  verifyCommands: [["npm", ["run", "check"]], ["npm", ["test"]]],
  staleWorkerSkipReap: false,
};

// ---------------------------------------------------------------------------
// State + policy storage (per project brain)
// ---------------------------------------------------------------------------

function runnerDir(slug) {
  const d = path.join(brainDir(slug), "autonomy", "runner");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function policyPath(slug) { return path.join(runnerDir(slug), "policy.json"); }
function statePath(slug) { return path.join(runnerDir(slug), "state.json"); }
function workersPath(slug) { return path.join(runnerDir(slug), "workers.json"); }
function lockPath(slug) { return path.join(runnerDir(slug), "lock.json"); }
function runsDir(slug) {
  const d = path.join(runnerDir(slug), "runs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function workerLogsDir(slug) {
  const d = path.join(runnerDir(slug), "worker-logs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function clampPositive(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function normalizePolicy(input = {}) {
  const m = { ...DEFAULT_POLICY, ...(input || {}) };
  const arr = (v, d) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : d);
  return {
    ...m,
    enabled: !!m.enabled,
    dryRun: !!m.dryRun,
    allowStandups: m.allowStandups !== false,
    allowGoalReview: m.allowGoalReview !== false,
    allowDecompose: m.allowDecompose !== false,
    allowTriage: m.allowTriage !== false,
    allowStaleRunningCleanup: m.allowStaleRunningCleanup !== false,
    allowUnblocker: m.allowUnblocker !== false,
    allowAssign: m.allowAssign !== false,
    execute: m.execute !== false,
    allowReviewGate: m.allowReviewGate !== false,
    integrationMode: m.integrationMode === "pr" ? "pr" : "merge",
    protectDecomposeOnProtected: m.protectDecomposeOnProtected !== false,
    intervalMinutes: clampPositive(m.intervalMinutes, DEFAULT_POLICY.intervalMinutes),
    maxDispatchPerCycle: Math.max(0, Number(m.maxDispatchPerCycle) || 0),
    maxStandupsPerCycle: Math.max(1, Number(m.maxStandupsPerCycle) || DEFAULT_POLICY.maxStandupsPerCycle),
    maxConcurrentWorkers: Math.max(0, Number(m.maxConcurrentWorkers) || 0),
    maxRepairGenerations: ((g) => (Number.isFinite(g) && g >= 0 ? Math.floor(g) : DEFAULT_POLICY.maxRepairGenerations))(Number(m.maxRepairGenerations)),
    maxBlockedUnblocksPerCycle: Math.max(1, Number(m.maxBlockedUnblocksPerCycle) || DEFAULT_POLICY.maxBlockedUnblocksPerCycle),
    maxTriagePerCycle: Math.max(1, Number(m.maxTriagePerCycle) || DEFAULT_POLICY.maxTriagePerCycle),
    workerTimeoutMinutes: clampPositive(m.workerTimeoutMinutes, DEFAULT_POLICY.workerTimeoutMinutes),
    devinPermissionMode: String(m.devinPermissionMode || DEFAULT_POLICY.devinPermissionMode),
    model: String(m.model || DEFAULT_POLICY.model),
    modelOverride: m.modelOverride ? String(m.modelOverride) : "",
    boards: m.boards === "all" || !Array.isArray(m.boards) ? "all" : m.boards.map(String),
    protectedBoards: arr(m.protectedBoards, DEFAULT_POLICY.protectedBoards),
    triageLanes: arr(m.triageLanes, DEFAULT_POLICY.triageLanes),
    decomposeLanes: arr(m.decomposeLanes, DEFAULT_POLICY.decomposeLanes),
    assignLanes: arr(m.assignLanes, DEFAULT_POLICY.assignLanes),
    executeLanes: arr(m.executeLanes, DEFAULT_POLICY.executeLanes),
    targetTaskIds: arr(m.targetTaskIds, DEFAULT_POLICY.targetTaskIds),
    humanRequiredTaskIds: arr(m.humanRequiredTaskIds, DEFAULT_POLICY.humanRequiredTaskIds),
  };
}

function policyFromRequest(info = {}) {
  if (!info || typeof info !== "object" || Array.isArray(info)) return {};
  if (info.policy && typeof info.policy === "object" && !Array.isArray(info.policy)) {
    return info.policy;
  }
  return info;
}

function getPolicy(slug) { return normalizePolicy(readJson(policyPath(slug), DEFAULT_POLICY)); }
function setPolicy(slug, patch = {}) {
  const next = normalizePolicy({ ...getPolicy(slug), ...(patch || {}) });
  writeJson(policyPath(slug), next);
  return { ok: true, policy: next };
}
function getState(slug) { return readJson(statePath(slug), { lastRunAt: null, decomposed: {}, lastResult: null }); }
function saveState(slug, state) { writeJson(statePath(slug), state); return state; }
function getWorkers(slug) { const w = readJson(workersPath(slug), { workers: [] }); return Array.isArray(w.workers) ? w.workers : []; }
function saveWorkers(slug, workers) { writeJson(workersPath(slug), { workers }); }

// ---------------------------------------------------------------------------
// Injected side-effects (real implementations; overridable in tests)
// ---------------------------------------------------------------------------

function _isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function _git(projectPath, args, timeout = 60000) {
  return execFileSync("git", args, { cwd: projectPath, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
}

function branchNameFor(board, taskId) {
  return `auto/${String(board)}-${String(taskId)}`.replace(/[^a-zA-Z0-9._/-]+/g, "-");
}

/**
 * Create (or reuse) an isolated git worktree for a task, branched off HEAD.
 * Concurrent Devin workers each get their own clean checkout, so they never
 * corrupt each other or the user's (possibly dirty) main working tree.
 */
function ensureWorktree({ projectPath, board, taskId }) {
  const branch = branchNameFor(board, taskId);
  const wt = path.join(projectPath, ".worktrees", `${board}-${taskId}`.replace(/[^a-zA-Z0-9._-]+/g, "-"));
  if (fs.existsSync(wt)) {
    let baseCommit = null;
    try { baseCommit = String(_git(projectPath, ["merge-base", "HEAD", branch])).trim() || null; } catch { baseCommit = null; }
    return { ok: true, worktree: wt, branch, baseCommit, reused: true };
  }
  fs.mkdirSync(path.join(projectPath, ".worktrees"), { recursive: true });
  const headCommit = String(_git(projectPath, ["rev-parse", "HEAD"])).trim();
  // If the branch already exists, attach to it; otherwise create it off HEAD.
  let hasBranch = false;
  try { _git(projectPath, ["rev-parse", "--verify", branch]); hasBranch = true; } catch { hasBranch = false; }
  const args = hasBranch ? ["worktree", "add", wt, branch] : ["worktree", "add", wt, "-b", branch, "HEAD"];
  _git(projectPath, args, 120000);
  let baseCommit = headCommit;
  if (hasBranch) {
    try { baseCommit = String(_git(projectPath, ["merge-base", "HEAD", branch])).trim() || headCommit; } catch { baseCommit = headCommit; }
  }
  return { ok: true, worktree: wt, branch, baseCommit, reused: false };
}

function defaultSpawnWorker({ projectPath, model, prompt, logPath, board, taskId, permissionMode }) {
  // Each worker runs in its own git worktree (isolation). Detached so the Devin
  // session outlives this cycle; output captured to a log file the next cycle
  // reaps. Mirrors how the Hermes dispatcher detaches its workers.
  let worktree = projectPath, branch = null, baseCommit = null;
  try {
    const wt = ensureWorktree({ projectPath, board, taskId });
    worktree = wt.worktree; branch = wt.branch; baseCommit = wt.baseCommit || null;
  } catch (e) {
    return { ok: false, reason: `worktree setup failed: ${String(e.message || e).slice(0, 300)}` };
  }
  const out = fs.openSync(logPath, "a");
  // Non-interactive autonomy: auto-approve all tools so the worker can actually
  // edit/commit/run tests. Safe because it is confined to an isolated worktree.
  const mode = String(permissionMode || process.env.DEVIN_PERMISSION_MODE || "dangerous");
  const child = spawn("devin", ["--model", String(model), "--permission-mode", mode, "-p", "--", prompt], {
    cwd: worktree,
    env: { ...process.env, DEVIN_PERMISSION_MODE: mode },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  return { ok: true, pid: child.pid, worktree, branch, baseCommit };
}

function defaultListChildPids(pid) {
  try {
    return String(execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }))
      .split(/\s+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function collectDescendantPids(rootPid, listChildren = defaultListChildPids) {
  const found = [];
  const queue = [Number(rootPid)];
  const seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    for (const child of listChildren(parent) || []) {
      const childPid = Number(child);
      if (!Number.isInteger(childPid) || childPid <= 0 || seen.has(childPid)) continue;
      seen.add(childPid);
      found.push(childPid);
      queue.push(childPid);
    }
  }
  return found;
}

function terminateProcessTree(pid, { listChildren = defaultListChildPids, kill = process.kill } = {}) {
  const workerPid = Number(pid);
  if (!Number.isInteger(workerPid) || workerPid <= 0) {
    return { ok: false, reason: "valid worker pid required" };
  }
  const descendants = collectDescendantPids(workerPid, listChildren).reverse();
  const signaled = [];
  const failures = [];
  for (const targetPid of [...descendants, workerPid]) {
    try {
      kill(-targetPid, "SIGTERM");
      signaled.push({ pid: targetPid, processGroup: true });
    } catch (groupError) {
      try {
        kill(targetPid, "SIGTERM");
        signaled.push({ pid: targetPid, processGroup: false });
      } catch (processError) {
        failures.push({
          pid: targetPid,
          reason: String(processError && processError.message || groupError && groupError.message || "worker termination failed"),
        });
      }
    }
  }
  return {
    ok: signaled.length > 0,
    pid: workerPid,
    signal: "SIGTERM",
    descendants,
    signaled,
    failures,
    reason: signaled.length ? undefined : (failures[0] && failures[0].reason || "worker termination failed"),
  };
}

function defaultTerminateWorker(pid) {
  return terminateProcessTree(pid);
}

function defaultReadLogTail(logPath, max = 4000) {
  try {
    const s = fs.readFileSync(logPath, "utf8");
    return s.length > max ? s.slice(-max) : s;
  } catch { return ""; }
}

function readPackageScripts(projectPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"));
    return pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function npmScriptName(cmd, args = []) {
  if (cmd !== "npm") return "";
  if (args[0] === "run" && args[1]) return String(args[1]);
  if (args[0] === "test") return "test";
  return "";
}

function runVerifyCommand(cmd, args, cwd, timeoutMs) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, tail: String(out).slice(-2500) };
  } catch (e) {
    const tail = String((e.stdout || "") + "\n" + (e.stderr || e.message || "")).slice(-5000);
    return { ok: false, tail };
  }
}

function failureSignatures(output) {
  const plain = String(output || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\.worktrees\/[^/\s]+\/(?=(?:workers|src|agent-harness|e2e|test|tests)\/)/g, "")
    .replace(/\/[^\s:]*\/(?=(?:workers|src|agent-harness|e2e|test|tests)\/)/g, "")
    .replace(/\/[^\s:]+\/\.worktrees\/[^\s:]+/g, "<worktree>")
    .replace(/\/Users\/[^\s:]+/g, "<path>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<time>")
    .toLowerCase();
  const lines = plain.split(/\r?\n/)
    .map((line) => line.trim().replace(/\b\d+\b/g, "#"))
    .filter((line) => (
      /unhandled rejection|missing script|error:|failed|failing|problems \(|\.test\.[jt]sx?|\.spec\.[jt]sx?/.test(line)
    ))
    .map((line) => line.slice(0, 500));
  return [...new Set(lines)];
}

function normalizeFailurePath(value) {
  return String(value || "")
    .replace(/^["'`]+|["'`,.:;]+$/g, "")
    .replace(/^.*?\.worktrees\/[^/]+\//, "")
    .replace(/^.*?(?=(?:workers|src|agent-harness|e2e|test|tests)\/)/, "")
    .replace(/:\d+(?::\d+)?$/, "");
}

function failureFingerprints(output) {
  const lines = String(output || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/);
  const fingerprints = [];
  const pathPattern = /((?:\.worktrees\/[^/]+\/)?(?:workers|src|agent-harness|e2e|test|tests)\/[^\s"'`]+\.(?:[cm]?[jt]sx?))(?::\d+){0,2}/i;
  for (let i = 0; i < lines.length; i += 1) {
    const error = lines[i].match(/^\s*Error:\s*(.+?)\s*$/i);
    if (error) {
      let file = "";
      for (let j = i + 1; j < Math.min(lines.length, i + 18); j += 1) {
        const pathMatch = lines[j].match(pathPattern);
        if (pathMatch) {
          file = normalizeFailurePath(pathMatch[1]);
          break;
        }
      }
      const message = error[1].trim().toLowerCase().replace(/\s+/g, " ");
      fingerprints.push(`error:${message}|file:${file || "unknown"}`);
    }
    const failedFile = lines[i].match(/\b(?:FAIL|FAILED)\b.*?((?:workers|src|agent-harness|e2e|test|tests)\/[^\s"'`]+\.(?:[cm]?[jt]sx?))/i);
    if (failedFile) fingerprints.push(`failed-file:${normalizeFailurePath(failedFile[1])}`);
    const missingScript = lines[i].match(/missing script:\s*["']?([^"'\s]+)["']?/i);
    if (missingScript) fingerprints.push(`missing-script:${missingScript[1].toLowerCase()}`);
  }
  return [...new Set(fingerprints)];
}

function matchesBaselineFailure(workerTail, baselineTail) {
  const workerFingerprints = failureFingerprints(workerTail);
  const baselineFingerprints = new Set(failureFingerprints(baselineTail));
  if (workerFingerprints.length) {
    return workerFingerprints.every((fingerprint) => baselineFingerprints.has(fingerprint));
  }
  const worker = failureSignatures(workerTail);
  const baseline = new Set(failureSignatures(baselineTail));
  return worker.length > 0 && worker.every((line) => baseline.has(line));
}

function defaultResolveBaselineRef({ projectPath, branch } = {}) {
  if (!projectPath || !branch) return null;
  try {
    return String(_git(projectPath, ["merge-base", "HEAD", branch])).trim() || null;
  } catch {
    return null;
  }
}

function prepareBaselineCheckout(projectPath, baselineRef) {
  if (!projectPath || !baselineRef) return null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-baseline-"));
  const checkout = path.join(root, "repo");
  try {
    _git(projectPath, ["worktree", "add", "--detach", checkout, baselineRef], 120000);
    const sourceModules = path.join(projectPath, "node_modules");
    const targetModules = path.join(checkout, "node_modules");
    if (fs.existsSync(sourceModules) && !fs.existsSync(targetModules)) {
      fs.symlinkSync(sourceModules, targetModules, "dir");
    }
    return { root, checkout };
  } catch (e) {
    try { _git(projectPath, ["worktree", "remove", "--force", checkout], 60000); } catch { /* ignore */ }
    fs.rmSync(root, { recursive: true, force: true });
    return null;
  }
}

function cleanupBaselineCheckout(projectPath, baseline) {
  if (!baseline) return;
  try { _git(projectPath, ["worktree", "remove", "--force", baseline.checkout], 60000); } catch { /* ignore */ }
  fs.rmSync(baseline.root, { recursive: true, force: true });
}

function defaultVerify({ projectPath, cwd, commands, baselineRef, timeoutMs = 1000 * 60 * 8 }) {
  const results = [];
  let allOk = true;
  const verifyCwd = cwd || projectPath || process.cwd();
  const baselineCheckout = prepareBaselineCheckout(projectPath, baselineRef);
  const baselineCwd = (baselineCheckout && baselineCheckout.checkout) || projectPath || verifyCwd;
  const baseScripts = readPackageScripts(baselineCwd);
  try {
    for (const [cmd, args] of commands || []) {
      const label = `${cmd} ${(args || []).join(" ")}`.trim();
      const script = npmScriptName(cmd, args || []);
      if (script && !baseScripts[script]) {
        results.push({
          cmd: label,
          ok: true,
          skipped: true,
          reason: `base project does not define npm script "${script}"`,
          tail: `Skipped: base project does not define npm script "${script}".`,
        });
        continue;
      }

      const worker = runVerifyCommand(cmd, args || [], verifyCwd, timeoutMs);
      if (worker.ok) {
        results.push({ cmd: label, ok: true, tail: worker.tail.slice(-1500) });
        continue;
      }

      const canCompareBaseline = baselineCwd && path.resolve(verifyCwd) !== path.resolve(baselineCwd);
      let baselineResult = null;
      if (canCompareBaseline) {
        baselineResult = runVerifyCommand(cmd, args || [], baselineCwd, timeoutMs);
        if (!baselineResult.ok && matchesBaselineFailure(worker.tail, baselineResult.tail)) {
          results.push({
            cmd: label,
            ok: true,
            baselineFailure: true,
            reason: "worker failure matches the clean base commit's existing failure signature",
            tail: worker.tail.slice(-2500),
            baselineTail: baselineResult.tail.slice(-2500),
          });
          continue;
        }
      }

      allOk = false;
      results.push({
        cmd: label,
        ok: false,
        tail: worker.tail.slice(-2500),
        baselineTail: baselineResult ? baselineResult.tail.slice(-2500) : "",
      });
    }
  } finally {
    cleanupBaselineCheckout(projectPath, baselineCheckout);
  }
  return { ok: allOk, results };
}

/** Fast-forward-only merge of a worker's branch into the main checkout. */
function defaultMergeBranch({ projectPath, branch }) {
  if (!branch) return { ok: false, reason: "no branch" };
  try {
    const ahead = Number(String(_git(projectPath, ["rev-list", "--count", `HEAD..${branch}`])).trim() || "0");
    if (!ahead) return { ok: true, merged: false, reason: "branch has no new commits" };
    const cherry = String(_git(projectPath, ["cherry", "HEAD", branch])).trim().split(/\r?\n/).filter(Boolean);
    if (cherry.length && cherry.every((line) => line.startsWith("- "))) {
      return {
        ok: true,
        merged: true,
        integrated: true,
        commits: 0,
        equivalentCommits: cherry.length,
        reason: "all branch patches are already integrated in HEAD",
      };
    }
    _git(projectPath, ["merge", "--ff-only", branch], 120000);
    return { ok: true, merged: true, commits: ahead };
  } catch (e) {
    return { ok: false, reason: String((e.stderr || e.message || e)).slice(0, 300) };
  }
}

function defaultPrepareReviewBranch({ projectPath, worktree, branch } = {}) {
  if (!projectPath || !worktree || !branch) return { ok: true, rebased: false, baselineRef: null };
  try {
    const head = String(_git(projectPath, ["rev-parse", "HEAD"])).trim();
    const mergeBase = String(_git(projectPath, ["merge-base", "HEAD", branch])).trim();
    if (mergeBase === head) return { ok: true, rebased: false, baselineRef: head };

    const cherry = String(_git(projectPath, ["cherry", "HEAD", branch])).trim().split(/\r?\n/).filter(Boolean);
    if (cherry.length && cherry.every((line) => line.startsWith("- "))) {
      return { ok: true, rebased: false, integrated: true, baselineRef: head };
    }

    try {
      _git(worktree, ["rebase", head], 120000);
    } catch (e) {
      try { _git(worktree, ["rebase", "--abort"], 60000); } catch { /* ignore */ }
      return {
        ok: false,
        reason: String((e.stderr || e.message || e)).slice(-1200),
        baselineRef: head,
      };
    }
    return { ok: true, rebased: true, baselineRef: head };
  } catch (e) {
    return { ok: false, reason: String((e.stderr || e.message || e)).slice(-1200) };
  }
}

function defaultCleanupWorktree({ projectPath, worktree }) {
  try { if (worktree && worktree !== projectPath) _git(projectPath, ["worktree", "remove", "--force", worktree], 60000); return { ok: true }; }
  catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 200) }; }
}

// ---------------------------------------------------------------------------
// Merge-manager (integrationMode: "pr")
//
// Instead of a local fast-forward merge, a green review gate can push the
// verified worker branch and open a GitHub PR via `gh`. This gives a human/CI
// review surface and never silently orphans a branch that cannot ff-merge.
// ---------------------------------------------------------------------------

function _gh(cwd, args, timeout = 60000) {
  return execFileSync("gh", args, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
}

/** Commits the worker branch is ahead of the main checkout's HEAD (0 = no work). */
function defaultBranchAhead({ projectPath, branch } = {}) {
  if (!branch) return 0;
  try { return Number(String(_git(projectPath, ["rev-list", "--count", `HEAD..${branch}`])).trim() || "0"); }
  catch { return 0; }
}

/** Name of the main checkout's current branch — the PR base. */
function defaultBaseBranch(projectPath) {
  try { return String(_git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || "main"; }
  catch { return "main"; }
}

/** Push a verified worker branch to origin. force-with-lease is used only as a
 *  rebase fallback and only ever on the throwaway auto/* branch, never main. */
function defaultPushReviewBranch({ projectPath, worktree, branch } = {}) {
  if (!branch) return { ok: false, reason: "no branch" };
  const cwd = worktree || projectPath;
  try {
    _git(cwd, ["push", "-u", "origin", branch], 120000);
    return { ok: true, forced: false };
  } catch (e) {
    try {
      _git(cwd, ["push", "--force-with-lease", "-u", "origin", branch], 120000);
      return { ok: true, forced: true };
    } catch (e2) {
      return { ok: false, reason: String((e2.stderr || e2.message || e2)).slice(0, 300) };
    }
  }
}

/** State of the PR for a head branch: "open" | "closed" | "merged" (or null). */
function defaultPullRequestStatus({ projectPath, branch } = {}) {
  if (!branch) return { ok: false, state: null };
  try {
    const out = _gh(projectPath, ["pr", "view", branch, "--json", "state,url,number,mergedAt"]);
    const data = JSON.parse(String(out).trim() || "{}");
    const state = data.mergedAt ? "merged" : String(data.state || "").toLowerCase();
    return { ok: true, state, url: data.url || null, number: data.number || null };
  } catch (e) {
    // `gh pr view` exits non-zero when there is no PR for the branch.
    return { ok: false, state: null, reason: String((e.stderr || e.message || e)).slice(0, 200) };
  }
}

/** Open (or reuse) a PR for a verified worker branch. Idempotent: an existing
 *  open PR for the same head branch is returned instead of opening a duplicate. */
function defaultOpenPullRequest({ projectPath, worktree, branch, base, title, body } = {}) {
  if (!branch) return { ok: false, reason: "no branch" };
  const cwd = worktree || projectPath;
  const baseBranch = base || defaultBaseBranch(projectPath);
  try {
    const existing = _gh(projectPath, ["pr", "list", "--head", branch, "--state", "open", "--json", "url,number", "--limit", "1"]);
    const rows = JSON.parse(String(existing).trim() || "[]");
    if (Array.isArray(rows) && rows.length) return { ok: true, url: rows[0].url, number: rows[0].number, created: false };
  } catch { /* no existing PR (or gh unavailable) — fall through to create */ }
  try {
    const out = _gh(cwd, ["pr", "create", "--base", baseBranch, "--head", branch, "--title", String(title || branch), "--body", String(body || "")], 120000);
    const url = String(out).trim().split(/\r?\n/).filter(Boolean).pop() || null;
    return { ok: true, url, created: true };
  } catch (e) {
    return { ok: false, reason: String((e.stderr || e.message || e)).slice(0, 400) };
  }
}

/** Body for an auto-opened review PR: task context + the captured gate evidence. */
function pullRequestBody(task, evidence) {
  return [
    task && task.body ? task.body : "(no task body)",
    task && task.acceptanceCriteria ? `\n## Acceptance criteria\n${task.acceptanceCriteria}` : "",
    "\n## Autonomy review gate",
    evidence || "(no evidence captured)",
    "\nOpened automatically by the CEO Studio autonomy runner (merge-manager). Merging is gated on review + CI; do not auto-merge without a green gate.",
  ].filter(Boolean).join("\n");
}

/**
 * Post a milestone work-event into a board's team-log channel (the room a
 * channel maps to). Best-effort and side-effect-only: the team log is a
 * convenience surface, never a gate, so failures must never break a cycle.
 */
function defaultPostWork({ projectPath, board, speaker, body }) {
  try {
    return meetings.post({ projectPath, room: meetings.boardRoom(board), speaker: speaker || "worker", body });
  } catch { return { ok: false }; }
}

const REAL_DEPS = {
  hermes,
  org,
  registry,
  autonomyLoop,
  selfRepair,
  standups,
  unblocker,
  briefRuns,
  isAlive: _isAlive,
  terminateWorker: defaultTerminateWorker,
  spawnWorker: defaultSpawnWorker,
  readLogTail: defaultReadLogTail,
  verify: defaultVerify,
  resolveBaselineRef: defaultResolveBaselineRef,
  prepareReviewBranch: defaultPrepareReviewBranch,
  mergeBranch: defaultMergeBranch,
  branchAhead: defaultBranchAhead,
  pushReviewBranch: defaultPushReviewBranch,
  openPullRequest: defaultOpenPullRequest,
  pullRequestStatus: defaultPullRequestStatus,
  cleanupWorktree: defaultCleanupWorktree,
  postWork: defaultPostWork,
};

/** Safely emit one milestone to the team-log channel (never throws). */
function logWork(deps, projectPath, board, speaker, body) {
  try { if (deps.postWork) deps.postWork({ projectPath, board, speaker, body }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSwarmRoster(workers = [], { board, taskId } = {}) {
  const others = workers.filter((w) => !(w.board === board && w.taskId === taskId));
  if (!others.length) return "You are currently the only active worker in the swarm.";
  return others.map((w) => `- ${w.agentId} (Devin ${w.model}) is working on ${w.board}/${w.taskId}${w.title ? ` — "${w.title}"` : ""}`).join("\n");
}

function buildPromptComments(comments = []) {
  const rows = (Array.isArray(comments) ? comments : [])
    .filter((c) => c && String(c.body || "").trim())
    .slice(0, 8)
    .map((c) => {
      const author = String(c.author || "unknown").trim();
      const body = String(c.body || "").trim().slice(0, 1200);
      return `### ${author}\n${body}`;
    });
  return rows.length ? rows.join("\n\n") : "No recent Kanban comments were loaded with this dispatch.";
}

function buildWorkerPrompt({ task, agent, board, projectPath, persona, swarm = [], branch, projectSlug, comments = [] }) {
  const accept = task.acceptanceCriteria || "";
  const roster = buildSwarmRoster(swarm, { board, taskId: task.id });
  const promptComments = buildPromptComments(comments);
  const sharedWorkLogPath = path.join(brainDir(projectSlug || "ceo-studio"), "autonomy", "shared-work-log.md");
  const projectName = path.basename(projectPath || "the active project");
  return [
    `You are "${agent.id}" (persona: ${persona || agent.persona || agent.id}), one agent in a multi-agent swarm that is autonomously building and self-repairing the active project: ${projectName}. CEO Studio is the cockpit and orchestration layer driving this work.`,
    "",
    "## Workspace isolation (critical)",
    `Your current working directory is an ISOLATED git worktree of ${projectName}${branch ? `, checked out on branch \`${branch}\`` : ""}. Work ONLY here. Do NOT \`cd\` to any other directory or absolute repo path, do NOT switch branches, and do NOT touch the main checkout — other swarm workers are running in their own worktrees in parallel and you must not collide with them. Commit your work on the current branch.`,
    "",
    `Hermes Kanban board: ${board}`,
    `Task id: ${task.id}`,
    `Task title: ${task.title}`,
    "",
    "## Task body",
    task.body || "(no body provided)",
    accept ? `\n## Acceptance criteria\n${accept}` : "",
    "",
    "## Recent Kanban comments and evidence",
    promptComments,
    "",
    "## Your swarm (A2A — stay aware of each other)",
    roster,
    "",
    "## A2A coordination (mandatory — this is how the swarm stays coherent)",
    "- You have the `hermes` MCP server (Kanban). BEFORE you start, use it to read the live board and the comments on your task and on sibling tasks, so you know what other agents are doing and avoid conflicting or duplicate work.",
    "- POST progress as Kanban comments on your task as you go (plan, key decisions, files you're touching, blockers). Other agents and the orchestrator read these — it is your shared communication channel.",
    "- If your work overlaps or conflicts with another active task, coordinate by commenting on the relevant task rather than stepping on it. Prefer narrow, non-overlapping changes.",
    "- Use the `gbrain` MCP tools for durable, cross-session memory: recall relevant prior context first, and record durable learnings/decisions when done.",
    "",
    "## Shared Work Log (mandatory visibility)",
    `- Shared work log path: ${sharedWorkLogPath}`,
    "- You MUST append to this log on every significant action (START, PROGRESS, DECISION, BLOCKER, COMPLETE, ERROR).",
    "- Format: [TIMESTAMP] [AGENT] [TASK_ID] [ACTIVITY_TYPE] Message",
    "- Use ISO 8601 timestamps in UTC.",
    "- This is the single source of truth for swarm activity — all agents must append here.",
    "- Before starting work: append START entry with your plan.",
    "- During work: append PROGRESS entries every 10-15 minutes or at milestones.",
    "- On decisions: append DECISION entry with rationale.",
    "- On blockers: append BLOCKER entry with what's needed.",
    "- On completion: append COMPLETE entry with summary.",
    "- On errors: append ERROR entry with details and impact.",
    "",
    "## Operating contract (mandatory)",
    "- Work ONLY in this repo. Make the smallest correct change that satisfies the task.",
    "- Do NOT mock to pass tests. Implement real functionality. Be honest about real vs planned vs mocked.",
    "- Respect AGENTS.md: the conversational CEO is the Hermes relay — never wire keyed OpenAI/Anthropic as the CEO.",
    "- Run `npm run check` and `npm test` before you finish. Fix what you break.",
    "- If you change behavior/architecture/docs, do the docs handoff (update authoritative docs, then `npm run docs:check`).",
    "- Commit every file change with a focused git commit explaining the why.",
    "- When finished, post a Kanban comment AND print a short summary: what changed, the commit hash(es), and the verification output.",
    "",
    "Begin now. If the task is ambiguous or blocked by something outside the repo, say so explicitly (in a Kanban comment) instead of guessing.",
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

// ---------------------------------------------------------------------------
// Lock (no overlapping cycles per project)
// ---------------------------------------------------------------------------

function acquireLock(slug, { isAlive = _isAlive, now = new Date() } = {}) {
  const lock = readJson(lockPath(slug), null);
  if (lock && lock.pid && isAlive(lock.pid) && lock.pid !== process.pid) {
    return { ok: false, reason: `another runner cycle is active (pid ${lock.pid})` };
  }
  writeJson(lockPath(slug), { pid: process.pid, at: now.toISOString() });
  return { ok: true };
}
function releaseLock(slug) { try { fs.unlinkSync(lockPath(slug)); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

function laneTasks(boardData, lane) {
  return ((boardData && boardData.columns && boardData.columns[lane]) || []);
}

function sameWorkspace(left, right) {
  if (!left || !right) return false;
  try {
    return path.resolve(String(left)) === path.resolve(String(right));
  } catch {
    return false;
  }
}

function resolveBoards(deps, policy, { projectSlug, projectPath } = {}) {
  if (policy.boards !== "all") return policy.boards;
  try {
    const boards = deps.hermes.listBoards() || [];
    const owned = boards
      .filter((board) => board && board.slug && sameWorkspace(board.default_workdir, projectPath))
      .map((board) => board.slug);
    if (owned.length) return owned;
    return boards
      .filter((board) => board && board.slug === projectSlug)
      .map((board) => board.slug);
  } catch { return []; }
}

function resolveAgent(deps, projectPath, assigneeId) {
  try {
    const reg = deps.registry.read(projectPath);
    return (reg.agents || []).find((a) => a.id === assigneeId) || null;
  } catch { return null; }
}

function recordBoardReadFailure(errors, board, boardData, phase = "getBoard") {
  if (!boardData || boardData.ok !== false) return false;
  errors.push({
    phase,
    board,
    error: boardData.reason || "Hermes board read failed",
  });
  return true;
}

function documentGate(deps, { projectSlug, board, task } = {}) {
  if (!deps.briefRuns || !deps.briefRuns.planningGate) {
    return { ok: true, allowed: true, reason: "document gate unavailable" };
  }
  let fullTask = task;
  if (task && task.id && deps.hermes && deps.hermes.getTask && (!task.body || !String(task.body).trim())) {
    try {
      const detail = deps.hermes.getTask(board, task.id);
      if (detail && detail.ok && detail.task) fullTask = { ...task, ...detail.task };
    } catch { /* summary task is still better than crashing the cycle */ }
  }
  const gate = deps.briefRuns.planningGate({ projectSlug, board, task: fullTask });
  return gate && typeof gate === "object" ? { task: fullTask, ...gate } : gate;
}

// Human-required gate. Some tasks can NEVER be verified by a headless `devin -p`
// worker (a real phone call, two-way device audio, on-device Siri/App-Intents,
// a manual dogfood pass, browser/device E2E). Dispatching a paid worker to them
// guarantees a failing gate, which then files a repair task, which fails the same
// way — the self-repair $-spiral. A task is human-required if its id is listed in
// `policy.humanRequiredTaskIds` or it carries an explicit `[human-required]`
// marker in its title/body/acceptance. The EXECUTE phase skips these (never
// dispatches), so they never enter the failure→repair loop.
const HUMAN_REQUIRED_MARKER = /\[human-required\]/i;
function isHumanRequired(task, policy) {
  if (!task) return false;
  const ids = policy && Array.isArray(policy.humanRequiredTaskIds) ? policy.humanRequiredTaskIds : [];
  if (ids.includes(String(task.id))) return true;
  return HUMAN_REQUIRED_MARKER.test(`${task.title || ""}\n${task.body || ""}\n${task.acceptanceCriteria || ""}`);
}

function blockDirtyBrief(deps, { board, task, gate, phase } = {}) {
  const taskId = task && task.id;
  if (!taskId) return;
  deps.hermes.addComment({
    board,
    taskId,
    author: "autonomy-runner/document-gate",
    body: gate.comment || "Document validation failed; returning this item to planning before autonomous work can continue.",
  });
  deps.hermes.setTaskStatus({
    board,
    taskId,
    status: "planning",
    reason: `document validation gate blocked ${phase || "autonomy"}`,
  });
}

function reviewFailureOutput(failTail, reviewInfo) {
  const lines = [];
  if (reviewInfo && (reviewInfo.branch || reviewInfo.worktree || reviewInfo.agentId)) {
    lines.push("### Failed worker branch context");
    if (reviewInfo.branch) lines.push(`- Branch: ${reviewInfo.branch}`);
    if (reviewInfo.worktree) lines.push(`- Worktree: ${reviewInfo.worktree}`);
    if (reviewInfo.agentId) lines.push(`- Agent: ${reviewInfo.agentId}`);
    lines.push("- Repair worker instruction: inspect or cherry-pick the failed branch/worktree before fixing the remaining gate failures, so previous repair work is not lost.");
    lines.push("");
  }
  if (failTail) lines.push(failTail);
  return lines.join("\n");
}

function assessWorkerCompletion(task = {}, output = "") {
  const contract = `${task.title || ""}\n${task.body || ""}`.toLowerCase();
  const requiresBrowserE2e = /(e2e|end-to-end)/.test(contract)
    && /(playwright|chrome devtools|browser automation|two contexts)/.test(contract);
  if (!requiresBrowserE2e) return { ok: true };

  const log = String(output || "").replace(/\u001b\[[0-9;]*m/g, "").toLowerCase();
  const requiresTwoContexts = /(two|separate) (?:browser )?contexts?|recruiter and recipient (?:browser )?contexts?/.test(contract);
  const explicitlyNotRun = /(would require|not (?:present|available|run|executed)|code inspection|test structure|structural e2e|unable to run|could not run)/.test(log);
  const substitutedApiCoverage = /(api-level validation instead of ui automation|api[- ]only|endpoint exists|mock invite id|accept(?:ed|ing)? (?:a )?(?:401|403|404))/.test(log);
  const actualBrowserEvidence = [
    /(?:npx\s+)?playwright(?:\s+test)?[\s\S]{0,240}(?:\b\d+\s+passed\b|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)/,
    /chrome devtools[\s\S]{0,240}(?:verified|passed|completed)/,
    /two (?:browser )?contexts?[\s\S]{0,240}(?:verified|passed|joined|completed)/,
  ].some((pattern) => pattern.test(log));
  const contextEvidence = !requiresTwoContexts || [
    /(?:two|separate) (?:browser )?contexts?[\s\S]{0,240}(?:verified|passed|joined|completed|exercised)/,
    /recruiter and recipient (?:browser )?contexts?[\s\S]{0,240}(?:verified|passed|joined|completed|exercised)/,
  ].some((pattern) => pattern.test(log));

  if (explicitlyNotRun || substitutedApiCoverage || !actualBrowserEvidence || !contextEvidence) {
    return {
      ok: false,
      reason: "required browser E2E evidence is missing; the worker reported structure, API-only, or incomplete context coverage instead of the executed Playwright or Chrome DevTools flow",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Repair-chain cap — the guard that stops the self-repair $-spiral.
//
// Every acceptance/integration/test-gate failure can file a repair task that is
// dispatched to a fresh paid Devin worker. If that repair task ALSO fails
// (classically: an unsatisfiable browser-E2E gate that no headless `devin -p`
// worker can pass), the naive behaviour files yet another repair task with a
// new id, forever — `t_fb6de5bf -> t_7ed4c3d5 -> t_b16016a0 -> ...`. We tag
// each auto-generated repair task with its "generation" in `state.repairChains`
// and, once a failing task is already at policy.maxRepairGenerations, escalate
// it to a human/CEO decision (leave it blocked) instead of spending on yet
// another worker.
// ---------------------------------------------------------------------------
function repairGeneration(state, taskId) {
  return (state && state.repairChains && state.repairChains[String(taskId)]) || 0;
}
function recordRepairChild(state, childTaskId, generation) {
  if (!state || !childTaskId) return;
  state.repairChains = state.repairChains || {};
  state.repairChains[String(childTaskId)] = generation;
}
function repairCapReached(state, policy, failingTaskId) {
  const cap = policy && Number.isFinite(policy.maxRepairGenerations) ? policy.maxRepairGenerations : 1;
  return repairGeneration(state, failingTaskId) >= cap;
}

function hasTrackedWorker(workers, board, taskId) {
  return workers.some((w) => w.board === board && w.taskId === taskId);
}

function isAlreadyReapedStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return !!s && s !== "running";
}

function isStaleRunningTask(task, workers, board) {
  if (!task || task.status !== "running") return false;
  if (hasTrackedWorker(workers, board, task.id)) return false;
  if (task.workerAlive === false) return true;
  return !task.worker_pid && !task.current_run_id;
}

function inTargetSet(policy, task) {
  const targets = policy && Array.isArray(policy.targetTaskIds) ? policy.targetTaskIds : [];
  if (!targets.length) return true;
  return task && targets.includes(String(task.id));
}

function reviewCandidates(boardData, board, policy, state) {
  const review = [...laneTasks(boardData, "review")];
  const targets = policy && Array.isArray(policy.targetTaskIds) ? policy.targetTaskIds : [];
  if (!targets.length) return review;
  const seen = new Set(review.map((task) => String(task.id)));
  for (const task of laneTasks(boardData, "blocked")) {
    const taskId = String(task && task.id || "");
    if (!taskId || seen.has(taskId) || !targets.includes(taskId)) continue;
    if (!state.reviews || !state.reviews[`${board}:${taskId}`]) continue;
    review.push(task);
    seen.add(taskId);
  }
  return review;
}

function verificationEvidence(results = []) {
  return results.map((result) => {
    const state = result.skipped ? "SKIP" : result.baselineFailure ? "BASELINE" : result.ok ? "PASS" : "FAIL";
    const reason = result.reason ? ` — ${result.reason}` : "";
    return `- ${state} \`${result.cmd}\`${reason}`;
  }).join("\n");
}

/**
 * Run a single autonomy cycle. Returns a structured run record.
 */
function runCycle({ projectSlug, projectPath, force = false, now = new Date(), deps: depsIn, policy: policyOverride } = {}) {
  if (!projectSlug) return { ok: false, reason: "project slug required" };
  const deps = { ...REAL_DEPS, ...(depsIn || {}) };
  const policy = normalizePolicy({ ...getPolicy(projectSlug), ...(policyOverride || {}) });

  if (!force && !policy.enabled) {
    return { ok: true, skipped: true, reason: "autonomy runner disabled", policy };
  }

  const lock = acquireLock(projectSlug, { isAlive: deps.isAlive, now });
  if (!lock.ok) return { ok: true, skipped: true, reason: lock.reason, policy };

  const startedAt = now.toISOString();
  const errors = [];
  const phases = {
    gateway: null,
    standups: null,
    goals: null,
    unblock: [],
    reap: [],
    research: [],
    staleRunning: [],
    plan: [],
    assign: [],
    execute: [],
    review: [],
  };
  const state = getState(projectSlug);
  state.decomposed = state.decomposed || {};
  let workers = getWorkers(projectSlug);

  const safe = (name, fn) => {
    try { return fn(); } catch (e) {
      errors.push({ phase: name, error: String(e && e.message || e) });
      return null;
    }
  };

  try {
    // 1. Gateway up
    phases.gateway = safe("gateway", () => deps.hermes.ensureUp());

    const boards = resolveBoards(deps, policy, { projectSlug, projectPath });
    const hasTargetTasks = policy.targetTaskIds.length > 0;

    // 2. Daily cadence. A standup needs both an enabled standup policy and an
    // enabled runner policy. It remains proposal-only and never receives paid
    // provider permission. Targeted task cycles skip unrelated cadence work.
    phases.standups = (!policy.allowStandups || hasTargetTasks)
      ? {
        ok: true,
        skipped: hasTargetTasks ? "targeted-task-cycle" : "disabled",
        reconcile: null,
        due: null,
      }
      : {
        ok: true,
        reconcile: safe("standups:reconcile", () => deps.standups.reconcile({
          projectSlug,
          projectPath,
          dryRun: policy.dryRun,
        })),
        due: safe("standups:due", () => deps.standups.runDue({
          projectSlug,
          projectPath,
          now,
          dryRun: policy.dryRun,
          limit: policy.maxStandupsPerCycle,
        })),
      };

    // 3. Reap finished workers (move running -> review, post their output).
    //    Agent lifecycle management is higher priority than portfolio analysis:
    //    a slow goal-review dependency must never leave completed workers stuck
    //    in running or prevent their review metadata from being recovered.
    //    Never in dry-run: reaping mutates the board AND worker tracking, so a
    //    dry-run must leave workers untouched for a real cycle to reap.
    if (!policy.staleWorkerSkipReap && !policy.dryRun) {
      const stillRunning = [];
      for (const w of workers) {
        const alive = deps.isAlive(w.pid);
        const startedMs = Date.parse(String(w.startedAt || ""));
        const timedOut = alive
          && Number.isFinite(startedMs)
          && (now.getTime() - startedMs) >= policy.workerTimeoutMinutes * 60 * 1000;
        if (alive && !timedOut) { stillRunning.push(w); continue; }
        if (timedOut) safe("terminate-worker", () => deps.terminateWorker(w.pid));
        safe("reap", () => {
          const tail = deps.readLogTail(w.logPath);
          const detail = deps.hermes.getTask ? deps.hermes.getTask(w.board, w.taskId) : null;
          const completion = timedOut
            ? { ok: false, reason: `worker exceeded the ${policy.workerTimeoutMinutes}-minute timeout and was terminated` }
            : assessWorkerCompletion(detail && detail.task || {}, tail);
          const workerErrored = timedOut || /\[devin error|Unknown model|error rc=|Traceback/i.test(tail);
          const failed = workerErrored || !completion.ok;
          const currentStatus = detail && detail.ok && detail.task && detail.task.status;
          const alreadyReaped = isAlreadyReapedStatus(currentStatus);
          if (!policy.dryRun) {
            if (alreadyReaped) {
              // A prior app/process may have mutated the board and then died
              // before workers.json was saved. Reaping must be idempotent: do
              // not post duplicate "finished" comments, but do restore the
              // review handoff metadata and drop the stale tracker.
              if (String(currentStatus).toLowerCase() === "review" && w.branch) {
                state.reviews = state.reviews || {};
                state.reviews[`${w.board}:${w.taskId}`] = { worktree: w.worktree, branch: w.branch, baseCommit: w.baseCommit || null, agentId: w.agentId };
              }
            } else {
              deps.hermes.addComment({
                board: w.board, taskId: w.taskId, author: `autonomy-runner/${w.agentId}`,
                body: `Devin worker (${w.model}) ${timedOut ? "timed out and was terminated" : "finished"} (pid ${w.pid}).${w.branch ? ` Work is on branch \`${w.branch}\`.` : ""}${completion.ok ? "" : `\n\nAcceptance evidence gate: ${completion.reason}`}\n\n\`\`\`\n${tail.slice(-3000)}\n\`\`\``,
              });
              deps.hermes.setTaskStatus({
                board: w.board, taskId: w.taskId,
                status: failed ? "blocked" : "review",
                reason: failed
                  ? (timedOut ? completion.reason : (workerErrored ? "devin worker reported an error" : completion.reason))
                  : "worker done; awaiting review/test gate",
              });
              // Hand the worktree/branch to the review/test gate.
              if (!failed && w.branch) {
                state.reviews = state.reviews || {};
                state.reviews[`${w.board}:${w.taskId}`] = { worktree: w.worktree, branch: w.branch, baseCommit: w.baseCommit || null, agentId: w.agentId };
              }
              if (!completion.ok) {
                const key = `${w.board}:${w.taskId}`;
                state.completionRepairs = state.completionRepairs || {};
                if (!state.completionRepairs[key] && repairCapReached(state, policy, w.taskId)) {
                  // Repair-chain cap hit: the task is already blocked above; do
                  // NOT spawn yet another paid repair worker on an unsatisfiable
                  // gate. Escalate to a human/CEO decision instead.
                  deps.hermes.addComment({
                    board: w.board, taskId: w.taskId, author: "autonomy-runner/repair-cap",
                    body: `Acceptance evidence gate still failing after ${repairGeneration(state, w.taskId)} automated repair attempt(s). This is almost certainly an environment/credentials blocker (no real browser/auth is available to a headless \`devin -p\` worker), not a code defect another worker can fix. Escalating to a human/CEO decision instead of dispatching more paid workers; leaving this task blocked.`,
                  });
                  state.completionRepairs[key] = {
                    createdAt: new Date().toISOString(),
                    escalated: true,
                    generation: repairGeneration(state, w.taskId),
                    branch: w.branch || null,
                  };
                } else if (!state.completionRepairs[key]) {
                  const evidence = reviewFailureOutput([
                    `### Acceptance evidence gate`,
                    completion.reason,
                    "",
                    "### Required repair outcome",
                    "- Run an actual Playwright or Chrome DevTools browser flow; unit, REST, code-inspection, placeholder, and auth-setup-only results do not satisfy this gate.",
                    "- Exercise separate recruiter and recipient browser contexts for both direct-call and screening-invite paths.",
                    "- Verify the recipient link, both participants joining, transcript completion, contact/graph association, and transcript viewer retrieval.",
                    "- Record the exact browser command or DevTools scenario, named scenarios, pass count, and report/trace paths in the completion output.",
                    "- If authentication, services, credentials, or environment setup prevent execution, report the concrete blocker and failing command. Do not redefine the acceptance criteria or claim structural coverage is E2E.",
                    "",
                    "### Worker completion output",
                    "```",
                    tail.slice(-3500),
                    "```",
                  ].join("\n"), w);
                  const filed = safe("reap-completion-selfrepair", () => deps.selfRepair.reportSystemBug({
                    board: w.board,
                    source: "autonomy worker acceptance gate",
                    title: `[Self-QA] Acceptance evidence incomplete for ${w.taskId}`,
                    observedBehavior: `Worker ${w.agentId} completed task ${w.taskId}, but required executable browser evidence was missing.`,
                    output: evidence.slice(0, 5000),
                    severity: "high",
                    createRepairTask: true,
                    workspace: projectPath,
                  }, { projectSlug, projectPath }));
                  const repairTaskId = filed && filed.repairTask && filed.repairTask.task && filed.repairTask.task.taskId || null;
                  recordRepairChild(state, repairTaskId, repairGeneration(state, w.taskId) + 1);
                  state.completionRepairs[key] = {
                    createdAt: new Date().toISOString(),
                    bugTaskId: filed && filed.bug && filed.bug.task && filed.bug.task.taskId || null,
                    repairTaskId,
                    branch: w.branch || null,
                  };
                }
              }
            }
          }
          phases.reap.push({
            board: w.board,
            taskId: w.taskId,
            agentId: w.agentId,
            branch: w.branch || null,
            outcome: alreadyReaped
              ? `already-${currentStatus}`
              : (timedOut ? "timed-out" : (!completion.ok ? "blocked-acceptance-evidence" : (failed ? "blocked" : "review"))),
          });
          if (!alreadyReaped) {
            logWork(deps, projectPath, w.board, w.agentId, failed
              ? `✗ hit an error on \`${w.board}/${w.taskId}\` — see the board log`
              : `✓ finished \`${w.board}/${w.taskId}\`${w.branch ? ` on branch \`${w.branch}\`` : ""}; awaiting review`);
          }
        });
      }
      workers = stillRunning;
      // Reaping is a durable lifecycle transition, not an in-memory prelude to
      // review. Checkpoint immediately so an Electron restart during a long
      // test gate does not resurrect finished workers and repeat their handoff.
      saveWorkers(projectSlug, workers);
      saveState(projectSlug, state);
    }

    // 4. Goal review + blocked analysis (delegated). Use the first board as the
    //    primary lens; goal layers are project-wide. An explicitly targeted
    //    cycle is an operational agent-management pass, so it must not wait on
    //    unrelated portfolio analysis before reviewing or repairing its tasks.
    phases.goals = policy.dryRun
      ? { ok: true, skipped: "dry-run" }
      : (!policy.allowGoalReview || hasTargetTasks)
        ? { ok: true, skipped: hasTargetTasks ? "targeted-task-cycle" : "disabled" }
        : safe("goals", () => deps.autonomyLoop.runCycle({
          projectSlug,
          projectPath,
          board: boards[0] || null,
          domain: policy.domain,
          force: true, // we own cooldown at the runner level
          now,
        }));

    // 5. UNBLOCK — blocked is an active escalation queue, not a parking lot.
    //    Hermes remains the board ledger; CEO Studio owns the richer unblock
    //    state in its board overlay.
    if (policy.allowUnblocker) {
      for (const board of boards) {
        safe("unblock", () => {
          const r = deps.unblocker.run({
            projectSlug,
            projectPath,
            board,
            domain: policy.domain,
            dryRun: policy.dryRun,
            limit: policy.maxBlockedUnblocksPerCycle,
          });
          phases.unblock.push(r);
        });
      }
    }

    let spawnedThisCycle = 0;
    const dispatchCap = policy.maxDispatchPerCycle > 0 ? policy.maxDispatchPerCycle : Infinity;
    const concCap = policy.maxConcurrentWorkers > 0 ? policy.maxConcurrentWorkers : Infinity;

    for (const board of boards) {
      const isProtected = policy.protectedBoards.includes(board);
      const boardData = safe("getBoard", () => deps.hermes.getBoard(board));
      if (!boardData || recordBoardReadFailure(errors, board, boardData, "plan/assign:getBoard")) continue;
      let triagedThisBoard = 0;

      // 4. RESEARCH/TRIAGE — raw intake should not sit forever waiting for a
      // human operator. Ask Hermes to specify it, then promote it toward the
      // planning/decomposition lane. This is the app doing the initial research
      // and normalization work through the CEO control plane.
      if (policy.allowTriage && !(isProtected && policy.protectDecomposeOnProtected)) {
        state.triaged = state.triaged || {};
        for (const lane of policy.triageLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (!inTargetSet(policy, t)) continue;
            if (triagedThisBoard >= policy.maxTriagePerCycle) break;
            const key = `${board}:${t.id}`;
            if (state.triaged[key]) continue;
            safe("research", () => {
              let specify = null;
              let promote = null;
              if (!policy.dryRun) {
                specify = deps.hermes.taskAction({
                  board,
                  taskId: t.id,
                  action: "specify",
                  reason: "autonomy runner researched raw triage intake",
                });
                if (specify && specify.ok) {
                  promote = deps.hermes.taskAction({
                    board,
                    taskId: t.id,
                    action: "promote",
                    reason: "specified by autonomy runner; ready for planning/decomposition",
                  });
                  state.triaged[key] = startedAt;
                }
              }
              phases.research.push({
                board,
                taskId: t.id,
                title: t.title,
                lane,
                dryRun: policy.dryRun,
                would: "specify intake with Hermes, then promote toward planning",
                specifyOk: specify ? !!specify.ok : undefined,
                promoteOk: promote ? !!promote.ok : undefined,
              });
              triagedThisBoard += 1;
            });
          }
        }
      }

      // 5. CLEANUP — a card in running with no live worker is not progress. If
      // the runner does not own a tracked worker for it, make the stale state
      // visible and block it for repair/re-dispatch instead of pretending the
      // swarm is active.
      if (policy.allowStaleRunningCleanup) {
        for (const t of laneTasks(boardData, "running")) {
          if (!inTargetSet(policy, t)) continue;
          if (!isStaleRunningTask(t, workers, board)) continue;
          safe("stale-running", () => {
            if (!policy.dryRun) {
              deps.hermes.addComment({
                board,
                taskId: t.id,
                author: "autonomy-runner/stale-worker-audit",
                body: "This card was in `running`, but CEO Studio found no live or tracked worker for it. Moving it to `blocked` so the orchestrator can repair, re-scope, or re-dispatch from visible board state.",
              });
              deps.hermes.setTaskStatus({
                board,
                taskId: t.id,
                status: "blocked",
                reason: "running task has no live/tracked worker",
              });
            }
            phases.staleRunning.push({
              board,
              taskId: t.id,
              title: t.title,
              dryRun: policy.dryRun,
              outcome: policy.dryRun ? "would-block-stale-running" : "blocked-stale-running",
            });
          });
        }
      }

      // 6. PLAN — decompose planning-lane briefs (skip protected boards if configured)
      if (policy.allowDecompose && !(isProtected && policy.protectDecomposeOnProtected)) {
        for (const lane of policy.decomposeLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (!inTargetSet(policy, t)) continue;
            const key = `${board}:${t.id}`;
            if (state.decomposed[key]) continue;
            safe("plan", () => {
              const gate = documentGate(deps, { projectSlug, board, task: t });
              if (gate && gate.ok && gate.allowed === false) {
                if (!policy.dryRun) blockDirtyBrief(deps, { board, task: t, gate, phase: "decomposition" });
                phases.plan.push({
                  board,
                  taskId: t.id,
                  title: t.title,
                  dryRun: policy.dryRun,
                  blocked: "document-validation",
                  reason: gate.reason,
                  missing: gate.validation && gate.validation.missing,
                });
                return;
              }
              if (gate && gate.ok === false) {
                phases.plan.push({ board, taskId: t.id, title: t.title, dryRun: policy.dryRun, skipped: gate.reason || "document gate failed" });
                return;
              }
              if (!policy.dryRun) {
                const r = deps.hermes.taskAction({ board, taskId: t.id, action: "decompose" });
                if (r && r.ok) state.decomposed[key] = startedAt;
              }
              phases.plan.push({ board, taskId: t.id, title: t.title, dryRun: policy.dryRun });
            });
          }
        }
      }

      // 5. ASSIGN — route unassigned actionable work to the owning registry agent
      if (policy.allowAssign) {
        for (const lane of policy.assignLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (!inTargetSet(policy, t)) continue;
            if (t.assignee) continue;
            safe("assign", () => {
              const routed = deps.org.route(projectPath, { domain: policy.domain, status: lane, kind: "task" });
              const assignee = routed && routed.assignee;
              if (!assignee) { phases.assign.push({ board, taskId: t.id, skipped: "no routed assignee" }); return; }
              if (!policy.dryRun) deps.hermes.assignTask({ board, taskId: t.id, assignee });
              phases.assign.push({ board, taskId: t.id, lane, assignee, team: routed.team, dryRun: policy.dryRun });
            });
          }
        }
      }
    }

    // 6. EXECUTE — capped, real Devin workers on ready work (across boards)
    if (policy.execute && !policy.dryRun) {
      for (const board of boards) {
        if (spawnedThisCycle >= dispatchCap) break;
        if (workers.length >= concCap) break;
        const boardData = safe("getBoard", () => deps.hermes.getBoard(board));
        if (!boardData || recordBoardReadFailure(errors, board, boardData, "execute:getBoard")) continue;
        for (const lane of policy.executeLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (!inTargetSet(policy, t)) continue;
            if (isHumanRequired(t, policy)) {
              // Never dispatch a paid worker to a task it cannot possibly verify
              // — that is the head of the self-repair $-spiral. Escalate once
              // (comment), then keep skipping it cheaply every cycle. Leave it in
              // its lane (NOT blocked) so the unblocker never picks it up either.
              const hkey = `${board}:${t.id}`;
              state.humanRequired = state.humanRequired || {};
              if (!state.humanRequired[hkey]) {
                safe("human-required", () => deps.hermes.addComment({ board, taskId: t.id, author: "autonomy-runner/human-gate",
                  body: "Marked **human-required**: a headless `devin -p` worker cannot verify this (real call / two-way device audio / on-device Siri / manual dogfood / device E2E). Auto-dispatch is DISABLED so it never starts a failure→repair spiral — a human must drive it. Remove it from `policy.humanRequiredTaskIds` or drop the `[human-required]` marker to re-enable automation." }));
                state.humanRequired[hkey] = { escalatedAt: new Date().toISOString() };
                saveState(projectSlug, state);
              }
              phases.execute.push({ board, taskId: t.id, skipped: "human-required" });
              continue;
            }
            if (spawnedThisCycle >= dispatchCap) break;
            if (workers.length >= concCap) break;
            const gate = documentGate(deps, { projectSlug, board, task: t });
            if (gate && gate.ok && gate.allowed === false) {
              safe("execute-document-gate", () => blockDirtyBrief(deps, { board, task: t, gate, phase: "dispatch" }));
              phases.execute.push({
                board,
                taskId: t.id,
                blocked: "document-validation",
                reason: gate.reason,
                missing: gate.validation && gate.validation.missing,
              });
              continue;
            }
            if (gate && gate.ok === false) {
              phases.execute.push({ board, taskId: t.id, skipped: gate.reason || "document gate failed" });
              continue;
            }
            if (!t.assignee) continue;
            if (workers.some((w) => w.board === board && w.taskId === t.id)) continue;
            const agent = resolveAgent(deps, projectPath, t.assignee);
            if (!agent || agent.provider !== "devin") {
              phases.execute.push({ board, taskId: t.id, skipped: `assignee ${t.assignee} is not a devin worker` });
              continue;
            }
            safe("execute", () => {
              const detail = deps.hermes.getTask(board, t.id);
              const full = (detail && detail.ok && detail.task) || t;
              const comments = (detail && detail.ok && Array.isArray(detail.comments)) ? detail.comments : [];
              // Swarm-aware: pass the live roster (incl. this new task) so the
              // worker knows who its siblings are. Append self first so the
              // roster reflects current intent.
              // modelOverride (when set) forces every worker onto one model,
              // regardless of its registry model — used to route the whole swarm
              // onto a promo/cheap model so paid swe-1.6 credits aren't burned.
              const model = policy.modelOverride || agent.model || policy.model;
              const swarm = [...workers, { board, taskId: t.id, agentId: agent.id, model, title: full.title || t.title }];
              const prompt = buildWorkerPrompt({ task: full, agent, board, projectPath, projectSlug, persona: agent.persona, swarm, branch: branchNameFor(board, t.id), comments });
              const logPath = path.join(workerLogsDir(projectSlug), `${board}-${t.id}-${Date.now()}.log`);
              const res = deps.spawnWorker({ projectPath, model, prompt, logPath, board, taskId: t.id, agent, permissionMode: policy.devinPermissionMode });
              if (!res || !res.ok) { phases.execute.push({ board, taskId: t.id, error: (res && res.reason) || "spawn failed" }); return; }
              deps.hermes.setTaskStatus({ board, taskId: t.id, status: "running", reason: `dispatched to Devin ${model} via autonomy runner` });
              deps.hermes.addComment({ board, taskId: t.id, author: `autonomy-runner/${agent.id}`, body: `Dispatched to Devin worker (model ${model}, pid ${res.pid}) on isolated branch \`${res.branch || "(main)"}\`. Coordinate via Kanban comments (A2A).` });
              workers.push({ board, taskId: t.id, agentId: agent.id, model, pid: res.pid, logPath, startedAt, title: full.title || t.title, worktree: res.worktree, branch: res.branch, baseCommit: res.baseCommit || null });
              // Persist the tracker the instant a paid worker exists. If the
              // cycle (or the whole app) dies before the end-of-cycle save, the
              // worker is still durably tracked, so a later cycle can reap and
              // time it out instead of leaking a runaway process indefinitely.
              saveWorkers(projectSlug, workers);
              spawnedThisCycle += 1;
              phases.execute.push({ board, taskId: t.id, agentId: agent.id, model, pid: res.pid });
              logWork(deps, projectPath, board, agent.id,
                `▶ started \`${board}/${t.id}\` — "${full.title || t.title}" (Devin ${model})`);
            });
          }
        }
      }
      // Publish the durable swarm roster so every agent + the cockpit can see
      // who is active (A2A awareness substrate, alongside Kanban comments).
      safe("swarm-roster", () => writeJson(path.join(runnerDir(projectSlug), "swarm.json"), {
        updatedAt: new Date().toISOString(),
        workers: workers.map((w) => ({ board: w.board, taskId: w.taskId, agentId: w.agentId, model: w.model, title: w.title || null, pid: w.pid })),
      }));
    } else if (policy.execute && policy.dryRun) {
      for (const board of boards) {
        const boardData = safe("getBoard", () => deps.hermes.getBoard(board));
        if (!boardData || recordBoardReadFailure(errors, board, boardData, "execute-dry-run:getBoard")) continue;
        for (const lane of policy.executeLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (!inTargetSet(policy, t)) continue;
            if (isHumanRequired(t, policy)) { phases.execute.push({ board, taskId: t.id, skipped: "human-required", dryRun: true }); continue; }
            const gate = documentGate(deps, { projectSlug, board, task: t });
            if (gate && gate.ok && gate.allowed === false) {
              phases.execute.push({
                board,
                taskId: t.id,
                blocked: "document-validation",
                dryRun: true,
                reason: gate.reason,
                missing: gate.validation && gate.validation.missing,
              });
              continue;
            }
            if (gate && gate.ok === false) {
              phases.execute.push({ board, taskId: t.id, skipped: gate.reason || "document gate failed", dryRun: true });
              continue;
            }
            if (t.assignee) phases.execute.push({ board, taskId: t.id, assignee: t.assignee, dryRun: true, would: "spawn devin worker" });
          }
        }
      }
    }

    // 7. REVIEW — strong test gate. Each reviewed task is verified in its own
    //    worktree (the exact code the worker produced), and only fast-forward-
    //    merged into the main checkout when its tests pass. Nothing reaches Done
    //    without passing verification; failures block + file a self-repair bug.
    if (policy.allowReviewGate) {
      state.reviews = state.reviews || {};
      for (const b of boards) {
        const boardData = safe("getBoard", () => deps.hermes.getBoard(b));
        if (!boardData || recordBoardReadFailure(errors, b, boardData, "review:getBoard")) continue;
        for (const t of reviewCandidates(boardData, b, policy, state)) {
          if (!inTargetSet(policy, t)) continue;
          const key = `${b}:${t.id}`;
          const reviewInfo = state.reviews[key] || null;
          safe("review", () => {
            const verifyCwd = (reviewInfo && reviewInfo.worktree) || projectPath;
            if (policy.dryRun) { phases.review.push({ board: b, taskId: t.id, dryRun: true, worktree: verifyCwd }); return; }
            // Merge-manager (PR mode): if a PR was already opened for this task,
            // do NOT re-verify — poll the PR and promote to Done only once it has
            // actually merged (or block it if a human closed it unmerged).
            if (policy.integrationMode === "pr" && state.pullRequests && state.pullRequests[key]) {
              const pr = state.pullRequests[key];
              const prState = (deps.pullRequestStatus ? deps.pullRequestStatus({ projectPath, branch: pr.branch }) : { state: null }) || { state: null };
              if (prState.state === "merged") {
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `PR ${pr.url} merged. Promoting task to Done.` });
                deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "done", reason: `merged via ${pr.url}` });
                if (reviewInfo && reviewInfo.worktree) safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
                delete state.reviews[key];
                delete state.pullRequests[key];
                if (state.integrationRepairs) delete state.integrationRepairs[key];
                saveState(projectSlug, state);
                logWork(deps, projectPath, b, "merge-manager", `✅ \`${b}/${t.id}\` merged via ${pr.url} — Done`);
                phases.review.push({ board: b, taskId: t.id, outcome: "done-via-pr-merge", pr: pr.url });
                return;
              }
              if (prState.state === "closed") {
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `PR ${pr.url} was closed without merging; leaving task blocked for a human decision.` });
                deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: `PR ${pr.url} closed unmerged` });
                delete state.pullRequests[key];
                saveState(projectSlug, state);
                phases.review.push({ board: b, taskId: t.id, outcome: "pr-closed-unmerged", pr: pr.url });
                return;
              }
              // Still open (or status unknown) — under review on GitHub this cycle.
              phases.review.push({ board: b, taskId: t.id, outcome: "pr-open", pr: pr.url });
              return;
            }
            const linkedRepair = (state.integrationRepairs && state.integrationRepairs[key])
              || (state.completionRepairs && state.completionRepairs[key]);
            if (linkedRepair && linkedRepair.repairTaskId && deps.hermes.getTask) {
              const repairDetail = deps.hermes.getTask(b, linkedRepair.repairTaskId);
              const repairStatus = repairDetail && repairDetail.ok && repairDetail.task
                ? String(repairDetail.task.status || "").toLowerCase()
                : "";
              if (repairStatus === "done") {
                deps.hermes.addComment({
                  board: b,
                  taskId: t.id,
                  author: "autonomy-runner/review-gate",
                  body: `Blocked acceptance or integration work was resolved by linked repair task \`${linkedRepair.repairTaskId}\`, which passed its review gate and merged into main. The obsolete pre-repair branch will not be replayed.`,
                });
                deps.hermes.setTaskStatus({
                  board: b,
                  taskId: t.id,
                  status: "done",
                  reason: `resolved by integrated repair ${linkedRepair.repairTaskId}`,
                });
                if (reviewInfo && reviewInfo.worktree) {
                  safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
                }
                delete state.reviews[key];
                if (state.integrationRepairs) delete state.integrationRepairs[key];
                if (state.completionRepairs) delete state.completionRepairs[key];
                phases.review.push({
                  board: b,
                  taskId: t.id,
                  outcome: "done-via-integration-repair",
                  repairTaskId: linkedRepair.repairTaskId,
                });
                return;
              }
            }
            const integration = reviewInfo && deps.prepareReviewBranch
              ? deps.prepareReviewBranch({ projectPath, worktree: reviewInfo.worktree, branch: reviewInfo.branch })
              : { ok: true, rebased: false, baselineRef: null };
            if (integration && integration.ok === false) {
              const integrationEvidence = [
                "### Failed worker branch context",
                `- Branch: ${reviewInfo && reviewInfo.branch || "(unknown)"}`,
                `- Worktree: ${reviewInfo && reviewInfo.worktree || "(unknown)"}`,
                `- Agent: ${reviewInfo && reviewInfo.agentId || "(unknown)"}`,
                "",
                "### Rebase failure",
                "```",
                integration.reason || "unknown integration failure",
                "```",
                "",
                "Repair instruction: preserve the worker's completed feature, resolve it against current main, run the project verification gate, and commit the reconciled result.",
              ].join("\n");
              deps.hermes.addComment({
                board: b,
                taskId: t.id,
                author: "autonomy-runner/review-gate",
                body: `Could not integrate branch \`${reviewInfo && reviewInfo.branch}\` onto the current main branch before verification. The rebase was aborted and the task remains blocked for a focused conflict-resolution worker.\n\n\`\`\`\n${integration.reason || "unknown integration failure"}\n\`\`\``,
              });
              deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: "worker branch needs conflict resolution" });
              state.integrationRepairs = state.integrationRepairs || {};
              let repair = state.integrationRepairs[key] || null;
              if (!repair && repairCapReached(state, policy, t.id)) {
                // Repair-chain cap hit: stop dispatching conflict-resolution
                // workers and escalate to a human/orchestrator merge decision.
                deps.hermes.addComment({
                  board: b, taskId: t.id, author: "autonomy-runner/repair-cap",
                  body: `Worker branch \`${reviewInfo && reviewInfo.branch || "(unknown)"}\` still cannot be integrated after ${repairGeneration(state, t.id)} automated repair attempt(s); escalating to a human/orchestrator merge decision rather than dispatching another repair worker. Task left blocked.`,
                });
                repair = {
                  createdAt: new Date().toISOString(),
                  escalated: true,
                  generation: repairGeneration(state, t.id),
                  branch: reviewInfo && reviewInfo.branch || null,
                };
                state.integrationRepairs[key] = repair;
                saveState(projectSlug, state);
              } else if (!repair) {
                const filed = safe("review-integration-selfrepair", () => deps.selfRepair.reportSystemBug({
                  board: b,
                  source: "autonomy review integration gate",
                  title: `[Self-QA] Integration conflict while reviewing ${t.id}`,
                  observedBehavior: `Worker branch ${reviewInfo && reviewInfo.branch || "(unknown)"} could not be rebased onto current main for task ${t.id} (${t.title}).`,
                  output: integrationEvidence.slice(0, 5000),
                  severity: "high",
                  createRepairTask: true,
                  workspace: projectPath,
                }, { projectSlug, projectPath }));
                const repairTaskId = filed && filed.repairTask && filed.repairTask.task && filed.repairTask.task.taskId || null;
                recordRepairChild(state, repairTaskId, repairGeneration(state, t.id) + 1);
                repair = {
                  createdAt: new Date().toISOString(),
                  bugTaskId: filed && filed.bug && filed.bug.task && filed.bug.task.taskId || null,
                  repairTaskId,
                  branch: reviewInfo && reviewInfo.branch || null,
                };
                state.integrationRepairs[key] = repair;
                saveState(projectSlug, state);
              }
              phases.review.push({
                board: b,
                taskId: t.id,
                outcome: "blocked-integration-conflict",
                branch: reviewInfo && reviewInfo.branch,
                repairTaskId: repair && repair.repairTaskId || null,
              });
              return;
            }
            const baselineRef = (integration && integration.baselineRef)
              || (reviewInfo && (reviewInfo.baseCommit || (deps.resolveBaselineRef && deps.resolveBaselineRef({ projectPath, branch: reviewInfo.branch }))));
            const verifyRes = deps.verify({ projectPath, cwd: verifyCwd, baselineRef, commands: policy.verifyCommands }) || { ok: false, results: [{ cmd: "verify", ok: false, tail: "verification did not run" }] };
            const evidence = verificationEvidence(verifyRes.results || []);
            if (!verifyRes.ok) {
              const failTail = (verifyRes.results || []).filter((r) => !r.ok).map((r) => `### ${r.cmd}\n\`\`\`\n${r.tail}\n\`\`\``).join("\n\n");
              const repairOutput = reviewFailureOutput(failTail, reviewInfo);
              deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Test gate FAILED — not promoting to Done.${reviewInfo ? ` (verified branch \`${reviewInfo.branch}\`)` : ""}\n${evidence}\n\n${failTail}` });
              deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: "autonomy review/test gate failed" });
              if (repairCapReached(state, policy, t.id)) {
                logWork(deps, projectPath, b, "review-gate", `⛔ \`${b}/${t.id}\` blocked — review/test gate failed; repair cap reached, escalated to a human`);
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/repair-cap", body: `Review/test gate still failing after ${repairGeneration(state, t.id)} automated repair attempt(s); escalating to a human/CEO decision rather than dispatching another repair worker. Task left blocked.` });
                phases.review.push({ board: b, taskId: t.id, outcome: "escalated-repair-cap" });
              } else {
                logWork(deps, projectPath, b, "review-gate", `⛔ \`${b}/${t.id}\` blocked — review/test gate failed; self-repair filed`);
                const filed = safe("review-selfrepair", () => deps.selfRepair.reportSystemBug({
                  board: b, source: "autonomy review/test gate",
                  title: `[Self-QA] Verification failed while reviewing ${t.id}`,
                  observedBehavior: `npm run check / npm test failed during the review gate for task ${t.id} (${t.title}).${reviewInfo && reviewInfo.branch ? ` Failed branch: ${reviewInfo.branch}.` : ""}${reviewInfo && reviewInfo.worktree ? ` Failed worktree: ${reviewInfo.worktree}.` : ""}`,
                  output: repairOutput.slice(0, 5000), severity: "high", createRepairTask: true,
                }, { projectSlug, projectPath }));
                recordRepairChild(state, filed && filed.repairTask && filed.repairTask.task && filed.repairTask.task.taskId || null, repairGeneration(state, t.id) + 1);
                phases.review.push({ board: b, taskId: t.id, outcome: "blocked" });
              }
              return;
            }
            // Verified. Land the worker's branch (if any) per integrationMode.
            let mergeNote = "";
            if (reviewInfo && reviewInfo.branch) {
              if (policy.integrationMode === "pr") {
                // Merge-manager: a verified branch is pushed + opened as a PR;
                // promotion to Done happens when that PR merges (polled above).
                const ahead = deps.branchAhead ? deps.branchAhead({ projectPath, branch: reviewInfo.branch }) : 1;
                if (!ahead) {
                  deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `Worker on branch \`${reviewInfo.branch}\` produced NO commits — no real change was made, so this is NOT Done. Sending back to blocked for re-scoping or a human decision.` });
                  deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: "worker produced no changes" });
                  safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
                  delete state.reviews[key];
                  phases.review.push({ board: b, taskId: t.id, outcome: "blocked-no-changes" });
                  return;
                }
                const push = deps.pushReviewBranch({ projectPath, worktree: reviewInfo.worktree, branch: reviewInfo.branch });
                if (!push || push.ok === false) {
                  deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `Test gate PASSED on \`${reviewInfo.branch}\`, but pushing it to open a PR failed:\n> ${push && push.reason || "unknown push failure"}\n\nLeaving in review for a human/orchestrator decision.` });
                  phases.review.push({ board: b, taskId: t.id, outcome: "pr-push-failed", branch: reviewInfo.branch });
                  return;
                }
                const opened = deps.openPullRequest({ projectPath, worktree: reviewInfo.worktree, branch: reviewInfo.branch, title: t.title, body: pullRequestBody(t, evidence) });
                if (!opened || opened.ok === false || !opened.url) {
                  deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `Test gate PASSED and \`${reviewInfo.branch}\` was pushed, but opening a PR failed:\n> ${opened && opened.reason || "no PR url returned"}\n\nLeaving in review for a human/orchestrator decision.` });
                  phases.review.push({ board: b, taskId: t.id, outcome: "pr-open-failed", branch: reviewInfo.branch });
                  return;
                }
                state.pullRequests = state.pullRequests || {};
                state.pullRequests[key] = { branch: reviewInfo.branch, url: opened.url, number: opened.number || null, openedAt: new Date().toISOString() };
                if (state.integrationRepairs) delete state.integrationRepairs[key];
                saveState(projectSlug, state);
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/merge-manager", body: `Test gate PASSED. Opened pull request for review + merge: ${opened.url}\n\nThe task is promoted to Done automatically once this PR merges.\n${evidence}` });
                // The branch is safely on origin; reclaim the local worktree.
                safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
                delete state.reviews[key];
                logWork(deps, projectPath, b, "merge-manager", `🔀 \`${b}/${t.id}\` passed the gate — opened PR ${opened.url} for merge`);
                phases.review.push({ board: b, taskId: t.id, outcome: "pr-opened", branch: reviewInfo.branch, pr: opened.url });
                return;
              }
              const merge = deps.mergeBranch({ projectPath, branch: reviewInfo.branch });
              if (merge.ok && !merge.merged) {
                // The worker produced no commits — it did not actually do the
                // work (often "blocked" / no changes). Never promote to Done.
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Worker on branch \`${reviewInfo.branch}\` produced NO commits — no real change was made, so this is NOT Done. Sending back to blocked for re-scoping or a human decision.` });
                deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: "worker produced no changes" });
                safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
                delete state.reviews[key];
                phases.review.push({ board: b, taskId: t.id, outcome: "blocked-no-changes" });
                return;
              }
              if (!merge.ok) {
                deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Tests PASSED on branch \`${reviewInfo.branch}\`, but it could not fast-forward-merge into the main branch (likely diverged):\n> ${merge.reason}\n\nLeaving in review for a human/orchestrator merge decision.` });
                phases.review.push({ board: b, taskId: t.id, outcome: "awaiting-merge", branch: reviewInfo.branch });
                return;
              }
              mergeNote = merge.integrated
                ? ` Branch \`${reviewInfo.branch}\` was already integrated in the main branch (${merge.equivalentCommits} patch-equivalent commit(s)).`
                : ` Merged branch \`${reviewInfo.branch}\` (${merge.commits} commit(s)) into the main branch.`;
              safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
              delete state.reviews[key];
            }
            deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Test gate PASSED.${mergeNote}\n${evidence}` });
            deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "done", reason: "passed autonomy review/test gate" });
            if (state.integrationRepairs) delete state.integrationRepairs[key];
            logWork(deps, projectPath, b, "review-gate", `✅ \`${b}/${t.id}\` passed the test gate${mergeNote ? " & merged" : ""} — Done`);
            phases.review.push({ board: b, taskId: t.id, outcome: "done" });
          });
        }
      }
    }
  } finally {
    saveWorkers(projectSlug, workers);
    releaseLock(projectSlug);
  }

  // Self-repair on infrastructure errors (capped to first error to avoid storms)
  if (errors.length && !policy.dryRun) {
    safe("selfrepair", () => deps.selfRepair.reportSystemBug({
      source: "autonomy runner",
      title: `Autonomy runner cycle hit ${errors.length} error(s)`,
      observedBehavior: errors.map((e) => `${e.phase}: ${e.error}`).join("\n"),
      severity: "high",
      createRepairTask: false,
    }, { projectSlug, projectPath }));
  }

  const result = {
    ok: errors.length === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    policy,
    boards: resolveBoards(deps, policy, { projectSlug, projectPath }),
    phases,
    liveWorkers: workers.length,
    spawned: phases.execute.filter((e) => e.pid).length,
    errors,
  };
  const runFile = path.join(runsDir(projectSlug), `${startedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(runFile, result);
  saveState(projectSlug, {
    ...state,
    lastRunAt: result.finishedAt,
    lastResult: {
      ...result,
      phases: undefined,
      standups: result.phases.standups,
      runFile,
    },
  });
  return { ...result, runFile };
}

function status(slug) {
  if (!slug) return { ok: false, reason: "project slug required" };
  return {
    ok: true,
    policy: getPolicy(slug),
    state: getState(slug),
    workers: getWorkers(slug).map((w) => ({ ...w, alive: _isAlive(w.pid) })),
  };
}

module.exports = {
  DEFAULT_POLICY,
  normalizePolicy,
  policyFromRequest,
  getPolicy,
  setPolicy,
  getState,
  getWorkers,
  buildWorkerPrompt,
  acquireLock,
  releaseLock,
  runCycle,
  status,
  // exported for tests / advanced callers
  _defaults: {
    spawnWorker: defaultSpawnWorker,
    terminateWorker: defaultTerminateWorker,
    collectDescendantPids,
    terminateProcessTree,
    verify: defaultVerify,
    readLogTail: defaultReadLogTail,
    isAlive: _isAlive,
    mergeBranch: defaultMergeBranch,
    prepareReviewBranch: defaultPrepareReviewBranch,
    failureFingerprints,
    matchesBaselineFailure,
    assessWorkerCompletion,
  },
};
