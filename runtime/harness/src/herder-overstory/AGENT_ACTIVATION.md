# Herder-Native Agent Activation

This document defines how the orchestrator (running inside the herder) requests the herder layer to activate an agent with a specific persona.

## Principles

- Everything goes through the herder (herder-session-management, agent registry, domain rooms).
- The orchestrator does not run raw `launch-agent` or `tmux` commands directly.
- Activation is a first-class herder operation.
- The result is a live agent record with presence, heartbeat, and a coordination contract (room + speaker).

## Activation Request (Minimal v0)

Posted by the orchestrator (via domain room or herder_mail) as a structured message:

```json
{
  "type": "ACTIVATE_AGENT",
  "request_id": "uuid",
  "persona": "DEEP_RESEARCHER",
  "skills": ["research", "analysis"],
  "domain": "discovery",
  "task_reference": "KANBAN-123 or room thread id",
  "preferred_speaker": "deep-research-1",
  "context_hints": {
    "brief": "...",
    "relevant_docs": ["..."]
  }
}
```

## What the Herder Layer Does

1. Validates the request against the agent registry (does a persona + skills combination exist?).
2. Determines the appropriate runtime/adapter (Hermes profile, external Grok watcher, A2A endpoint, etc.).
3. Creates or reuses the herder session / adapter for this agent.
4. Starts the persona-enabled runtime (injects the persona definition + domain AGENTS.md + task context).
5. Starts the appropriate watcher / listener (domain-room-watch or A2A equivalent).
6. Registers/updates the live agent record with:
   - persona
   - current herder session / adapter ref
   - coordination (room, speaker)
   - heartbeat / status
7. Posts a response back into the domain room / herder_mail:
   ```json
   {
     "type": "AGENT_ACTIVATED",
     "request_id": "...",
     "agent_id": "grok-builder-1",   # Example using a safer/cheaper specialist instead of grok-research
     "session_ref": "pipe-grok-builder-1",
     "speaker": "deep-research-1",
     "room": "discovery"
   }
   ```

## Visibility

- The new agent immediately appears in `herder-dashboard` with its persona.
- All communication (including the activation request itself) is visible in the domain room (or summarized there).
- Heartbeats keep the presence fresh.

## Current Gap

Today we have no component that listens for `ACTIVATE_AGENT` and performs the above steps. `launch-agent` and `domain-room-watch` are manual workarounds.

## Next Step

Build a minimal "herder-agent-activator" (could be a long-running watcher or part of herder-session-management) that can handle `ACTIVATE_AGENT` requests for the common case (external agents via our watcher + persona).

This is the concrete piece that lets the orchestrator (inside the herder) actually control agent lifecycles instead of humans/scripts doing it.
