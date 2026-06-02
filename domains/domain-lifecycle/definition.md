# Domain: Domain Lifecycle

**Status**: Defined (Initial)  
**Created via**: Domain Architect guided interview + Review & Refinement phase (June 2026 discussion artifacts)  
**Owner Persona (creation)**: Domain Architect  
**Handoff**: To Agenda Agent (see handoffs/001-domain-lifecycle-initial-handoff.md)

## Purpose / Ownership
This domain owns the end-to-end lifecycle of strategic domains inside CEO Studio projects.

It is responsible for:
- How domains are discovered, proposed, and intentionally created.
- The interactive definition experience (conversational interview with live AGUI outline).
- Explicit handoff mechanics from definition to actionable work.
- Ongoing document quality and consistency inside every domain (Dirty → Clean transitions, conflict detection).
- Agent scoping boundaries (System/Critical, Project, Domain) and preventing cross-pollination.
- Recursive knowledge growth through deep-dive linked child documents.

## Overarching Goal / Long-term Outcome
Projects using CEO Studio maintain a living, trustworthy, non-rotating body of domain knowledge from the moment a domain is born. Humans and agents always have a clear, scoped, versioned source of truth for "what this area owns and why", without repeated re-explanation or conflicting information.

Success looks like: New work is always attached to clean domain definitions. The BA Document Guard prevents bad information from entering the trusted base. Agenda Agents reliably triage new domains into the right next actions. The system scales in complexity without documentation debt.

## Key Capabilities / Initial Features
- Guided domain creation interview driven by the Domain Architect persona (right panel chat + live left AGUI clickable hierarchical outline).
- Real-time synthesis of purpose, goal, boundaries, features, relationships, and captured entities during the interview.
- Explicit Review & Refinement phase with deep-dive / recursive document linking from any outline node.
- First-class Handoff records (persisted payload containing synthesized definition + raw artifacts + captured agenda items + user confirmation).
- Per-domain BA Document Guard (two-layer: immutable system rules + editable persona) that enforces Dirty/Clean state on all documents and blocks work on dirty ones.
- Agent scoping enforcement (visibility and activation rules for System vs Project vs Domain agents).
- Integration with existing brain storage, kanban visibility, and provenance.

## Relationships & Boundaries
- **Depends on**: AGUI system (for live outline), Hermes CEO relay (all conversational turns, including specialized personas), brain artifact model, existing domains.js storage.
- **Depended on by**: Almost every other domain (most work eventually touches or creates domains). The L3 swarm orchestration model, project mounting, and CEO oversight all rely on clean domain boundaries.
- **Not owned here**: General kanban mechanics, cost guardrails, self-repair, specific planning-team personas (those remain in their own domains or the harness core).
- **Potential overlaps flagged**: The older heuristic domain detection in projects.js and the legacy `create-domain.sh` / harness teams scaffolding. These should evolve into or coexist cleanly with the new interview-driven flow.

## Captured During Definition (Entities & Agenda Items)
From the defining discussion:
- Subdomain candidate: Agent Scoping Model (System/Project/Domain visibility rules)
- Feature: Live interactive AGUI outline component (clickable tree with context injection back to the agent)
- Feature: Handoff persistence + querying (hybrid brain artifact + kanban task surface)
- Agenda Item: Wire Domain Architect as a primed Hermes mode (or dedicated flow) that emits AGUI blocks for the outline
- Agenda Item: Implement BA Document Guard hooks in brain.writeArtifact + convai doc tools (soft gates first)
- Agenda Item: Extend docs:check + AGENTS.md rules to protect the new critical system agents and two-layer persona convention
- Agenda Item: Create the actual "Domain Lifecycle" domain definition inside CEO_STUDIO using the new process (this document)

## Initial Owner
Domain Architect (during creation interview and handoff)

## Notes from Definition Process
This domain was defined from the June 2026 design discussion. The raw source material now lives inside this domain:

- `docs/design/` (system-overview, domain-creation-process, handoff-protocol, critical-system-agents, agent-scoping-model, domain-terminology, recursive-document-linking)
- `docs/personas/` (domain-architect, agenda-agent, ba-document-guard)

Nothing important from that discussion was lost; it was explicitly extracted into the handoff.

**Canonical home for all Domain Lifecycle design history is now `docs/` under this domain.**

---
**This definition is the output of the Domain Creation Process as specified.** It is intentionally kept at the "good enough to start" level. Deeper decomposition, user journeys, detailed specs, and implementation planning are captured as agenda items for the Agenda Agent and subsequent work.
