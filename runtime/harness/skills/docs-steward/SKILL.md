---
name: docs-steward
description: "Keep CEO Studio docs aligned with code, agent registry, workflows, and autonomy behavior. Use before handoff when behavior, architecture, IPC tools, voice tools, providers, or orchestration changes."
version: 0.1.0
author: CEO Studio
tags: [documentation, handoff, governance, docs-drift, agent-quality]
related_skills: [custom-kanban-workflows, herder-swarm-control]
---

# Docs Steward

Use this skill whenever a change affects how the system works or how agents should operate.

## Job

Prevent documentation drift. The docs steward does not rubber-stamp work; it checks whether future agents can understand the real current system without needing this conversation.

## When To Use

Use for changes to:

- Hermes CEO relay, model/provider setup, or API-key assumptions
- Domain board briefs, bugs, goals, provenance, self-repair, autonomy loops, or orchestration org structure
- IPC/preload/renderer/voice tool surfaces
- Agent registry, personas, teams, workflows, skills, or dispatch paths
- Verification commands, hooks, or operating rules

Do not use for purely cosmetic edits that do not affect behavior or operating instructions.

## Required Pass

1. Identify authoritative docs for the changed area.
2. Compare docs against code and tests, not against memory.
3. Update stale docs in the same change.
4. Add or update a check if the drift is likely to recur.
5. Leave a short handoff note listing docs changed and any docs intentionally left stale.

## Authoritative Docs

- Root operating rules: `AGENTS.md`
- Current user-facing orientation: `README.md`
- Full implementation ladder: `E2E_PLAN.md`
- Domain/autonomy architecture: `runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md`
- Docs governance: `runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`
- Agent registry: `runtime/harness/agents/agents.json`
- Persona/skill behavior: `runtime/harness/personas/` and `runtime/harness/skills/`

## Quality Criteria

A docs pass is good when:

- A future agent can find the current source of truth in one or two links.
- Docs distinguish implemented behavior from planned behavior.
- Provider/CEO routing claims do not reintroduce the API-key CEO mistake.
- New tools/agents/workflows appear in both registry/config and human-readable docs.
- `npm run docs:check` passes.

## Handoff Template

```markdown
Docs pass:
- Updated: <files>
- Checked but unchanged: <files>
- Intentional gaps / follow-up docs: <items or none>
- Verification: npm run docs:check
```
