# Feature: Conversational Brief Intake (type a brief into the CEO chat)

**Status**: Implemented
**Domain**: Domain Lifecycle
**Owner (initial)**: CEO Studio cockpit (renderer + main)
**Related Docs**:
- `brief-sectional-decomposer.md` (the decomposition step this hands off to)
- `../../../../AGENTS.md` ("Conversational Brief Intake" + "Swarm / Kanban Cockpit")

---

## Purpose

A **brief** is the canonical unit of work, and creating one is the whole point of
the cockpit. Until now the only conversational way to create one was **voice**
(the ElevenLabs agent's `create_brief` client tool). The typed CEO chat box only
relayed to Hermes for Q&A — so typing "create a brief …" discussed the work but
never produced the structured `[Brief]` card. This feature closes that gap:
typed chat now has **parity with voice**, and the brief → decomposition pipeline
finally has a discoverable front door.

## Flow

Triggered by typing `create a brief …` / `new brief …` / `/brief …` in the CEO
chat box, or by `+ → New brief`:

1. **Draft** — the founder's free-form description is sent to the Hermes CEO,
   which distills it into the canonical 7 fields. The reply is parsed
   deterministically and shown in the left panel.
2. **Review / refine** — missing required fields are named in plain language;
   the founder keeps describing and the draft is re-derived from the running
   transcript. (Required: title, goal, domain, currentRenderedState,
   problemMismatch, acceptanceCriteria, nextAction.)
3. **Confirm → create** — on "create it" the draft goes through the single
   enforced path `domainBoard.createBrief` (IPC `domain_board:create_brief`),
   which writes the `[Brief]` task + the durable Brief Run.
4. **Optional decompose** — the builder offers to break the brief into child
   briefs via `proposeBriefDecomposition`; on approval it materializes them with
   `applyBriefDecomposition` (human-approval gated). See
   `brief-sectional-decomposer.md`.

## Implementation

- `main/core/brief-intake.js` — `draftBrief()` (Hermes-backed) plus the pure,
  unit-tested `parseBriefDraft()` / `missingFields()`. The missing-field rule
  mirrors `domain-board.missingBriefFields` so the conversational gate and the
  creation gate never disagree. Drafting only proposes; it never creates.
- IPC `brief_intake:draft` (`main/index.js`) + `window.ceo.briefIntakeDraft`
  (`main/preload.js`).
- `renderer/brief-builder.js` — the conversational state machine
  (`window.BriefBuilder`), hooked into `renderer/app.js` `runTurn()` via
  `maybeHandle()`, and wired to `+ → New brief`.
- Tests: `test/brief-intake.test.js` (parse + missing-field + Hermes-injected
  draft cases), chained into `npm test`.

## Non-goals / notes

- The renderer never creates a brief directly — creation stays gated behind
  `createBrief` so validation, the Brief Run, and provenance always run.
- If the CEO relay is unavailable, drafting degrades gracefully: the builder
  keeps any known fields and asks the founder to add detail or cancel.
