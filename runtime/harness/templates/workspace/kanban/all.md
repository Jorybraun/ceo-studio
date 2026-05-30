# Kanban Board — __NAME__ (all)

**Living document.** Agents and humans update it during planning and execution.
It is the visible state of the project.

## Triage (Ideas → Fully planned & approved)

| Item | Size | Owner | Status | Notes |
|------|------|-------|--------|-------|
| (none yet) | | | | |

## Ready for Execution (Approved plans, tasks created)

(none)

## In Progress (Builders executing against approved docs)

(none)

## Review / Blocked

(none)

## Done

- `.harem/` workspace scaffolded

## Board Rules

1. Nothing moves from Triage to Ready without a full asset package
   (spec/requirement, design mock if UI, ADR if architectural, test/QA plan,
   cross-domain impact analysis) and explicit approval.
2. All plan changes after approval require a new triage item or logged decision.
3. Every task in Ready must reference its source requirement/epic.
4. Documentation discrepancies are raised immediately as new triage items.
