# Docs Stewardship And Agent Handoff

## Problem

CEO Studio is changing from a desktop shell into a Hermes-backed autonomy cockpit. The system now has briefs, bugs, goals, provenance, orchestration org routing, self-repair intake, voice tools, and multiple agent/team registries. Without a required docs pass, every future agent has to rediscover what is real.

## Decision

Documentation stewardship is a required passoff step for behavior-changing work.

The dedicated owner is:

- Agent: `docs-steward`
- Persona: `runtime/harness/personas/general/docs-steward.md`
- Skill: `runtime/harness/skills/docs-steward/SKILL.md`
- Team: `documentation-stewards`

This is not a separate product feature. It is an operating gate that every agent, including Codex-style coding agents, must satisfy before handoff.

## Required Handoff

For any change to architecture, autonomy, providers, registry/org structure, IPC, voice tools, domain-board behavior, goals, bugs, provenance, or self-repair:

1. Identify affected authoritative docs.
2. Update those docs in the same change.
3. Update agent/persona/skill registry docs if tools or roles changed.
4. Run `npm run docs:check` or `npm run check`.
5. Report docs changed and known gaps in the final handoff.

## Authoritative Docs

| Area | Primary docs |
|---|---|
| Agent operating rules | `AGENTS.md` |
| User/project orientation | `README.md` |
| Capability ladder and original build plan | `E2E_PLAN.md`, `NORTH_STAR.md` |
| Domain board/autonomy/org routing | `runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md` |
| Docs handoff policy | this file |
| Agent registry and teams | `runtime/harness/agents/agents.json` |
| Skills and personas | `runtime/harness/skills/`, `runtime/harness/personas/` |

Superseded docs may remain for history, but they must clearly say they are superseded and point to the current source of truth.

## Mechanical Gate

`npm run docs:check` runs `scripts/docs-check.js`. It verifies the minimum docs contract:

- Root `AGENTS.md` preserves the Hermes CEO/no API-key rule.
- Root `AGENTS.md` contains the documentation handoff rule.
- `README.md` points to the autonomy/org routing and docs stewardship docs.
- `DOMAIN_BOARD_AUTONOMY_E2E.md` mentions current domain-board/autonomy/org components.
- The docs steward skill/persona exists.
- `agents.json` registers `docs-steward` and `documentation-stewards`.

This is intentionally lightweight. It does not prove every doc is perfect; it prevents the most damaging forms of drift.

## What Counts As Done

A docs pass is complete when:

- The docs describe implemented behavior, not only planned behavior.
- Any remaining stale/superseded docs are clearly marked.
- New tools/agents/workflows are discoverable from registry/config and human docs.
- The final handoff says what was updated and which gaps remain.
