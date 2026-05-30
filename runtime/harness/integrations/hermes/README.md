# Hermes Integration (Planning & Research Agents)

## Purpose

This directory contains the adapter and handoff logic for using **Hermes** as the primary engine for planning, research, requirements gathering, and design exploration work.

The Project CEO Harness does **not** build its own planning agents. It delegates this class of work to Hermes (which already has strong Kanban + swarm capabilities that the founder likes).

## Integration Goals

- Allow the CEO Orchestrator to submit clear planning/research tasks to Hermes.
- Retrieve results (specs, designs, research summaries, proposed approaches) back into the CEO Harness.
- Make the output visible and reviewable in our Kanban.
- Preserve conversation / reasoning visibility where possible (feed into the brain).

## Current Status

**Early design.** No live integration yet.

We are defining:
- What a good "Delegation Request" to Hermes looks like.
- How results come back.
- How to maintain traceability between the CEO Harness and the work happening inside Hermes.

## Planned Handoff Format (Draft)

When the CEO Orchestrator wants Hermes to do planning work, it should produce something like:

```yaml
delegation_id: del-2026-05-28-003
target_harness: hermes
work_type: planning_research_design
objective: |
  Explore transcript-first approaches for the discovery domain.
  ...
constraints:
  - Raw transcript must remain first-class and queryable
  - Avoid heavy up-front synthesis where possible
  - Must support selective human involvement during interviews
success_criteria:
  - Clear recommended architecture
  - Comparison of alternatives
  - Rough mocks or flow diagrams
  - Impact analysis on downstream domains
context_refs:
  - brain/conversations/chat-2026-05-28.jsonl
  - context/discovery-team/docs/requirements/raw-transcript-primary-artifact.md
priority: high
requested_by: ceo-orchestrator
```

Hermes would then run this as a Kanban item or swarm task internally.

## Open Questions

- How do we actually submit work to Hermes? (API, shared volume, task queue, manual handoff for now?)
- How much of Hermes' internal Kanban / agent conversations do we want to pull back?
- What is the cleanest way for Hermes output to become a reviewable package in our Kanban?

## Next Steps

1. Define a minimal viable handoff contract with the founder.
2. Decide on the lowest-friction integration mechanism for early use (could even start as "CEO writes a brief → human pastes into Hermes" while we build automation).
3. Build the first thin adapter.
