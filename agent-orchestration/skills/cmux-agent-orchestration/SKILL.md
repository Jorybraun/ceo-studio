# Agent Orchestration

Teaches agents how to orchestrate multi-agent workflows in cmux, including starting agent servers, discovering agents, making them communicate, and monitoring agent status.

## Use when

- You need to start multiple agent servers in separate cmux panes
- You want agents to discover and communicate with each other
- You need to coordinate multi-agent collaboration on a project
- You want to monitor agent status and conversations

## Typical commands

```bash
# Start agent orchestration workspace
cmux new-workspace --name "Agent Orchestration" --cwd /path/to/project

# Start an agent server
npm run agent-server -- --type devin --port 8001 --project /path/to/project

# Discover running agents
npm run agent-cli -- discover

# Make agents communicate
npm run agent-cli -- talk --from devin-8001 --to voice-agent-8002 --message "Hello"

# Start multi-agent collaboration
npm run agent-cli -- collaborate --project /path/to/project

# Monitor agent status
npm run agent-cli -- monitor
```

## Agent types

- **devin** - Code analysis, debugging, implementation, planning
- **voice-agent** - Voice input/output, conversation, coordination
- **specialist** - Domain expertise, analysis, best practices, recommendations
- **coordinator** - Orchestration, task assignment, coordination, monitoring

## Workflow

1. Create a cmux workspace for agent orchestration
2. Split workspace into multiple panes (one per agent + CLI)
3. Start agent servers in each pane with different ports
4. Use CLI pane to discover agents and make them communicate
5. Monitor agent logs in each pane for live visibility
6. Use CLI to orchestrate multi-agent collaboration

## Example

```
Use $cmux-agent-orchestration to set up a 4-agent workspace for project analysis.
```

This will:
- Create a workspace with 4 agent panes + CLI pane
- Start Devin (port 8001), Voice Agent (port 8002), Specialist (port 8003), Coordinator (port 8004)
- Auto-discover all agents
- Ready for agent-to-agent communication and collaboration