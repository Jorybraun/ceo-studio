# Domain Factory CEO Operating Model Recommendation

**Date**: 2026-06-02
**Room**: `domain-factory-ceo-operating-model`
**Participants**: `codex-factory-strategist`, `devin-opus-factory-reviewer`
**Source transcript**: `runtime/harness/brain/rooms/domain-factory-ceo-operating-model/chat.log`
**Harness synthesis**: `runtime/harness/brain/rooms/domain-factory-ceo-operating-model/requirements.md`

## Outcome

Codex and Devin agreed that CEO Studio should separate CEO governance from factory execution.

The CEO should own vision, priority, taste, strategic tradeoffs, approvals, and briefing review. The factory should own scoped execution through domain-owned Work Packages, completion packets, peer review, validation, documentation, and domain audits.

Hermes Kanban remains the CEO-facing governance and coordination surface. It should not become the detailed execution runtime for every build log, validation run, review artifact, and blocker.

## Recommended Architecture

- `Agenda Item`: CEO/governance intent and approval.
- `Work Package`: domain-owned execution unit stored under the domain.
- `Completion Packet`: builder-owned knowledge capture required before review.
- `CEO Briefing`: concise artifact surfaced back to the CEO with decisions needed, risks, blockers, and throughput.

The recommended canonical store is a separate domain-owned factory store under `domains/<domain>/factory/`, with Hermes Kanban bridged only for approvals and briefings.

## Lifecycle State Machine

`Agenda Item approved -> Scoped -> Assigned -> Building -> Completion Packet -> Peer Review -> Validation/Dogfood -> Docs Review -> Domain Audit -> CEO Briefed -> Done`

Blocked is a side state, not a destination. A blocked item must include:

- `blocked_reason`
- `blocking_owner`
- `next_unblock_action`
- `human_needed`
- `retry_after`
- evidence

Expired or repeated blockers should trigger split, reroute, repair, or escalation.

## First Implementation Slice

Build the executable contract before full autonomous dispatch:

1. Define and store `work-package.json` / markdown Work Package artifacts.
2. Define and store `completion-packet.json` / markdown Completion Packet artifacts.
3. Enforce gates in the factory runner:
   - builder and reviewer cannot be the same assignment,
   - no completion packet means no review and no Done,
   - no validation evidence means no Done,
   - no docs/domain audit signoff means no Done,
   - blocked work without required fields is rejected back to the runner.

## Mandatory Views

- CEO Briefing view: decisions needed, human unblock requests, drift, risk, throughput.
- Factory State view: Work Packages by lifecycle state per domain.
- Work Package detail: requirements, acceptance criteria, owner, reviewer, validation plan, docs expectations, provenance.
- Completion Packet viewer.
- Test Report / validation evidence attachment view.
- Scheduled Domain Audit report.

## Review Risk

Independent review is only real if the reviewer is genuinely independent. If the same provider/model builds and reviews from similar context, the peer-review gate becomes weak. The registry should support a separate reviewer agent or at least a separate persona and fresh context for review.

## Human Decisions Needed

- Confirm whether Work Packages are canonical as domain-owned artifacts, Hermes Kanban metadata, or both with domain artifacts as the source of truth.
- Confirm which risk classes may close autonomously and which always require CEO approval.
- Confirm that hard review gates are acceptable even when they slow throughput.
