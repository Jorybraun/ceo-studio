# Tmux Agent Orchestration Research and Herder-Native Architecture Decision

Status: accepted architecture decision, May 2026
Owner: herder-session-management / agent-harness

## Decision

Tmux is a visibility and TTY adapter for agents that require an interactive terminal. It is not the source of truth, the durable brain, the task queue, the lifecycle manager, or the proof that an agent is healthy.

The PIPE/Harness target architecture is:

1. Kanban remains the durable work ledger and completion surface.
2. Domain rooms remain the human-visible shared conversation and audit surface.
3. Structured events / herder_mail carry machine-readable control messages.
4. The agent registry is the canonical source for agent identity, launch mode, room, persona, capabilities, and health policy.
5. A herder-agent-manager consumes events, consults the registry, launches or reuses agents idempotently, and records lifecycle results.
6. The dashboard renders lifecycle state; it does not become the orchestration brain.
7. Tmux is only an adapter for interactive TTY-only CLIs and must copy important output back into Kanban, domain-room, events/herder_mail, or repo evidence files.

Short form: dashboard + chat + tmux panes is not an orchestrator. Herder-native orchestration requires a durable control loop.

## Why this decision exists

The current harness has useful pieces:

- domain-room chat logs
- `herder-chat` and `herder-dashboard`
- `domain-room-watch` presence and heartbeat files
- direct `@agent` steering through tmux key injection
- `herder_mail.py` as an early structured-message prototype
- a declarative agent registry

But the deep-research investigation showed that these are not enough by themselves. A visible chat log and a pane with a heartbeat can make the system look alive while no agent brain is actually reading normal messages, deciding on work, launching collaborators, or writing lifecycle outcomes.

The missing component is a manager/listener that turns structured requests into durable lifecycle changes.

## Lessons from adjacent systems

### Overstory

Reference: https://github.com/jayminwest/overstory

Relevant pattern:

- Persistent coordinator state, typed mail, watchdogs, worktrees/runs, merge queues, and a UI are separate from terminal visibility.
- Workers are normally headless and surfaced through the system UI/API.
- Tmux attach is optional observability or escape hatch, not the primary brain.

Lesson for PIPE/Harness:

Adopt durable coordinator and message-bus patterns. Do not let tmux scrollback or a live pane be the only evidence of work, state, or health.

### Warren

Reference: https://github.com/jayminwest/warren

Relevant pattern:

- Successor direction to Overstory with a durable run/event model.
- Steering is an explicit endpoint/event, such as `POST /runs/:id/steer`, not pane scraping.
- UI, CLI, and API flow through one composition/control path.

Lesson for PIPE/Harness:

Avoid separate hidden paths for UI, CLI, and agent commands. Route human requests, steering, lifecycle state, and completion through one herder-native event/run path.

### multi-agent-shogun

Reference: https://github.com/yohey-w/multi-agent-shogun

Relevant pattern:

- A tmux-first hierarchy can work only when work is persisted outside tmux.
- Coordinator/manager/worker roles are backed by task YAML, reports, decisions, and explicit wake-up notifications.
- Delegation returns control quickly instead of blocking the top-level coordinator.

Lesson for PIPE/Harness:

Even if a CLI agent must run in tmux, assignment, report, and decision state must live in files/events/Kanban/rooms. Tmux is the transport, not the state model.

### claude_codex_bridge / CCB

Reference: https://github.com/SeemSeam/claude_codex_bridge

Relevant pattern:

- Project configuration defines agents, windows, worktrees, models, roles, and routes.
- Runtime state is recoverable.
- Collaboration modes are explicit: direct human targeting, callback-required delegation, silent/background delegation, status requests, and failure reports.

Lesson for PIPE/Harness:

Normal chat messages should not magically mean “orchestrate.” The harness needs explicit routes and event types such as `ACTIVATE_AGENT`, `ASSIGN_TASK`, `STEER_AGENT`, `STATUS_REQUEST`, `AGENT_DONE`, and `AGENT_FAILED`.

### run-kit

Reference: https://github.com/sahil87/run-kit

Relevant pattern:

- Spawner and dashboard are separate.
- A spawner creates worktrees and tmux panes.
- A browser dashboard observes state.
- Agents survive dashboard restart.

Lesson for PIPE/Harness:

