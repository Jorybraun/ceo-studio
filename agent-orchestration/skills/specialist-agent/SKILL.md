# Specialist Agent

Teaches agents how to use the Specialist Agent for domain expertise, analysis, best practices, and recommendations.

## Use when

- You need domain-specific expertise
- You want in-depth analysis
- You need best practices for a specific domain
- You want recommendations based on domain knowledge

## Typical commands

```bash
# Start Specialist agent server
npm run agent-server -- --type specialist --port 8003 --project /path/to/project

# Ask Specialist for expertise
npm run agent-cli -- talk --from devin-8001 --to specialist-8003 --message "What are the best practices for authentication?"

# Ask Specialist for analysis
npm run agent-cli -- talk --from coordinator-8004 --to specialist-8003 --message "Analyze this architecture"

# Ask Specialist for recommendations
npm run agent-cli -- talk --from voice-agent-8002 --to specialist-8003 --message "Recommend improvements for this design"
```

## Capabilities

- Domain expertise
- Analysis
- Best practices
- Recommendations

## Example

```
Use $specialist-agent to provide best practices for implementing OAuth2 authentication.
```

This will have the Specialist provide domain-specific expertise on OAuth2 implementation.