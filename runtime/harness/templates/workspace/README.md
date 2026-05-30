# `.harem/` — project workspace

This folder is the harness **workspace** for this project. It holds all
project-specific state the agents produce or consume:

- `harem.json` — identity + config + the marker that makes this a managed project
- `kanban/` — the board(s)
- `mgmt/stage-map.md` — which team/workflow/personas own each Kanban stage
- `context/` — per-domain context (`<domain>-team/`)
- `brain/rooms/` — agent ↔ agent ↔ human conversation logs
- `sessions/` — orchestrator state + cost/spawn ledger

The harness **engine** (the code that runs agents) lives elsewhere (installed
with CEO Studio). This folder is just data and travels with the project.

Created by `harness/bin/harem-init`. Safe to commit (or git-ignore if you prefer
to keep runtime logs out of history).
