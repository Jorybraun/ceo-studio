# Domain Architect Create Phase Plan

**Status**: Active implementation plan
**Created**: 2026-06-02
**Source bundle**: `/Users/hans/Downloads/files-0545a4ae`
**Owner**: Domain Lifecycle

## Source Documents Adopted

- `domain-creation-process.md`
- `handoff-protocol.md`
- `system-overview.md`
- `domain-terminology.md`
- `agent-scoping.md`
- `critical-system-agents.md`
- `recursive-document-linking.md`
- `personas/domain-architect.md`
- `personas/agenda-agent.md`
- `personas/ba-agent.md`

The canonical domain copies live under `domains/domain-lifecycle/docs/design/` and `domains/domain-lifecycle/docs/personas/`. The downloaded bundle is treated as source material for this plan, not as an ignored side-channel.

## Gap Analysis

The existing system had a working file-backed domain scaffold, handoff files, agenda proposals, and a basic Domain Architect state machine. It did not yet fully implement the create phase described in the source bundle.

Implemented before this plan:

- Domain folders with `definition.md`, `captured-agenda-items.md`, `handoffs/`, `plans/`, `requirements/`, `agendas/`, and `docs/`.
- A conservative Domain Architect interview state machine.
- Confirmation-gated domain creation.
- Handoff creation under the created domain.
- Agenda proposal serialization.

Missing or incomplete:

- Agent-led create workspace where the Domain Architect is the primary flow, not a helper beside a static form.
- Live clickable definition outline that can focus conversation on one section.
- Review/refinement phase after initial field capture.
- Deep-dive capture from a selected outline node.
- Raw transcript and source-bundle provenance in the handoff package.
- Agenda Agent receipt/acknowledgement UX.
- BA dirty/clean document state for new or changed domain artifacts.
- Agent scoping enforcement in the registry and app views.
- Recursive child document creation with parent references.

## Current Implementation Pass

This pass upgrades the create phase without changing the storage contract:

- Add focused outline selection to the Domain Architect session.
- Allow review-phase refinements after required fields are captured.
- Capture deep dives as proposal-only Agenda Items.
- Persist raw transcript/source provenance in the creation handoff.
- Add the missing relationships/dependencies field to the create UI.
- Keep human confirmation required before the domain is written.

## Next Agenda Items

## [proposed] Agenda Agent receipt and acknowledgement UI

- ID: agenda-20260602-agenda-agent-receipt-ui
- Type: handoff-triage
- Priority: high
- Human approval required: yes
- Source: domain-architect-create-phase-plan
- Parent: domain-creation-process
- Expected outcome: Handoffs can be acknowledged, triaged, and converted into proposal-only Agenda Items from the app.
- Output artifact: `domains/domain-lifecycle/docs/features/agenda-agent-handoff-inbox.md`

Build the app-facing handoff inbox for pending/acknowledged/in-progress/completed/needs-human states.

## [proposed] BA dirty clean document state

- ID: agenda-20260602-ba-dirty-clean-state
- Type: documentation
- Priority: high
- Human approval required: yes
- Source: domain-architect-create-phase-plan
- Parent: system-overview
- Expected outcome: New or modified domain artifacts visibly start dirty and can be reviewed clean by the BA Agent.
- Output artifact: `domains/domain-lifecycle/docs/features/ba-document-state.md`

Implement the first soft version of Dirty/Clean metadata for domain-owned documents.

## [proposed] Recursive deep dive child documents

- ID: agenda-20260602-recursive-deep-dive-documents
- Type: decomposition
- Priority: normal
- Human approval required: yes
- Source: domain-architect-create-phase-plan
- Parent: recursive-document-linking
- Expected outcome: Deep dives can create linked child documents with parent references.
- Output artifact: `domains/domain-lifecycle/docs/features/recursive-deep-dive-documents.md`

Turn selected outline nodes into linked child documents during review/refinement.

## [proposed] Agent scoping enforcement

- ID: agenda-20260602-agent-scoping-enforcement
- Type: agent/persona proposal
- Priority: high
- Human approval required: yes
- Source: domain-architect-create-phase-plan
- Parent: agent-scoping
- Expected outcome: System, project, and domain agents have enforced visibility and edit rules in registry-backed app views.
- Output artifact: `domains/domain-lifecycle/docs/features/agent-scoping-enforcement.md`

Make scoping more than terminology: restrict visibility/use/editing by scope.
