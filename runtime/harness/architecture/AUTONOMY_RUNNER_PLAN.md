# CEO Studio Autonomy Runner Plan

This document is the current implementation plan for making CEO Studio autonomous without relying on voice credits or nonexistent Hermes commands.

## Implementation Status — IMPLEMENTED (initial)

The runner now exists as a real core module, not a prompt: `main/core/autonomy-runner.js`.

One cycle, per board: ensure gateway up → **REAP** finished workers → optional goal review + blocked analysis (delegated to `autonomy-loop`) → **UNBLOCK** (load blocked work, write CEO Studio overlay metadata, and create a next unblock path) → **RESEARCH/TRIAGE** (ask Hermes to specify raw intake and promote it toward planning) → **STALE RUNNING CLEANUP** (detect running cards with no live/tracked worker and block them visibly) → **PLAN** (decompose planning-lane briefs after document validation) → **ASSIGN** (route unassigned actionable work to the owning registry agent via `orchestration-org`) → **EXECUTE** (spawn capped, real workers after document validation) → **REVIEW** (a strong test gate: `npm run check` + `npm test` must pass before anything reaches Done) → persist a run record. Explicitly targeted task cycles skip broad portfolio review so the CEO can collect, review, repair, and integrate the agents it already dispatched without waiting on unrelated goal analysis. A per-project lock prevents overlapping cycles; infrastructure failures file self-repair bugs.

Key implementation decisions:

