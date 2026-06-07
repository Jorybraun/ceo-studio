# Channels — Testing Criteria

**Domain**: Channels
**Status**: living document
**Updated**: 2026-06-02
**Scope**: The entire channel system, end-to-end — the live A2A room loop, the
channel bridge, the board team-log integration, the IPC surface, and the
channel UI.

This is the acceptance contract for the channel system. Each criterion is
phrased as observable behavior with a clear pass condition, so a human or an
agent can verify the system without re-deriving intent. Criteria are grouped by
behavior, then by layer. Use the status legend and keep this file updated in the
same change as any code change (per `AGENTS.md`).

**Status legend**: ✅ PASS · ❌ FAIL · ⚠️ PARTIAL · ⬜ NOT YET RUN

---

## 0. How to verify

### Automated (run first, zero cost)
| Command | Covers | Where |
|---|---|---|
| `npm run check` | syntax + docs handoff gate | repo root |
| `npm test` | backend room-loop lifecycle validation; team-log work-events | `test/core.test.js`, `test/autonomy-runner.test.js` |
| `cd runtime/harness && python -m pytest tests/` | harness adapter/meeting unit tests | `runtime/harness/tests/` |

Automated tests must NOT spend provider credits or spawn tmux agents. The
backend lifecycle tests assert validation/idempotency only; the autonomy tests
use injected fakes (`postWork`) to assert the correct *real* calls are made.

### Manual / live (real providers, costs spend)
Live conversation requires real agent providers (never `echo`). The UI sets
`allowPaid: true` automatically when opening a channel. Watch the durable bus
directly while testing:
```
tail -f runtime/harness/brain/rooms/<room>/chat.log
```
Room names: UI channels are `chan-<key>`; board team-logs are
`chan-board-<slug>` (see `meetings.boardRoom`).

---

## 1. Channel switcher & navigation (UI)

- **C1.1** ⬜ The Channels view lists four groups: **Project CEO** (default),
  **Team logs (boards)** (one entry per Kanban board), **Group channels** (one
  per registry team), **Direct messages** (one per registry agent).
- **C1.2** ⬜ Empty states render instead of breaking: "No boards yet.",
  "No team channels yet." when the respective sources are empty.
- **C1.3** ⬜ The currently open channel is visually highlighted (active key).
- **C1.4** ⬜ Clicking **Project CEO** returns the right panel to the default CEO
  conversation and stops/hides both overlay surfaces (`switchToCeoChannel`).
- **C1.5** ⬜ Clicking a team / board / DM entry opens that channel in the single
  right panel (`openChannel`); the agent surface is hidden, the channel surface
  is shown. This must clear any inline `display:flex` state left by the agent
  surface, not only add the `hidden` class.
- **C1.6** ⬜ Only one channel surface is active at a time; switching channels
  swaps the conversation, stops the previous room loop, and does not stack
  panels.
- **C1.7** ⬜ Pressing **Escape** with a channel open closes the channel surface.

## 2. Channel membership resolution

- **C2.1** ⬜ A **team** channel's members are the registry team's members.
- **C2.2** ⬜ A **DM** channel has exactly one member (the agent).
- **C2.3** ⬜ A **board** channel resolves members from the live swarm
  (`ceoSwarm`); when the board is idle it falls back to registry agents
  (`boardChannelMembers`).
- **C2.4** ⬜ Opening a channel with zero resolvable members shows a system
  message ("No agents are assigned to this channel yet.") and does not start a
  loop.
- **C2.5** ⬜ Member chips render provider/name correctly; the CEO chip appears
  only when CEO-in-room is toggled on.

## 3. Live room loop lifecycle (bridge: `meetings.js`)

- **C3.1** ✅ `startRoomLoop` rejects when neither members nor a team are given
  (`/members or a team/`). *(covered: `test/core.test.js`)*
- **C3.2** ✅ `startRoomLoop` rejects when no room name is given.
  *(covered: `test/core.test.js`)*
- **C3.3** ✅ `roomLoopStatus` reports `running: false` for a room that was never
  opened. *(covered: `test/core.test.js`)*
- **C3.4** ✅ `stopRoomLoop` on an un-opened room is a no-op (`stopped: false`).
  *(covered: `test/core.test.js`)*
- **C3.5** ⬜ `startRoomLoop` is idempotent per room: starting an
  already-running loop returns `{ ok: true, already: true }` and does not spawn a
  second child.
- **C3.6** ⬜ A started loop is tracked in `roomLoops` and removed from the map on
  child exit.
- **C3.7** ⬜ `stopRoomLoop` kills the child (SIGTERM) and clears the map entry.
- **C3.8** ⬜ `stopAllRoomLoops` terminates every tracked loop (invoked on app
  quit via `before-quit` in `main/index.js`).
- **C3.9** ⬜ Opening a channel in the UI starts the loop; closing the channel
  surface (`closeChannelSurface`) stops it.
- **C3.10** ⬜ Room-loop children are NOT detached, so they die with the app even
  if `stopAllRoomLoops` is missed.

## 4. Message routing (daemon: `room_loop.py`)

