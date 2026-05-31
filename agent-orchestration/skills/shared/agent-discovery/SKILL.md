# Agent Discovery

Teaches agents how to discover running agent servers via HTTP endpoints and build an agent registry.

## Use when

- You need to find all running agent servers
- You want to build an agent registry
- You need agent status information
- You want to verify agent health

## Typical commands

```bash
# Discover all agents
npm run agent-cli -- discover

# Check specific agent health
curl http://localhost:8001/health

# Get agent information
curl http://localhost:8001/discover
```

## Discovery process

1. Scan common ports (8001-8005) for HTTP servers
2. Call `/discover` endpoint on each port
3. Parse agent information (type, capabilities, endpoints)
4. Build agent registry in memory
5. Return agent list with status

## Example

```
Use $agent-discovery to find all running agents and build the registry.
```

This will scan ports, discover agents, and build a registry for coordination.