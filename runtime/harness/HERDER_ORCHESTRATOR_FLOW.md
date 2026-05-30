# How the Herder Orchestrator Should Work

This document breaks down the intended end-to-end model for the PIPE-OS herder system, based on our discussions and the existing architecture docs.

For the research and accepted architecture decision behind this flow, see `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`. That document is the anti-regression reference: tmux is only a visibility/TTY adapter, not the source of truth or brain.

## Core Principle

The **orchestrator** lives *inside* the herder (as the `kanban-orchestrator` Hermes profile).

It does **not** live outside as a separate script or manual process.

Its job is to:
- Read the durable state (Kanban + domain rooms)
- Decide what work needs to happen
- Cause the herder to activate the right agents with the right personas
- Monitor the swarm via the dashboard and rooms
- Keep everything coordinated without the human manually launching agents

## The Full Flow (Step by Step)

1. **Work Enters the System**
   - A task appears on a domain Kanban board (e.g. "Analyze the microapp brief for graph requirements").
   - Or a human posts a clear request into the domain room.

2. **The Orchestrator Notices**
   - The `kanban-orchestrator` (running inside a herder session) is the active brain.
   - It is loaded with the right skills: `kanban-orchestrator` + `pipe-os-management` + `herder-session-management` + `agent-personas`.
   - It watches Kanban + the relevant domain room(s).

3. **Decomposition & Persona Selection**
   - The orchestrator breaks the work down.
   - It decides: "This needs a Deep Researcher + one Systems Architect + two Builders."
   - It looks up the right personas from the library (`planning-team/` or `agents/personas/`).

4. **Activation Request (The Key Missing Glue)**
   - The orchestrator does **not** manually run `./bin/launch-agent`.
   - Instead, it posts a structured request into the herder (via domain room or the new herder_mail system):
     ```json
     {
       "type": "ACTIVATE_AGENT",
       "persona": "DEEP_RESEARCHER",
       "task_reference": "KANBAN-123 or room message id",
       "room": "discovery",
       "preferred_speaker": "deep-research-1"
     }
     ```
   - This request is visible in the room (so humans can see what's happening).

5. **Herder Layer Executes the Launch**
   - A herder agent manager / adapter (part of `herder-session-management` or a dedicated watcher) receives the request.
   - It:
     - Consults the agent registry.
     - Launches the appropriate runtime (Hermes profile or external like Grok) into its dedicated herder/tmux session.
     - Starts the persona-enabled watcher (`domain-room watch ... --persona DEEP_RESEARCHER`).
     - Registers the agent in the live presence system (so `herder-dashboard` sees it immediately with the correct persona).
     - Injects the persona definition + relevant domain `AGENTS.md` + task context into the agent's session.

6. **The Agent Comes Alive**
   - The new agent appears in the `herder-dashboard` under "Live Agents" with its persona.
   - It starts receiving messages from the domain room (and structured herder_mail).
   - It can post back using the same mechanisms.

7. **Coordination Happens in the Open**
   - All agent-to-agent and agent-to-orchestrator communication flows through the domain room (visible to everyone) + optional structured herder_mail for typed protocol messages.
   - The dashboard shows:
     - Which agents are alive and which persona each is running.
     - The live chat between them.
     - Heartbeats / status.

8. **Work Completes → Feedback Loop**
   - Agents post results, artifacts, questions, or escalation into the room.
   - The orchestrator monitors via the dashboard + room.
   - When done, the orchestrator updates Kanban (the durable source of truth) and can stand agents down or re-task them.

## Current State vs Target (Honest Gap Analysis)

**What we have today (good foundation):**
- Agent registry with personas + coordination rules.
- `launch-agent --persona X` (manual way to get a persona agent into a room).
- `domain-room-watch --persona` + heartbeats.
- `herder-dashboard` (visualization of agents + chat).
- `herder_mail.py` (structured messaging on top of rooms).
- Domain rooms as the shared visible bus.

**What's still mostly manual / missing:**
- The orchestrator itself does not yet automatically request "activate these personas for this task."
- No clean "activation request" protocol that the herder layer listens for.
- Launching is still done by humans/scripts instead of being driven by the orchestrator through the herder.

## Why This Model Matters

- The human steers at the Kanban level (high leverage).
- The orchestrator does the smart routing and delegation.
- The herder layer handles the messy details of launching, presence, and communication.
- Everything stays visible in domain rooms + the dashboard.
- We get the power of Overstory-style swarm orchestration without throwing away the existing herder + registry + room foundation.

## Next Logical Pieces to Build

1. A formal "Activation Request" message type in herder_mail.
2. A small herder-side listener that can turn an activation request into an actual launched persona agent.
3. Make the `kanban-orchestrator` (when running) able to emit these requests based on Kanban state.
4. Enhance the dashboard to show pending activation requests and orchestrator decisions.

This is the "orchestrator controls the herder" loop you're asking for.

---

**Question for you**: Which part of this flow feels most important to make real first?
- The activation request protocol?
- Making the dashboard show orchestrator decisions?
- Something else?

We can execute on the highest-leverage piece right now.
