# Portability & External Nature

This harness is intentionally designed to live **outside** any project it manages.

## Core Principle

The harness is a general tool for high-agency, CEO-level project strategy and planning. It is not "the PIPE harness." It should be possible to:

- Package it as a container
- Point it at different codebases or initiatives
- Version it independently of the projects it serves
- Reuse it on future projects without major rework

## Current State (Early)

Right now it lives inside the PIPE-OS repository at `harness/`. This is temporary scaffolding only.

## Target State

- The harness becomes its own repository (or published package + container).
- A project "connects" to the harness rather than containing it.
- Configuration clearly separates harness identity from target project identity.
- The harness can maintain its own persistent brain/memory across multiple projects if desired (or per-project brains).

## Implications for Design

- Avoid hard-coded paths or assumptions about being inside the target repo.
- All references to "the project" should go through configuration or explicit mounting.
- Domain teams and the CEO Orchestrator should be able to reason about "the project at /target" without assuming the harness code lives there.

This is a first-class requirement, not a nice-to-have.
