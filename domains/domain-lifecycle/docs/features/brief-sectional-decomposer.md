# Feature: Brief Sectional Decomposer (Break Brief into Sections + Multiple Plans)

**Status**: Design / Implementation starting  
**Domain**: Domain Lifecycle  
**Owner (initial)**: Planner + Agenda Agent (with CEO oversight)  
**Related Design Docs**:
- `../design/domain-creation-process.md` (Review & Refinement + deep dive)
- `../design/handoff-protocol.md` (Agenda Agent triage + suggested decomposition points)
- `../design/critical-system-agents.md` (Agenda Agent responsibilities)
- `../../definition.md` (Key Capabilities + Captured Agenda Items)
- `../personas/agenda-agent.md`

---

## Purpose
Enable high-quality, repeatable decomposition of large, structured briefs into **logical sections** and **well-structured Agenda Items** (the primary output).

An Agenda Item (per the architecture in `../design/handoff-protocol.md`, `../personas/agenda-agent.md`, and captured examples) includes:
- Reference to the parent brief/handoff.
- Description and context (pulled from brief sections + design docs).
- Action items / concrete next steps (light breakdown only).
- Suggested routing to existing agents/personas from the registry (`runtime/harness/agents/agents.json`).
- If no good match: explicit proposal to create a new persona (draft) and/or registry entry.
- Priority, human flags, provenance links to supporting docs/specs.

These Agenda Items are the "what needs to happen next" that the Agenda Agent produces. They may then be turned into (lightweight) child briefs, tasks, swarm definitions, or other execution artifacts — but the decomposer focuses on producing high-quality, routable Agenda Items first.

This is core infrastructure for the Domain Lifecycle vision: when an Agenda Agent receives a handoff containing a complex body of work, it (or a human) can use the decomposer to turn the resulting brief into well-scoped, linked, provenance-tracked Agenda Items that respect the architecture (light triage only by Agenda Agent; deeper work handed off to specialists; human-visible; nothing lost; match or extend the agent registry).

See the dedicated detailed spec and plan: `../plans/decomposer-spec-and-plan.md` (this is the canonical place for the full Agenda Item data model, matching logic, and phased implementation).

For handoff-sourced work, the decomposer consumes the normalized package defined in `../plans/handoff-intake-contract.md` instead of arbitrary markdown.

## Why This Matters (Problem / Mismatch)
Current flow (`Decompose` button → `hermes kanban decompose`):
- Produces flat, low-context child tasks.
- Ignores the rich structured sections already present in every valid brief (`### Goal`, `### Problem / Mismatch`, `### Acceptance Criteria`, etc.).
- Does not know about the design artifacts that now live inside `domains/<slug>/docs/`.
- Makes it hard to do the "light triage + handoff to specialists" flow described for the Agenda Agent.
- The `domain-lifecycle` board (and future domain boards) stay empty or chaotic even when excellent definition + design material exists.

## Requirements

### Functional
- Accept a valid brief taskId (on any board).
- Parse the canonical sections produced by `briefBody` in `main/core/domain-board.js`.
- When the brief declares a `domain` that has a `domains/<domain>/docs/design/` folder, load those documents as primary context.
- Propose a breakdown organized by:
  - The brief's own major sections, **and/or**
  - Logical workstreams derived from the loaded design docs + captured agenda items.
- For each proposed section/workstream, generate a **full Agenda Item proposal** ready for human/CEO review.
- When a human approves materialization, selected Agenda Items may generate full, valid lightweight child briefs (title + all required fields) that reference the richer Agenda Item record.
- Support two output modes (user/CEO selectable):
  1. Multiple linked child briefs (recommended for most domain work).
  2. A `hermes kanban swarm` graph definition (for parallel execution of well-defined sub-work).
- Record rich provenance linking parent brief → each child plan (and any generated assets).
- Never bypass `missingBriefFields` validation on generated children.
- Human-in-the-loop review step before any children are materialized on the kanban.

### Non-Functional
- The decomposer must itself be documented inside this domain (this document) so future work on it follows the same hygiene rules.
- Must be usable by both humans (UI + voice) and agents (Agenda Agent, planner persona).
- Must produce auditable, queryable output (via existing provenance + brain artifacts).

