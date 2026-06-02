# CEO Studio Autonomy Runner Plan

This document is the current implementation plan for making CEO Studio autonomous without relying on voice credits or nonexistent Hermes commands.

## Implementation Status — IMPLEMENTED (initial)

The runner now exists as a real core module, not a prompt: `main/core/autonomy-runner.js`.

One cycle, per board: ensure gateway up → goal review + blocked analysis (delegated to `autonomy-loop`) → **PLAN** (decompose planning-lane briefs) → **ASSIGN** (route unassigned actionable work to the owning registry agent via `orchestration-org`) → **EXECUTE** (spawn capped, real workers) → **REVIEW** (a strong test gate: `npm run check` + `npm test` must pass before anything reaches Done) → persist a run record. A per-project lock prevents overlapping cycles; infrastructure failures file self-repair bugs.

Key implementation decisions:

- **Workers are real Devin `swe-1.6` sessions, executed directly** (`devin --model <m> -p`). Hermes spawns workers as `hermes -p <profile>` agents and has **no Devin model provider**, so a Hermes worker cannot run swe-1.6. The registry already models `devin` as a provider, so the runner runs the Devin CLI itself. The Hermes board remains the single source of truth for lanes, claiming, comments, and lifecycle.
- **Git worktree isolation**: each worker runs in its own `.worktrees/<board>-<task>` checkout on branch `auto/<board>-<task>`, branched off HEAD. Concurrent workers never corrupt each other or the user's working tree. The review/test gate verifies inside the worktree and only fast-forward-merges into the main branch when tests pass (otherwise the task stays in review for a human/orchestrator merge decision).
- **A2A awareness**: the Devin CLI config ships the `hermes` (Kanban) and `gbrain` MCP servers, so every worker can read the live board, see what sibling agents are doing, and post progress comments — the board is the durable A2A bus. Each worker prompt also injects the live swarm roster. A durable roster is published to `<brain>/autonomy/runner/swarm.json`.
- **Headcount is orchestrator-driven**: `maxConcurrentWorkers`/`maxDispatchPerCycle` of `0` mean unlimited; positive values are safety caps.

Surfaces:
- In-app (primary): IPC `runner:status|configure|run_once|start|stop`, exposed on the preload bridge as `window.ceo.runnerStart/runnerStop/runnerRunOnce/runnerStatus/runnerConfigure`.
- CLI (fallback): `npm run autonomy:dry-run`, `npm run autonomy:once`, `npm run autonomy:start` (wrapping `scripts/start-autonomy.js`).
- Tests: `test/autonomy-runner.test.js` asserts the decision logic (assign, spawn, the pass→Done / fail→blocked+self-repair gate, locking, caps) with injected fakes — the production path uses the real Devin CLI and real `npm test`.

Remaining/next: surface a Swarm panel in the renderer; richer cost accounting for Devin credits; smarter (non-ff) merge handling; promotion policy for autonomous brief creation.

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
5. Dispatch ready assigned work through Hermes Kanban.
6. Detect system failures and create self-repair bugs.
7. Persist every run as evidence.

Voice is not part of this loop. Voice is intake only.

## Board Model

The board is the durable queue. Lanes are not decorative; they determine workflow ownership:

- `triage`: raw or incomplete intake.
- `bug`: reproducible defects and self-repair intake.
- `planning`: briefs being enriched or decomposed.
- `todo`: planned work not yet dispatchable.
- `ready`: dispatchable work.
- `running`: active worker execution.
- `blocked`: escalation lane; must trigger analysis.
- `review`: verification lane.
- `done`: verified archive.

## Runner Contract

The runner should be implemented as a real script or core module, not as a prompt-only instruction.

Inputs:

- `board`: default `ceo-studio`.
- `domain`: default `All`.
- `intervalMinutes`: default from autonomy policy.
- `maxDispatch`: default `1` in safe mode.
- `dryRunDispatch`: default `true`.
- `force`: bypass cooldown for manual runs only.

One cycle:

1. `hermes.ensureUp()`
2. `autonomyLoop.runCycle(...)`
   - goal reviews
   - blocked-lane analysis
   - run record persistence
3. `hermes.dispatch({ board, max, dryRun })`
   - dry-run first unless explicit active dispatch is enabled
4. Persist a runner record with:
   - gateway status
   - autonomy run file
   - dispatch output
   - blocked analysis summary
   - proposed actions
   - failures

Long-running mode:

1. Start with one safe cycle.
2. Sleep for `intervalMinutes`.
3. Repeat while enabled.
4. Never run overlapping cycles for the same board.
5. On any runner error, file or update a self-repair bug.

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

## Self-Repair Hook

The runner should call self-repair when infrastructure fails, for example:

- Hermes gateway cannot start.
- Kanban dispatch exits nonzero.
- Autonomy cycle throws.
- Board DB cannot be read.
- A task repeatedly auto-blocks from tool/test failures.

Self-repair flow:

1. Create a bug in the `bug` lane.
2. Create a linked repair task.
3. Notify `self-repair-engineer` in the `self-repair` room.
4. Require root cause, docs status, verification, and git commit.

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
- Runner state survives process restart.
- Board comments/memory artifacts show blocked escalations.
- `npm run check` and `npm test` pass.
