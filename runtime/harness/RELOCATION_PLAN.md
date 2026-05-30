# Harness Relocation Plan

**Status**: Proposed  
**Date**: 2026-05-28

## Goal
Move the CEO Harness from inside `PIPE-OS/harness/` to an external location so it can be a reusable, portable tool across multiple projects (as documented in `PORTABILITY.md` and `MULTI-PROJECT.md`).

## Current Location
`/Users/hans/Code/PIPE/PIPE-OS/harness/`

## Recommended Target Location
`/Users/hans/Code/PIPE/harness/`   (or `~/harness/`)

This keeps it at the same level as individual projects rather than inside one of them.

## Why Now
- The harness was always intended to be temporary scaffolding inside PIPE-OS.
- We are actively building domain-specific tools (domain-room, brain/rooms, context/*-team).
- Continuing to grow it inside PIPE-OS increases future migration pain and contradicts the stated architecture.

## Risks & Challenges
- Many documentation files still contain relative paths assuming `harness/` lives inside the project.
- The new `domain-room` script and `brain/rooms/discovery/` were just created.
- `context/discovery-team/` and several docs reference the harness location.
- Docker and attach scripts have some project-specific assumptions.

## Proposed Approach (Phased)

### Phase 0: Audit (Do this first)
- Full grep for hardcoded paths referencing PIPE-OS or relative harness locations.
- Inventory of all scripts that compute their own root (`domain-room`, `agent-launch`, etc.).
- Identify data that should stay per-project vs data that belongs to the harness.

### Phase 1: Preparation
- Update all scripts to robustly detect harness root (most already try).
- Create this relocation plan.
- Update key docs (`AGENTS.md`, `PORTABILITY.md`, `README.md`) to reflect the move.
- Decide final target directory.

### Phase 2: Move
- Actually move the directory.
- Create a symlink in the old location during transition if needed (`PIPE-OS/harness` → `../harness`).
- Update all internal references.

### Phase 3: Cleanup
- Remove symlink once everything is stable.
- Update all documentation examples.
- Test domain-room, agent tools, and Discovery setup against the new location.
- Update any Docker volume mounts or .env files.

## Current State of Key Scripts (as of 2026-05-28)

- `bin/domain-room`: Uses `$(cd "$(dirname "$0")/.." && pwd)` + optional `HARNESS_ROOT` env var. Relatively portable.
- `bin/attach-to-project`: Already writes data to `~/.ceo-harness/`. Good.
- `bin/agent-launch` / `agent-dashboard`: Use `~/.agent-sessions` registry + tmux. Mostly location-independent.
- Many docs still have examples like `./harness/bin/...` or assume the harness is inside the project.

## Decision Needed
1. Final target location (`~/harness`, `/Users/hans/Code/PIPE/harness`, or elsewhere)?
2. Do we want a transition symlink in `PIPE-OS/harness`?
3. When do we execute the actual move (after current Discovery work stabilizes, or soon)?

## Next Immediate Actions
- Complete path audit.
- Update this document with findings.
- Get explicit approval on target location and timing.

## Audit Findings (2026-05-28)

**Absolute path problems**: Minimal. Only a few examples and the plan document itself.

**Relative path problems**: Many documentation references of the form:
- `harness/bin/...`
- `harness/skills/...`
- `harness/brain/...`
- `harness/context/...`

These appear in:
- AGENTS.md
- skills/pipe-os-management/SKILL.md
- brain/rooms/README.md
- context/discovery-team/docs/TEAM_ROOM.md
- Various architecture docs

**Script robustness**:
- `domain-room` is one of the better ones (computes root dynamically + supports HARNESS_ROOT override).
- Most bin/ scripts are relatively self-contained.

**Data that should move vs stay**:
- The `brain/rooms/discovery/` content is domain-specific and should probably travel with the harness instance for now.
- Per-project Kanban and Hermes state lives in Hermes itself, not here.

**Recommendation from audit**: The move is very doable. The main work is documentation cleanup after the physical move + deciding on a transition symlink strategy.

## Updated Direction (2026-05-28) - Separate Content Repo

User feedback: The harness should live in its own **content repository**, not just as a sibling folder. Goal is to completely avoid cluttering the actual project repo (PIPE-OS).

This is a stronger separation than "move the folder up one level."

### Implications
- The harness becomes its own Git repository (can have its own remote, history, versioning).
- PIPE-OS (and any future projects) will reference the harness rather than contain it.
- Typical patterns:
  - Clone `harness` repo to `~/harness` or a dedicated location.
  - Projects contain only thin references or instructions (e.g. "clone the harness repo and point it at this project").
  - Or use git submodules / sparse checkouts if tight integration is desired.
- The harness repo would contain the core tooling + general skills + the ability to host project-specific context (like `context/discovery-team/`).

### What Should Live in the Harness Repo (Proposed)
- All of `bin/`
- `docker/`
- `skills/` (general + meta)
- `agents/`
- `architecture/` (general patterns)
- `brain/` infrastructure (but per-project data might live elsewhere or be mounted)
- `chat/`
- Core docs (AGENTS.md, DESIGN.md, PORTABILITY.md, etc.)
- `integrations/`

### What Should Probably Stay With or Be Generated Per Project
- `context/<specific-domain>-team/` for domains that belong to a project (or these could be symlinked/copied from the harness instance when a project is attached)
- Project-specific planning docs under `planning/PIPE-OS/`
- Any sensitive or large project-specific artifacts

### Open Questions for Separate Repo Model
1. Should `context/` folders for active domains live inside the harness repo or be managed per-project?
2. How do we handle the current `brain/rooms/discovery/` data we just created?
3. Do we want the harness repo to be public eventually, or private for now?
4. Git workflow: Will we use submodules, or just manual "clone the harness separately" instructions?
5. What happens to the work we've done in the last few days (domain-room, Discovery brief, etc.) during the extraction?

