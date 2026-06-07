# Harem

**Your personal agent swarm.**

This is the local system (previously called "the harness") for running and talking to a collection of persona-driven agents. The goal is simple:

- Start agents easily with a persona
- Talk to them directly with `@agent` in chat
- Have real back-and-forth (agents that actually respond)
- Let a long-running orchestrator coordinate everything

Everything lives under this directory and is driven by the single `harem` command.

## Core Idea

We do **not** want to build yet another low-level agent platform.

Instead, this harness:
- Maintains the big picture and cross-domain strategy.
- Uses Kanban as the primary human review surface (approve / deny / comment).
- Lets the human steer naturally via chat when needed.
- Hands real work off to proven existing tools:
  - **Hermes** (Kanban + swarms) for planning, research, and design.
  - **Overstory** (or similar) for coding and implementation.
  - **GBrain** (or equivalent) for persistent memory and synthesis.

## Key Characteristics

- **High agency** inside the delegated harnesses.
- **Kanban-centric** human interface.
- **Selective deep involvement** via chat (especially early on).
- **Agnostic & portable** — designed to eventually live outside any single project and be reusable.
- **No reinvention** of coding agents or complex orchestration engines.

## Current State

Early architecture and foundation phase.

See:
- `DESIGN.md` — overall philosophy and architecture
- `architecture/DELEGATION-MODEL.md` — how we compose existing systems
- `architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` — tmux-agent research
- `architecture/BRAIN_AND_GBRAIN_ROADMAP.md` — local brain, dream cycles, and future GBrain contract
- `agents/AGENT_REGISTRY.md` — registered agents
- `harness/config/kanban.py` — the structured Kanban stage → team/workflow config objects
- The **Commands & Tools** section below — canonical reference for everything in `bin/` + Tool Discipline rules

This local setup (the agents, personas, herder-chat, messaging, etc.) is affectionately called the **Harem**.

## Quick Start

```bash
# Start an agent with a persona (it gets a brain + responder so it can reply)
harem -a my-builder -p architect -d discovery:planning -c

# Talk to it directly
# (inside herder-chat)
@my-builder please design the data model

# Start a long-running orchestrator (its brain can be Hermes, Grok, etc.)
harem --orchestrator -d discovery:main

# Talk to the AI orchestrator
@grok spin up two researchers for this task

# Best way: Start the dedicated Kanban-finishing orchestrator (drives the Kanban to completion)
harem kanban-finisher --domain discovery --room main

# Alternative dedicated launcher
harem-kanban-finisher
```

The `harem` command (and `harem-kanban-finisher`) is the main interface. It handles starting agents with the right brain + persona, creating domain:room spaces, and running long-lived orchestrators that can drive Kanban completion using delegation.

### Delegation Example (used by the Kanban Finisher)

```bash
harem delegate \
  --task "Raw Transcript as Primary Artifact" \
  --personas "ba,architect,pm" \
  --domain discovery:planning \
  --tag kanban-auto
```

Or the lower-level helper:
```bash
harem-delegate --task "..." --personas "ba,architect" --room discovery:planning
```

**Recommended form (stage-driven):**

```bash
harem delegate --task "..." --stage Triage
```

This is the cleanest way. It resolves the team, workflow, and personas from the real config object (see below).

Explicit team + workflow form:

```bash
harem delegate --task "..." --team discovery-planning --workflow discovery-planning-triage
```

Legacy/raw form (still works):

```bash
harem delegate --task "..." --personas "ba,architect,pm"
```

The orchestrator monitors the room and drives the Kanban forward. See `bin/list-teams` for currently defined teams.

## Core Concepts

- **Personas**: Live in the big `personas/` folder. You can add as many as you want, organized however you like (including domain-specific ones).
- **Agent**: The herder identity — name, tmux session, persona, skills, presence, and ability to be addressed with `@name`.
- **Brain**: The actual thinking engine attached to the agent (a Hermes profile, direct Grok, Claude, local model, etc.). Different agents can have different brains.
- **@agent**: Direct messaging. Type `@name whatever` in the chat and it steers the agent's tmux session (and posts visibly).
- **Orchestrator**: An agent running the orchestrator role (via `herder-swarm-control` + `herder-messaging` skills). Its brain can be Hermes, Grok, Claude, etc. — the behavior stays consistent.
- **Delegation helpers**: `harem-delegate` is used by the orchestrator to spin up the right persona agents for a specific Kanban task.
- **Team**: A named group of roles/personas that owns work for a particular kind of Kanban work (defined in `harness/teams/<name>/definition.md`).
- **Workflow**: A repeatable process with clear gates and handoff rules (defined in `harness/workflows/<name>.md`).
- **Stage Map / Kanban Config**: The binding of Kanban columns (Triage, Ready, In Progress, etc.) to teams and workflows. See the full system below.

