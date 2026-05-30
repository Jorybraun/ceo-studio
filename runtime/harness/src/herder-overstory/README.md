# Herder + Overstory Adapters

This directory contains patterns and code adapted from Overstory (https://github.com/jayminwest/overstory) to make the PIPE-OS herder support proper multi-agent swarms with personas.

## Goals (non-reinvention)

- Use Overstory's proven ideas without copying the whole system:
  - Capability/persona-driven workers
  - Structured agent-to-agent messaging (better than raw chat.log)
  - Coordinator/orchestrator pattern that lives in the herder
  - Clean separation of "what the agent is" (persona) from "what it should do now" (task overlay)

- Integrate with existing PIPE-OS primitives:
  - Agent Registry (personas, skills, launch configs, coordination rooms)
  - Domain Rooms (as the visible comms bus)
  - Tmux/TTY adapters only where an interactive CLI requires them
  - `kanban-orchestrator` + `herder-session-management` as the brain

## Key Adaptations We're Considering

1. **Herder Mail** — A typed messaging protocol on top of (or alongside) domain rooms, inspired by Overstory's SQLite mail bus.
2. **Persona + Capability Worker Spawning** — Enhance `launch-agent` so the orchestrator can say "launch 3 builders + 1 reviewer with these personas for task X".
3. **Coordinator Pattern** — A persistent herder agent that owns decomposition and dispatch, rather than the raw kanban-orchestrator doing everything.

See also:

- `../../architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` — research and architecture decision: tmux is a visibility/TTY adapter, not the source of truth or brain.
- `../../AGENT_ORCHESTRATION_PLAN.md` — active herder-native lifecycle plan.
