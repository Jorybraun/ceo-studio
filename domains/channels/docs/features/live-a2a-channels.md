# Feature Spec: Live A2A Channels

## Purpose
Turn every channel into a living conversation. Selecting the CEO, a team, a
board, or a single agent in the switcher swaps the one right-hand panel to that
conversation. Messages posted there are answered by real agents — addressed
ones directly, the whole team via relevance gating — and agents can take a
bounded round of follow-up with each other. Board channels additionally stream
work milestones from the autonomy runner so a channel literally *is* the team's
shared work log.

This replaces the earlier "UI shell" channels (see the historical log in
`../../teams/channels-testing-log.md`) where clicking did nothing and agents
only sent heartbeats.

## Architecture (how the pieces fit)
```
renderer/app.js  ──IPC──>  main/index.js  ──>  main/core/meetings.js
   channel switcher            meetings:*           startRoomLoop ─ spawn ─┐
   channel surface                                  post / room            │
                                                                           v
                                       runtime/harness/bin/agent room  (room_loop.py)
                                          watches chat.log for HUMAN lines
                                          routes -> agent_adapter.converse()
                                          posts replies back into chat.log
                                                  ^
autonomy-runner.js  ── meetings.post(boardRoom(b)) ──┘  (work milestones)
```

- **Durable bus**: `runtime/harness/brain/rooms/<room>/chat.log`, lines formatted
  `[<iso>] <speaker>: <body>`. This is the single source of truth a channel reads.
- **Room naming**: UI rooms are `chan-<key>` (lowercased/sanitized); board
  team-logs are `meetings.boardRoom(slug)` = `chan-board-<slug>`.
- **Live loop**: a non-detached child per room, tracked in `meetings.js`
  `roomLoops`, killed on close and on app quit (`stopAllRoomLoops`).

## Implemented v1
- Persistent room loop (`room_loop.py`) watching `chat.log` from a start cursor
  (no re-answering backlog on restart).
- `@mention` routing to specific members; whole-team messages offered to all
  members who reply only if relevant, else `PASS` (dropped silently).
- Single-member (DM) rooms always treat messages as addressed.
- Bounded agent-to-agent follow-up via `@teammate` mentions in a reply
  (`--max-followups`, default 1 from the UI).
- Only HUMAN speakers (`you`/`ceo`/`human`) trigger routing; agent/Facilitator
  lines never re-trigger.
- gbrain shared memory: per-turn capture + recall, gracefully off when the CLI
  is unavailable.
- Idle-exit option; otherwise runs until killed.
- Channel switcher with four groups: Project CEO (default), Team logs (one per
  board), Group channels (teams), Direct messages (agents).
- Board channels resolve members from the live swarm (`ceoSwarm`), falling back
  to the registry when idle.
- Human/CEO drop-in posting with shared-context injection (`withChannelContext`).
- Add-agent-to-channel flow that restarts the loop to include the new member and
  posts the notice as a non-human speaker.
- Work-event milestones render as compact, color-coded log lines, distinct from
  chat bubbles (`isWorkEvent`).
- Autonomy runner posts `▶ started`, `✓ finished`, `✗ error`, `✅ Done`,
  `⛔ blocked` into the board's team-log channel (best-effort, never a gate).

## Domain Contract
- A live channel uses real providers only (`allowPaid: true`); the free `echo`
  provider is for backend lifecycle tests, never live conversation.
- The room-loop's ephemeral turns are exempt from the `tmux-concurrency`
  guardrail (`CEO_GUARDRAIL_DISABLE_TMUX=1`).
- Starting a loop is idempotent per room; closing or quitting stops it.
- Team-log posts are side-effect-only: a failure must never break a cycle.

## Product Requirements
- The user can address one agent (`@id` or DM) or a whole team in one panel.
- Irrelevant agents stay quiet (no PASS noise in the transcript).
- The CEO can drop into any live room mid-conversation to steer it.
- Boards show live milestones as agents build, without manual refresh.
- Switching channels swaps the conversation in the single right panel.

## Verification
See `../../testing-criteria.md` for the full end-to-end criteria. Minimum
smoke set:
- `npm run check` and `npm test` pass (covers backend loop lifecycle + team-log events).
- Open a team channel, post a whole-team message, confirm only relevant members reply.
- DM a single agent, confirm it always answers.
- Run an autonomy cycle on a board, confirm `▶`/`✓`/`✅` lines appear in that board's channel.
- Close the channel / quit the app, confirm the room loop is stopped.