## Kanban Stage Configuration System (Teams, Workflows, and Stage Maps)

This is the declarative system that lets the Kanban Finisher (and other orchestrators) drive cards from Triage all the way to Done **without hardcoded persona lists** in Python.

### Two Parallel Views

The system deliberately maintains two representations:

**1. Human & Brain View (Markdown — what people and LLM brains read)**

- `context/<domain>-team/mgmt/stage-map.md` — "For items in this column, use this team + this workflow"
- `harness/teams/<team-name>/definition.md` — Charter, roles, and default personas for a team
- `harness/workflows/<workflow-name>.md` — The actual process, gates, and success criteria

These files are rich, readable documentation. The `kanban-finisher` persona is explicitly told to read the stage-map for the current column of a card before delegating.

**2. Machine Config Object (what code actually executes against)**

- `harness/config/kanban.py`

This module defines proper Python dataclasses:

```python
StageMapping(team, workflow, default_personas, notes)
DomainKanbanConfig(domain, stages: dict[str, StageMapping])
```

Tools load real objects from here:

```python
from config.kanban import get_stage_mapping

mapping = get_stage_mapping("discovery", "Triage")
# mapping.team → "discovery-planning"
# mapping.workflow → "discovery-planning-triage"
# mapping.default_personas → [...]
```

This is the reliable source for automation. It follows the same pattern as `agents/registry.py`.

### How to Delegate (Recommended Order)

```bash
# 1. Best for orchestrators and automation (recommended)
harem delegate --task "Fix the transcript pipeline" --stage Triage

# 2. Explicit team + workflow
harem delegate --task "..." --team discovery-planning --workflow discovery-planning-triage

# 3. Raw personas (power user / one-off)
harem delegate --task "..." --personas "ba,architect,pm"
```

`--stage` is the preferred form because it goes through the real config object in `harness/config/kanban.py`.

### Adding or Changing Behavior

- Want a new team? Create `harness/teams/my-new-team/definition.md` (and usually add it to `harness/config/kanban.py` so tools can resolve it).
- Want a new workflow? Create `harness/workflows/my-new-workflow.md`.
- Want different behavior per stage for a domain? Update both:
  - The human view: `context/<domain>-team/mgmt/stage-map.md`
  - The machine config object: the corresponding entry in `harness/config/kanban.py`
- Run `bin/list-teams` to see what teams are currently registered in the config.

The long-running `harem kanban-finisher` is designed to use this system so the same binary can drive completely different domains with completely different team structures and processes.

## Current Direction

We're consolidating around the `harem` CLI as the single way to start agents, assign personas, open rooms, and run the orchestrator. The focus is real conversation and direct control via `@agent` rather than heavy ceremony.

### Kanban-Finishing Orchestrator

The dedicated `harem kanban-finisher` (and `harem-kanban-finisher`) launches a long-running orchestrator using the `kanban-finisher` persona + `herder-swarm-control` + `herder-messaging` skills.

It periodically reads the Kanban (`context/discovery-team/mgmt/kanban.md`), looks up the current stage in the domain's stage map, and delegates using the structured config object in `harness/config/kanban.py` (via `harem delegate --stage ...` or explicit team/workflow).

This is the engine that will drive Triage items all the way to Done using the configured teams and workflows for each Kanban column.

## Commands & Tools

The primary way to interact with the Harem is through the unified `harem` command.

### Primary Interface

| Command   | Purpose                                                                 |
|-----------|-------------------------------------------------------------------------|
| `harem`   | Main CLI. Start agents with personas, open chats, run the orchestrator, manage tags. |

Example usage is shown in the Quick Start above.

### Supporting Tools (mostly called by `harem` or used directly when needed)

#### Domain Rooms (the shared visible bus)

| Command             | Purpose                                      |
|---------------------|----------------------------------------------|
| `domain-room`       | Create rooms, post messages, watch rooms, etc. |
| `herder-chat`       | The rich interactive chat UI (what you spend most time in) |
| `herder-steer`      | Low-level: inject text into an agent's tmux pane |

