# Channels Domain Rules

**Purpose**: Own live agent-to-agent communication — persistent A2A rooms, the
human/CEO drop-in surface, board team-log channels, and the one-panel channel
switcher — so a "channel" is a real, durable, living conversation rather than a
UI shell.

**Overarching Goal**: One place to address the CEO, a team, or a single agent;
agents reply when it concerns them and coordinate with each other; every board
doubles as a streaming team log.

## Boundaries
- Owns the live room loop, relevance gating, and bounded A2A follow-up.
- Owns the channel bridge in `main/core/meetings.js` and the channel UI in `renderer/app.js`.
- Owns the board team-log convention (`meetings.boardRoom`) and how milestones render.
- Does not own team membership (Teams), the one-shot meeting flow (Meetings),
  the autonomy runner's decision logic, or provider credentials.

## Interaction Rules
- Any change to channel/room behavior must update this domain first
  (`definition.md`, `testing-criteria.md`, and the relevant `docs/features/` spec).
- The room loop's ephemeral provider turns must stay exempt from the
  `tmux-concurrency` guardrail (`CEO_GUARDRAIL_DISABLE_TMUX=1`): they create no
  tmux sessions and conversation memory lives in the provider session store.
- Live channels must use real providers only — never the free `echo` placeholder
  (the UI sets `allowPaid: true` when starting a channel loop). `echo` is for
  zero-cost backend lifecycle tests, not live conversation.
- Only HUMAN-authored lines (`You`/`CEO`/`Human`) trigger routing. System and
  agent lines (e.g. `Facilitator`) must never re-trigger the watcher, or the room
  feeds itself. System notices must post as a non-human speaker.
- The team log is a convenience surface, never a gate: a failed `postWork` must
  never break an autonomy cycle.
- Run `npm run check` and `npm test` after any change; update `testing-criteria.md`
  in the same change (per root `AGENTS.md` docs handoff).

## Source Code Map
See the "Source Code Map" table in `definition.md`.
