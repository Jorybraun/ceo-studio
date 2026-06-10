# Handoff Intake Contract for Decomposition

**Status**: Draft / Phase 0  
**Domain**: Domain Lifecycle  
**Purpose**: Define the normalized input package that the decomposer receives when the source is a handoff instead of a kanban brief.

This document refines, but does not replace, the raw handoff protocol in `../docs/design/handoff-protocol.md`. The design doc remains authoritative for handoff concepts and responsibilities. This file defines the practical intake shape for the decomposer and Agenda Agent workflow.

---

## Why This Exists

The decomposer cannot produce high-quality Agenda Items until the input contract is clear. A kanban brief already has a canonical body shape via `main/core/domain-board.js::briefBody`. A handoff is currently a markdown artifact with structured sections but no machine-normalized schema.

This contract defines:
- What data is extracted from a handoff.
- What shape the decomposer receives.
- How handoff inputs line up with brief inputs.
- What is missing or invalid before decomposition can safely proceed.

The decomposer should operate on this normalized package, not on arbitrary markdown.

---

## Input Sources

For v1, the decomposer supports two source kinds that normalize into one internal shape:

1. `brief`
   - Source: Hermes kanban task body.
   - Existing path: `propose_brief_decomposition({ board, taskId })`.
   - Parser: canonical `briefBody` section extraction.

2. `handoff`
   - Source: file-backed handoff record under `domains/<domain>/handoffs/`.
   - Initial seed: `domains/domain-lifecycle/handoffs/001-domain-lifecycle-initial-handoff.md`.
   - Parser: markdown section extraction plus linked artifact loading.

The shared normalized shape should be called `decompositionInput` in code and docs until a better name emerges.

---

## Normalized Decomposition Input Shape

```json
{
  "source": {
    "kind": "handoff",
    "id": "001-domain-lifecycle-initial-handoff",
    "path": "domains/domain-lifecycle/handoffs/001-domain-lifecycle-initial-handoff.md",
    "title": "Handoff #001 - Domain Lifecycle (Initial Definition)"
  },
  "context": {
    "project": "CEO_STUDIO",
    "domain": "domain-lifecycle",
    "board": "domain-lifecycle",
    "fromAgent": "domain-architect",
    "toAgent": "agenda-agent",
    "status": "pending",
    "humanVisible": true,
    "createdAt": "2026-06-01"
  },
  "trigger": {
    "summary": "User requested that the Domain Functionality design be turned into a real first-class domain.",
    "triggeredBy": "Direct user request after docs sync and planning session"
  },
  "payload": {
    "synthesizedDefinition": {
      "path": "domains/domain-lifecycle/definition.md",
      "summary": "Clean synthesized definition for the Domain Lifecycle domain."
    },
    "capturedEntities": [
      {
        "kind": "agenda_item",
        "title": "Implement live interactive AGUI outline component",
        "sourcePath": "domains/domain-lifecycle/captured-agenda-items.md",
        "priority": "high"
      }
    ],
    "suggestedNextAgendaItems": [
      "Agenda Agent to review this new Domain Lifecycle domain and propose a kickoff plan.",
      "Decide on the delivery mechanism for handoffs in v1."
    ],
    "relationships": [],
    "openQuestions": [],
    "scopeWarnings": [
      "This domain is meta: it defines how all other domains will be created."
    ],
    "userConfirmation": "The user explicitly directed creation of the domain definition in the actual app structure."
  },
  "artifacts": {
    "rawArtifacts": [
      "domains/domain-lifecycle/docs/design/system-overview.md",
      "domains/domain-lifecycle/docs/design/domain-creation-process.md",
      "domains/domain-lifecycle/docs/design/handoff-protocol.md",
      "domains/domain-lifecycle/docs/design/critical-system-agents.md",
      "domains/domain-lifecycle/docs/design/agent-scoping-model.md",
      "domains/domain-lifecycle/docs/design/domain-terminology.md",
      "domains/domain-lifecycle/docs/design/recursive-document-linking.md"
    ],
    "personaArtifacts": [
      "domains/domain-lifecycle/docs/personas/domain-architect.md",
      "domains/domain-lifecycle/docs/personas/agenda-agent.md",
      "domains/domain-lifecycle/docs/personas/ba-document-guard.md"
    ],
    "supportingArtifacts": [
      "domains/domain-lifecycle/captured-agenda-items.md"
    ]
  },
  "decompositionHints": {
    "agendaItemSeeds": [
      "Implement live interactive AGUI outline component",
      "Wire Domain Architect as a usable flow",
      "Add first-class Handoff persistence and Agenda Agent triage path",
      "Implement BA Document Guard hooks and Dirty/Clean state management"
    ],
    "preferredOutput": "agenda_items",
    "materializationAllowed": false
  }
}
```

