---
name: ceo-studio-terminal-control
description: "Gives the CEO ability to view and interact with agent tmux sessions in CEO Studio. Includes terminal snapshots, sending commands to agents, opening interactive terminals, and posting messages to agent A2A rooms."
version: 0.1.0
author: CEO Studio
platforms: [macos]
metadata:
  hermes:
    tags: [ceo-studio, terminal, agents, tmux, messaging]
    related_skills: [pipe-os-management, herder-swarm-control]
---

# CEO Studio Terminal Control

This skill gives the CEO (Hermes agent) the ability to view and interact with agent tmux sessions running in CEO Studio. This allows the CEO to "see what agents are doing" and send commands directly to their terminals.

## Available Functions

### 1. View Agent Terminal Snapshot

Get a text snapshot of an agent's current tmux session output.

```bash
# Usage (from harness bin directory)
./bin/ceo-studio-terminal snapshot <agent-id>
```

**Example:**
```bash
./bin/ceo-studio-terminal snapshot architect
```

Returns the last 240 lines of the agent's terminal output as JSON.

**Available agents:** architect, ba, pm, planner, builder, researcher, designer, facilitator, docs-steward, self-repair-engineer, domain-factory-orchestrator, etc. (See agent registry)

### 2. Send Command to Agent Terminal

Send a command/keys to an agent's tmux session (as if you typed it in their terminal).

```bash
# Usage (from harness bin directory)
./bin/ceo-studio-terminal send <agent-id> <command>
```

**Example:**
```bash
./bin/ceo-studio-terminal send architect "explain the storage model architecture"
./bin/ceo-studio-terminal send planner "create a task for the API refactoring"
```

This sends the command followed by Enter to the agent's terminal.

### 3. Open Interactive Terminal

Request that CEO Studio opens a full interactive PTY terminal for an agent in the UI.

```bash
# Usage (from harness bin directory)
./bin/ceo-studio-terminal open <agent-id>
```

**Example:**
```bash
./bin/ceo-studio-terminal open architect
```

This uses a file-based trigger system to request CEO Studio to open the terminal. The main process watches for trigger files and opens the terminal when detected.

### 4. Send Message to Agent Room

Post a message to an agent's A2A room (the proper way to talk to room-based agents).

```bash
# Usage (from harness bin directory)
./bin/ceo-studio-terminal message <agent-id> <message>
```

**Example:**
```bash
./bin/ceo-studio-terminal message architect "Please review the data model for the new feature"
./bin/ceo-studio-terminal message planner "Decompose this brief into actionable tasks"
```

This posts the message into the agent's domain room where their watcher will see it and respond.

## When to Use Each Function

- **terminal-snapshot**: When you want to see what an agent is currently doing or check their state
- **terminal-send**: When you want to send a direct command to an agent's terminal (e.g., ask them to explain something)
- **terminal-open**: When you want to interactively work with an agent's terminal in the UI
- **message**: When you want to properly communicate with an agent via their A2A room (preferred for most communication)

## Agent IDs

Common agent IDs (from the registry):
- `ceo` - The CEO (you)
- `architect` - Architecture and technical decisions
- `ba` - Business analysis and requirements
- `pm` - Project management and roadmap
- `planner` - Task planning and specifications
- `builder` - Implementation and verification
- `researcher` - Research and evidence gathering
- `designer` - UX design and mocks
- `facilitator` - Coordination and synthesis
- `docs-steward` - Documentation and registry maintenance
- `self-repair-engineer` - Diagnostics and system repair

## Example Workflow

```bash
# Check what the architect is currently working on
./bin/ceo-studio-terminal snapshot architect

# Ask the architect to explain something
./bin/ceo-studio-terminal send architect "Explain your current approach to the storage model"

# Send a proper message to the planner
./bin/ceo-studio-terminal message planner "Please decompose the API refactoring brief into tasks"

# Open an interactive terminal for the orchestrator
./bin/ceo-studio-terminal open orchestrator
```

## Notes

- These functions work with the CEO Studio harness's tmux-based agent mounting system
- Agents must be mounted (running) for terminal operations to work
- Room-based messaging works even when an agent's terminal window isn't the active one
- All operations are logged and visible in the CEO Studio UI

## Anti-Patterns

- Don't use `terminal-send` for complex multi-line conversations - use `message` instead
- Don't try to open terminals for agents that aren't mounted - check with `terminal-snapshot` first
- Don't spam agents with repeated commands - give them time to respond