- **The CEO owns the agent lifecycle.** Planning and delegation are intermediate states. The CEO must promote dispatch-ready work, launch registered agents through the app, monitor workers and A2A evidence, run review/integration gates, dispatch repairs, and continue until the goal is verified or a concrete human-only decision is required.
- **Workers are real Devin `swe-1.6` sessions, executed directly** (`devin --model <m> -p`). Hermes spawns workers as `hermes -p <profile>` agents and has **no Devin model provider**, so a Hermes worker cannot run swe-1.6. The registry already models `devin` as a provider, so the runner runs the Devin CLI itself. The Hermes board remains the single source of truth for lanes, claiming, comments, and lifecycle.
- **Hermes Kanban is the ledger; CEO Studio owns the overlay.** Hermes remains canonical for task ids, lanes, assignees, comments, and task actions. Extensible operating metadata that Hermes does not expose as first-class fields lives in CEO Studio project brain under `brain/boards/<board>/tasks/<task>.json` via `main/core/board-overlay.js`.
- **Blocked is active, not parked.** `main/core/unblocker.js` turns blocked tasks into explicit unblock plans. It classifies the blocker, stores `blocked_reason`, `next_unblock_action`, owner, retry/stale state, and spawned work in the overlay, then creates the appropriate planner, self-repair, CEO, or human-decision path.
- **Triage is researched by the app, not an operator script.** Raw intake in `triage` is handled by the runner through Hermes task actions: `specify` to enrich the card, then `promote` toward planning/decomposition. Dry-runs record `phases.research` without mutating the board.
- **Research is capped per cycle.** `maxTriagePerCycle` limits how many raw intake cards are specified in one runner pass, so the app can make progress without surprise unbounded Hermes calls.
- **Goal-specific passes can target exact tasks.** `targetTaskIds` lets the cockpit run a focused cycle for the current goal, for example dispatching one PIPE MVP card without accidentally starting unrelated ready work first.
- **Self-repair work must target the registry agent id.** Bugs and linked repair tasks route to `self-repair-engineer`, not the team label `self-repair`, so the runner can resolve and dispatch the repair worker.
- **Self-repair work stays in the failing project.** When the review gate fails for a mounted project such as PIPE, the linked repair task names that project/worktree as the workspace instead of defaulting back to CEO Studio.
- **Running must mean a live worker.** A `running` card with no live or tracked worker is stale board state. The runner comments on it and moves it to `blocked` so the orchestrator can repair, re-scope, or re-dispatch from visible state. Dry-runs record `phases.staleRunning`.
- **Git worktree isolation**: each worker runs in its own `.worktrees/<board>-<task>` checkout on branch `auto/<board>-<task>`, branched off HEAD. Concurrent workers never corrupt each other or the user's working tree. The review/test gate verifies inside the worktree and only fast-forward-merges into the main branch when tests pass (otherwise the task stays in review for a human/orchestrator merge decision).
- **A2A awareness**: the Devin CLI config ships the `hermes` (Kanban) and `gbrain` MCP servers, so every worker can read the live board, see what sibling agents are doing, and post progress comments — the board is the durable A2A bus. Each worker prompt also injects the live swarm roster. A durable roster is published to `<brain>/autonomy/runner/swarm.json`.
- **Dispatch evidence is in the prompt, not only in MCP.** Every worker prompt includes recent Kanban comments for the task, including review-gate failures and human/orchestrator corrections. Workers should still read the live board through Hermes, but critical evidence must be present at dispatch time so repair agents do not repeat stale work.
- **Document validation is an autonomous gate.** `main/core/brief-runs.js` validates required brief fields before decomposition and before dispatch. Dirty briefs are returned to `planning` with a `CEO Studio Document Validation Gate` comment instead of being decomposed or sent to workers.
- **Review failures preserve continuity.** When the review/test gate files self-repair work, the repair task evidence includes the failed worker branch/worktree and instructs the next repair worker to inspect or cherry-pick that branch before fixing remaining gate failures.
- **Verification follows the mounted project's contract.** An `npm run <script>` gate is skipped when that script does not exist in the base project's `package.json`; a worker is not asked to invent a repository-wide gate just because CEO Studio itself has one.
- **Inherited failures are evidence, not automatic regressions.** Each worker records the Git commit it branched from. If a worker check fails, the runner creates a temporary clean checkout of that base commit outside the project (sharing `node_modules` only), executes the same command there, then removes the checkout. Matching failure signatures are recorded as `BASELINE` evidence and do not block the branch; new failure signatures still block and create self-repair work. This prevents nested project `.worktrees` or dirty user files from contaminating the baseline.
- **Failed branches can be re-reviewed without another worker.** A focused runner pass with `targetTaskIds` may re-verify a blocked task when `state.reviews` still holds its branch/worktree. This is the recovery path after verification policy or baseline evidence improves.
- **Patch-equivalent specialist branches close as integrated.** Before attempting a fast-forward, the review gate checks `git cherry HEAD <branch>`. If every branch patch already exists in the current main branch, the task is completed as already integrated instead of remaining stuck in Review or attempting to reapply older work.
- **Integration conflicts dispatch repair work.** If a completed worker branch cannot rebase onto current main, the runner blocks the original card, records the branch/worktree/rebase evidence, and creates one idempotent self-repair handoff for a conflict-resolution agent instead of leaving the work parked.
- **Integrated repairs close their blocked parents.** Once a linked conflict-repair task passes review and merges, the runner marks the original blocked task Done and removes its obsolete branch handoff instead of attempting to replay the pre-repair branch.
- **Executable acceptance evidence is required.** Browser/E2E tasks that require Playwright, Chrome DevTools, or two-context validation are blocked when a worker reports only code inspection or test scaffolding. The runner creates a linked repair handoff carrying the incomplete branch and output so a follow-up agent must execute the missing flow.
- **Active project framing**: worker prompts must name the active project/worktree, not hard-code CEO Studio as the implementation repo. CEO Studio is the cockpit/orchestration layer; the worker's isolated worktree may be a mounted project such as PIPE.
- **Headcount is orchestrator-driven**: `maxConcurrentWorkers`/`maxDispatchPerCycle` of `0` mean unlimited; positive values are safety caps.

Surfaces:
- In-app (primary): IPC `runner:status|configure|run_once|start|stop`, exposed on the preload bridge as `window.ceo.runnerStart/runnerStop/runnerRunOnce/runnerStatus/runnerConfigure`.
- CLI (fallback): `npm run autonomy:dry-run`, `npm run autonomy:once`, `npm run autonomy:start` (wrapping `scripts/start-autonomy.js`).
- Tests: `test/autonomy-runner.test.js` asserts the decision logic (assign, spawn, the pass→Done / fail→blocked+self-repair gate, locking, caps) with injected fakes — the production path uses the real Devin CLI and real `npm test`.

