# Domain: Channels

**Slug**: channels
**Status**: defined
**Owner Persona**: domain-architect
**Created**: 2026-06-02T08:49:52Z
**Updated**: 2026-06-02T08:49:52Z
**Kanban Board**: ceo-studio

## Purpose / Ownership
Own how people and agents talk to each other inside CEO Studio: the live A2A
(agent-to-agent) rooms, the human/CEO drop-in surface, the board team-log
channels where work milestones appear, and the one-panel channel switcher that
ties them together. A "channel" is the durable, human-visible conversation
substrate (`brain/rooms/<room>/chat.log`) plus whatever makes it *live* (the
persistent room-loop daemon).

## Overarching Goal / Long-term Outcome
A Slack-like surface where the CEO, a team, or a single agent can be addressed
in one place, agents reply when a message concerns them (and coordinate with
each other), and every board doubles as a team log that streams real work
milestones as autonomy runs. One panel, many channels, always live.

## Boundaries / Ownership
- Owns the live room loop (`room_loop.py`) routing, relevance gating, and bounded A2A follow-up.
- Owns the channel bridge (`main/core/meetings.js`): room naming, post/read, room-loop lifecycle.
- Owns the channel switcher + channel surface in `renderer/app.js`.
- Owns the board team-log convention (`meetings.boardRoom(board)`) and how work milestones render in a channel.
- Owns the IPC surface for channels (`meetings:room_loop_*`, `meetings:post`, `meetings:room`).
- Does NOT own team membership/registry definitions (that is the Teams domain).
- Does NOT own the one-shot meeting engine flow or synthesis (that is the Meetings domain).
- Does NOT own the autonomy runner's decision logic (it only consumes the team-log post hook).
- Does NOT own provider credentials, model funding, or the Hermes CEO relay itself.

## Key Capabilities / Initial Features
- Persistent per-room A2A loop: agents reply to human messages until stopped.
- `@mention` routing to one agent; whole-team routing with PASS-gated relevance.
- DM rooms (single member) always answer; bounded agent-to-agent follow-up chains.
- Human/CEO drop-in: post into a live room mid-conversation to steer it.
- Board team-log channels: autonomy milestones (`▶ ✓ ✗ ✅ ⛔`) stream into a channel.
- Board live swarm strip: show active runner/board workers, with terminal
  click-through for mounted registry agents and task context for direct workers.
- One-panel channel switcher: CEO, board team-logs, team channels, DMs.
- Shared context injection (referenced artifacts/files) when posting to a room.
- gbrain shared-memory capture/recall per turn (degrades gracefully when absent).

## Relationships
- Teams (membership, room conventions, roster selection)
- Meetings (one-shot meeting engine shares the same room substrate)
- Agent Registry (member providers/models/personas)
- Kanban Cockpit (each board maps to a team-log channel)
- Autonomy Runner (posts work milestones into board channels)
- Orchestration Routing (who belongs in a board's live swarm)
- Hermes CEO Relay (CEO is an agent that can drop into rooms)

## Domain Team / Core Agents
- domain-architect
- agenda-agent
- architect
- pm
- docs-steward

## Artifact Contract
- Definition: `definition.md`
- Index: `index.md`
- Operational rules: `AGENTS.md`
- Testing criteria: `testing-criteria.md`
- Feature specs: `docs/features/`
- Design docs: `docs/design/`
- Handoffs: `handoffs/`
- Agendas and meeting outputs: `agendas/`

## Source Code Map (where the implementation lives)
| Concern | File |
|---|---|
| Channel bridge (naming, post/read, loop lifecycle) | `main/core/meetings.js` |
| Live A2A room daemon | `runtime/harness/agents/room_loop.py` |
| Room loop CLI entrypoint | `runtime/harness/bin/agent` (`room` subcommand) |
| Conversational turns / session continuity | `runtime/harness/agents/agent_adapter.py` |
| Shared memory | `runtime/harness/agents/gbrain_memory.py` |
| Team-log milestone hook | `main/core/autonomy-runner.js` (`defaultPostWork`/`logWork`) |
| IPC handlers | `main/index.js`, `main/preload.js` |
| Channel switcher + surface | `renderer/app.js` (`renderChannelsView`, `openChannel`, …) |
| Backend lifecycle tests | `test/core.test.js` |
| Team-log work-event tests | `test/autonomy-runner.test.js` |
