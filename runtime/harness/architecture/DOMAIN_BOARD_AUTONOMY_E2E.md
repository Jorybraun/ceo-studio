# Domain Board Autonomy E2E

This is the target operating model for CEO Studio + Hermes Kanban. It keeps the CEO as Hermes, keeps board writes durable, and separates observable infrastructure from actual agent work.

## Work Item Types

### Brief
A brief is the parent record for planned work. It must use the canonical brief sections before it can be decomposed or dispatched:

- Goal
- Board
- Domain
- Current Rendered State
- Problem / Mismatch
- Constraints
- Acceptance Criteria
- Next Action
- Owner / Persona

Child tasks and generated assets must reference the parent brief title or task id.

### Task
A task is executable work derived from a brief or bug. Tasks should name:

- Parent brief or bug
- Workspace rule
- Expected artifact
- Verification evidence
- Assignee/persona

### Bug
A bug is a defect record. It must include:

- Observed behavior
- Expected behavior
- Reproduction steps
- Severity
- Impact/evidence when available
- Acceptance criteria for proof of repair

If a bug reveals a systemic gap, create or link a prevention brief.

### Asset
An asset is output generated for a brief or task: docs, screenshots, reports, generated media, patches, logs, or validation evidence. Assets must carry provenance back to the parent brief/task.

## Queue And Lane Semantics

The board is the durable queue. Agents should not maintain a private hidden queue that can diverge from Hermes.

- `triage`: raw intake; PM/planner must normalize it.
- `bug`: reproducible defect intake; self-repair confirms severity/reproduction and creates or executes the linked repair path.
- `planning`: brief is being enriched or decomposed.
- `todo` / `ready`: dispatchable work with owner, workspace, and acceptance criteria.
- `running`: worker is actively executing.
- `blocked`: worker cannot progress; this must trigger blocker analysis, not silent polling.
- `done`: verified against the acceptance criteria with evidence.

Polling alone is insufficient. Each loop must compare current board state, recent comments/events, and worker liveness, then choose one concrete action.

## CEO Studio Board Overlay

Hermes Kanban is intentionally treated as the board ledger, not the full product database. CEO Studio owns an overlay store for metadata that Hermes cannot represent as first-class fields.

Canonical Hermes data:

- task id
- title/body
- lane/status
- assignee
- comments/log
- task actions such as block, unblock, promote, dispatch

CEO Studio overlay data:

- domain and goal links
- provenance pointers
- blocker type and reason
- next unblock action
- unblock owner
- retry/stale state
- spawned unblock task id
- human decision request id
- human notification id
- review/completion evidence pointers

The overlay lives under project brain at `brain/boards/<board>/tasks/<task>.json` and is read with the Hermes board to form the app's richer board view.

## Blocked Escalation

When an item enters or remains in `blocked`, the orchestrator should create a visible blocker analysis comment:

- What is blocked
- Evidence already checked
- Decision needed or missing dependency
- Proposed next action
- Escalation target: planner, CEO, human, or specialist

If the blocker is caused by CEO Studio or the harness itself, create a bug linked to the affected brief/task.

Blocked work must also receive a concrete unblock plan in the CEO Studio overlay. The unblocker chooses one path:

- requirements/scope blocker: create planner clarification work.
- system failure/test blocker: create self-repair work.
- human/external blocker: create a human decision request, write a notification to the cockpit inbox, and keep the task visibly waiting.
- CEO prioritization blocker: create a CEO decision path.
- resolved blocker: call Hermes `unblock` or split/promote according to the recorded decision.

## Planner Responsibilities

The planner agent owns decomposition, not execution:

1. Read the brief and domain context.
2. Reject or enrich incomplete briefs.
3. Create child tasks with parent references.
4. Assign lane, persona, workspace, and verification expectations.
5. Leave the brief in planning until child tasks are ready.
6. Escalate ambiguity instead of inventing missing requirements.

## Goal Alignment

The CEO should maintain layered goals:

- Daily: board movement and concrete verification.
- Weekly: domain milestones and blocker burn-down.
- Monthly: roadmap outcomes and system health improvements.
- Quarterly: strategic roadmap themes.

