# Channels Domain Index

This domain owns live agent-to-agent communication in CEO Studio: persistent
A2A rooms, the human/CEO drop-in surface, board team-log channels, and the
one-panel channel switcher.

See `definition.md` for scope and the source-code map.

Active artifacts:
- `definition.md` — scope, boundaries, capabilities, source map
- `AGENTS.md` — operational rules for changing channel behavior
- `testing-criteria.md` — end-to-end acceptance criteria for the whole channel system
- `docs/features/live-a2a-channels.md` — feature spec for the live channel system

Related domains:
- Teams (`../teams/`) — owns membership/registry; holds the *historical*
  channel test logs from when the feature was a non-functional shell.
- Meetings (`../meetings/`) — owns the one-shot meeting engine that shares the
  same room substrate.
