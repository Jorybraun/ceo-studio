# Agent Orchestration & Lifecycle Plan (Herder-Native)

**Status**: Draft for alignment (May 2026)
**Owner**: CEO Orchestrator + herder-session-management

Related decision record: `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` is the accepted research/architecture decision behind this plan: tmux is a visibility/TTY adapter, while domain rooms, structured events/herder_mail, the registry, herder-agent-manager, and dashboard lifecycle state form the herder-native control loop.

## Core Principle

The **CEO Orchestrator** (the `kanban-orchestrator` Hermes profile) is the strategic brain.  
It does **not** directly manage low-level agent processes.  
It decomposes work, creates high-quality delegations, and lets the herder + specialized harnesses handle execution.

"Spinning up agents" and "managing the live agent context" is the job of the **herder layer**, not the CEO Orchestrator itself.

## Layers of Responsibility

### 1. CEO Orchestrator (Strategic Layer)
- Loaded with: `kanban-orchestrator` + `pipe-os-management` + `herder-session-management` + `agent-personas`
- Responsibilities:
  - Maintains holistic project context + priorities (via brain + Kanban + domain rooms)
  - Decomposes goals into clear work packages / delegation requests
  - Decides *which* harness or specialist profile should handle a piece of work
  - Creates high-quality handoff artifacts (requirements, acceptance criteria, context slices)
  - Monitors progress via Kanban + domain rooms
  - Prepares results for human review
- **Does NOT**:
  - Directly launch individual specialist agents
  - Manage tmux sessions or low-level processes
  - Maintain runtime heartbeats

### 2. Herder Layer (Runtime Execution & Coordination Layer)
This is where "live agent context" and agent lifecycle actually live.

Key components:
- **herder-session-management** (Hermes skill): The primary mechanism for persistent multi-agent coordination. Owns agent records, adapters, sessions, and presence.
- **Agent Registry** (`agentRegistry.ts` + generated JSON): Canonical list of known agents, their roles, personas, skills, launch configs, and coordination rules (including which domain room they post to).
- **Domain Rooms**: The shared, append-only, browser-visible communication bus attached to a herder session. This is where cross-agent handoffs and status happen in real time.
- **Kanban**: The durable task ledger and source of truth for work state.

Responsibilities of the herder layer:
- Registering / activating agents into the live context
- Launching or resuming agent adapters/sessions when requested
- Maintaining online/offline/heartbeat status
- Routing messages between agents and the orchestrator via domain rooms
- Exposing "who is alive and what are they doing" queries

### 3. Specialist Agents (Worker Layer)
These are the things that actually do the work (planning, research, design, coding, etc.).

They are launched/activated **by the herder layer** (triggered by delegations from the CEO Orchestrator), not directly by the CEO.

Each specialist should be configured with:
- A persona (from the planning-team or agents/personas library)
- Relevant skills (loaded via Hermes profile or context injection for external agents)
- A coordination contract (which room they post to, what speaker name they use)

## Current State vs Desired State (May 2026)

