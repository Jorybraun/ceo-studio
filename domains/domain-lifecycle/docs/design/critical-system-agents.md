# Critical System Agents

## Definition

**Critical System Agents** are agents that are **required** for the platform to function correctly. They are part of the core infrastructure of the system, not optional user-created agents.

They live at the **System** scope level (see `agent-scoping.md`).

## Key Characteristics

- **Mandatory**: The system cannot operate properly without them.
- **Immutable Core Behavior**: Their fundamental responsibilities are defined in a non-editable system prompt.
- **Customizable Persona**: They can have an editable persona layer that changes tone, style, or project-specific behavior.
- **Always Available**: They are visible and usable across all projects and domains.
- **Protected**: Users cannot delete or disable these agents.

## Current Critical System Agents

| Agent                  | Primary Responsibility                              | Notes |
|------------------------|-----------------------------------------------------|-------|
| **CEO**                | Overall project leadership, high-level decision making, coordination | Top-level orchestrator |
| **Domain Architect**   | Guides users through creating well-scoped domain definitions via interview | Runs domain creation flow |
| **Agenda Agent**       | Receives handoffs, triages work, decides what happens next, manages scheduling and follow-ups | Primary receiver of domain creation handoffs |
| **BA Agent**           | Lives inside each domain. Protects document quality, enforces dirty/clean state, prevents conflicting information | Critical for solving documentation rot |
| **Orchestrator**       | Routes work between agents, manages queues and execution flow | Needed for agent coordination |

## Design Principle

Critical System Agents should have two layers:

1. **System Layer** (Immutable)
   - Defines *what* the agent must do
   - Enforces core rules (e.g., BA Agent must review dirty documents, Agenda Agent must triage handoffs)

2. **Persona Layer** (Editable)
   - Defines *how* the agent behaves
   - Can be customized per project

This split ensures the system stays reliable while still allowing project-specific tuning.

## Future Considerations

As the system evolves, new agents may be promoted to "Critical System Agent" status if they become essential to platform operation. This should be a deliberate decision, not automatic.