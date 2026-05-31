# Tmux Orchestration - Agent Registry Explanation

## Two Registry Systems

### 1. In-Memory Agent Registry (Library)
- Used when all agents run in the same process
- Fast, synchronous coordination
- Works with the `AgentOrchestrator` class
- **Does NOT work across tmux panes** (different processes)

### 2. HTTP-Based Agent Discovery (CLI)
- Used when agents run in separate processes (tmux panes)
- Slower, async coordination via HTTP
- Works with the `agent-server` and `agent-cli`
- **Works across tmux panes** (different processes)

## How It Works in Tmux

```
Tmux Session: agent-orchestration
├── Pane 0: Devin Agent (port 8001)
│   ├── HTTP Server
│   ├── /health endpoint
│   ├── /discover endpoint  
│   └── /a2a endpoint
│
├── Pane 1: Voice Agent (port 8002)
│   ├── HTTP Server
│   ├── /health endpoint
│   ├── /discover endpoint
│   └── /a2a endpoint
│
├── Pane 2: Specialist Agent (port 8003)
│   ├── HTTP Server
│   ├── /health endpoint
│   ├── /discover endpoint
│   └── /a2a endpoint
│
├── Pane 3: Coordinator Agent (port 8004)
│   ├── HTTP Server
│   ├── /health endpoint
│   ├── /discover endpoint
│   └── /a2a endpoint
│
└── Pane 4: CLI (Control)
    ├── Discovers agents via HTTP
    ├── Makes agents talk via HTTP
    └── Monitors agent status via HTTP
```

## Registry Flow in Tmux

### Step 1: Agents Start
Each agent starts as an HTTP server in its own pane:
- Devin: `http://localhost:8001`
- Voice Agent: `http://localhost:8002`
- Specialist: `http://localhost:8003`
- Coordinator: `http://localhost:8004`

### Step 2: Discovery
CLI pane scans ports 8001-8005:
```bash
curl http://localhost:8001/discover
curl http://localhost:8002/discover
curl http://localhost:8003/discover
curl http://localhost:8004/discover
```

Each agent returns its info:
```json
{
  "agentId": "devin-8001",
  "type": "devin",
  "port": 8001,
  "capabilities": ["code-analysis", "debugging"],
  "endpoints": {
    "a2a": "http://localhost:8001/a2a"
  }
}
```

### Step 3: Registry Creation
CLI builds an in-memory registry:
```typescript
cli.knownAgents = {
  "devin-8001": { agent info },
  "voice-agent-8002": { agent info },
  "specialist-8003": { agent info },
  "coordinator-8004": { agent info }
}
```

### Step 4: Communication
When you make agents talk:
```bash
npm run agent-cli -- talk --from devin-8001 --to voice-agent-8002 --message "Hello"
```

CLI:
1. Looks up `devin-8001` in registry
2. Looks up `voice-agent-8002` in registry
3. Sends HTTP POST to `voice-agent-8002`'s `/a2a` endpoint
4. Voice agent processes and responds
5. Response is logged in CLI pane

## Agent Registry vs. HTTP Discovery

| Feature | In-Memory Registry | HTTP Discovery |
|---------|-------------------|----------------|
| **Scope** | Single process | Multiple processes |
| **Speed** | Fast (in-memory) | Slower (HTTP) |
| **Coordination** | Synchronous | Asynchronous |
| **Tmux Support** | ❌ No | ✅ Yes |
| **Use Case** | Library usage | CLI/Tmux usage |

## Live Logs in Tmux

Each pane shows its own agent's logs:

**Devin Pane:**
```
✓ Agent devin-8001 started on port 8001
✓ Type: devin
✓ Project: /Users/hans/Code/AGENT/CEO_STUDIO

[2024-01-01T00:00:00Z] Received A2A request:
  From: voice-agent-8002
  To: devin-8001
  Payload: {"task":"Analyze this code"}

[2024-01-01T00:00:01Z] Sending A2A response:
  To: voice-agent-8002
  Response: {...}
```

**Voice Agent Pane:**
```
✓ Agent voice-agent-8002 started on port 8002
✓ Type: voice-agent
✓ Project: /Users/hans/Code/AGENT_STUDIO

[2024-01-01T00:00:00Z] Received A2A request:
  From: devin-8001
  To: voice-agent-8002
  Payload: {"task":"Coordinate this task"}
```

**CLI Pane:**
```
=== Making devin-8001 talk to voice-agent-8002 ===

✓ Message sent successfully
✓ Response received in 5ms

Response from voice-agent-8002:
{
  "agentId": "voice-agent-8002",
  "response": "Voice Agent received: {...}"
}
```

## How to Use

### Start Tmux Orchestration
```bash
cd /Users/hans/Code/AGENT/CEO_STUDIO/agent-orchestration
./cli/tmux-orchestrate.sh
```

This creates:
- 4 agent panes with live logs
- 1 CLI pane for commands
- Auto-discovery of all agents
- Ready for agent-to-agent communication

### In CLI Pane
```bash
# Discover agents (auto-runs on start)
npm run agent-cli -- discover

# Make agents talk
npm run agent-cli -- talk --from devin-8001 --to voice-agent-8002 --message "Hello"

# Start collaboration
npm run agent-cli -- collaborate --project /Users/hans/Code/AGENT_STUDIO

# Monitor agents
npm run agent-cli -- monitor
```

## Benefits of This Approach

✅ **Visual** - See all agents and their logs in real-time
✅ **Isolated** - Each agent in its own pane/process
✅ **Coordinated** - HTTP-based discovery and communication
✅ **Debuggable** - Watch each agent's behavior independently
✅ **Scalable** - Easy to add more agents/panes
✅ **Registry** - CLI maintains agent registry via HTTP discovery

## Summary

The **agent registry still exists**, but in tmux orchestration it's:
- **HTTP-based** instead of in-memory
- **CLI-maintained** instead of library-maintained
- **Cross-process** instead of single-process
- **Discoverable** via HTTP endpoints instead of direct calls

You get the best of both worlds:
- Live visibility of all agents
- Agent registry for coordination
- Agent-to-agent communication
- Project context for all agents