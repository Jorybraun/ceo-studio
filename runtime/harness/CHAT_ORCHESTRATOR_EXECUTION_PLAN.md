# Chat Orchestrator Execution Plan (Herder-Native Swarm Management)

**Status (2026 update)**: This is the cleaned-up, actionable version of the earlier Chat Orchestrator vision. Many tactical pieces (herder-chat with real key injection, herder-steer, swarm-facilitator persona, UI cleanup) have landed. The core remaining gap is the **activation + registry wiring loop** so the orchestrator (inside the herder) can actually drive persona agent lifecycles instead of humans/scripts doing it manually.

Related decision record: `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` documents the tmux-agent systems research and locks in the architecture rule that dashboard/chat/tmux panes are not enough; the missing production path is structured events/herder_mail + registry + herder-agent-manager + dashboard lifecycle state.

## Context
The user wants the "Chat Orchestrator" (also called Swarm Facilitator) to be a real, persistent, herder-native role that:
- Lives inside the herder (as a Hermes profile or long-running watcher).
- Monitors domain rooms.
- Uses the agent registry + presence to understand the swarm.
- Can request new persona agents via structured `ACTIVATE_AGENT` messages.
- Facilitates coordination between specialists.
- Keeps everything visible and auditable in domain rooms + herder-dashboard.

The fundamental principle (repeated by the user): **we are using the herdr**. No external terminals, no osascript, everything through herder sessions, domain rooms, and key injection where needed.

## Current State (Updated)
**What now exists and works:**
- `domain-room` family + `domain-room-watch --persona` + heartbeats/presence.
- `launch-agent --persona X` (practical manual path for external agents like Grok).
- `herder-steer` + `herder-chat` with real `@agent message` that does `tmux send-keys + Enter` ("fire in the input").
- `swarm-facilitator.md` persona created (communication-heavy role).
- Major cleanup: entire React/npm `ui/` layer (multi-agent-desktop + room-chat) deleted to stop duplication.
- `herder-dashboard` (Rich) and `herder-chat` (Textual) as the terminal-native visibility surfaces.
- `herder_mail.py` prototype for structured messaging on top of rooms.
- `AGENT_ACTIVATION.md` and `HERDER_ORCHESTRATOR_FLOW.md` documenting the target model.

**What is still broken / missing (the real blocker):**
- The agent registry (`agents/AGENT_REGISTRY.md`) is **not wired** into any runtime herder tools. `launch-agent`, watchers, steering, and dashboards do not read it.
- No listener for `ACTIVATE_AGENT` requests. The orchestrator (kanban-orchestrator or swarm-facilitator) cannot yet cause the herder to launch a new persona agent.
- Launching and persona attachment is still a manual/human or scripted activity.
- The swarm-facilitator persona exists on disk but has no running agent actually using it in a persistent way.
- No end-to-end where the orchestrator inside the herder says "I need a Deep Researcher for this task" and the agent appears with presence.

## Vision (Unchanged)
The orchestrator (kanban-orchestrator profile) stays at strategic/Kanban level. For active domain work it can delegate swarm management to a **Chat Orchestrator / Swarm Facilitator** role. That role uses domain rooms as the visible bus + structured herder_mail for typed coordination, and can request activation of new specialists via the herder layer (registry + activation protocol).

Everything stays herder-native. The human steers at Kanban + high-signal room posts. The dashboard is the live view.

## PR Plan

### PR 1: Wire the Agent Registry into the Herder Tools (Foundation)
**Description**: Make `agents/AGENT_REGISTRY.md` (or a generated JSON/MD form of it) the actual source of truth that `launch-agent`, `domain-room-watch`, `herder-steer`, presence, and the dashboards consult. Stop duplicating persona/room/session info in CLI flags and ad-hoc files.

**Files/components affected**:
- `harness/agents/AGENT_REGISTRY.md` (make it the canonical machine-readable source or generate JSON from it)
- `harness/bin/launch-agent`
- `harness/bin/domain-room-watch`
- `harness/bin/herder-dashboard` (replace the stub)
- `harness/bin/herder-chat` (for persona resolution + steering targets)
- Possibly a small `harness/bin/herder-registry` helper or library

**Dependencies**: None

### PR 2: Minimal Herder-Side ACTIVATE_AGENT Listener + Activator
**Description**: Implement the missing piece from `src/herder-overstory/AGENT_ACTIVATION.md`. A small herder component (long-running watcher or extension to domain-room-watch / a new `herder-activate` tool) that listens for `ACTIVATE_AGENT` messages in a domain room, validates against the now-wired registry, launches the appropriate persona agent (reusing `launch-agent` logic or direct herder session creation), registers presence, and posts `AGENT_ACTIVATED`.

**Files/components affected**:
- `harness/src/herder-overstory/` (herder_mail + new activator logic)
- New or extended `harness/bin/herder-activate` (or integrated into domain-room)
- Updates to `launch-agent` to be callable as a library/step
- `harness/agents/AGENT_REGISTRY.md` usage in activation path

**Dependencies**: PR 1

### PR 3: Make the Swarm Facilitator / Chat Orchestrator Persona Actually Runnable
**Description**: Create the minimal herder session + watcher setup (or Hermes profile) that runs the `swarm-facilitator` persona persistently for a domain. It should monitor the room, maintain swarm awareness (via the now-wired registry + presence), and be able to emit `ACTIVATE_AGENT` requests.

**Files/components affected**:
- `harness/agents/personas/swarm-facilitator.md` (refine if needed)
- `harness/bin/launch-agent` or new `herder-swarm-facilitator` entrypoint
- Example usage / docs in `HERDER_ORCHESTRATOR_FLOW.md`

**Dependencies**: PR 1, PR 2 (to be able to request new agents)

### PR 4: End-to-End Swarm Test + Orchestrator Delegation Path
**Description**: Demonstrate the full loop: kanban-orchestrator (or human via room) posts high-level work for a domain → Chat Orchestrator / Swarm Facilitator decides on needed personas → emits `ACTIVATE_AGENT` → agents appear with correct personas in the dashboard and room → they collaborate visibly (using room + herder_mail) → results surface to Kanban. Use a real (small) Discovery task.

**Files/components affected**:
- Updates to `harness/HERDER_ORCHESTRATOR_FLOW.md` and related docs
- Possibly small enhancements to herder-chat/herder-dashboard for better orchestrator visibility
- Test scenario in the discovery room + Kanban

**Dependencies**: PR 1, PR 2, PR 3

### PR 5 (optional, lower priority): Polish & Hardening
**Description**: Better error handling / visibility when activation fails; herder-dashboard improvements for swarm health; make `herder-chat` the clearly primary steering surface; full registry as a proper JSON + loader.

**Files/components affected**:
- Various herder bin tools and docs

**Dependencies**: PR 4

## Verification Criteria
- The registry is consulted by the main herder tools instead of ad-hoc flags.
- The Chat Orchestrator (or kanban-orchestrator) can cause a new persona agent to appear without a human running `launch-agent`.
- A small swarm (Facilitator + 1-2 specialists) can be stood up for a real task with most coordination visible in the room + dashboard.
- All of this remains strictly herder-native (tmux sessions, domain rooms, key injection for steering).