## Acceptance Criteria / Testing Instructions

- [ ] A high-level brief for "Implement Domain Lifecycle core" (populated from this domain's own `definition.md` + handoff) can be decomposed via the new flow.
- [ ] The proposal shows clear sections (e.g. "Live AGUI Outline Component", "Domain Architect Persona Wiring", "Handoff Persistence + Querying", "BA Document Guard Hooks", "Agent Scoping Enforcement", etc.).
- [ ] Every generated Agenda Item includes parent reference, context, action items, routing suggestion, human-attention flag, and provenance links.
- [ ] Any approved child brief materialized from an Agenda Item passes `missingBriefFields` and uses the exact `briefBody` template + correct orchestration routing.
- [ ] Approved child briefs are created on the target board (preferring the brief's declared domain board when it exists, e.g. `domain-lifecycle`).
- [ ] Full parent → child provenance links are queryable (`provenance.graph` and brain artifacts).
- [ ] The feature itself is tracked only in this document + links from the handoff/captured-agenda-items (no duplication of requirements/AC in multiple places).
- [ ] `npm run docs:check` and `npm test` still pass after implementation.
- [ ] Manual dogfood: After decomposition, `hermes kanban --board domain-lifecycle list` shows well-formed, linked child work that a human or agent can triage further.
- [ ] One of the generated child plans can itself be decomposed further (recursive support demonstrated).

## Current State (as of this spec)
- The `domain-lifecycle` Hermes board exists but contains zero tasks.
- Excellent source material exists in `docs/design/` and `definition.md` (the "raw transcript + captured entities").
- The mechanical `decomposeBrief` exists but is thin (just forwards to Hermes).
- An early `brief-decomposer.js` exists (proposes workstreams and draft child briefs using simple parsing and hard-coded Domain Lifecycle items). It needs to evolve to primarily output structured **Agenda Items** (with registry matching and new persona proposals) per this spec and the dedicated plan.
- No full Agenda-Item-aware, registry-matching, controlled decomposition exists yet.

## Implementation Notes (for the team)
**See the dedicated detailed spec and phased plan: `../plans/decomposer-spec-and-plan.md`**

This is now the canonical place for:
- Exact Agenda Item data model and structure.
- Registry matching logic + new persona/agent proposal format.
- Piece-by-piece implementation plan (Karpathy-style iterations, controlled environment, guardrails).
- How to use agents from the registry to help build/test the decomposer itself (narrow scopes only).

Key technical anchors (evolve as we go):
- `main/core/domain-board.js` (briefBody, createBrief, existing decomposeBrief, provenance)
- `main/core/ticket-planner.js` (context gathering patterns)
- `main/core/brief-decomposer.js` (current base to iterate on)
- Agent registry at `runtime/harness/agents/agents.json` + personas
- UI proposal review in the existing task planning view
- Domain `AGENTS.md` and the broad `decomposition-capability-improvement.md` for overall iteration rules
- Domain `plans/handoff-intake-contract.md` for handoff-sourced decomposer input

**Guardrails (non-negotiable)**: Do not modify raw design docs in `docs/design/`. Do not implement or let agents drive the testing strategy/evaluation work. Stay slow and deliberate; document changes here and in the detailed plan first. Follow the new agent protocol for any harness work (worktrees, dry-run, human review).

## Links
- Parent handoff: `../handoffs/001-domain-lifecycle-initial-handoff.md`
- Captured agenda items: `../captured-agenda-items.md`
- Domain definition: `../../definition.md`
- Detailed decomposer spec & plan: `../plans/decomposer-spec-and-plan.md`
- Handoff intake contract: `../plans/handoff-intake-contract.md`

**This document (brief-sectional-decomposer.md) remains the high-level feature home.** The detailed spec/plan in `../plans/decomposer-spec-and-plan.md` is where we finish spec'ing out Agenda Item production, agent matching, and the implementation approach. Any future work on this capability must update both as appropriate, starting with discussion here.
