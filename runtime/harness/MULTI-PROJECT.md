# Using the CEO Harness with Multiple Projects

This document explains how to run the Project CEO Harness against **two (or more) different projects at the same time** — for example:

- Your existing project (PIPE-OS)
- A brand new project you're starting from scratch

## Core Principle

The CEO Harness is designed to be **external** to the projects it manages. It is not "inside" any one codebase.

Each project you want to manage should have:
- Its own **isolated state** (conversations, brain data, Kanban, domain structures)
- Its own configuration
- Its own connection to delegated tools (Hermes, GBrain, Overstory, etc.)

You can run multiple independent instances of the harness.

## Recommended Approaches

### Option 1: Multiple Docker Compose Instances (Recommended for 24/7)

This is the cleanest way when you want things running persistently.

**Structure:**

```
~/harness/                    # The CEO Harness code lives here (once, external)
├── docker-compose.yml
├── .env.pipe                 # Config for your existing project
├── .env.new-project          # Config for the new project you're starting
└── ...

~/projects/
├── PIPE-OS/                  # Your existing project
└── new-idea/                 # Brand new project
```

**How to run both at once:**

```bash
# Terminal 1 or systemd service - PIPE project
cd ~/harness
docker compose --env-file .env.pipe up -d --build

# Terminal 2 or another service - New project
docker compose --env-file .env.new-project up -d --build
```

Or use profiles for one compose file:

```bash
docker compose --profile pipe up -d
docker compose --profile new up -d
```

### Option 2: One Harness Binary + Multiple "Managed Projects"

If you're not using Docker yet, you can point the harness at different targets by running it with different environment variables or config files.

## Recommended Directory Layout (Cleanest)

Move (or clone) the harness code to a completely separate location from any project you manage:

```bash
# Recommended long-term location
~/tools/project-ceo-harness/     # The harness lives here forever
```

Then each project you manage only needs a small config file or env file pointing back to the harness.

## Example Configuration Files

### `.env.pipe` (for your existing project)

```env
PROJECT_NAME=pipe
TARGET_PROJECT=/Users/hans/Code/PIPE/PIPE-OS
BRAIN_DATA_PATH=/Users/hans/.ceo-harness/pipe/brain
CONVERSATIONS_PATH=/Users/hans/.ceo-harness/pipe/conversations
KANBAN_PATH=/Users/hans/.ceo-harness/pipe/kanban
HERMES_URL=http://localhost:8081          # Optional: dedicated Hermes instance
BRAIN_URL=http://localhost:8001
```

### `.env.new-project` (for a brand new project)

```env
PROJECT_NAME=my-new-idea
TARGET_PROJECT=/Users/hans/Code/my-new-idea
BRAIN_DATA_PATH=/Users/hans/.ceo-harness/my-new-idea/brain
CONVERSATIONS_PATH=/Users/hans/.ceo-harness/my-new-idea/conversations
KANBAN_PATH=/Users/hans/.ceo-harness/my-new-idea/kanban
HERMES_URL=http://localhost:8082
BRAIN_URL=http://localhost:8002
```

This way each project has completely isolated memory, history, and state.

## Using Docker Profiles (One Compose File)

You can also structure `docker-compose.yml` with profiles:

```yaml
services:
  ceo-pipe:
    profiles: ["pipe"]
    # ... config for PIPE project

  ceo-new:
    profiles: ["new"]
    # ... config for new project
```

Then start them independently:

```bash
docker compose --profile pipe up -d
docker compose --profile new up -d
```

## Starting a Brand New Project

When you want to use the harness on a brand new idea:

1. Create the project directory.
2. Create a dedicated `.env` file for it.
3. Run the harness against it (via Docker or directly).
4. Use chat with the CEO Orchestrator to begin the initial breakdown:
   > "@ceo Help me start this new project. What domains should we create first?"

The harness will scaffold domains inside that project's context (or inside the harness state, depending on your preference).

## Sharing vs Isolation

- **Brain / Memory**: Should almost always be per-project (different contexts).
- **Chat history**: Per-project.
- **Kanban & Domains**: Per-project.
- **The actual harness code**: Shared (one copy).
- **Delegated tools** (Hermes, GBrain, Overstory): Can be shared or per-project depending on load.

## Current State of This Repo

Right now the `harness/` folder lives inside the PIPE-OS repository. For true multi-project use, you will eventually want to move (or symlink) this harness code to a neutral location outside any specific project.

## Next Steps (What We Can Build)

- A `bin/attach-to-project.sh` helper script
- Better support in `docker-compose.yml` for multiple projects via profiles
- A simple way to list all projects the harness is currently managing
- Per-project 24/7 service management (systemd templates or Docker Swarm / Kubernetes later)

Would you like me to start implementing any of the above right now?
