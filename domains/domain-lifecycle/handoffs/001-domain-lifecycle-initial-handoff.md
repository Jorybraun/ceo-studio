# Handoff #001 — Domain Lifecycle (Initial Definition)

**From**: Domain Architect (Critical System Agent)  
**To**: Agenda Agent (Critical System Agent)  
**Status**: pending  
**Created**: 2026-06-01 (from June 2026 design discussion)  
**Human visible**: Yes (CEO / project owner should see this)

## Context
**Project**: CEO_STUDIO  
**Domain**: Domain Lifecycle (the capability that implements the new agent-mediated domain model itself)

## Trigger
User (after reviewing the design discussion artifacts) requested that the "Domain Functionality" described in the tmp/ (now promoted) documents be turned into a real, first-class domain inside the CEO_STUDIO project using the exact process the documents specify.

## Payload — Synthesized Domain Definition
See sibling file: `../definition.md`

Key extracted elements:
- Clear purpose and long-term outcome around preventing documentation rot through intentional domain birth + hygiene.
- Six core fields populated (name, purpose, overarching goal, initial features, relationships, owner persona).
- Captured entities during "interview" (subdomains, features, concrete agenda items listed in definition.md).

## Raw Artifacts / Source Material
The full June 2026 design discussion that produced this definition now lives **inside this domain** (canonical location after migration):

- `docs/design/system-overview.md`
- `docs/design/domain-creation-process.md`
- `docs/design/handoff-protocol.md`
- `docs/design/critical-system-agents.md`
- `docs/design/agent-scoping-model.md`
- `docs/design/domain-terminology.md`
- `docs/design/recursive-document-linking.md`
- Personas (design versions): `docs/personas/domain-architect.md`, `docs/personas/agenda-agent.md`, `docs/personas/ba-document-guard.md`

These serve as the "raw transcript + captured entities" for this handoff.

**Note:** The previous (incorrect) promoted copies under `runtime/harness/architecture/domains/` have been removed. This domain now owns its own design history.

## User Confirmation (the "this feels good" moment)
The user explicitly directed: create the domain definition for this functionality in the actual structure the app generates / the new vision describes, not as another tmp document. They want the output of the Domain Architect process, followed by proper handoff to Agenda Agent.

## Suggested Next Agenda Items (from Domain Architect perspective)
1. Agenda Agent to review this new "Domain Lifecycle" domain and propose a kickoff plan (including whether it needs its own subdomain for "Agent Scoping" or "BA Guard implementation").
2. Decide on the delivery mechanism for handoffs in v1 (hybrid brain artifact + kanban task recommended in the design doc).
3. Schedule or create the first concrete implementation work items. Use the new Brief Sectional Decomposer (documented in `docs/features/brief-sectional-decomposer.md` inside this domain) to turn high-level briefs into properly sectioned child plans on this board.
4. Determine how the live AGUI outline component will be built (PR 1–2 in the plan) and how the Domain Architect persona will be invoked for future domains.
5. Ensure the BA Document Guard two-layer model is documented and protected by the docs-steward process.

## Notes / Scope Warnings
- This domain is meta: it is the domain that defines how all other domains (including itself in the future) will be created.
- We are currently in the "design placeholder" phase for the three new Critical System Agents (registered in agents.json but not yet fully wired with two-layer prompts or dedicated flows).
- Legacy domain creation paths (heuristic detection in projects.js + create-domain.sh) exist and should be documented as coexisting during the transition.

## Handoff Record Metadata
- ID: 001-domain-lifecycle-initial-handoff
- Triggered by: Direct user request after docs sync and planning session
- Payload includes both clean synthesized definition and references to raw source material
- No automatic execution — human/CEO + Agenda Agent must decide sequencing

---
**This handoff is now the official record.** The Agenda Agent (or the CEO directing it) owns what happens next. The Domain Architect's job for this domain creation is complete.