- **R4.1** ⬜ Only HUMAN-authored lines (`you`/`ceo`/`human`, case-insensitive)
  trigger routing. Agent, `Facilitator`, `Orchestrator`, and system lines never
  re-trigger the watcher (the room cannot feed itself).
- **R4.2** ⬜ On startup the loop sets its cursor to the current end of the log,
  so restarting it does NOT re-answer the existing backlog.
- **R4.3** ⬜ A `@<agent>` mention routes the message to that member directly,
  who answers as "addressed" (no PASS gating).
- **R4.4** ⬜ Multiple `@mentions` in one message route to each mentioned member
  once (deduped, order preserved).
- **R4.5** ⬜ A whole-team message (no mention, >1 member) is offered to every
  member; each replies only if it concerns their role, else returns exactly
  `PASS`.
- **R4.6** ⬜ `PASS` replies are dropped — they never appear in the transcript
  (no PASS noise).
- **R4.7** ⬜ A single-member (DM) room always treats a message as addressed and
  always answers.
- **R4.8** ⬜ Empty-body human lines are ignored.
- **R4.9** ⬜ A mention of an unknown id (not a member) is ignored without error.
- **R4.10** ⬜ One failing agent turn is caught and logged (`[room-loop] WARN`)
  and does not kill the room.
- **R4.11** ⬜ On startup a `Facilitator` "Live room is ON (…)" notice is posted;
  on shutdown a "Live room is OFF." notice is posted.

## 5. Agent-to-agent follow-up (daemon)

- **A5.1** ⬜ When an agent's reply contains `@<teammate>`, that teammate is
  offered a follow-up turn (`_chain`).
- **A5.2** ⬜ Follow-up depth is bounded by `max_followups` (UI passes 1); chains
  cannot run away.
- **A5.3** ⬜ A member never follows up to itself (`mid == from_id` is skipped).
- **A5.4** ⬜ A teammate that has nothing to add returns `PASS` and the chain
  stops there.

## 6. Human / CEO drop-in & posting (bridge + UI)

- **H6.1** ⬜ `meetings.post` creates the room dir + `chat.log` (with a header) on
  first write and appends `[<iso>] <speaker>: <body>`.
- **H6.2** ⬜ `meetings.post` rejects an empty body and a missing room.
- **H6.3** ⬜ Posting a brief via "Discuss brief →" injects it into the live room
  and triggers agent replies (it does NOT start a one-shot meeting).
- **H6.4** ⬜ Posting as **You** vs **CEO** is selectable; CEO is only offered
  when CEO-in-room is toggled on.
- **H6.5** ⬜ Addressing a specific member via the "→" selector prefixes `@id` so
  routing targets that member.
- **H6.6** ⬜ Posted messages carry shared context (referenced artifacts/files)
  appended under `----- context -----` via `withChannelContext`, only when
  context exists.
- **H6.7** ⬜ A failed post restores the input text and shows a system error;
  state label reflects the failure.

## 7. Transcript rendering (UI)

- **T7.1** ⬜ `meetings.room` parses `chat.log` into `{ts, speaker, body}` entries,
  anchoring on the ISO timestamp header (bracketed text inside a body — e.g.
  `[echo:ba] …` — does not split an entry).
- **T7.2** ⬜ The leading `# <room> Team Room` header is not rendered as a message.
- **T7.3** ⬜ Normal agent/human lines render as chat bubbles.
- **T7.4** ⬜ Work-event milestones (lines starting `▶ ✓ ✗ ✅ ⛔`, `isWorkEvent`)
  render as compact mono LOG lines, NOT chat bubbles.
- **T7.5** ⬜ Work-event color tone matches severity: `✗`/`⛔` red, `✅`/`✓`
  green, `▶` amber.
- **T7.6** ⬜ The feed auto-scrolls to the latest entry; the state label shows
  `· live A2A` when the loop is live, `· idle` when started but not live.
- **T7.7** ⬜ Read/parse failures show a system message and a `· room error`
  state rather than crashing the poll loop.

## 8. Board team-log integration (autonomy runner)

- **B8.1** ✅ Spawning a worker posts a `▶ started` work-event to the board's
  team-log (`speaker = agentId`). *(covered: `test/autonomy-runner.test.js`)*
- **B8.2** ✅ Finishing a worker posts `✓ finished`; an errored worker posts `✗`.
  *(reap phase; `✓` covered, `✗` path asserted via finished/error branch)*
- **B8.3** ✅ A passing review/test gate posts `✅ … Done`.
  *(covered: `test/autonomy-runner.test.js`)*
- **B8.4** ✅ A failing review/test gate posts `⛔ … blocked`.
  *(covered: `test/autonomy-runner.test.js`)*
- **B8.5** ⬜ Work-events target `meetings.boardRoom(board)` so the milestone
  lands in exactly the channel the UI opens for that board.
- **B8.6** ⬜ `postWork` is best-effort: when it throws, the autonomy cycle still
  completes (the team log is never a gate). *(`logWork` swallows errors)*
- **B8.7** ⬜ Dry-run cycles produce no spawns/status changes and therefore no
  premature milestones.

## 9. IPC surface (`main/index.js` + `preload.js`)

