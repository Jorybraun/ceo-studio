# PIPE-OS CEO Harness — Agent Operating Guide

This document explains how to work with the **Project CEO Harness** using Hermes Kanban as the primary coordination system.

Any agent (Claude, Grok, Hermes profiles, etc.) working inside or with this harness must follow these conventions.

## Core Philosophy

- **Hermes Kanban is the source of truth** for all work.
- The `kanban-orchestrator` profile acts as the **CEO / Chief of Staff** through Hermes/Codex OAuth. It must not depend on raw OpenAI/Anthropic API keys.
- Specialist profiles (e.g. `pipe`, future `pipe-research`, `pipe-ux`, etc.) act as workers.
- The human remains the primary decision maker. Agents propose and execute within approved bounds.
- Planning-first: Prefer creating clear plans, research, and proposals over direct implementation.
- Everything important should be visible and reviewable through Kanban tasks and comments.

## Key Hermes Concepts

- **Board**: `pipe-os` — This is the main board for all PIPE-OS planning, domain work, and harness evolution.
- **CEO Profile**: `kanban-orchestrator` — This is the strategic orchestrator. It audits, decomposes, prioritizes, and assigns work.
- **Worker Profiles**: Start with `pipe`. More specialist profiles will be added (research, UX, architecture, etc.).
- **Tasks**: The atomic unit of work. Every task should have clear acceptance criteria.
- **Comments**: Primary way to steer, give feedback, or clarify tasks.
- **Decomposition**: The CEO (or planning agents) should break large goals into smaller, assignable Kanban tasks.

## How to Work Inside This System

### 1. When given a high-level goal

- Do **not** start implementing immediately.
- First, understand the current state by looking at:
  - Existing Kanban tasks on the `pipe-os` board
  - `harness/` documentation and architecture
  - `knowledge/plan/` and relevant project docs
- Then create well-structured Kanban tasks (or ask the CEO profile to do so).

### 2. Working with the CEO Orchestrator

- The `kanban-orchestrator` profile is responsible for strategic decomposition.
- You can create tasks and assign them to it, or comment on existing tasks asking it to break things down.
- Example good prompt when creating a task for it:

```
Act as CEO for PIPE-OS. Audit current state and decompose this goal into a clear set of Kanban tasks with dependencies and acceptance criteria. Assign work only to existing profiles.
```

### 3. Communication

- Use **Kanban comments** for durable, reviewable communication between agents and the human.
- For real-time discussion between agents, use the herder/domain-room layer so the shared log is durable and browser-visible.
- Any legacy TTY-only agent adapter must copy important communication back into Kanban comments or the domain-room log.

### 4. Planning Meetings / Domain Reviews

- Each domain can have scheduled review/planning meetings with the human.
- During these sessions, surface relevant research, diagrams (Mermaid), and findings.
- These are working meetings, not just status updates.

### 5. Self-Improvement of the Harness

- The harness is allowed to improve itself.
- Self-improvement work is tracked primarily via GitHub Issues in the harness repository (with auto-merge in early stages).
- Major or risky changes should still be proposed clearly.

## Important Files & Locations

- `harness/skills/pipe-os-management/SKILL.md` — **Primary loadable operating model** (the constitution). Load this skill with the `kanban-orchestrator` for any strategic or domain work. Contains the layered model, per-domain Kanban strategy, domain lifecycle workflow, communication protocols, and curated Hermes skill toolkit.
- `harness/DESIGN.md` — Main philosophy and architecture
- `harness/architecture/` — Detailed architecture documents (read the `00-ARCHITECTURE_PATHS.md` for an overview of all major paths)
- `harness/agents/AGENT_REGISTRY.md` — Current live agent registry concept: Hermes, Grok, and hinnymen/Feynman, with their model/provider bindings
- `harness/planning/PIPE-OS/` — Concrete planning for the actual application
- `harness/skills/` — Expert skill and persona library (start here for role definitions)
- `harness/context/` — Domain-specific context and AGENTS.md files

## Profiles You Should Know

| Profile / Agent        | Role                              | Typical Model / Tool | Notes |
|------------------------|-----------------------------------|----------------------|-------|
| Hermes                 | Herder session orchestrator / controller | openai-codex OAuth   | Runs the show, routes work through Kanban, rooms, and adapters |
| Grok                   | Optional worker / planning/build  | Grok Build CLI       | External agent adapter; durable outputs go to room/Kanban |
| hinnymen / Feynman     | Research agent                    | https://www.feynman.is | Research, evidence, uncertainty mapping |
| kanban-orchestrator    | CEO / Chief of Staff              | openai-codex         | Strategic decomposition and prioritization |
| pipe                   | General worker / implementation   | openai-codex         | Default funded worker profile for PIPE-OS |
| docs-steward           | Documentation handoff reviewer    | registry provider    | Keeps docs, registry, skills, and workflows aligned |
| default                | General purpose                   | openai-codex         | Fallback / general tasks |

## Anti-Patterns

- Bypassing Kanban and doing work in private chat or local files only.
- Implementing directly without first creating tasks and getting direction from the CEO profile.
- Treating the harness as a traditional codebase instead of a living, agent-augmented operating system.
- Creating complex custom orchestration outside of Hermes when Hermes Kanban can already handle it.
- **Creating new bin/ commands or tools that duplicate existing functionality.** Before writing anything new in `bin/`, read `harness/README.md` → "Commands & Tools" section and attempt to extend an existing command instead.

## Tool Discipline (Mandatory)

The harness deliberately keeps a small, coherent set of commands. Proliferating similar tools (multiple dashboards, multiple chat interfaces over the same room, etc.) creates confusion and maintenance debt.

**Rule:** Do not create unnecessary functions or commands.

- Always check `harness/README.md` (the Commands & Tools table) first.
- Prefer extending `domain-room` (via subcommands), `launch-agent`, `herder-chat`, or `herder-steer` over creating new executables.
- New tools are only justified when they have a genuinely distinct purpose that cannot be met by extending what already exists.
- Any new command added to `bin/` must also be documented in the reference table in `README.md`.
- Any behavior-changing work must pass the docs handoff in `../AGENTS.md` and `architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`.

This rule applies to both humans and agents working in the harness.

## Goal

Any agent that enters this workspace should load `pipe-os-management` (plus `kanban-orchestrator` and supporting Hermes skills) and read the active domain's `AGENTS.md`. This combination should be sufficient to operate without the human constantly re-explaining the model.

---

**Read the architecture overview first:**
`harness/architecture/00-ARCHITECTURE_PATHS.md`

This is the current source of truth for how the system is meant to work.
