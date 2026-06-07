# Meetings Domain

**Purpose**: Define how meetings work inside CEO Studio — when they happen, how they are structured, who participates, how decisions are captured, and how the decomposer turns meeting output into actionable work.

**Core Goal**: Make meetings a first-class, intentional mechanism rather than ad-hoc conversations. Every meeting should have clear intent, participants, output format, and direct path into the Kanban + planning system.

## Key Responsibilities
- Meeting formats and cadences (voice syncs, architecture reviews, blocker triage, vision alignment)
- Participant routing and team involvement
- Decision capture and immediate translation into tasks/plans
- Integration with the decomposer (how raw meeting output becomes decomposed work items)
- Voice + UI support for running and reviewing meetings

## Boundaries
- Owns meeting structure, flow, and post-meeting processing.
- Owns the relationship between meetings and the autonomous decomposer.
- Does not own general Kanban execution or agent spawning.

## Current State
CEO Studio has a real Meetings cockpit backed by `main/core/meetings.js` and the harness A2A meeting engine. The UI can schedule meetings, start scheduled meetings, show live room transcripts, and save meeting output back into domain-owned agenda artifacts.

Project standups are implemented as a durable cadence layer in `main/core/standups.js`. Enabling a standup creates or updates one stable daily policy and appends a proposal-only Agenda Item to the selected or fallback domain. When the app-owned autonomy runner is active with `allowStandups`, each due occurrence is claimed once, started with `allowPaid: false`, and written to `<project>/brain/standups/executions.json`. Recurring occurrences use unique dated rooms so earlier transcripts and requirements remain available.

At start time, the occurrence snapshots active daily goals for its domain and links itself to those goals. If a daily goal is linked to an existing Brief Run, the standup room is also linked to that Brief Run. On later runner cycles, completed room requirements are synthesized into the same typed review proposals used by other Brief Run meetings.

Standalone standup output is reviewable in the Meetings cockpit. Decisions, evidence, and completion updates can be accepted into the durable occurrence; Agenda Items require explicit human approval before entering the domain; blockers require explicit approval before becoming Human Escalations. No standup proposal dispatches workers, creates Kanban execution tasks, or grants paid-provider permission.

Completed meetings linked to a Brief Run are post-processed by `main/core/meeting-synthesis.js`. The deterministic pass reads the room's durable `requirements.md` and creates typed, idempotent proposals for decisions, Agenda Items, blockers, evidence, and completion updates. The Brief Run cockpit exposes explicit approve/reject controls. Approval records the result through existing domain, Hermes, overlay, Brief Run, and provenance contracts; blocker approval clearly moves the parent task to `blocked`. Proposal generation never dispatches agents or creates Kanban tasks.

The remaining policy gap is optional unattended approval for proven low-risk proposal types. Until a separate approval tier is designed and verified, all standup and meeting proposals remain human-reviewed.
