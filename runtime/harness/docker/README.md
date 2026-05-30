# Running the Project CEO Harness 24/7 with Docker

This guide explains how to containerize and run the CEO Harness (and its delegated tools) persistently so agents can work autonomously around the clock.

## Philosophy

- The CEO Harness itself is relatively lightweight (strategic orchestration + chat + delegation + brain coordination).
- The heavy autonomous work (planning swarms, research, coding) runs inside specialized harnesses (Hermes, Overstory, etc.).
- Everything should survive restarts, sleep, and power cycles.

## Quick Start (Development / Local 24/7)

```bash
cd harness

# 1. (Optional) Point to the project you want managed
export TARGET_PROJECT=/path/to/your/project

# 2. Start everything in the background
docker compose up -d

# 3. Watch logs
docker compose logs -f ceo-orchestrator
```

The `ceo-orchestrator` service will run continuously with background loops (reading chat, managing delegations, updating brain context, etc.).

## Production 24/7 Recommendations

### 1. Persistent Volumes (Critical)
All important state lives in named volumes:
- `ceo_state`
- `ceo_brain_logs` (raw chat + agent conversations)
- `ceo_kanban`
- `brain_data` (GBrain's database + repo)
- `shared_work` (handoff area between CEO Harness and Hermes/Overstory)

These survive container restarts and `docker compose down`.

### 2. Brain Layer (GBrain)
GBrain is designed for 24/7 operation with "dream cycles" (background enrichment, synthesis, graph maintenance).

In the compose file, the `brain` service should be configured with:
- Its own persistent storage
- Scheduled jobs / cron inside GBrain for the dream cycle
- Proper API keys (via `.env` or secrets)

Example `.env` snippet:
```
GBRAIN_OPENAI_API_KEY=sk-...
GBRAIN_DREAM_CYCLE_INTERVAL=3600   # every hour
```

### 3. Hermes (Planning Agents)
Run Hermes as its own persistent service (or on another machine).

The CEO Harness talks to it via `HERMES_URL`.

For true 24/7 planning:
- Keep Hermes running with its Kanban swarm / agents active.
- The CEO Orchestrator sends delegation requests when it detects strategic work that needs deep planning.

### 4. Overstory (Coding Agents)
Overstory already supports persistent coordinators.

You can run one or more Overstory instances and have the CEO Harness dispatch implementation work to them when planning is approved.

### 5. Chat Access
Currently the chat tool is a CLI. For 24/7 human access you have options:

**Short term:**
- Run `docker compose exec ceo-orchestrator ./bin/chat --to ceo` when you want to talk.

**Better (recommended next step):**
- Turn the chat into a lightweight always-on service (FastAPI + simple UI or just stdio over a socket).
- Or expose it via a simple web interface / Telegram bot / etc.

### 6. Monitoring & Observability
Add to your compose (or use external tools):
- Log aggregation (Loki, etc.)
- Health checks on the orchestrator
- Resource limits so one runaway delegation doesn't kill the host

Example healthcheck in compose:
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import ceo_orchestrator.health; ceo_orchestrator.health.check()"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Configuration

Create a `.env` file next to `docker-compose.yml`:

```env
TARGET_PROJECT=/Users/you/Code/my-real-project
BRAIN_URL=http://brain:8000
HERMES_URL=http://hermes:8080
CEO_LOG_LEVEL=info
```

## Common 24/7 Patterns

1. **One machine, everything together** (easiest)
   - Run this docker-compose + a Hermes container + GBrain.

2. **Distributed**
   - CEO Harness + Brain on one VPS.
   - Hermes on another machine (more resources for planning swarms).
   - Overstory instances spun up per coding task.

3. **Hybrid**
   - Run the CEO Harness + Brain in Docker.
   - Run Hermes via its preferred deployment (Railway, Render, your own server) and just point `HERMES_URL`.

## Next Steps for Real Autonomy

- Implement the actual background orchestrator loop inside the Docker image.
- Build the delegation protocol (how the CEO tells Hermes "go do this planning work").
- Add a persistent Kanban store (database or files) that survives restarts.
- Make the chat interface always available (web or bot).

Would you like me to start building any of these pieces next (e.g., a real background orchestrator loop, a simple web chat, or the Hermes delegation client)?
