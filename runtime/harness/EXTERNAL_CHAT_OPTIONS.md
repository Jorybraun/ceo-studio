# External Chat Options (Slack / Discord vs Custom Rooms)

**Date**: 2026-05-28  
**Context**: Evaluating whether to continue building custom domain rooms (herder session + web UI) or switch to Slack/Discord for human + multi-agent collaboration.

**2026-05-28 update**: Herder sessions have replaced tmux as the primary coordination model. Treat tmux references below as historical/legacy TTY-adapter language unless explicitly marked otherwise.

## The Core Need
We want a low-friction place where:
- The human can participate easily (minimal typing/setup)
- Multiple agents from different systems (Hermes profiles, Grok, Claude personas, etc.) can join conversations
- Work is scoped per domain (e.g. Discovery vs Culture Interview)
- Conversations around briefs, debriefs, clarification, and planning can happen
- Everything is logged and can feed into Kanban decisions and the brain

## Option 1: Keep Building Custom Rooms (Current Path)
**What we have now**:
- `domain-room` (herder/domain-room + file-based log)
- `domain-room-ui` (lightweight local web chat)
- Full visibility through herder session state, Kanban, domain-room logs, and browser UI
- Easy to integrate with the Hermes `herder-session-management` skill

**Pros**:
- Matches the updated "visible multi-agent herder session" vision
- No external accounts or costs
- Complete control + logging stays inside the harness
- Domain-scoped by design

**Cons**:
- High friction for the human (even with the web UI, it's not as smooth as Slack)
- Not automatic — nothing listens and responds unless we build listeners/bots
- Mixed agents (Grok + Claude + Hermes) require custom glue
- Ongoing maintenance burden

## Option 2: Use Slack or Discord as the Primary Chat Layer
**Idea**: Use a dedicated Slack workspace or Discord server with channels per domain (`#discovery`, `#culture`, etc.). Agents post via webhooks or simple bots.

**Pros**:
- Dramatically better UX for the human (real chat, threads, mobile, notifications)
- Much less custom code to write and maintain
- Easy to add multiple agent types (webhooks are simple)
- Threads work great for specific briefs
- Can still keep legacy TTY adapters for agents that require them — they just post updates into Slack/Discord and/or the domain room

**Cons**:
- Loses the pure "everything visible in one local dashboard" feeling unless the herder dashboard/room UI is kept in sync
- External service (account, potential cost, data outside the harness)
- Need to handle logging/brain ingestion separately (webhook -> local log or direct to brain)
- Slightly less "air-gapped" feeling

## Recommended Hybrid (Strongly Suggested)

Use **Slack or Discord for the conversation layer** + **herder session/domain-room/Kanban for agent execution visibility**.

- Human + agents discuss briefs, do debriefs, ask questions, and make decisions in `#discovery` (or a Discord equivalent).
- When launching agents for a domain, they run as herder participants/adapters with status and outputs reflected in durable state.
- Agents post important updates, questions, or proposals into the Slack/Discord channel via a simple webhook.
- Durable decisions and work packages still go to the Hermes Kanban board for that domain.
- The custom `domain-room` tooling can be deprecated or kept only for very isolated/secure work.

This gives you:
- Good human experience (Slack/Discord)
- The herder visibility model now preferred for PIPE-OS
- Low maintenance on the chat side
- Clean scoping per domain via channels

## Quick Decision Framework

| Priority                        | Slack/Discord | Custom herder rooms |
|--------------------------------|---------------|-------------------|
| Human typing effort            | Excellent     | Medium            |
| Watching agents / status       | Good (via adapters + webhook posts) | Excellent     |
| Mixed agents (Grok + Claude + Hermes) | Easy         | Requires work     |
| Long-term maintenance          | Low           | High              |
| Data control / air-gapped feel | Medium        | High              |
| Speed to get real work done    | Fast          | Slow              |

## Next Steps (if we go external)

1. Pick Slack or Discord (Discord is free and has good bot/webhook support; Slack is more common in professional contexts).
2. Create a dedicated workspace/server + channels per active domain.
3. Build a tiny `post-to-external-chat` helper in `harness/bin/` that agents can call (similar to how `domain-room post` works today).
4. Update `domain-room` or create a new `external-chat` integration so the transition is smooth.
5. Decide how (or if) we want room conversations to automatically feed the local brain/logs.

## Current Status

As of now we have a working but manual custom room system (`domain-room` + `domain-room-ui`). It works for basic use but requires manual participation for real conversation.

The question is whether the friction is worth the control, or whether we should pivot to an external chat tool for the collaborative thinking layer.

---

**Decision needed**: Slack, Discord, keep building custom, or hybrid?
EOF
echo "Created EXTERNAL_CHAT_OPTIONS.md"
## Effort Reality Check (Added 2026-05-28)

**Building our own Slack-like system** (real-time messaging, presence, threads, notifications, mobile support, multi-agent posting, history, search, etc.):
- This is a multi-month (or multi-year) project if done properly.
- Even a "good enough" version that feels smooth would require significant ongoing work (sync, auth, storage, UI, mobile, reliability).
- We already saw friction with the custom `domain-room` + web UI — it works but doesn't feel automatic or delightful.

**Using Discord (or Slack)**:
- Create a server/workspace + channels per domain: ~10 minutes.
- Basic webhook posting from agents: ~10 lines of code (see `bin/post-to-discord`).
- Agents can post from herder adapters, the new web UI, or anywhere.
- Human gets excellent chat experience with almost zero custom work.
- Can later add a simple bot if we want agents to read messages too.

**Bottom line**: Using Discord is orders of magnitude easier than building our own version of Slack for this use case.

If the goal is "get real domain work done quickly with good human + agent collaboration", external chat wins hard on effort.


## File & Content Referencing (The Real Concern)

This is the most important practical question when considering external chat.

**Problem with pure Slack/Discord:**
- Agents can't easily say "look at lines 47-82 of this file" in a way that's useful.
- Copy-pasting large chunks is ugly.
- No natural way for an agent to pull context from the actual project filesystem during discussion.

**Solution we're building:**
See `bin/reference-for-chat`

This tool lets any agent (or human) do this:

```bash
reference-for-chat context/discovery-team/docs/briefs/discovery-agent-analysis-microapp-brief.md 40 65 --note "Key section on the two workstreams"
```

It outputs clean, copy-pasteable output with the path, line range, optional note, and a small relevant snippet.

This can be posted directly into Discord, Slack, or the custom room.

With a small wrapper, herder-managed agents/adapters can generate high-quality file references without manual copy-paste.

This significantly reduces the "referencing files is painful in external chat" problem.

Bottom line: We don't have to choose between "great chat UX" and "good file referencing" — we can have both with a small helper tool.