**Room log management.** Each room's `chat.log` is the shared bus and can grow
without bound (a single misbehaving agent once produced a 55MB log). `domain-room`
now self-manages it:

- **Auto-rotation:** every `post` checks the log size; once it exceeds
  `ROOM_LOG_MAX_BYTES` (default 5 MiB, set `0` to disable) the log is moved to
  `chat.log.1` (one generation kept) and a fresh log is started. Disk per room is
  bounded to ~2× the cap, with no cron required.
- **Manual trim:** `domain-room compact <domain> [keep]` trims to the last `keep`
  lines (default 5000) and backs up first. Passing `[keep]` makes it
  non-interactive so it can run from a script/cron.
- Readers (`domain-room watch`, `herder-chat`) detect the size shrink from
  rotation/compaction and reset their read offset, so no messages are dropped or
  re-fired.

#### Starting & Running Agents

| Command                | Purpose |
|------------------------|---------|
| `launch-agent`         | Lower-level way to start a persona agent into a herder session |
| `harem-orchestrator`   | Dedicated long-running process for the orchestrator |

#### Utilities

| Command           | Purpose |
|-------------------|---------|
| `list-personas`   | See everything available in your `personas/` folder |
| `list-teams`      | See defined teams (used with `--team` / `--stage` delegation) |

#### A2A Agents & Meetings (`bin/agent`)

`bin/agent` is the generic, provider-backed adapter. Beyond `dispatch` / `tell` /
`sessions` / `providers`, it speaks the real **Agent2Agent (A2A) protocol** so any
CLI agent can be wrapped and orchestrated uniformly:

| Subcommand        | Purpose |
|-------------------|---------|
| `serve`           | Run a real A2A HTTP server that wraps ONE agent (any provider) with a discoverable Agent Card. The agent's "brain" is just its provider CLI behind the standard protocol. |
| `meeting`         | Stand up invited members as A2A servers and run an **agenda-driven, relevance-gated** meeting. Members contribute or reply `PASS`; the facilitator synthesizes requirements into the room + `requirements.md`. One-shot: ask once, synthesize, exit. |
| `room`            | Run a **persistent live room loop**: watch the room's `chat.log` for new human messages and route them to members so they reply in real time, until stopped. `@<agent>` addresses one; a whole-team message is relevance-gated (reply or `PASS`); an agent reply that `@<teammate>` mentions triggers bounded agent-to-agent follow-up. **Memory:** each turn is captured into **gbrain** and relevant prior context is recalled per turn (augmenting provider-session continuity); gbrain auto-skips if unhealthy (`--no-gbrain` to disable). Recall is bounded by `--gbrain-limit` (result count) and a `--gbrain-ceiling` context cap (max chars injected per turn, default 4000). This is the ongoing complement to one-shot `meeting`. |

```bash
# Serve one agent as an A2A endpoint (foreground)
./bin/agent serve --agent architect --provider devin --persona architect --room discovery

# Run a requirements meeting (free dry run with echo; real brains with devin/grok)
./bin/agent meeting --room discovery \
  --members "ba:echo:ba,arch:echo:architect,pm:echo:pm" \
  --agenda "Define requirements for X" \
  --criteria "What a good outcome looks like"

# ...or pull members from the declarative registry (agents.json) by id or team:
./bin/agent meeting --room discovery --members "ba,architect,pm" --agenda "..."
./bin/agent meeting --room discovery --team discovery-planning --agenda "..."

# Run a PERSISTENT live room (agents reply to whatever is posted, until killed).
# Post into it from another shell with `domain-room post`, or from the cockpit.
./bin/agent room --room discovery --team discovery-planning
./bin/agent room --room discovery --members "ba,architect,pm" --max-followups 1
```

#### Studio Sessions

Studio Sessions are the cockpit's saved build/deep-dive conversations. Each
session has one lead registry agent, a durable AGUI-rendered transcript, an
artifact/workflow panel, an optional planned team, and a room log under
`runtime/harness/brain/rooms/sess-*/`.

The session behavior is deliberate:

- Creating or reopening a session does **not** start an A2A room loop.
- The chat input talks to the selected lead through the AGUI bridge, persists
  the turn in the session JSON, and mirrors user/lead turns into the session's
  room `chat.log` so the team log visibly updates.
- Provider cost is governed by the shared guardrails: max concurrent agents,
  hourly/per-cycle spawn caps, and the kill switch. Paid labels alone do not
  block normal agent use.
- If a live room loop is running, the same chat input posts to the room instead
  of also direct-calling the lead, so one user message does not double-trigger
  agents. Agent replies appear in the room log.
