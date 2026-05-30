---
name: pipe-os-management
description: "Core operating model for PIPE-OS on Hermes. Layered architecture, per-domain Kanban, human authority, and recommended skills. Load this for strategic or domain work."
version: 0.3.0
author: PIPE-OS Harness
---

# PIPE-OS Management Model (Simplified)

This is the current operating model. Keep it practical — the goal is to get real product work done, not to build the perfect swarm meta-system.

## Core Principles

- Hermes Kanban is the source of truth.
- Every meaningful domain gets its own board when active.
- **Implementation work must be followed by real dogfood + chrome-devtools-mcp validation** before anything is called "done". This rule is non-negotiable.
- The human is the boss. Agents propose, execute within bounds, and escalate.
- Raw transcripts and specific evidence > flattened summaries (especially in Discovery).
- One domain at a time for deep focus.

## Recommended Skills (keep the list short)

**Core for orchestration**:
- `kanban-orchestrator`
- `pipe-os-management` (this)
- `herder-session-management`

**Quality & Validation** (use these ruthlessly):
- `dogfood`
- `kanban-chrome-validation`

**For implementation help**:
- `kanban-codex-lane` (when you want isolated Codex work)
- Direct work or `delegate_task` for most things (especially when running on strong Grok)

**Planning**:
- `recursive-planning-framework`
- `plan` / `writing-plans`

Stop adding more custom lane skills and workflow variants unless they are obviously saving time. The ceremony is currently too high.

## Simple Rule for Implementation Tasks

1. Write clear acceptance criteria.
2. Do the work (direct, delegation, or Codex lane if isolation is needed).
3. Create a validation task that forces real browser dogfood + chrome-devtools-mcp inspection.
4. Only close when the validation confirms "done" state with evidence.

That's the main discipline. Everything else is secondary.

## Anti-Patterns

- Spending more time on swarm mechanics than on the actual product.
- Creating new "lane" skills for every model or tool.
- Letting agents mark work done without real browser validation.
- Over-generalizing workflows before we even know what works.

**Current version note**: Stripped back a lot of the meta-workflow complexity. The value is in getting RCD-INT work and real features shipped with proper validation, not in perfect handoff protocols.

Load this + `kanban-orchestrator`. Then actually do the work.