Each planning cycle should tie new briefs, bugs, and tasks to the smallest relevant goal layer. When work does not support any active goal, it should stay in triage until the CEO or human accepts it.

## Current Implementation Slice

Implemented in CEO Studio:

- `main/core/domain-board.js` validates and renders canonical brief and bug bodies.
- `domain_board:create_brief`, `domain_board:create_bug`, and `domain_board:decompose_brief` IPC handlers expose this to cockpit agents.
- Live voice tools `create_brief`, `create_bug`, and `decompose_brief` can create real Hermes Kanban items without bypassing validation.
- Local brain artifacts are recorded for created briefs/bugs when a project is open.
- `main/core/autonomy.js` can scan the blocked lane, add a durable `CEO Studio Blocker Analysis` comment, choose an escalation target, and log an open-question memory artifact.
- `main/core/board-overlay.js` stores CEO Studio-owned per-task metadata beside the Hermes ledger.
- `main/core/unblocker.js` turns blocked tasks into explicit unblock plans, creates planner/self-repair/decision work, and comments the plan back to the Hermes task.
- `main/core/notifications.js` stores cockpit notifications for human-required blockers; the renderer header surfaces unread human escalations and lets the human open or acknowledge them.
- Live voice/planner tool `analyze_blocked_work` exposes blocked-lane analysis without turning the UI into the orchestrator.
- `main/core/provenance.js` records queryable brief/task/bug/asset relationships in project brain JSONL.
- Live voice/planner tools `create_child_task`, `record_brief_asset`, and `show_provenance` let decomposition and generated assets belong to a parent brief or bug.
- `main/core/goals.js` stores daily, weekly, monthly, quarterly, and roadmap goals as durable project-brain records.
- Live voice/planner tools `list_goals`, `set_goal`, and `link_work_to_goal` let the CEO align briefs, bugs, and tasks with explicit goal layers.
- `main/core/goal-review.js` runs deterministic daily/weekly/monthly/quarterly/roadmap reviews against the board, writes a durable `dream_cycle` artifact, and proposes next actions.
- Live voice/planner tool `review_goals` exposes the review cycle and renders the report in the cockpit.
- `main/core/autonomy-loop.js` stores conservative autonomy policy, enforces cooldowns, runs goal reviews plus blocked analysis, and persists run records.
- Live voice/planner tools `autonomy_status`, `configure_autonomy`, `run_autonomy_cycle`, `start_autonomy`, and `stop_autonomy` expose explicit long-running control without hidden polling.
- The renderer Goals view includes a Daily Operating Loop panel: create today's goal, configure/start the standup, run daily goal review, run the conservative autonomy cycle, and run an autonomy-runner dry-run from one app-owned surface.
- `main/core/standups.js` stores the project standup policy plus durable occurrence records under `<project>/brain/standups/`. An enabled autonomy runner automatically reconciles completed rooms and starts due standups through the Meetings bridge when `allowStandups` is enabled. Every occurrence keeps `allowPaid: false`, snapshots matching active daily goals, links itself to those goals, and links any goal-backed Brief Runs into the existing meeting review path.
- Recurring meeting starts keep the stable policy meeting id but use a unique dated room per occurrence. Prior transcripts and `requirements.md` files are therefore preserved instead of being cleared by the next morning's run.
- Standup execution is claimed before launch and recorded in `executions.json`, so repeated runner cycles do not double-start the same scheduled occurrence. Dry-run cycles report due candidates without claiming or spawning them; targeted task cycles skip unrelated cadence work.
- Runner enablement is durable. Reopening a project with an enabled runner policy restores the interval timer and immediately performs a cycle, so daily cadence does not silently stop at app restart.
- When a standup finishes, the runner deterministically synthesizes its `requirements.md`. Linked Brief Runs receive the normal decision/Agenda Item/blocker/evidence/completion proposal review. Standalone occurrences expose the same explicit approve/reject controls in Meetings; approvals can record local outcomes, create an approved domain Agenda Item, or raise a Human Escalation, but never dispatch work.
- `main/core/self-repair.js` turns observed CEO Studio failures and improvement requests into first-class bugs plus linked repair tasks and evidence provenance.
- Live voice/planner tool `ask_self_repair` asks the dedicated `self-repair-engineer` agent to diagnose or improve the system, attempts to mount it, posts the handoff to the `self-repair` room, and requires verification, docs status, and a focused git commit before completion.
- Live voice/planner tool `report_system_bug` remains available for logging self-repair defects without a live agent handoff.
- The renderer task planning panel loads provenance, linked goals, and autonomy status for the selected Hermes task, showing parent briefs, child work, assets, and current autonomy mode/state beside the brief.
- Valid domain-board briefs now create a file-backed Brief Run under the project Brain. Task detail exposes its editable canonical document, validation state, progress checklist, decisions, evidence, linked Studio sessions, and active session agents. Document edits re-run the same gate used by the autonomy runner. Starting a conversation from a Brief Run prepares the board/task/run reference in the renderer, but preserves the session lifecycle rule: the linked Studio session is persisted only when the user sends the first text message.
- The Brief Run cockpit now consolidates linked real meeting rooms, scheduled meetings, proposed Agenda Items, canonical provenance-backed context assets, completed-work summaries, and live tmux terminal streams for linked agents. Meeting schedules carry the Brief Run reference, room feeds and terminal snapshots refresh in place, terminal input uses the registry/mount bridge, and linked Studio sessions append a durable completion summary when they enter `done`.
- `main/core/meeting-synthesis.js` deterministically converts completed linked-room `requirements.md` output into durable Brief Run proposals for decisions, Agenda Items, blockers, evidence, and completion updates. Proposal generation is automatic and idempotent; materialization is not. `brief_runs:meeting_proposal_action` requires `humanApproved: true` before an approval can record a decision/evidence/completion, append a domain Agenda Item, or block the parent Hermes task. Rejections remain visible in the synthesis history.
- `main/core/orchestration-org.js` defines the machine-readable org structure that binds Kanban lanes to owning teams, workflows, default personas, queue roles, and escalation targets, including a first-class `bug` lane owned by the `self-repair` team.
- Briefs, bugs, child tasks, and blocked-analysis comments now carry this routing contract, and live voice/planner tools `show_orchestration_org` and `route_work` expose the model before delegation.
- `main/core/skills.js` builds the lightweight Skill Catalog by scanning `SKILL.md` files from the project, the harness, and Kimi Desktop's local skill library. `skills:list` returns discoverable capability templates, and `skills:route` previews which registry agents should lead or participate for a requested skill set.
- The default harness registry includes explicit planning, execution, review, documentation, and self-repair teams so `triage/planning`, `todo/ready/running`, `blocked/review`, docs handoff, and repair handoff have concrete owners.
- `runtime/harness/personas/general/self-repair-engineer.md` and `runtime/harness/skills/self-repair/SKILL.md` define the self-repair operating contract: diagnose first, implement real fixes, run `npm run check` and `npm test` unless blocked, update docs or obtain docs-steward signoff, commit all file changes, and report the commit hash plus verification evidence.
- `runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`, `runtime/harness/skills/docs-steward/SKILL.md`, and the `docs-steward` persona define the documentation handoff role. `npm run docs:check` is part of `npm run check`.

Still needed:

- Backfill provenance for child tasks created directly by native `hermes kanban decompose` if Hermes exposes child ids in command output/events.
- Decide and implement the promotion policy for when proposed actions may become actual briefs/tasks without human confirmation.
- Connect automatic failure detectors to `report_system_bug` once false-positive and duplicate suppression policy is defined.
- Add lightweight board-card badges for provenance and goal alignment without overloading the Kanban scan view.
- Surface lane owner/team/workflow directly on board cards and dispatch controls.
- Define a policy tier for optional unattended approval of demonstrably low-risk meeting proposals. Until that policy exists, every meeting proposal remains human-reviewed and no synthesis can create Kanban work, change execution policy, or block a task automatically.