---

## Required Fields

A normalized handoff input is valid only if it has:

- `source.kind`
- `source.id`
- `context.project`
- `context.domain`
- `context.fromAgent`
- `context.toAgent`
- `payload.synthesizedDefinition`
- `payload.userConfirmation`
- At least one of:
  - `payload.capturedEntities`
  - `payload.suggestedNextAgendaItems`
  - `decompositionHints.agendaItemSeeds`
- `artifacts.rawArtifacts`

If any required field is missing, the decomposer should return a reviewable validation error and should not invent missing facts.

---

## Markdown Handoff Mapping

The current markdown handoff format maps into the normalized shape as follows:

| Markdown section | Normalized field |
| --- | --- |
| Title line | `source.title` |
| `From` | `context.fromAgent` |
| `To` | `context.toAgent` |
| `Status` | `context.status` |
| `Created` | `context.createdAt` |
| `Human visible` | `context.humanVisible` |
| `Context` | `context.project`, `context.domain` |
| `Trigger` | `trigger.summary` |
| `Payload - Synthesized Domain Definition` | `payload.synthesizedDefinition` |
| `Raw Artifacts / Source Material` | `artifacts.rawArtifacts`, `artifacts.personaArtifacts` |
| `User Confirmation` | `payload.userConfirmation` |
| `Suggested Next Agenda Items` | `payload.suggestedNextAgendaItems` |
| `Notes / Scope Warnings` | `payload.scopeWarnings` |
| `Handoff Record Metadata` | `source.id`, `trigger.triggeredBy` |

Linked artifacts such as `definition.md` and `captured-agenda-items.md` should be loaded as supporting context, but raw design docs under `docs/design/` must remain read-only.

---

## Decomposer Responsibilities

When given a normalized handoff input, the decomposer should:

1. Validate the input package.
2. Load linked supporting artifacts read-only.
3. Extract candidate Agenda Items from:
   - `payload.capturedEntities`
   - `payload.suggestedNextAgendaItems`
   - `decompositionHints.agendaItemSeeds`
   - `captured-agenda-items.md`
4. Preserve parent reference as `parent.kind = "handoff"` unless the human later creates a kanban parent brief.
5. Produce Agenda Item proposals with routing suggestions and human-attention flags.
6. Keep `materializationAllowed = false` unless a separate human approval action changes it.

The decomposer should not:
- Create kanban work automatically.
- Modify the source handoff.
- Modify raw design docs.
- Promote proposed agents/personas into the live registry.
- Treat suggested next agenda items as final implementation tasks.

---

## Initial Seed Package

The first real input package should be derived from:

- Handoff: `domains/domain-lifecycle/handoffs/001-domain-lifecycle-initial-handoff.md`
- Definition: `domains/domain-lifecycle/definition.md`
- Captured agenda items: `domains/domain-lifecycle/captured-agenda-items.md`
- Raw design docs: `domains/domain-lifecycle/docs/design/`
- Domain personas: `domains/domain-lifecycle/docs/personas/`

This seed should be used to create the first hand-authored expected output before runtime decomposer behavior changes.

---

## Open Decisions

- Whether normalized handoff inputs should be persisted as `.json` next to markdown handoff files or generated on demand.
- Whether `context.board` should default to the domain slug or be explicitly declared in the handoff.
- How strict the markdown parser should be when handoff files vary from the current template.
- Whether `payload.capturedEntities` should preserve check-state from `captured-agenda-items.md`.
- How to link a handoff parent to later materialized kanban briefs in provenance.

---

## Next Step

Create one hand-authored expected Agenda Item output from this seed package. Use that expected output to guide the smallest decomposer implementation slice.
