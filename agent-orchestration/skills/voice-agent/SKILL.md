# Voice Agent

Teaches agents how to use the Voice Agent for voice input/output, conversation, and coordination tasks.

## Use when

- You need voice input/output capabilities
- You want conversational agent interaction
- You need coordination between agents
- You want to manage agent communication flow

## Typical commands

```bash
# Start Voice Agent server
npm run agent-server -- --type voice-agent --port 8002 --project /path/to/project

# Ask Voice Agent to coordinate
npm run agent-cli -- talk --from coordinator-8004 --to voice-agent-8002 --message "Coordinate this task"

# Ask Voice Agent to summarize conversation
npm run agent-cli -- talk --from devin-8001 --to voice-agent-8002 --message "Summarize our discussion"

# Ask Voice Agent for next action
npm run agent-cli -- talk --from specialist-8003 --to voice-agent-8002 --message "What should we do next?"
```

## Capabilities

- Voice input
- Voice output
- Conversation
- Coordination

## Example

```
Use $voice-agent to coordinate the conversation between Devin and the Specialist.
```

This will use the Voice Agent to manage the flow of communication between other agents.