- Worker/team launch is explicit and plan-gated; launching workers does not
  silently start paid providers or a background room loop.
- Clicking an agent card opens a left-panel terminal inspector backed by tmux
  `capture-pane` plus one-line `send-keys`. This is the free interim terminal;
  the node-pty/xterm rebuild upgrades the transport later without changing the
  session model.

This keeps sessions useful as revisitable working conversations while avoiding
surprise provider spend from hidden heartbeats or auto-spawns.

#### Agent Roster Dogfood

Use the roster dogfood runner whenever agent registry, provider, model, room, or
meeting behavior changes. It exercises each configured agent through the same
`agent_adapter` path rooms and meetings use, then runs a resume turn so provider
session bugs are visible.

```bash
# Spend-safe: tests non-paid providers and reports paid agents as skipped.
npm run qa:agents

# Full live-provider pass. This spends provider turns and raises the hourly cap
# for this explicit test process so the whole roster can be checked.
npm run qa:agents -- --allow-paid

# Target a single failing agent while iterating.
npm run qa:agents -- --agent codex-factory-strategist
```

Reports are written to `dogfood-output/agent-roster/` with immutable timestamped
files plus `report.md` as the latest pointer. The room transcript is written
under `runtime/harness/brain/rooms/<room>/chat.log`.

**Declarative agent registry (`agents/agents.json`).** Adding an agent is config,
not code: declare `{id, provider, persona, model, capabilities}` and it's usable as
a meeting member by bare id (inline `id:provider:persona` overrides). Named `teams`
expand via `--team`. Projects override the shipped defaults via `$CEO_AGENTS_CONFIG`
or a `<workspace>/agents.json` (env file wins). Providers can be mixed freely
(echo/devin/grok).

Notes:
- Every A2A exchange is still mirrored into the human-visible **domain room** (the
  `chat.log` bus) via the existing `agent_adapter`; provider spend is bounded by
  the shared caps/kill-switch rather than a paid-label block.
- Personas resolve per-project via `agents/personas.py` (see `$CEO_PERSONAS_DIR`,
  `<workspace>/personas`, then the shipped `personas/`).
- **Dependency:** `serve`/`meeting` need `a2a-sdk` in `runtime/harness/.venv`
  (`python3 -m venv .venv && .venv/bin/pip install 'a2a-sdk[http-server]' uvicorn httpx`).
  `bin/agent` auto-re-execs into that venv when needed. `room` drives members
  through the same `agent_adapter` substrate the A2A executor wraps, so it runs
  without the a2a-sdk (no HTTP server to stand up).
- **Cockpit integration:** opening a team/DM/board channel in CEO Studio starts a
  `room` loop for that channel (`meetings.startRoomLoop` → IPC
  `meetings:room_loop_start`), so typing in the channel composer is a real A2A
  conversation; closing it (or quitting the app) stops the loop. The cockpit is a
  Slack-like switcher: the **CEO** is the default channel, and each Kanban board
  has a **team-log channel** (`meetings.boardRoom(slug)`) where the autonomy
  runner posts work milestones (▶ started / ✓ finished / ✅ done / ⛔ blocked)
  next to the chat — so a channel is the team's shared work log. Messages to a
  room also carry the same referenced context the CEO chat injects.

### Tool Discipline

Keep the surface small. Prefer extending `harem` or `herder-chat` over creating new standalone scripts.

## How the Orchestrator Works

The orchestrator (you talking to `@grok`, or a persistent `swarm-facilitator`) can:

- Create agents on demand when needed
- Message any agent directly with `@name`
- Keep long-running context

To keep the orchestrator alive "forever":

```bash
tmux new -d -s harem-orchestrator 'harem --orchestrator -d discovery:main'
```

Then just talk to it normally in `herder-chat` with `@grok`.

## Personas

All personas live in `personas/`. This is intentionally a big, flat, user-managed folder (with optional subfolders for domains or categories).

Add a new persona by dropping a `.md` file in there. Use it immediately with `-p` or when doing `/new`.

Run `./bin/list-personas` to see everything you currently have.

> Most day-to-day interaction should go through the `harem` CLI and `herder-chat`. The older commands below still exist for power users or scripting but are being consolidated.

### Lower-level / Power Tools (use when needed)

- `domain-room` family — raw room operations
- `herder-steer` — direct injection into agent panes
- `launch-agent` — explicit agent session creation

See the individual script `--help` for details.
