"use strict";
/**
 * Autonomy Runner — the self-driving loop that makes the Kanban board actually
 * move work forward with agents from the registry.
 *
 * This is the connective tissue described in
 * runtime/harness/architecture/AUTONOMY_RUNNER_PLAN.md. One cycle, per board:
 *
 *   1. ensure the Hermes gateway (CEO brain) is up
 *   2. goal review + blocked analysis (delegated to autonomy-loop)
 *   3. PLAN     — decompose planning-lane briefs into linked child tasks
 *   4. ASSIGN   — route unassigned actionable work to the owning registry agent
 *   5. EXECUTE  — spawn capped, real Devin (swe-1.6) workers on ready work,
 *                 in the project repo, non-blocking (detached + reaped later)
 *   6. REVIEW   — a strong test gate: nothing reaches Done until the project's
 *                 verification commands pass; failures file self-repair bugs
 *   7. persist a run record; never run overlapping cycles for the same project
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
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { brainDir } = require("./paths");

const hermes = require("./hermes");
const org = require("./orchestration-org");
const registry = require("./registry");
const autonomyLoop = require("./autonomy-loop");
const selfRepair = require("./self-repair");

const DEFAULT_POLICY = {
  enabled: false,
  intervalMinutes: 15,
  boards: "all", // "all" | [slugs]
  domain: "All",
  dryRun: false, // master switch: when true, no board mutations, just propose
  allowDecompose: true, // PLAN phase
  allowAssign: true, // ASSIGN phase
  execute: true, // EXECUTE phase (spawn real Devin workers). User chose live, capped.
  allowReviewGate: true, // REVIEW phase (test gate -> Done / self-repair)
  model: "swe-1.6",
  // Headcount is orchestrator-driven. 0 = unlimited (the orchestrator/CEO
  // decides how many Devins to run); a positive number is a hard safety cap.
  maxDispatchPerCycle: 3, // new workers spawned per cycle (0 = unlimited)
  maxConcurrentWorkers: 0, // total live Devin workers across all boards (0 = unlimited)
  workerTimeoutMinutes: 45,
  // Unattended workers run non-interactively (`devin -p`): there is no human to
  // approve tool calls, so "auto" (read-only auto-approve) leaves them unable to
  // edit/commit/run tests. They are isolated in a per-task git worktree, so
  // "dangerous" (auto-approve all tools) is the correct default for autonomy.
  devinPermissionMode: "dangerous",
  protectedBoards: ["domain-lifecycle"], // human-only per its own design docs
  protectDecomposeOnProtected: true, // don't auto-decompose protected boards
  decomposeLanes: ["planning"],
  assignLanes: ["todo", "ready", "bug", "review"],
  executeLanes: ["ready"],
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
    allowDecompose: m.allowDecompose !== false,
    allowAssign: m.allowAssign !== false,
    execute: m.execute !== false,
    allowReviewGate: m.allowReviewGate !== false,
    protectDecomposeOnProtected: m.protectDecomposeOnProtected !== false,
    intervalMinutes: clampPositive(m.intervalMinutes, DEFAULT_POLICY.intervalMinutes),
    maxDispatchPerCycle: Math.max(0, Number(m.maxDispatchPerCycle) || 0),
    maxConcurrentWorkers: Math.max(0, Number(m.maxConcurrentWorkers) || 0),
    workerTimeoutMinutes: clampPositive(m.workerTimeoutMinutes, DEFAULT_POLICY.workerTimeoutMinutes),
    devinPermissionMode: String(m.devinPermissionMode || DEFAULT_POLICY.devinPermissionMode),
    model: String(m.model || DEFAULT_POLICY.model),
    boards: m.boards === "all" || !Array.isArray(m.boards) ? "all" : m.boards.map(String),
    protectedBoards: arr(m.protectedBoards, DEFAULT_POLICY.protectedBoards),
    decomposeLanes: arr(m.decomposeLanes, DEFAULT_POLICY.decomposeLanes),
    assignLanes: arr(m.assignLanes, DEFAULT_POLICY.assignLanes),
    executeLanes: arr(m.executeLanes, DEFAULT_POLICY.executeLanes),
  };
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
  if (fs.existsSync(wt)) return { ok: true, worktree: wt, branch, reused: true };
  fs.mkdirSync(path.join(projectPath, ".worktrees"), { recursive: true });
  // If the branch already exists, attach to it; otherwise create it off HEAD.
  let hasBranch = false;
  try { _git(projectPath, ["rev-parse", "--verify", branch]); hasBranch = true; } catch { hasBranch = false; }
  const args = hasBranch ? ["worktree", "add", wt, branch] : ["worktree", "add", wt, "-b", branch, "HEAD"];
  _git(projectPath, args, 120000);
  return { ok: true, worktree: wt, branch, reused: false };
}

function defaultSpawnWorker({ projectPath, model, prompt, logPath, board, taskId, permissionMode }) {
  // Each worker runs in its own git worktree (isolation). Detached so the Devin
  // session outlives this cycle; output captured to a log file the next cycle
  // reaps. Mirrors how the Hermes dispatcher detaches its workers.
  let worktree = projectPath, branch = null;
  try {
    const wt = ensureWorktree({ projectPath, board, taskId });
    worktree = wt.worktree; branch = wt.branch;
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
  return { ok: true, pid: child.pid, worktree, branch };
}

function defaultReadLogTail(logPath, max = 4000) {
  try {
    const s = fs.readFileSync(logPath, "utf8");
    return s.length > max ? s.slice(-max) : s;
  } catch { return ""; }
}

function defaultVerify({ projectPath, cwd, commands, timeoutMs = 1000 * 60 * 8 }) {
  const results = [];
  let allOk = true;
  for (const [cmd, args] of commands || []) {
    try {
      const out = execFileSync(cmd, args, {
        cwd: cwd || projectPath || process.cwd(),
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      results.push({ cmd: `${cmd} ${(args || []).join(" ")}`, ok: true, tail: String(out).slice(-1500) });
    } catch (e) {
      allOk = false;
      const tail = String((e.stdout || "") + "\n" + (e.stderr || e.message || "")).slice(-2500);
      results.push({ cmd: `${cmd} ${(args || []).join(" ")}`, ok: false, tail });
    }
  }
  return { ok: allOk, results };
}

/** Fast-forward-only merge of a worker's branch into the main checkout. */
function defaultMergeBranch({ projectPath, branch }) {
  if (!branch) return { ok: false, reason: "no branch" };
  try {
    const ahead = Number(String(_git(projectPath, ["rev-list", "--count", `HEAD..${branch}`])).trim() || "0");
    if (!ahead) return { ok: true, merged: false, reason: "branch has no new commits" };
    _git(projectPath, ["merge", "--ff-only", branch], 120000);
    return { ok: true, merged: true, commits: ahead };
  } catch (e) {
    return { ok: false, reason: String((e.stderr || e.message || e)).slice(0, 300) };
  }
}

