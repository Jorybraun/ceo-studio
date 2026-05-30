# Proposed Structure for Standalone Harness Content Repo

This document outlines what the harness would look like as its own repository (the "content repo" model).

## Root Structure (Proposed)

harness/
├── bin/                    # All the agent/domain-room/launch tools
├── docker/                 # Dockerfile + compose for running the harness
├── skills/                 # Curated skill library (general + meta)
│   ├── core/
│   ├── meta/
│   ├── pipe-os-management/   # (this would become more generic over time)
│   └── ...
├── agents/                 # Personas and workflows
├── architecture/           # General patterns and decision records
├── integrations/           # Hermes, GBrain, Overstory, etc.
├── chat/                   # Chat interface scaffolding
├── context/                # Templates + examples of domain teams
│   └── templates/
│       └── discovery-team/   # or similar
├── brain/                  # Infrastructure for rooms, logs, etc. (not data)
├── docs/                   # (renamed or consolidated from root .md files)
├── REPO_README.md
├── AGENTS.md               # (the operating guide)
├── DESIGN.md
└── ...

## Key Changes from Current State

1. Remove all PIPE-OS specific content from the core repo.
   - Move `planning/PIPE-OS/`, `context/discovery-team/` etc. into the project or into a "managed projects" area.

2. Make `context/` more template-oriented.
   - Projects clone or copy domain templates from the harness when they activate a domain.

3. Brain data strategy
   - The harness can manage multiple project brains.
   - Or each project has its own brain mount.

4. Tooling updates
   - `attach-to-project` becomes the main onboarding command.
   - `domain-room` and similar tools need to be project-aware.

## Migration Path (High Level)

Phase 1: Decide this is the direction and freeze major new development inside the current harness/ until the repo is split.

Phase 2: Create a new Git repo (could start as a fresh clone or by filtering the existing history).

Phase 3: Clean the new repo of project-specific data.

Phase 4: Set up the first project (PIPE-OS) to reference the new harness repo.

Phase 5: Update all documentation and scripts to assume an external harness.

## Open Decisions

- Should the harness repo contain example projects, or are examples kept very small?
- How much of the current Discovery work moves into the harness repo vs stays with PIPE-OS?
- Do we want the harness to be versioned independently (with releases/tags)?