Remaining/next: surface a Swarm panel in the renderer; richer cost accounting for Devin credits; smarter (non-ff) merge handling; richer research tools beyond Hermes `specify`.

## Current Reality

The conversational CEO is already live through the Hermes relay:

- CEO Studio calls `main/core/hermes.js`.
- The relay shells out to `hermes chat -q`.
- Hermes is OAuth-funded and must remain the CEO brain.
- There is no raw OpenAI or Anthropic API-key CEO path.

The full long-running autonomy loop is not a single Hermes command yet. The following commands were verified against the installed CLI:

- Valid: `hermes gateway start`
- Valid: `hermes kanban --board ceo-studio dispatch --dry-run --max 3`
- Valid: `hermes kanban --board ceo-studio dispatch --max 3`
- Invalid today: `hermes start-autonomy`
- Invalid today: `hermes use recursive-planning-harness`
- Invalid today: `hermes kanban dispatch --board ceo-studio --max 3 --autonomous`

The skills exist and should guide orchestration behavior:

- `kanban-orchestrator`
- `recursive-planning-harness`
- `herder-session-management`

## Operating Goal

CEO Studio should run a conservative autonomous cycle that can:

1. Keep Hermes gateway online.
2. Keep the board as the source of truth.
3. Review daily/weekly/monthly/quarterly/roadmap goals.
4. Analyze blocked work instead of letting it rot.
5. Research raw triage intake through Hermes instead of requiring a human script.
6. Detect stale running work and make it visible.
7. Dispatch ready assigned work through isolated registry workers.
8. Detect system failures and create self-repair bugs.
9. Persist every run as evidence.

Voice is not part of this loop. Voice is intake only.

## Board Model

The board is the durable queue. Lanes are not decorative; they determine workflow ownership:

- `triage`: raw or incomplete intake; the runner asks Hermes to specify it and promote it toward planning.
- `bug`: reproducible defects and self-repair intake.
- `planning`: briefs being enriched or decomposed.
- `todo`: planned work not yet dispatchable.
- `ready`: dispatchable work.
- `running`: active worker execution; if no live/tracked worker exists, the runner blocks it as stale.
- `blocked`: escalation lane; must trigger analysis.
- `review`: verification lane.
- `done`: verified archive.

## Runner Contract

The runner should be implemented as a real script or core module, not as a prompt-only instruction.

Inputs:

- `board`: default `ceo-studio`.
- `domain`: default `All`.
- `intervalMinutes`: default from autonomy policy.
- `allowStandups`: default `true`; effective only for enabled standup policies.
- `maxStandupsPerCycle`: default `2`.
- `maxDispatch`: default `1` in safe mode.
- `dryRunDispatch`: default `true`.
- `force`: bypass cooldown for manual runs only.

One cycle:

1. `hermes.ensureUp()`
2. Standup cadence:
   - reconcile previously started rooms and synthesize completed `requirements.md`
   - dry-run: report due candidates without claiming or starting them
   - live: claim and start up to `maxStandupsPerCycle` due occurrences with `allowPaid: false`
   - snapshot matching daily goals and link goal-backed Brief Runs
   - skip cadence during a `targetTaskIds` cycle
3. `autonomyLoop.runCycle(...)`
   - goal reviews
   - blocked-lane analysis
   - run record persistence
4. `unblocker.run(...)`
   - writes CEO Studio overlay state for blocked tasks
   - creates planner clarification tasks, self-repair work, or human decision requests
   - comments the unblock plan back to the Hermes task
5. Research/triage:
   - read `triage` cards
   - dry-run: record `phases.research`
   - live: call `hermes.taskAction({ action: "specify" })`, then promote toward planning
   - cap work with `maxTriagePerCycle`
6. Stale running cleanup:
   - read `running` cards
   - dry-run: record `phases.staleRunning`
   - live: comment and block cards that have no live/tracked worker
