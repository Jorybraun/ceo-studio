# Agent Scoping Model

## Overview

Agents in this system exist at different **scoping levels**. Scoping determines visibility, permissions, and where an agent can be used. The goal is to prevent cross-pollination and keep agents in the correct context.

## Scoping Levels

### 1. System Agents (Critical / Global)
- **Scope**: Available everywhere in the platform.
- **Purpose**: These are required for the system to function.
- **Examples**: CEO, Domain Architect, Agenda Agent, BA Agent, Orchestrator.
- **Characteristics**:
  - Cannot be deleted by users.
  - Have immutable core behavior (system prompt).
  - Can be customized per project via editable persona layer.
  - Always visible and available.

### 2. Project Agents
- **Scope**: Belong to a specific project. Visible across all domains inside that project.
- **Purpose**: Agents that support project-level work but are not critical system infrastructure.
- **Examples**: A project-level documentation agent, a project-wide notification agent, or custom project assistants.
- **Characteristics**:
  - Created by users or generated during domain work.
  - Visible in the project context but not outside it.
  - Can be deleted or modified by project owners.

### 3. Domain Agents
- **Scope**: Belong to a specific domain inside a project.
- **Purpose**: Agents that are specialized for work inside one domain.
- **Examples**: A "Teams" domain agent, a "Billing" domain agent, or any agent created inside a domain.
- **Characteristics**:
  - Only visible when the user is inside that domain.
  - Focused on that domain’s responsibilities.
  - Can be created, edited, or removed within the domain.

## Scoping Rules

- An agent should **only be visible and usable** within its defined scope.
- System Agents are always available.
- Project Agents are available throughout their project but nowhere else.
- Domain Agents are only visible when inside their domain.
- No cross-pollination: A Domain Agent should not appear in another domain or at the project level unless explicitly promoted.

## Why This Matters

Clear scoping prevents confusion, reduces context pollution for agents, and makes the UI more intuitive. When you are inside a domain, you should only see agents relevant to that domain. When you are at the project level, you see project-level agents plus all system agents.