function defaultCleanupWorktree({ projectPath, worktree }) {
  try { if (worktree && worktree !== projectPath) _git(projectPath, ["worktree", "remove", "--force", worktree], 60000); return { ok: true }; }
  catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 200) }; }
}

const REAL_DEPS = {
  hermes,
  org,
  registry,
  autonomyLoop,
  selfRepair,
  isAlive: _isAlive,
  spawnWorker: defaultSpawnWorker,
  readLogTail: defaultReadLogTail,
  verify: defaultVerify,
  mergeBranch: defaultMergeBranch,
  cleanupWorktree: defaultCleanupWorktree,
};

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSwarmRoster(workers = [], { board, taskId } = {}) {
  const others = workers.filter((w) => !(w.board === board && w.taskId === taskId));
  if (!others.length) return "You are currently the only active worker in the swarm.";
  return others.map((w) => `- ${w.agentId} (Devin ${w.model}) is working on ${w.board}/${w.taskId}${w.title ? ` — "${w.title}"` : ""}`).join("\n");
}

function buildWorkerPrompt({ task, agent, board, projectPath, persona, swarm = [], branch }) {
  const accept = task.acceptanceCriteria || "";
  const roster = buildSwarmRoster(swarm, { board, taskId: task.id });
  return [
    `You are "${agent.id}" (persona: ${persona || agent.persona || agent.id}), one agent in a multi-agent swarm that is autonomously building and self-repairing the CEO Studio project. The app is dogfooding itself.`,
    "",
    "## Workspace isolation (critical)",
    `Your current working directory is an ISOLATED git worktree of the CEO Studio repo${branch ? `, checked out on branch \`${branch}\`` : ""}. Work ONLY here. Do NOT \`cd\` to any other directory or absolute repo path, do NOT switch branches, and do NOT touch the main checkout — other swarm workers are running in their own worktrees in parallel and you must not collide with them. Commit your work on the current branch.`,
    "",
    `Hermes Kanban board: ${board}`,
    `Task id: ${task.id}`,
    `Task title: ${task.title}`,
    "",
    "## Task body",
    task.body || "(no body provided)",
    accept ? `\n## Acceptance criteria\n${accept}` : "",
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

function resolveBoards(deps, policy) {
  if (policy.boards !== "all") return policy.boards;
  try {
    const boards = deps.hermes.listBoards() || [];
    return boards.map((b) => b.slug).filter(Boolean);
  } catch { return []; }
}

function resolveAgent(deps, projectPath, assigneeId) {
  try {
    const reg = deps.registry.read(projectPath);
    return (reg.agents || []).find((a) => a.id === assigneeId) || null;
  } catch { return null; }
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
  const phases = { gateway: null, goals: null, reap: [], plan: [], assign: [], execute: [], review: [] };
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

    const boards = resolveBoards(deps, policy);

    // 2. Goal review + blocked analysis (delegated). Use the first board as the
    //    primary lens; goal layers are project-wide. Skipped in dry-run because
    //    the delegated loop can write goal artifacts + blocked-lane comments.
    phases.goals = policy.dryRun
      ? { ok: true, skipped: "dry-run" }
      : safe("goals", () => deps.autonomyLoop.runCycle({
        projectSlug,
        projectPath,
        board: boards[0] || null,
        domain: policy.domain,
        force: true, // we own cooldown at the runner level
        now,
      }));

    // 3. Reap finished workers (move running -> review, post their output).
    //    Never in dry-run: reaping mutates the board AND worker tracking, so a
    //    dry-run must leave workers untouched for a real cycle to reap.
    if (!policy.staleWorkerSkipReap && !policy.dryRun) {
      const stillRunning = [];
      for (const w of workers) {
        if (deps.isAlive(w.pid)) { stillRunning.push(w); continue; }
        safe("reap", () => {
          const tail = deps.readLogTail(w.logPath);
          const failed = /\[devin error|Unknown model|error rc=|Traceback/i.test(tail);
          if (!policy.dryRun) {
            deps.hermes.addComment({
              board: w.board, taskId: w.taskId, author: `autonomy-runner/${w.agentId}`,
              body: `Devin worker (${w.model}) finished (pid ${w.pid}).${w.branch ? ` Work is on branch \`${w.branch}\`.` : ""}\n\n\`\`\`\n${tail.slice(-3000)}\n\`\`\``,
            });
            deps.hermes.setTaskStatus({
              board: w.board, taskId: w.taskId,
              status: failed ? "blocked" : "review",
              reason: failed ? "devin worker reported an error" : "worker done; awaiting review/test gate",
            });
            // Hand the worktree/branch to the review/test gate.
            if (!failed && w.branch) {
              state.reviews = state.reviews || {};
              state.reviews[`${w.board}:${w.taskId}`] = { worktree: w.worktree, branch: w.branch, agentId: w.agentId };
            }
          }
          phases.reap.push({ board: w.board, taskId: w.taskId, agentId: w.agentId, branch: w.branch || null, outcome: failed ? "blocked" : "review" });
        });
      }
      workers = stillRunning;
    }

    let spawnedThisCycle = 0;
    const dispatchCap = policy.maxDispatchPerCycle > 0 ? policy.maxDispatchPerCycle : Infinity;
    const concCap = policy.maxConcurrentWorkers > 0 ? policy.maxConcurrentWorkers : Infinity;

    for (const board of boards) {
      const isProtected = policy.protectedBoards.includes(board);
      const boardData = safe("getBoard", () => deps.hermes.getBoard(board));
      if (!boardData || !boardData.ok) continue;

      // 4. PLAN — decompose planning-lane briefs (skip protected boards if configured)
      if (policy.allowDecompose && !(isProtected && policy.protectDecomposeOnProtected)) {
        for (const lane of policy.decomposeLanes) {
          for (const t of laneTasks(boardData, lane)) {
            const key = `${board}:${t.id}`;
            if (state.decomposed[key]) continue;
            safe("plan", () => {
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
        if (!boardData || !boardData.ok) continue;
        for (const lane of policy.executeLanes) {
          for (const t of laneTasks(boardData, lane)) {
            if (spawnedThisCycle >= dispatchCap) break;
            if (workers.length >= concCap) break;
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
              // Swarm-aware: pass the live roster (incl. this new task) so the
              // worker knows who its siblings are. Append self first so the
              // roster reflects current intent.
              const swarm = [...workers, { board, taskId: t.id, agentId: agent.id, model: agent.model || policy.model, title: full.title || t.title }];
              const prompt = buildWorkerPrompt({ task: full, agent, board, projectPath, persona: agent.persona, swarm, branch: branchNameFor(board, t.id) });
              const logPath = path.join(workerLogsDir(projectSlug), `${board}-${t.id}-${Date.now()}.log`);
              const model = agent.model || policy.model;
              const res = deps.spawnWorker({ projectPath, model, prompt, logPath, board, taskId: t.id, agent, permissionMode: policy.devinPermissionMode });
              if (!res || !res.ok) { phases.execute.push({ board, taskId: t.id, error: (res && res.reason) || "spawn failed" }); return; }
              deps.hermes.setTaskStatus({ board, taskId: t.id, status: "running", reason: `dispatched to Devin ${model} via autonomy runner` });
              deps.hermes.addComment({ board, taskId: t.id, author: `autonomy-runner/${agent.id}`, body: `Dispatched to Devin worker (model ${model}, pid ${res.pid}) on isolated branch \`${res.branch || "(main)"}\`. Coordinate via Kanban comments (A2A).` });
              workers.push({ board, taskId: t.id, agentId: agent.id, model, pid: res.pid, logPath, startedAt, title: full.title || t.title, worktree: res.worktree, branch: res.branch });
              spawnedThisCycle += 1;
              phases.execute.push({ board, taskId: t.id, agentId: agent.id, model, pid: res.pid });
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
        if (!boardData || !boardData.ok) continue;
        for (const lane of policy.executeLanes) {
          for (const t of laneTasks(boardData, lane)) {
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
        if (!boardData || !boardData.ok) continue;
        for (const t of laneTasks(boardData, "review")) {
          const key = `${b}:${t.id}`;
          const reviewInfo = state.reviews[key] || null;
          safe("review", () => {
            const verifyCwd = (reviewInfo && reviewInfo.worktree) || projectPath;
            if (policy.dryRun) { phases.review.push({ board: b, taskId: t.id, dryRun: true, worktree: verifyCwd }); return; }
            const verifyRes = deps.verify({ projectPath, cwd: verifyCwd, commands: policy.verifyCommands }) || { ok: false, results: [{ cmd: "verify", ok: false, tail: "verification did not run" }] };
            const evidence = (verifyRes.results || []).map((r) => `- ${r.ok ? "PASS" : "FAIL"} \`${r.cmd}\``).join("\n");
            if (!verifyRes.ok) {
              const failTail = (verifyRes.results || []).filter((r) => !r.ok).map((r) => `### ${r.cmd}\n\`\`\`\n${r.tail}\n\`\`\``).join("\n\n");
              deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Test gate FAILED — not promoting to Done.${reviewInfo ? ` (verified branch \`${reviewInfo.branch}\`)` : ""}\n${evidence}\n\n${failTail}` });
              deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "blocked", reason: "autonomy review/test gate failed" });
              safe("review-selfrepair", () => deps.selfRepair.reportSystemBug({
                board: b, source: "autonomy review/test gate",
                title: `[Self-QA] Verification failed while reviewing ${t.id}`,
                observedBehavior: `npm run check / npm test failed during the review gate for task ${t.id} (${t.title}).`,
                output: failTail.slice(0, 1500), severity: "high", createRepairTask: true,
              }, { projectSlug, projectPath }));
              phases.review.push({ board: b, taskId: t.id, outcome: "blocked" });
              return;
            }
            // Verified. Merge the worker's branch into main (ff-only) if present.
            let mergeNote = "";
            if (reviewInfo && reviewInfo.branch) {
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
              mergeNote = ` Merged branch \`${reviewInfo.branch}\` (${merge.commits} commit(s)) into the main branch.`;
              safe("cleanup", () => deps.cleanupWorktree({ projectPath, worktree: reviewInfo.worktree }));
              delete state.reviews[key];
            }
            deps.hermes.addComment({ board: b, taskId: t.id, author: "autonomy-runner/review-gate", body: `Test gate PASSED.${mergeNote}\n${evidence}` });
            deps.hermes.setTaskStatus({ board: b, taskId: t.id, status: "done", reason: "passed autonomy review/test gate" });
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
  if (errors.length) {
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
    boards: resolveBoards(deps, policy),
    phases,
    liveWorkers: workers.length,
    spawned: phases.execute.filter((e) => e.pid).length,
    errors,
  };
  const runFile = path.join(runsDir(projectSlug), `${startedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(runFile, result);
  saveState(projectSlug, { ...state, lastRunAt: result.finishedAt, lastResult: { ...result, phases: undefined, runFile } });
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
  _defaults: { spawnWorker: defaultSpawnWorker, verify: defaultVerify, readLogTail: defaultReadLogTail, isAlive: _isAlive },
};