7. Plan/assign/execute/review:
   - decompose planning-lane briefs
   - assign unowned actionable work via `orchestration-org`
   - spawn capped Devin workers from `ready`, with task body, recent comments/evidence, active project, isolated branch, and swarm roster in the initial prompt
   - run the review gate before Done
   - when `targetTaskIds` is set, only those tasks participate in the phase
8. Persist a runner record with:
   - gateway status
   - standup due/reconciliation results
   - autonomy run file
   - research/stale-running decisions
   - execution/review output
   - blocked analysis summary
   - proposed actions
   - failures

Long-running mode:

1. Start with one safe cycle.
2. Sleep for `intervalMinutes`.
3. Repeat while enabled.
4. Persist the enabled policy; reopening the project restores the timer and immediately checks for due cadence/work.
5. Never run overlapping cycles for the same board.
6. On any runner error, file or update a self-repair bug.

## Safety Defaults

Default mode is observe/propose:

- Goal reviews may write artifacts.
- Blocked analysis may write comments and memory artifacts.
- Dispatch defaults to dry-run.
- Automatic creation of new briefs/tasks remains off until policy explicitly allows it.

Active dispatch requires an explicit policy flag and should still cap spawns:

- `maxDispatch` starts at `1`.
- Require assigned workspaces for worker tasks.
- Prefer isolated worktrees for code work.
- Never dispatch `scratch` code tasks.

## Integration modes (how a green gate lands work)

`policy.integrationMode` controls how the REVIEW phase lands a verified worker branch:

- `"merge"` (default): fast-forward-merge the branch into the local main checkout on green. Simple, but a diverged branch cannot ff-merge and is left blocked.
- `"pr"` (the **merge-manager**): push the verified branch to `origin` and open a GitHub PR via `gh` (idempotent — an existing open PR for the head branch is reused, never duplicated). The task stays in `review` and is promoted to Done only when the PR actually merges; the next cycle polls `gh pr view` and finalizes (a PR closed unmerged blocks the task for a human decision). The local worktree is reclaimed once the branch is safely on `origin`, and branches with no commits are never pushed or PR'd.

Both modes keep the same invariant: nothing reaches Done without passing `npm run check` + `npm test`, and a branch that cannot integrate cleanly is blocked for a human/orchestrator merge rather than silently orphaned. PR mode additionally requires `gh` to be installed and authenticated.

## Oversight report (no silent abandonment)

The runner's lifecycle had only two terminal outcomes — auto-merge on green, block on red — and **no surface for completed-but-unlanded work**. The result: a fleet of `auto/*` branches whose board status (often `done`/`archived`) disagreed with the repo (the commits never reached the base branch), abandoned with nothing reporting it. `report()` closes that visibility gap.

