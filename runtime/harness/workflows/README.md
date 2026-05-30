# Workflows

Named, reusable **workflow** definitions for the Harem.

A workflow is a repeatable process (sequence of phases, gates, handoff rules, validation steps) that a team follows when working on items in a particular Kanban stage.

## Why Workflows (Separate from Personas and Teams)

- Personas = *who* you are and how you think.
- Teams = *who works together* on a class of work.
- Workflows = *how* that team is expected to operate for a given stage or type of card.

This separation lets the same team use different workflows in different columns (or the same workflow be used by multiple teams/domains).

## Organization

```
workflows/
    README.md
    discovery-planning-triage.md
    implementation-plus-dogfood-validation.md
    review-loop.md
    ...
```

The filename (without .md) is the canonical workflow name used in `stage-map.md` files and delegation commands.

## Content Style

Workflow files are rich Markdown, written to be loaded directly into a brain (kanban-finisher, orchestrator, or the team members themselves). They contain:

- Goal / mandate
- Phases or steps (numbered)
- Entry / exit criteria
- Required artifacts / outputs
- Handoff rules
- Validation gates (especially the non-negotiable ones)
- Anti-patterns

They deliberately cross-reference the relevant `kanban.md` Board Rules and domain `AGENTS.md`.

## Current Core Workflows

- `discovery-planning-triage` — Full planning cycle for items entering the discovery domain (the first real one).
- `implementation-plus-dogfood-validation` — Any non-trivial builder work must be followed by real browser dogfood + chrome-devtools-mcp validation before it can be marked Done (see also `skills/custom-kanban-workflows`).

## Usage

Referenced from:
- `context/<domain>-team/mgmt/stage-map.md` (stage → workflow binding)
- `harem delegate --workflow ...`
- The kanban-finisher persona loads the workflow doc as context when driving a card in that stage.

## Adding a New Workflow

1. Write `workflows/my-new-workflow.md`
2. Reference it from the appropriate stage-map(s).
3. Keep it focused — one clear process with strong gates.

The goal is not 50 micro-workflows. The goal is a small number of high-signal, enforced processes that actually move cards to Done with quality and visibility.
