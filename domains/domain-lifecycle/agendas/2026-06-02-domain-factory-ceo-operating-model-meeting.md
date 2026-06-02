# Meeting Agenda: CEO + Domain Factory Operating Model

**Date**: 2026-06-02
**Room**: `domain-factory-ceo-operating-model`
**Participants**: `codex-factory-strategist`, `devin-opus-factory-reviewer`

## Context

The user wants CEO Studio to become an autonomous 24/7 software factory, but not by making the CEO's Kanban the execution runtime.

The desired model:

- The CEO drives vision, taste, priorities, tradeoffs, and strategic decisions.
- Agenda Items remain the high-level intake layer.
- A separate domain-owned factory runtime turns approved Agenda Items into Work Packages.
- Work Packages must include requirements, acceptance criteria, builder assignment, peer review, validation/dogfood testing, docs updates, BA/domain audits, and visible reports.
- Builders must emit completion packets so their knowledge becomes domain-owned artifacts.
- A scheduled Domain Agent audits each domain for stale, blocked, dirty, unreviewed, untested, or undocumented work.
- Blocked work must not become a parking lot; every blocked item needs reason, owner, next unblock action, retry time, and evidence.

## Existing Artifacts

- `domains/domain-lifecycle/plans/ceo-project-management-operating-model.md`
- `runtime/harness/personas/general/domain-factory-orchestrator.md`
- `runtime/harness/agents/agents.json`
- Domain Lifecycle design docs under `domains/domain-lifecycle/docs/design/`

## Questions For The Room

1. What is the best architecture for separating CEO governance from factory execution?
2. What should the first implementation slice be so this becomes real without the user micromanaging?
3. What artifacts and app views are mandatory for the factory runtime?
4. How should scheduled domain audits work?
5. How should peer review and validation gates work?
6. How should the CEO learn to manage the project over time?
7. What should be built next in CEO Studio?

## Desired Output

Produce a concrete implementation recommendation with:

- System architecture.
- Agent responsibilities.
- Lifecycle state machine from Agenda Item to Done.
- First 3 implementation milestones.
- Risks and anti-patterns.
- What to ask the human before proceeding.
