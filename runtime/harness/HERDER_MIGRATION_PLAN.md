# Herder Migration Plan

Status: active migration plan.

## Decision

Herder sessions replace tmux as the primary persistent multi-agent coordination model for PIPE-OS.

Tmux is now only a legacy transport/adapter for interactive TTY-only tools that do not yet have a headless/API/browser-control path. It must not be treated as the source of truth.

Research/decision record: `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` captures the tmux-agent orchestration research behind this decision and the target path of domain-room visibility + structured events/herder_mail + registry + herder-agent-manager + dashboard lifecycle.

## Source of truth hierarchy

1. Kanban board state: tasks, claims, blockers, runs, comments, completion.
2. Herder session transcript/context: active mission, decisions, routing, summaries.
3. Domain-room/shared logs: cross-agent status, questions, handoffs, room-visible discussion.
4. Repo artifacts: plans, acceptance criteria, validation evidence, agent registry.
5. Adapter logs/TTY buffers: evidence only after copied into the durable layers above.

## New vocabulary

| Old vocabulary | Replacement |
|---|---|
| tmux session | herder session or adapter process |
| tmux pane | herder participant / agent record |
| send-keys | task assignment, room post, adapter input, delegate prompt |
| capture-pane | task comments, room logs, run logs, session transcript |
| pane alive | agent heartbeat/status |
| tmux bridge | domain-room/herder-room |
| tmux dashboard | herder dashboard / room UI / Kanban board |

## Architecture

### Herder session

The active autonomous controller. Owns mission, routing, prioritization, and coordination policy.

### Kanban

The durable work queue and completion ledger. Every non-trivial task must include acceptance criteria and explicit done/not-done validation.

### Domain room

Shared, append-only conversation layer for multi-agent coordination and browser visualization.

### Agent registry

Canonical operational representation of Hermes, Grok, hinnymen/Feynman, and future collaborators. Agents have model refs, role/mission, session/adaptor refs, output channels, and validation obligations.

### Adapter layer

Temporary compatibility layer for external systems. A TTY/tmux adapter is allowed only when no better control surface exists, and only if outputs are persisted back to Kanban/domain-room.

## Migration backlog

### Phase 1 — Skills and operating docs

- [x] Document tmux-agent research and the herder-native architecture decision in `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`.
- [x] Create `herder-session-management` Hermes skill.
- [x] Delete/absorb `tmux-agent-management` into `herder-session-management`.
- [x] Patch global recursive planning harness skill to use herder terminology.
- [x] Patch `harness/skills/pipe-os-management/SKILL.md` to reference herder sessions.
- [x] Patch `harness/AGENTS.md` communication rules.
- [x] Patch `harness/agents/AGENT_REGISTRY.md` to use `sessionRef`/`adapterRef`.

### Phase 2 — Harness audit and doc cleanup

- [ ] Patch `harness/brain/rooms/README.md` so domain-room is no longer described as a tmux room first.
- [x] Patch `harness/EXTERNAL_CHAT_OPTIONS.md` to reframe Slack/Discord/domain-room around herder, not tmux visibility.
- [ ] (Removed) The React multi-agent-desktop prototype layer has been deleted. Any related migration work is no longer needed.
- [ ] Patch `knowledge/plan/pipe-self-improving-harness-strategy.md` to reflect herder as the current model.

### Phase 3 — CLI/script migration

- [ ] Replace or wrap `harness/bin/agent-launch` with a herder adapter launcher.
- [ ] Replace or wrap `harness/bin/agent-dashboard` with a herder dashboard/registry view.
- [ ] Update `harness/bin/domain-room` comments and behavior so tmux UI is optional, not core.
- [ ] Update `harness/bin/domain-room-ui` copy to say "shared with herder agents/adapters" rather than "shared with tmux agents".

### Phase 4 — Agent adapter implementation

- [x] Merge hinnymen and Feynman into one registered research agent (`hinnymen` / `hinnymen-feynman-research`).
- [ ] Define adapter records for Grok and hinnymen/Feynman in the UI/runtime registry.
- [ ] Determine Grok non-tmux control path: API, one-shot CLI, headless CLI, or browser automation.
- [ ] Determine hinnymen/Feynman control path: API/browser/manual research workflow.
- [ ] Ensure each adapter writes status and outputs to domain-room and Kanban.

### Phase 5 — Validation run

- [ ] Run a full PIPE planning loop without using tmux pane capture as source of truth.
- [ ] Demonstrate one task from created -> assigned -> worked -> validated -> completed using only Kanban/session/domain-room/repo evidence.
- [ ] Record lessons back into `herder-session-management` and this plan.

## Acceptance criteria for migration complete

- No PIPE operating document recommends tmux as the primary multi-agent coordination model.
- Remaining tmux references are explicitly labeled legacy, optional UI, or TTY fallback adapter.
- Agent registry supports `sessionRef` and `adapterRef` as first-class concepts.
- Domain-room remains the durable shared communication layer.
- Kanban remains the durable task/source-of-truth layer.
- External agent outputs are persisted to room/Kanban/evidence files.
- A real herder-native task lifecycle has been validated.