`autonomy-runner.report({ projectSlug, projectPath })` is a read-only inventory (it spawns nothing). For every task on every owned board it cross-references the live worker roster (`workers.json`), the runner state (`state.json`: `pullRequests`, `reviews`, `completionRepairs`/`integrationRepairs` escalations, `humanRequired`, `repairChains`) and git (`branchState` → does the task's `auto/*` branch exist, how far ahead, is it merged into the base) and assigns one honest **disposition**:

- `live` — a tracked worker is running for it.
- `open-pr` — a merge-manager PR is open and being polled.
- `in-review` — handed to the REVIEW gate this/last cycle.
- `needs-human` — repair-cap escalation or a human-required gate; a person must drive it.
- `delivered` — `done` and the branch is merged (or there is no branch).
- `stranded` — an unmerged branch with commits, but no PR/review in flight.
- `diverged` ⚠ — **the board says `done` but the branch never reached the base branch** (board/repo mismatch). This is the standout alarm.
- otherwise the raw board status (`ready`/`blocked`/`triage`/…).

Surfaces: `npm run autonomy:report` (CLI table, action-needed rows first) and IPC `runner:report` → `window.ceo.runnerReport()` (cockpit). `report()` accepts injected `deps.hermes.getBoard` + `deps.branchState` (and optional `state`/`workers`) so it is fully testable without a board, git, or disk.

## Self-Repair Hook

The runner should call self-repair when infrastructure fails, for example:

- Hermes gateway cannot start.
- Kanban dispatch exits nonzero.
- Autonomy cycle throws.
- Board DB cannot be read.
- A task repeatedly auto-blocks from tool/test failures.

Self-repair flow:

1. Create a bug in the `bug` lane.
2. Create a linked repair task that targets the failing project workspace and carries the review-gate output as evidence.
3. Notify `self-repair-engineer` in the `self-repair` room.
4. Require root cause, docs status, verification, and git commit.

**Anti-churn guards (mandatory).** Two recursion sources previously fanned paid workers over the same dead ends:

- *Repair generation cap* — auto-generated repair tasks are tagged with their generation in `state.repairChains`; once a failing task reaches `policy.maxRepairGenerations` (default `1`) the runner escalates to a human (leaves it blocked) instead of filing yet another repair. Enforced at all three failure sites (reap acceptance gate, review integration conflict, review test gate).
- *Unblocker recursion guard* — the blocked-lane unblocker creates a child `Clarify blocker for …` / `CEO decision for …` / `[Unblock] …` task. `isUnblockMetaTask()` detects when a blocked task is itself one of these meta-tasks and **escalates it to a human decision (creates no new child) instead of nesting another `Clarify blocker for [Clarify blocker for …]` layer.**

## Agent Responsibilities

- `kanban-orchestrator`: decomposes and routes; does not implement.
- `planner`: turns briefs into linked child tasks.
- `builder`: implements assigned tasks.
- `architect`: reviews architecture/interface implications.
- `self-repair-engineer`: diagnoses and repairs system defects.
- `docs-steward`: keeps operating docs current before handoff.
- `facilitator`: coordinates rooms/meetings when several agents are involved.

## Implementation Steps

1. Add `main/core/autonomy-runner.js`.
2. Add a CLI script `scripts/start-autonomy.js`.
3. Add package scripts:
   - `npm run autonomy:once`
   - `npm run autonomy:dry-run`
   - `npm run autonomy:start`
4. Add IPC/tool support so the cockpit can start/stop the runner.
5. Record runner state in project brain under `autonomy/runner/`.
6. Add tests for:
   - dry-run dispatch command shape
   - run record persistence
   - no overlapping cycles
   - self-repair bug creation on simulated failure
7. Update docs and `npm run docs:check`.

## Team-log channels (work milestones)

Each Kanban board has a **team-log channel** — a standing room (`meetings.boardRoom(slug)` → `chan-board-<slug>`) that the cockpit opens when you click the board in the Channels list. The runner posts milestone **work-events** into that room as agents build, so the whole team (and the human) get shared insight into work in flight, alongside chat:

- **▶ started** — when a worker is dispatched on a task (EXECUTE).
- **✓ finished … awaiting review** / **✗ hit an error** — when a worker is reaped.
- **✅ … Done** / **⛔ … blocked** — the review/test gate outcome.

These are posted via the injectable `postWork` dep (`defaultPostWork` → `meetings.post`); it is best-effort and side-effect-only — the team log is a convenience surface, never a gate, so a posting failure never affects a cycle. The cockpit renders these as compact log lines (distinct from chat) and the persistent A2A room loop lets you ask members `@agent what are you doing?` on demand (answered from the visible log + the agent's room session; live worker-session introspection is a future extension).

## Definition Of Done

The autonomy runner is not complete until evidence proves:

- `npm run autonomy:dry-run` starts Hermes, reviews goals, analyzes blocked work, and dispatches only as dry-run.
- `npm run autonomy:once -- --dispatch` can spawn at most the configured number of ready tasks.
- A failed dispatch creates or updates a self-repair bug.
- Worker prompts include recent task comments/evidence so agents see review-gate failures without relying only on a later MCP lookup.
- Linked self-repair tasks include the captured failure output and the failing project workspace.
- Mounted-project verification skips absent base scripts, records matching inherited failures as baseline evidence, and still rejects new failures.
- A targeted blocked task with saved review metadata can be re-reviewed without spawning a replacement worker.
- Runner state survives process restart.
- Board comments/memory artifacts show blocked escalations.
- `npm run check` and `npm test` pass.
