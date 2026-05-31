# Devin Agent

Teaches agents how to use the Devin agent for code analysis, debugging, implementation, and planning tasks.

## Use when

- You need code analysis or debugging help
- You want implementation assistance
- You need code planning or architecture guidance
- You want to work with the Devin CLI agent

## Typical commands

```bash
# Start Devin agent server
npm run agent-server -- --type devin --port 8001 --project /path/to/project

# Ask Devin to analyze code
npm run agent-cli -- talk --from voice-agent-8002 --to devin-8001 --message "Analyze this function"

# Ask Devin to implement a feature
npm run agent-cli -- talk --from coordinator-8004 --to devin-8001 --message "Implement user authentication"

# Ask Devin for code review
npm run agent-cli -- talk --from specialist-8003 --to devin-8001 --message "Review this pull request"
```

## Capabilities

- Code analysis
- Debugging
- Implementation
- Planning
- File operations

## Example

```
Use $devin-agent to analyze the authentication module and suggest improvements.
```

This will start a Devin agent and have it analyze the code, providing suggestions for improvements.