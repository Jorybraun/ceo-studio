# Coordinator Agent

Teaches agents how to use the Coordinator Agent for orchestration, task assignment, coordination, and monitoring tasks.

## Use when

- You need to orchestrate multi-agent workflows
- You want to assign tasks to optimal agents
- You need to coordinate agent communication
- You want to monitor agent status and workload

## Typical commands

```bash
# Start Coordinator agent server
npm run agent-server -- --type coordinator --port 8004 --project /path/to/project

# Ask Coordinator to assign task
npm run agent-cli -- talk --from voice-agent-8002 --to coordinator-8004 --message "Assign this task to the best agent"

# Ask Coordinator for status
npm run agent-cli -- talk --from voice-agent-8002 --to coordinator-8004 --message "What is the current agent status?"

# Ask Coordinator to coordinate
npm run agent-cli --talk --from devin-8001 --to coordinator-8004 --message "Coordinate this multi-agent workflow"
```

## Capabilities

- Orchestration
- Task assignment
- Coordination
- Monitoring

## Example

```
Use $coordinator-agent to assign the code review task to the agent with the most capacity.
```

This will have the Coordinator analyze agent workloads and assign the task optimally.