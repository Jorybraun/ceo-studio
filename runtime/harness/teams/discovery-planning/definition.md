# Team: discovery-planning

**Canonical name**: `discovery-planning`

This is the core planning team for the discovery domain.

## Charter

Own the full intake, discovery, and planning cycle for PIPE's discovery layer. The team turns raw human conversations (and other intake) into high-signal, fully-planned, approved assets that can safely move from Triage → Ready without loss of context or signal.

The team does **not** implement the application. It plans, researches, specifies, mocks, and documents what must be true.

## Core Roles & Default Personas

Default Personas: orchestrator, ba, architect, pm, qa-planning, SENIOR_DESIGNER_UX

| Role                  | Default Persona          | Primary Responsibility |
|-----------------------|--------------------------|------------------------|
| Orchestrator          | kanban-finisher / ceo-orchestrator | Owns workflow, routing, context integrity, Kanban movement, escalation |
| PM                    | pm                       | Roadmap, epic breakdown, high-level requirements |
| BA                    | ba                       | Full project context, user journeys, decomposition, living docs |
| Architect             | architect / SYSTEMS_ARCHITECT | Technical specs, ADRs, data models, transcript provenance, cross-domain contracts |
| Design Planning       | SENIOR_DESIGNER_UX       | Living HTML mocks for every user-facing piece before execution |
| QA Planning           | (qa-planning when exists)| Explicit test coverage + quality criteria before any builder work |

All members operate inside the domain's `team-harness/`, read the domain `AGENTS.md` as law, and post visible work into the domain room + update the Kanban.

## Standing Workflow

When this team is activated for a card in **Triage** (see the domain's `mgmt/stage-map.md`):

- Follow `workflows/discovery-planning-triage.md`
- Produce the full asset package required by the Board Rules in `kanban.md`
- Everything enters via Triage; nothing leaves Triage without the complete package + explicit approval

## Activation

This team is normally stood up by the Kanban Finisher (or a human orchestrator) when the top open item for the domain is in the Triage column and the stage-map points at `team: discovery-planning`.

Example delegation (via harem or direct):

```
harem delegate --task "..." --team discovery-planning --workflow discovery-planning-triage
```

Or the Kanban Finisher reads the stage-map, sees the team + workflow, loads the relevant definition + workflow docs into context, and drives the delegation + monitoring loop.

## Non-Negotiables (from domain AGENTS.md)

- The raw transcript is a first-class, immutable, queryable artifact.
- Any synthesis / RCD / profile is secondary and must be traceable back to the original transcript.
- No over-synthesis that destroys specific language, tone, contradictions, or context.
- No agent "just knows" context — query the living docs first.
- Chat (domain room) is the place plan changes and handoffs are made visible.

## Success Signal

When a hiring manager (or downstream consumer) can look at a set of discovery transcripts produced under this team's work and immediately feel "these people actually understand what we're looking for," without needing a 12-page generic synthesis document.

## References

- Domain law: `context/discovery-team/AGENTS.md`
- Domain orchestrator contract: `context/discovery-team/team-harness/orchestrator.md`
- Board rules & current items: `context/discovery-team/mgmt/kanban.md`
- Active stage binding: `context/discovery-team/mgmt/stage-map.md`
