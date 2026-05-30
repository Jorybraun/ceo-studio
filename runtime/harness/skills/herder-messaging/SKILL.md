---
name: herder-messaging
description: "Core skill for sending and receiving structured messages between agents inside the herder using domain rooms. Covers AgentMessage format, the minimal direct messaging path, and how to hold conversations with other agents (including external AIs like Grok)."
version: 0.2.0
author: PIPE-OS Harness
---

# Herder Messaging Skill

This skill teaches an agent how to **actually talk to other agents** in the Harem.

The core idea is simple:

> You don't need to be an orchestrator.  
> You just need to be able to message them.

## Core Primitives

### 1. Structured Messages (AgentMessage)

Use the Python `HerderAgent` class when you have code access:

```python
from agents.herder_agent import HerderAgent

me = HerderAgent.from_registry("grok", room="mexicans")

# Send a typed, structured message
me.send_message(
    recipient="grok-builder",
    content="Please implement the new graph node type.",
    msg_type="task",
    metadata={"priority": "high", "from_skill": "herder-messaging"}
)

# Read messages addressed to you
my_messages = me.get_messages_for_me(limit=30)
for msg in my_messages:
    if msg.msg_type == "task":
        print(f"Task from {msg.sender}: {msg.content}")
```

This writes a visible `[AGENT_MSG]` JSON line into the room (for humans and audit) and also attempts to fire it directly into the recipient's tmux pane.

### 2. The Minimal Direct Path (Recommended for AI + Humans)

For the simplest possible "just message them" experience, use:

```bash
./bin/grok-msg <agent-name> "your message here"
```

Example:
```bash
./bin/grok-msg grok-builder "Status check on the schema work?"
./bin/grok-msg swarm-facilitator "We need to spin up two more researchers"
```

This does:
- Posts the message visibly in the room as "Grok"
- Fires the text directly into the agent's main tmux pane (via herder-steer)

This is currently the most reliable, lowest-ceremony way for an external AI (or human) to communicate with running agents.

### 3. Listening for Messages Addressed to You

When running as a watcher or responder, you receive messages in two ways:

- Structured: Parse `[AGENT_MSG]` lines from `chat.log` (see `AgentMessage.from_room_line`)
- Direct: Text that was steered into your pane will appear in your terminal/input

For the AI Grok specifically, use the conversation flow in this chat + the `grok-msg` tool when you need to reach other agents.

## Design Principles (Important)

- **Visibility first**: Important messages should appear in the domain room so humans and the orchestrator can see them.
- **Direct when possible**: Use steering (`herder-steer`) to get text into an agent's actual running context.
- **No heavy router required (yet)**: The current shared-room + direct-steer model is intentionally simple. A dedicated mailroom router can be added later if traffic grows.
- **Multiple instances are normal**: You can have `grok-1`, `grok-2`, `researcher-7`, etc., all with the same or different personas. Messaging works by agent `id` / name, not by persona.

## When to Use Structured vs Simple Path

| Situation                        | Recommended Path     |
|----------------------------------|----------------------|
| AI (Grok) talking to agents      | `grok-msg` (simple)  |
| Python orchestrator code         | `HerderAgent.send_message` (structured) |
| Agent needs to reply programmatically | `send_message` + `get_messages_for_me` |
| Human wants to talk to agents    | herder-chat `@agent` or `grok-msg` |
| Long-running task handoff        | Structured `AgentMessage` with `msg_type` and `metadata` |

## Integration with Other Skills

This skill pairs especially well with:
- `herder-swarm-control` — use messaging to activate, steer, and coordinate agents
- `herder-session-management` — create focused rooms and message within them
- Any domain-specific persona skill

## Future Directions (Not Implemented Yet)

- Per-agent inbox files (`brain/rooms/<room>/inbox/<name>.jsonl`) for more efficient receiving
- A lightweight "mailroom" watcher agent that can route / fan-out / dedupe
- Full A2A protocol gateway (see `src/herder-overstory/A2A_INTEGRATION.md`)

For now, keep it simple and direct.

---

**Rule of this skill**: If you can't easily message another agent, the system is too complicated. Simplify until you can.