The dashboard cannot be the lifecycle owner. PIPE/Harness currently has much of the dashboard/chat half; it still needs the active manager/spawner half.

### AI Maestro

Reference: https://github.com/23blocks-OS/ai-maestro

Relevant pattern:

- Built around cross-agent communication, persistent memory, a dashboard, work coordination/Kanban, and an Agent Messaging Protocol / AMP.
- Tmux can be one deployment mode, but messaging and coordination are first-class.

Lesson for PIPE/Harness:

Agent-to-agent messaging and task coordination must be explicit, typed, and durable. They should not emerge accidentally from panes that happen to be open.

### A2A Protocol

Reference: https://github.com/a2aproject/A2A
Local harness note: `src/herder-overstory/A2A_INTEGRATION.md`

Relevant pattern:

- Agents expose capabilities through Agent Cards.
- Long-running work is modeled as tasks with status, messages, artifacts, streaming updates, and push notifications.
- JSON-RPC / HTTP / SSE provide precise machine-to-machine coordination while hiding internal implementation details.

Lesson for PIPE/Harness:

Keep domain rooms as the visible audit layer, but use herder_mail / A2A-like structured messages for precise machine control. A future A2A adapter should be able to wrap registered persona agents without replacing the room.

## Current PIPE/Harness gap

The investigation found these current-state facts:

- `herder-dashboard` is view-only. It is a monitor, not an orchestrator.
- Normal `herder-chat` messages append to `brain/rooms/<domain>/chat.log`; they do not invoke an orchestrator control loop.
- Targeted `@agent` messages use tmux key injection through `herder-steer`; this is manual steering and depends on a healthy pane at an input prompt.
- `domain-room-watch --persona --heartbeat` creates presence and heartbeats, but without an `--on-message` brain handler it is only a watcher.
- `herder-activate` is manual/future-facing; it is not a long-running listener consuming activation events.
- The registry has useful metadata, but active launch/chat/steer paths do not fully treat it as canonical.
- The Swarm Facilitator / Chat Orchestrator can appear present while its main brain process is absent or idle.

Therefore the current system can show activity without autonomous orchestration. The fix is not “make the dashboard smarter.” The fix is to add the herder-native manager/control loop and make the dashboard render that state.

## Target herder-native path

### 1. Domain-room visibility

Domain rooms remain the human-readable stream:

- human requests
- orchestrator summaries
- visible agent coordination
- lifecycle mirrors such as “AGENT_ACTIVATED deep-research for task X”
- high-signal handoffs and failure explanations

Domain rooms are not the only machine protocol.

### 2. Structured events / herder_mail

Add or formalize a machine-readable channel, such as `brain/rooms/<domain>/events.jsonl`, SQLite-backed herder_mail, or an A2A-compatible transport.

Minimum event types:

- `ACTIVATE_AGENT`
- `DEACTIVATE_AGENT`
- `ASSIGN_TASK`
- `STEER_AGENT`
- `STATUS_REQUEST`
- `AGENT_ACTIVATING`
- `AGENT_ACTIVATED`
- `AGENT_FAILED`
- `TASK_ASSIGNED`
- `AGENT_DONE`

Each event should include:

- stable event id / request id
- idempotency key
- domain / room
- actor / requested_by
- target agent id when applicable
- task or artifact reference
- reason / human-readable summary
- created_at timestamp
- machine payload

### 3. Canonical registry

The registry must drive launch/chat/steer/dashboard/manager behavior, including:

- agent id and display name
- persona and skill set
- canonical room(s)
- launch mode: Hermes profile, external CLI adapter, A2A endpoint, watcher-only, disabled
- tmux session/window only when needed by an adapter
- profile/command/model/provider hints
- capabilities
- health policy and stale timeout
- current lifecycle state or pointer to state file

Unknown or disabled agents should fail visibly. They should not silently create misleading watcher-only sessions.

### 4. herder-agent-manager

The manager is the missing brainstem.

Responsibilities:

- consume structured events exactly once
- consult the registry
- validate requested personas/capabilities
- launch or reuse runtimes idempotently
- start watcher sidecars when appropriate
- route assignment context to the agent through a durable protocol
- write `AGENT_ACTIVATING`, `AGENT_ACTIVATED`, `AGENT_FAILED`, `TASK_ASSIGNED`, and completion/failure events
- mirror human-readable lifecycle lines into the domain room
- checkpoint consumed event ids so restarts do not duplicate spawns

