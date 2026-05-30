# Herder Messaging — Quick Usage

## As an external AI (Grok, Claude, etc.)

Just use the minimal tool:

```bash
./bin/grok-msg <agent-name> "Your message"
```

This is the recommended path when you are the AI participant in the swarm.

## From Python code (inside a HerderAgent or orchestrator)

```python
from agents.herder_agent import HerderAgent

agent = HerderAgent.from_registry("my-agent", room="discovery")

# Send
agent.send_message("target-agent", "Do the thing", msg_type="task")

# Receive
for msg in agent.get_messages_for_me():
    if msg.sender == "important-agent":
        agent.reply_to(msg, "Got it, working on it.")
```

## In herder-chat

```
/new researcher-3 deep-researcher
@grok-builder please review this
```

The system will handle delivery via room + direct steering.

## Loading the skill

Any agent that needs reliable messaging should load this skill:

```python
agent.load_skill("herder-messaging")
```

See also: `herder-swarm-control` for higher-level coordination patterns.