**Current (what we've been building manually):**
- `agent-launch` + `launch-agent` scripts that create raw tmux sessions
- `domain-room watch` + `--persona` as a way for external agents (Grok) to stay alive and see the room
- Manual coordination via posts to the room
- Agent registry exists but is mostly declarative/static

**Desired (herder-native):**
- The CEO Orchestrator posts a clear delegation request (to Kanban + room)
- The herder layer (via `herder-session-management`) sees the delegation and activates the appropriate registered agent/adapter with the right persona + skills
- The activated agent appears in the "live agent context" with proper heartbeat/status
- The agent watches its assigned domain room (or is pushed tasks)
- All status, outputs, and handoffs flow through domain-room + Kanban (not tmux panes)
- The CEO Orchestrator monitors at the strategic level only

## Recommended Next Steps (to close the gap)

1. **Make the Agent Registry runtime-aware**
   - Add live status fields (online/offline, last heartbeat, current session/adapter)
   - Build a small CLI or Hermes skill that can query + update this ("report online/offline status" as called out in AGENT_REGISTRY.md)

2. **Implement a Herder-native launcher**
   - Replace/augment `agent-launch` and `launch-agent` with something that goes through `herder-session-management`
   - When the orchestrator (or human) wants a specialist, it requests activation via the herder, which handles persona/skill loading + room registration

3. **Standardize how personas + skills are attached to live agents**
   - For Hermes profiles: via profile + skill loading at launch time
   - For external agents (Grok etc.): via the watcher + explicit `--persona` + context priming from the registry
   - The watcher we built (`domain-room-watch --persona`) is a good temporary adapter for external agents

4. **Make domain rooms the primary observation surface**
   - All agent heartbeats, status, and task handoffs should be visible in the room (not hidden in tmux)
   - `domain-room who` should eventually be powered by the live agent registry + herder presence, not just log parsing

5. **Clarify the delegation contract**
   - Document the exact shape of a "Delegation Request" that the CEO Orchestrator creates when it wants a persona+skills agent to do work
   - This request should be sufficient for the herder layer to activate the right thing

## For the Discovery Domain Right Now

Until the full herder-native lifecycle is built, the pragmatic path is:

- Use the CEO Orchestrator (kanban-orchestrator profile) for high-level decomposition and delegation decisions.
- Use `launch-agent --persona X` (or direct `domain-room watch --persona X`) as the current adapter to get a live specialist visible in the room.
- All coordination happens visibly in the discovery room + Kanban.
- We treat the current watcher + persona mechanism as a temporary herder adapter (as allowed in the migration plan).

This keeps us moving on real Discovery work while we build the missing runtime orchestration pieces.

---

**Next action for alignment**: Review this with the human + Hermes (kanban-orchestrator). Decide which of the 5 steps above we tackle first so the "orchestrator spins up persona agents" experience becomes real instead of manual.

## The Core Flow: Kanban Through Hermes Through the Orchestrator

This is the mental model:

```
Human
   │
   │ (steers via decisions, priorities, approvals)
   ▼
Kanban (Portfolio + Per-Domain boards)
   │
   │ (durable source of truth for all work state)
   ▼
kanban-orchestrator (Hermes profile)
   │   loaded with: kanban-orchestrator + pipe-os-management
   │                + herder-session-management + agent-personas
   │
   │ (the active CEO brain — decomposes, routes, delegates)
   ▼
Herder Layer (herder-session-management + Agent Registry)
   │
   ├── Domain Rooms (real-time visible A2A + human coordination bus)
   │
   ├── Agent Records + Presence (live agent context)
   │
   └── Launch / Activation of Persona Agents
            │
            ▼
       Specialist Agents (with loaded personas + skills)
            │
            └── Execute work → Post status/handoffs back to Room + Kanban
```

**Key rules in this model:**

- **Kanban is primary.** The orchestrator reads Kanban first. Domain rooms are for real-time discussion and handoffs, not the source of truth.
- The **kanban-orchestrator** does *not* implement. It decides what needs to happen and who (which persona profile or external harness) should do it.
- When it wants a persona-driven agent for a task, it goes through the herder layer (via herder-session-management) to activate/register the right agent from the registry with the correct persona.
- All important outputs and decisions eventually land back in Kanban comments or as new Kanban items.

This is why raw tmux spawning and manual watchers feel wrong — they sit outside this flow. The goal is for the orchestrator (operating through Hermes) to be the one that causes the right persona agent to appear in the right domain room with the right context.


## Who Is Actually Orchestrating the Agents Right Now? (May 2026 Status)

**Short answer**: Nobody, in the automated sense you want.

### Current Reality

- The `kanban-orchestrator` Hermes profile exists and is *intended* to be the CEO brain.
- When you run `./bin/launch-agent --name foo --persona BAR`, you (the human or a script) are manually deciding to launch the agent.
- The `domain-room-watch --persona` + `herder-dashboard` are just **observability + presence** tools. They let agents see the room and let you see the agents.
- There is no process that:
  - Watches Kanban + the domain room
  - Decides "we need a Deep Researcher + two Builders for this task"
  - Automatically triggers the herder to launch/register those specific persona agents
  - Assigns them the work via structured messages
  - Monitors their heartbeats and escalates if they stall

The orchestrator (kanban-orchestrator) is mostly doing high-level decomposition and posting text into the room or Kanban. It is not yet driving the *lifecycle* of persona agents through the herder.

### The Missing Piece (the actual "orchestrator controls the herder" loop)

What needs to exist:

1. **Activation / Launch Request Protocol**
   The orchestrator (or a human via Kanban) should be able to post a structured request into the herder, something like:
   ```json
   {
     "type": "ACTIVATE_AGENT",
     "persona": "DEEP_RESEARCHER",
     "skills": ["research", "analysis"],
     "task_id": "TASK-123",
     "room": "discovery",
     "speaker_name": "deep-research-1"
   }
   ```

2. **Herder Agent Manager**
   A component (part of `herder-session-management` or a dedicated adapter) that listens for these requests and:
   - Looks up the agent in the registry
   - Launches the appropriate runtime (Hermes profile or external via `launch-agent` style mechanism)
   - Starts the watcher with the correct persona
   - Registers the agent in the live presence / context with heartbeat tracking
   - Returns the agent identifier back to the orchestrator

3. **The kanban-orchestrator becomes the real driver**
   Instead of you manually typing `./bin/launch-agent`, the kanban-orchestrator (running inside Hermes) sees work on Kanban, decides on the needed personas, and emits the `ACTIVATE_AGENT` requests through the herder.

This is the gap between "we have tools to launch persona agents" and "the orchestrator manages the herder and the swarm."

### Recommended Immediate Next Step

Define and implement a minimal **Agent Activation Request** flow using the `herder_mail` system we started:

- Add a new message type `ACTIVATE_AGENT` to herder_mail.
- Create a small "herder-agent-manager" process (or extend the watcher) that can receive these requests.
- Wire a simple path so the kanban-orchestrator (or you, for testing) can trigger it.

Once that exists, we can start moving from manual `launch-agent` commands to the orchestrator actually controlling which persona agents are alive.

This is the concrete thing that will make the dashboard useful — it will show agents that the orchestrator itself decided to spin up, not ones we launched by hand.