This component should exist outside the dashboard. The dashboard may display manager state, but must not own it.

### 5. Real orchestrator / facilitator brain

A watcher heartbeat is not an agent brain.

For the Swarm Facilitator or Chat Orchestrator to count as active:

- a real LLM/agent runtime must be running with the facilitator persona
- the watcher is only a sidecar
- normal room messages must trigger a reply, delegation, activation request, or explicit failure
- provider/rate-limit/auth errors must become visible lifecycle state

### 6. Dashboard lifecycle view

The dashboard should distinguish:

- brain-running
- watcher-only
- activating
- failed
- stale
- offline
- disabled/manual-required

It should show pending activation requests, recent failures, current task, last heartbeat, last lifecycle event, and registry metadata. It should remain explicit when it is view-only.

## Anti-regression rules

- Do not describe tmux panes as agents unless the brain process and durable lifecycle state prove they are active.
- Do not treat chat.log append as orchestration.
- Do not treat `@agent` key injection as autonomous delegation.
- Do not add orchestration logic hidden inside a dashboard loop.
- Do not create more parallel UIs or launch commands until the canonical manager/registry/event path exists.
- Do not complete Kanban tasks based only on pane presence or screenshots; record done/not-done evidence through the required validation channel.

## Migration checklist

- [ ] Document this decision in root/architecture docs and link it from active plans.
- [ ] Make the registry canonical and machine-readable for launch/chat/steer/dashboard/manager paths.
- [ ] Formalize structured event storage for each domain room.
- [ ] Implement `herder-agent-manager` or equivalent long-running listener.
- [ ] Make the manager consume `ACTIVATE_AGENT` exactly once per idempotency key.
- [ ] Have the manager write `AGENT_ACTIVATING`, `AGENT_ACTIVATED`, and `AGENT_FAILED` events plus room mirrors.
- [ ] Replace invalid/stale launch commands with registry-driven, herder-native launch paths.
- [ ] Make Swarm Facilitator / Chat Orchestrator run a real brain process, not only a watcher heartbeat.
- [ ] Update the dashboard to show lifecycle state and distinguish watcher-only from brain-running.
- [ ] Keep tmux only as a TTY adapter for tools that lack a headless/API path.
- [ ] Persist external-agent outputs back to Kanban, room, events/herder_mail, or repo artifacts.
- [ ] Run the end-to-end validation checklist below before declaring the migration complete.

## End-to-end validation checklist

A herder-native orchestration loop is done only when this can be demonstrated from a clean or restarted state:

1. Post one structured `ACTIVATE_AGENT` event for a known agent, such as `deep-research`, in the discovery room.
2. Prove the manager consumes the event exactly once.
3. Prove the registry resolves the intended agent, room, persona, launch mode, and health policy.
4. Prove the manager launches or reuses the correct runtime idempotently.
5. Prove the system starts the correct watcher/sidecar when needed.
6. Prove durable state receives `AGENT_ACTIVATING` followed by `AGENT_ACTIVATED` or `AGENT_FAILED`.
7. Prove the domain room receives a human-readable lifecycle mirror.
8. Prove the dashboard shows the correct lifecycle label, not just a heartbeat.
9. Send a normal user message to the domain room.
10. Prove the orchestrator/facilitator brain responds, delegates, emits an activation request, or records an explicit failure without requiring manual `@agent` steering.
11. Restart the dashboard and prove agent lifecycle state survives.
12. Restart or re-run the manager and prove it does not duplicate the activation.
13. Record command output, event-log slice, room-log slice, and browser/dashboard validation evidence in the Kanban task or evidence artifact.

## Related harness docs

- `HERDER_MIGRATION_PLAN.md`
- `AGENT_ORCHESTRATION_PLAN.md`
- `CHAT_ORCHESTRATOR_EXECUTION_PLAN.md`
- `HERDER_ORCHESTRATOR_FLOW.md`
- `src/herder-overstory/AGENT_ACTIVATION.md`
- `src/herder-overstory/A2A_INTEGRATION.md`
- `src/herder-overstory/README.md`
- `agents/AGENT_REGISTRY.md`
