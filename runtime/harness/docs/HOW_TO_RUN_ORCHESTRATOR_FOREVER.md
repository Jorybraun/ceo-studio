# How to Run a Long-Living Orchestrator in the Harem

## The Problem
You want the orchestrator (Grok / swarm-facilitator) to stay alive forever so it can:
- Listen for @grok or @swarm-facilitator messages
- Create agents on demand
- Have real back-and-forth conversations
- Run commands in rooms

## Recommended Ways (in order)

### 1. Best for daily use: Dedicated tmux session + responder
```bash
# Start the orchestrator session
tmux new -s harem-orchestrator

# Inside the tmux, run:
harem --orchestrator -d discovery:main
```

Detach with `Ctrl-b d`. Re-attach later with `tmux attach -t harem-orchestrator`.


### 2. Using the dedicated long-running script
```bash
tmux new -d -s harem-orchestrator 'harem-orchestrator --domain discovery --room main'
```

This runs the Python reactor loop forever.

### 3. Production / always-on (when you're ready)
- systemd user service
- Docker container (see docker/ folder)
- A small cron + healthcheck that restarts it if it dies

## Why agents didn't respond before

Previously agents were mostly just watchers (they printed room lines but had no "brain" that knew how to reply using their persona).


In the Harem we distinguish:
- **Agent**: the identity, herder session (tmux), persona, skills, and ability to be @'d and messaged.
- **Brain**: the actual thinking engine (a Hermes profile, direct Grok/Claude, etc.).

You can attach different brains to the same orchestrator agent/role. The skills define the behavior.

## Current back-and-forth flow (what you asked for)

1. `harem -a my-builder -p architect -d mexicans:dev -c`
2. In the chat that opens: `@my-builder please design the new node type`
3. The agent (because it has a responder) can now see the message and reply in the room.

The orchestrator (`@grok`) can do the same thing and can also create agents on the fly when needed.

When running as a Kanban Finisher (`harem kanban-finisher`), it uses the structured stage configuration from `harness/config/kanban.py` (via `--stage` resolution or the loaded `kanban-finisher` persona reading `stage-map.md`) to decide which team and workflow to apply for the current column of each Kanban item.

## Memory Usage Note (Long-Running Processes)


This prevents memory leaks that would occur from repeatedly loading the entire (potentially multi-megabyte) chat history into RAM on every poll loop.

If you are seeing high memory usage, make sure you are on a recent version of the Harem code that includes this improvement.
