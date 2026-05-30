# Teams

Reusable, named **team** definitions for the Harem.

## Purpose

A "team" is a named grouping of roles/personas that owns a particular kind of work (planning for a domain, execution + validation, review, etc.).

Instead of hardcoding lists of personas in orchestrators or delegation scripts, you refer to the team by name. The Kanban Finisher (and future stage-aware agents) consult the team definition + the per-Kanban `stage-map.md` to know who to spin up for work in a given column.

## Organization

```
teams/
    README.md
    discovery-planning/
        definition.md
    execution-builders/
        definition.md
    review-guild/
        definition.md
    ...
```

Add new teams in their own subfolder with a `definition.md`. The name of the folder is the canonical team name (use kebab-case).

## What Goes in a Team Definition

- Purpose / charter
- Core roles + the persona each role normally runs with
- Default workflow(s) this team uses
- How the team is activated (via `harem` / Kanban Finisher / stage-map)
- Any standing rules or handoff contracts

See `discovery-planning/definition.md` for the first real example.

## Usage

- Referenced from `context/<domain>-team/mgmt/stage-map.md` (the binding of Kanban stage → team + workflow).
- Can be expanded by tools: future `harem agent --team discovery-planning` or `harem team spawn ...`.
- The `kanban-finisher` persona (and any brain running orchestration) reads these files as context, exactly like it reads personas and skills.

## Relationship to Domain AGENTS.md

Many teams are the "Planning Layer" or "Execution Layer" for a specific domain. The authoritative deep law for that domain still lives in `context/<domain>-team/AGENTS.md`. The team definition here is the **operational / delegation** view — who gets launched, what persona they carry, and what workflow they follow for a stage.

## Adding a New Team

1. `mkdir -p teams/my-new-team`
2. Write `teams/my-new-team/definition.md`
3. Reference it from one or more `stage-map.md` files.
4. (Optional) Add a matching workflow under `workflows/`.

Keep the surface small. Most teams are thin declarations that point at rich domain docs + workflow files.
