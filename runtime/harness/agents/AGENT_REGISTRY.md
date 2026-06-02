# Agent Registry

**Status**: The machine-readable registry now lives in `runtime/harness/agents/agents.json` and is loaded by the Node cockpit registry plus the Python herder registry bridge. This file is the human-readable orientation layer.

The harness separates two concepts:

1. **Models** — providers/engines (`modelRegistry`)
2. **Agents** — operational workers/controllers with roles, herder session/adaptor references, launch commands, and coordination rules (`agentRegistry`)

This matters because Grok, hinnymen/Feynman, Hermes, etc. are not just model names. They are agents/tools with different launch paths and roles.

## Canonical Object

The canonical writable object is `agents.json`:

- `agents[]`: id, provider, persona, capabilities, optional tmux/session details.
- `teams`: named ordered lists of agent ids.
- `orchestration` (optional project override): lane/team/workflow routing policy consumed by `main/core/orchestration-org.js`.

The cockpit reads/writes this registry through `main/core/registry.js`; the herder reads it through `runtime/harness/agents/agent_config.py` and `runtime/harness/agents/registry.py`.

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

### Docs Steward

Role: documentation handoff and docs-drift prevention

- id: `docs-steward`
- persona: `docs-steward`
- skill: `runtime/harness/skills/docs-steward/SKILL.md`
- team: `documentation-stewards`
- mission: review behavior-changing work before handoff, update authoritative docs, and keep agent/skill/workflow registry docs aligned with implementation.

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

## Docs Handoff Rule

Any change to agents, teams, skills, workflows, provider routing, autonomy, or domain-board behavior must update the relevant docs and pass `npm run docs:check`. See `runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`.
