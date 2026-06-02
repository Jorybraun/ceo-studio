# Agent Communication — Root Cause & Cleanup Proposal

## TL;DR

Your agents couldn't talk to each other because **the "external" agent path never starts an agent brain**. `launch-agent` in `external` mode only creates a tmux session + a room *watcher* and then prints:

> `Registry command (start manually or via adapter when ready): ...`  (`bin/launch-agent` ~line 164)

So nothing was actually running to receive or answer messages. The watcher (`domain-room-watch`) only *tails* `chat.log` and updates presence — it does **not** make an agent respond. A present watcher looked like a live agent, but there was no brain behind it. Steering (`herder-steer` → tmux `send-keys` into the `main` window) typed into an empty pane, so messages vanished.

On top of that there were **several competing, half-wired comms mechanisms** with no single working path (see "Dead/▲nonsensical" below), which made it impossible to reason about.

## What now works (validated live)

A new adapter, **`bin/devin-agent`**, runs real **Devin CLI** sessions (default model `swe-1.6-fast`) as first-class swarm members and bridges both directions onto the domain-room bus:

- `dispatch --agent <name> --room <r> --task "..."` → runs a Devin turn, captures the reply, records the session id, posts request+reply to the room.
- `tell --agent <name> --room <r> --message "..."` → **resumes the same Devin session** (persistent memory) and posts the exchange.
- `sessions --room <r>` → lists every Devin agent + its session id.

**Live proof (2026-05-29, room `swarm-demo`):** two agents (`devin-research`, `devin-architect`) on `swe-1-6` each worked a Kanban item, then answered orchestrator follow-ups that correctly remembered prior context (one cited the real "Matching domain / Neo4j / dealbreaker gating"). All messages landed on one durable bus: `brain/rooms/swarm-demo/chat.log`.

Why this path is sound where the old one wasn't: it runs an actual brain per turn, captures the reply deterministically from stdout (no tmux-pane scraping), and persists via session ids — so "communicate with every agent" is just reading one room + `devin-agent tell`.

## Dead / nonsensical architecture (proposed cleanup — NOT yet deleted)

Grounded in usage greps:

1. **`external` launch mode that doesn't launch anything.** `bin/launch-agent` external branch should either (a) actually run the registry `command` in the tmux `main` window (like it does for `hermes_profile`), or (b) be removed in favor of real adapters (`devin-agent`, a future `grok-agent`). Today it's a foot-gun that creates the illusion of a running agent.

2. **Structured event protocol with no runtime consumer.** `lib/domain_room_events.py` (ACTIVATE_AGENT/ASSIGN_TASK/… + `append_event`) is referenced **only by its own test** (`tests/test_domain_room_events.py`). It's a designed-but-unwired protocol. Either wire it into a real herder-agent-manager or remove it; right now it's architecture that "makes no sense" because nothing emits or consumes it in the live loop.

3. **Naive placeholder receive-paths in `agents/herder_agent.py`.** `feed_to_brain()` and `process_recent_room_activity()` are self-described placeholders that steer text into a (usually brainless) tmux pane. They imply a working receive loop that doesn't exist. Recommend deprecating in favor of the adapter model.

4. **Autonomous reactor loop (`agents/reactor.py`).** Imported by `herder_agent.py`/`planning_session.py` but never reliably driven end-to-end. Keep only if we commit to it; otherwise it's a third half-path competing with the orchestrator and the adapter.

5. **Overlapping orchestrator entry points.** `bin/harem-orchestrator`, `bin/harem-kanban-finisher`, `bin/kanban-finisher-agent` overlap. Consolidate to one.

## Recommended target model (simple, one path)

```
Orchestrator (you / CEO) ──▶ domain room (chat.log = the bus)
        │                          ▲
        ▼                          │ reply posted back
   bin/devin-agent  ──▶ Devin CLI session (swe-1.6-fast default, persistent via session id)
```

- One bus (the room). One adapter per agent kind (`devin-agent` now; add `grok-agent` later that reuses the same post-to-room contract and the `config/cost_limits.py` guardrail).
- Delete/retire the paths in 1–5 above so there is exactly one way agents communicate.

## Cleanup — STATUS (done this pass)

**Done (approved deletions/fixes):**
- ✅ Removed `lib/domain_room_events.py` + `tests/test_domain_room_events.py` (dead — only self-referenced).
- ✅ Removed `bin/kanban-finisher-agent` (a second Auto-GPT-style loop that overlapped `harem-orchestrator` and was an extra credit-burn vector). `harem-kanban-finisher` remains as a thin alias → one orchestrator.
- ✅ Removed the orphaned `process_recent_room_activity()` placeholder from `herder_agent.py`.
- ✅ Fixed the **`external` no-op launch**: `bin/launch-agent` now actually runs the registry `command` in the main window (it used to only print it), and points users to the provider adapter when no command is set.

**Retained (with reason):**
- `agents/reactor.py`, `react_to_messages()`, `feed_to_brain()` — **kept** because `agents/planning_session.py` actively uses `react_to_messages`/`send_message`. Removing them would break the planning team. Migrate `planning_session` to the provider adapter first, then these can go.

## New architecture (built this pass) — one bus, one provider interface

- **Provider interface** `agents/providers/` (`base.AgentProvider`): `dispatch()` + `tell()`. Implementations: `devin` (Devin CLI, paid) and `echo` (free/offline, for tests). Add new backends here — never vendor-specific code elsewhere.
- **Generic adapter** `agents/agent_adapter.py` + CLI `bin/agent`: run any provider's agent as a swarm member that posts every request/reply to the domain room, persists resumable sessions per (room, agent), and is **guardrail-gated** (kill switch, provider-`paid` policy, per-cycle/hourly/concurrency caps). `bin/devin-agent` is now a thin alias (`--provider devin`).
- **Orchestrator wiring**: `bin/harem-orchestrator` handles `[ACTION] DISPATCH --provider <p> --agent <name> --task "..."`, deduped and cost-gated. Paid providers (Devin) are refused for *automated* dispatch unless `CEO_ALLOW_PAID=1`; a human at a TTY (`bin/agent`) may dispatch them.

Verified with the free `echo` provider: `tests/test_agent_adapter.py` (dispatch, two-way `tell`, hourly cap, kill switch, paid-refused-without-calling). Live Devin/SWE-1.6 two-way exchange verified earlier in room `swarm-demo`.

## Still open (proposed, not done)

- Migrate `agents/planning_session.py` onto the provider adapter, then remove `reactor.py` + the `react_to_messages`/`feed_to_brain` steer-into-pane path.
- Add a `grok` provider implementing the same interface (so Grok agents flow through the one guarded path too).