- **I9.1** ⬜ `meetings:room_loop_start` → `meetings.startRoomLoop` with the active
  project path injected.
- **I9.2** ⬜ `meetings:room_loop_stop` → `meetings.stopRoomLoop`.
- **I9.3** ⬜ `meetings:room_loop_status` → `meetings.roomLoopStatus`.
- **I9.4** ⬜ `meetings:post` and `meetings:room` round-trip the room name/speaker/
  body correctly.
- **I9.5** ⬜ `preload.js` exposes `roomLoopStart/Stop/Status`, `meetingPost`,
  `meetingRoom` on `window.ceo` (renderer calls match these names).
- **I9.6** ⬜ App quit (`before-quit`) calls `stopAllRoomLoops` without throwing.

## 10. Cost, safety & guardrails

- **G10.1** ⬜ Live channel loops use real providers only; the UI never starts a
  loop with the `echo` placeholder.
- **G10.2** ⬜ Room-loop ephemeral turns are exempt from the `tmux-concurrency`
  guardrail (`CEO_GUARDRAIL_DISABLE_TMUX=1`) and run even when other tmux
  sessions exist; they create no tmux session.
- **G10.3** ⬜ No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is required or introduced
  for channels (per root `AGENTS.md`).
- **G10.4** ⬜ `meetings.start` (one-shot) still requires `allowPaid` to use a
  paid provider; default `echo` stays zero-cost.

## 11. End-to-end golden paths (manual, live)

- **E11.1 — Team relevance gating** ⬜
  Open a team channel with ≥3 members. Post a whole-team message relevant to one
  role only. *Pass*: that member replies; the others stay silent (no PASS lines
  in `chat.log`).
- **E11.2 — Direct address** ⬜
  In the same channel, post `@<id> <question>`. *Pass*: only `<id>` replies.
- **E11.3 — A2A follow-up** ⬜
  Post a message that makes one agent `@mention` a teammate. *Pass*: the teammate
  takes exactly one follow-up turn (bounded), then the chain stops.
- **E11.4 — DM always answers** ⬜
  Open a DM channel and post any message. *Pass*: the single agent always replies.
- **E11.5 — CEO drop-in** ⬜
  Toggle CEO-in-room, post as CEO to steer. *Pass*: the message is attributed to
  CEO and routes like a human line.
- **E11.6 — Add agent mid-conversation** ⬜
  Add an agent via "add to channel". *Pass*: a non-human `Facilitator` notice is
  posted (no routing round triggered), the loop restarts, and the new member is
  addressable.
- **E11.7 — Board team log streams milestones** ⬜
  Open a board channel, run an autonomy cycle on that board. *Pass*: `▶ started`,
  then `✓ finished`/`✅ Done` (or `✗`/`⛔` on failure) appear as LOG lines, live,
  without manual refresh.
- **E11.8 — Switch without leak** ⬜
  Open channel A, switch to channel B, then quit. *Pass*: A's loop is stopped on
  switch/close and no orphan `bin/agent room` processes remain after quit
  (`pgrep -f "agent room"` is empty).
- **E11.9 — Restart no-replay** ⬜
  Stop and restart a loop on a room with existing history. *Pass*: the loop does
  not re-answer old messages (cursor starts at the current end).
- **E11.10 — Memory degradation** ⬜
  Run with gbrain unavailable. *Pass*: the room runs unchanged with no memory and
  no errors; the ON notice omits the memory line.

---

## Coverage summary

| Area | Automated | Manual/live | Notes |
|---|---|---|---|
| Loop lifecycle validation (§3.1–3.4) | ✅ `core.test.js` | — | idempotency/cleanup (§3.5–3.10) need a live or mocked-spawn test |
| Team-log work-events (§8.1–8.4) | ✅ `autonomy-runner.test.js` | — | board-room targeting (§8.5) is asserted indirectly |
| Routing & gating (§4) | ⬜ | ⬜ E11.1–E11.4 | no daemon-level unit test yet; candidate for `runtime/harness/tests/test_room_loop.py` |
| A2A follow-up (§5) | ⬜ | ⬜ E11.3 | candidate for daemon unit test with a fake adapter |
| UI switcher/surface (§1,2,6,7) | ⬜ | ⬜ | renderer has no headless test harness yet |
| IPC surface (§9) | ⬜ | ⬜ | could assert handler registration in `main.boot.test.js` |

### Known gaps / candidate follow-up tests
1. A daemon unit test (`runtime/harness/tests/test_room_loop.py`) driving
   `_handle_message`/`_chain` with a fake `agent_adapter` to lock §4–§5 without
   spending credits.
2. A bridge test asserting `startRoomLoop` idempotency and `stopAllRoomLoops`
   cleanup using a stub `spawn`.
3. A `_parseLog` unit test for §7.1 (timestamp-anchored parsing, bracket-in-body).
4. An IPC registration assertion in `test/main.boot.test.js` for §9.

These are intentionally listed rather than silently mocked. Per root `AGENTS.md`:
do not mock a feature to fake a pass — implement the real check or mark the
criterion ⬜ until it is genuinely covered.
