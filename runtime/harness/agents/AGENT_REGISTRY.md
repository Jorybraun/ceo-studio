# Agent Registry

**Status**: The previous implementation lived in the (now removed) React prototype at `ui/multi-agent-desktop/src/config/agentRegistry.ts`.

The harness separates two concepts:

1. **Models** — providers/engines (`modelRegistry`)
2. **Agents** — operational workers/controllers with roles, herder session/adaptor references, launch commands, and coordination rules (`agentRegistry`)

This matters because Grok, hinnymen/Feynman, Hermes, etc. are not just model names. They are agents/tools with different launch paths and roles.

## Canonical Object

The previous concrete TypeScript implementation was removed along with the React UI prototypes.

The conceptual registry (roles, personas, herder tmux sessions, launch paths, coordination rooms) is documented here and in the herder tools (`launch-agent`, `domain-room-watch --persona`, presence files, etc.).

A future herder-native implementation can re-create a similar structure (JSON, Markdown, or code) when real orchestrator-driven activation is built.

## Current Registered Models

- `gpt-5.5` — current Hermes/default controller model
- `grok` — Grok Build CLI agent
- `hinnymen` — hinnymen is Feynman; research agent/service, web-first at `https://www.feynman.is`

## Current Registered Agents

### Hermes

Role: herder session orchestrator / controller

- id: `hermes`
- modelRef: `gpt-5.5`
- sessionRef: current herder/Hermes session, not desktop-launched
- mission: run the show, assign work, route through Kanban/rooms/adapters, keep coordination in the room

### Grok

Role: general planning / builder worker

- id: `grok`
- modelRef: `grok`
- adapterRef: `grok-discovery` (legacy TTY adapter may use `pipe-grok-discovery` until a headless/API path is confirmed)
- launch command: `grok --resume 019e6f2f-8dbd-7b23-bfa5-aed566488086 --cwd /Users/hans/Code/PIPE/PIPE-OS --always-approve --no-alt-screen`
- mission: execute Hermes assignments and post concise status/handoffs

### hinnymen / Feynman

Role: research agent

- id: `hinnymen`
- modelRef: `hinnymen`
- URL: `https://www.feynman.is`
- adapterRef: `hinnymen-feynman-research` (web/API/browser adapter; legacy TTY slot only if needed)
- launch mode: web-first until CLI/API is confirmed
- mission: source gathering, evidence checks, uncertainty mapping, research briefs

## Coordination Rule

Every registered agent has a `coordination` block pointing at the shared room:

```text
/Users/hans/Code/PIPE/PIPE-OS/harness/brain/rooms/discovery/chat.log
```

Agents should post important status/questions/handoffs through:

```bash
cd /Users/hans/Code/PIPE/PIPE-OS/harness
./bin/domain-room post discovery "<AgentName>" "<message>"
```

## Next Step

The next useful improvement is a small harness command that reads `agentRegistry.ts` or a generated JSON equivalent and can:

- list agents
- show launch commands
- start or resume herder adapters
- prime agents with their mission and coordination rules
- report online/offline status
