# Shared Agent Skills

Shared skills library for all agents in the agent orchestration system. These skills provide common functionality that can be used across different agent types.

## Available Skills

### Agent Discovery
`skills/shared/agent-discovery/SKILL.md`

Automatically discovers running agent servers via HTTP endpoints, builds agent registry, and provides agent status information.

### Agent Communication
`skills/shared/agent-communication/SKILL.md`

Handles agent-to-agent communication via HTTP, including message routing, request/response cycles, and conversation logging.

### Agent Lifecycle
`skills/shared/agent-lifecycle/SKILL.md`

Manages agent lifecycle states (DORMANT, SLEEP, ACTIVE, STOPPED), handles wake/sleep/start/stop operations, and manages agent resources.

### Agent Registry
`skills/shared/agent-registry/SKILL.md`

Maintains agent registry with agent information, capabilities, and endpoints. Supports both in-memory and HTTP-based registries.

### Project Context
`skills/shared/project-context/SKILL.md`

Provides project context to agents, including project path analysis, file structure detection, and dependency analysis.

## Usage

Each agent can use these shared skills:

```bash
# Discover agents
Use $agent-discovery to find all running agents

# Communicate with agents
Use $agent-communication to send messages between agents

# Manage agent lifecycle
Use $agent-lifecycle to wake/sleep/start/stop agents

# Access agent registry
Use $agent-registry to get agent information

# Provide project context
Use $project-context to analyze the current project
```

## Example

```
Use $agent-discovery to find all agents, then use $agent-communication to make them collaborate on the project.
```

This will discover all running agents and orchestrate their communication for project work.