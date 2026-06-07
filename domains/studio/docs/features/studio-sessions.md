# Feature: Studio Sessions

## Purpose

First-class **build sessions** in CEO Studio: pick a lead agent from the registry, run a phased workflow (explore -> plan -> approve -> decompose -> execute), spawn workers into a shared A2A room, and click through to each worker's live terminal.

## Persistence

`~/.ceo-studio/<project-slug>/brain/studio-sessions/<id>.json`

Fields include `planDoc`, `decompositionDoc`, `taskTree`, `plannedTeam`, `workers`, and `transcript`.

### Decomposition

Session **decomposition** is the approved breakdown of work after planning — aligned with Domain Lifecycle **Agenda Items** (`type: decomposition`, optional `actionItems`, nested `children`).

Sources (in priority order):

1. **`decompositionDoc`** — explicit capture from the lead agent or human (`sessions:set_decomposition`).
2. **`taskTree`** — step tree from the workflow bar (`sessions:set_task_tree`); surfaced as decomposition items when no explicit doc exists.

`sessions:get` and `sessions:decomposition` return a computed `decomposition` summary for the left panel.

### Auto-capture from chat

When the lead agent replies with an `agui` block, `main/core/session-capture.js` extracts:

- Top-level `decomposition` / `plan` JSON keys, or
- Decomposition-shaped `list` / `table` components (title `type` status lines)

and persists via `setDecomposition` / `setPlan` during the appropriate phases (`agui-server` after each session turn).

Voice/cockpit tools: `get_active_studio_session`, `set_session_decomposition`, `set_session_plan`.

## IPC

- `sessions:list`, `sessions:create`, `sessions:get`, `sessions:set_active`, `sessions:update`
- `sessions:set_plan`, `sessions:approve_plan`, `sessions:reject_plan`
- `sessions:set_planned_team`, `sessions:launch_team`, `sessions:set_task_tree`
- `sessions:set_decomposition`, `sessions:decomposition`
- `sessions:spawn_worker`, `sessions:room`, `sessions:post`

## Chat routing

Active session → `main/core/session-agent.js` via AGUI (`main/core/agui-server.js`). No active session → Hermes CEO stream (unchanged).

## UI

- Nav **Sessions** → `renderer/studio-sessions.js`
- Selecting a session loads **session detail** in the left panel (`#session-artifact-host`): plan snippet, decomposition summary, team, workers
- Workflow bar: plan approval, team roster + launch, task tree
- The active session shows a swarm strip with the lead and spawned workers.
- Clicking a lead/worker in the strip, or a worker in the Active Workers detail list, opens the full Terminal nav and preselects that agent in PuTI/xterm.
- `#panel-inspect` remains available as a lightweight snapshot fallback, but the primary click-through path is the live xterm terminal.

## Gates

- `execute` and `done` phases require `planApprovedAt`
- `launch_team` requires approved plan and non-empty `plannedTeam`
