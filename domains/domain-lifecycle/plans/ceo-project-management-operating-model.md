# CEO Project Management Operating Model

**Status**: Active design and implementation plan
**Created**: 2026-06-02
**Owner**: Domain Lifecycle
**Purpose**: Teach the CEO layer how to govern the project without becoming the execution Kanban.

## Core Separation

The CEO drives vision. The domain factory drives execution.

## CEO Owns

- Project vision and taste.
- Strategic priorities and sequencing.
- What matters and what should not be built.
- Tradeoffs across domains.
- Approval of major Agenda Items.
- Decision principles and escalation handling.
- Review of executive briefings.

## CEO Does Not Own

- Builder work logs.
- Raw implementation state.
- Test execution details.
- Peer review mechanics.
- Dirty/Clean document checks.
- Repeated blocked-card babysitting.
- Direct assignment of every subtask.

## Factory Owns

- Turning approved Agenda Items into Work Packages.
- Requirements and acceptance criteria.
- Builder assignment and completion packets.
- Peer review routing.
- Dogfood/testing reports.
- Documentation updates and docs-steward review.
- BA/domain audits.
- Blocked-work retry and repair loops.

## Required CEO Inputs

The CEO needs these durable artifacts to manage well:

- `Project Vision`: mission, users, taste, anti-goals, current bets.
- `Domain Priorities`: what each domain should optimize for now.
- `Decision Principles`: how to choose when tradeoffs appear.
- `Operating Cadence`: daily/weekly briefing expectations.
- `Escalation Policy`: what must come back to the human.

## CEO Briefing Contract

The Domain Factory Orchestrator must produce a regular briefing with:

- What shipped or became clean.
- What is blocked and whether human input is required.
- What risks increased.
- What docs changed or remain dirty.
- What tests failed.
- What Agenda Items need CEO approval.
- What decisions are requested from the human.

The CEO responds with:

- Approve / reject / reprioritize Agenda Items.
- Resolve strategy or product tradeoffs.
- Update vision or decision principles.
- Delegate factory actions back to the Domain Factory Orchestrator.

## Autonomy Rules

- The CEO may approve low-risk maintenance work if it matches current vision and policy.
- The CEO must ask the human before changing product direction, major architecture, spending policy, provider strategy, or user-facing scope.
- The factory may continue routine audit, review, test, and docs work without CEO intervention.
- Blocked work should escalate to the CEO only after the factory has attempted retry, split, reroute, or repair.

## Implementation Path

1. Add a `domain-factory-orchestrator` project agent.
2. Add a `domain-factory-operations` team.
3. Create a CEO-visible brief that starts the factory runtime implementation.
4. Add a Testing Studio workstream for visible test reports and recurring schedules.
5. Add a Domain Audit workstream for scheduled per-domain audits.
6. Add a CEO Briefing artifact so the CEO can govern from summaries instead of raw cards.

## Success Criteria

- The CEO receives regular executive summaries instead of needing to inspect every card.
- Every approved Agenda Item has a factory lifecycle state.
- Work cannot close without review, validation, docs, and domain audit evidence.
- Blocked work has a recovery loop.
- Builders transfer feature knowledge into completion packets and domain docs.
- The human can steer vision without micromanaging execution.
