# Project CEO Harness — Design

**Goal**: A reusable, high-agency, agnostic **meta-orchestration system** that thinks about software projects at the CEO level and delegates actual execution work to existing specialized agent harnesses.

## Fundamental Philosophy (May 2026)

The Project CEO Harness is a **strategic meta-orchestration layer**. It does two things:

1. **Directly manages lightweight subagents** (especially cheap, high-volume models like Kimi) for research, exploration, and proposal generation. These run as subagents under the CEO Orchestrator's control.
2. **Delegates** larger, more complex blocks of work (deep planning, implementation, etc.) to existing mature harnesses (Hermes, Overstory, etc.) instead of reinventing them.

The goal is to combine cheap massive parallelism for thinking with high-quality execution for doing — all under one strategic brain that the human can steer through chat and review via Kanban.

### Key External Tools We Intend to Compose

- **Hermes** (especially Kanban + swarms) → Primary home for planning, research, requirements, and design agents.
- **Overstory** (or similar) → Coding, implementation, and code-level agent swarms.
- **GBrain** (or equivalent) → Persistent memory, synthesis, gap analysis, and long-term context that doesn't rot.

This harness owns the "why" and "in what order" — not the "how do we make agents collaborate on a spec".

## Core Requirements

- **Human as the primary decision maker**: The human (the real CEO/boss) makes most final decisions. The system prepares excellent proposals, does research, manages execution, and handles low-stakes decisions over time — but does not take over strategic or important decision rights by default.
- **Kanban review loop** as the main way the human interacts with completed work and exercises decision authority.
- **High agency** for the delegated systems and subagents, with selective human involvement via chat when the human wants to steer.
- **CEO-level thinking**: One (or small set of) top-level orchestrator(s) that understands the project as a whole and prepares clear, well-reasoned recommendations for the human.
- **Agnostic & portable**: This system must be packageable and reusable across projects.
- **Self-improving system**: The harness must get meaningfully better over time with minimal human effort. This includes dream cycles / background jobs that review work, improve skills/prompts, enrich the brain, detect patterns in the founder’s judgment, and reduce noise in proposals.
- **Gradual autonomy**: More control and decision rights can be given to the system over time as it proves it has internalized the founder's judgment (via the brain and dream cycles).
- **Full conversation visibility** when the human wants it.
- **No reinvention** of low-level agent orchestration or coding agents.

### Human Decision Authority (Foundational Principle)

The default model is:

> **Agents (including the CEO Orchestrator) propose and execute within approved bounds. The human decides.**

This is enforced primarily through the Kanban review loop. Subagents and teams are encouraged to be highly opinionated and generate strong proposals, but they do not have autonomous authority over important or strategic decisions unless the human has explicitly delegated that category.

Over time, as the brain and dream cycles better capture the founder’s judgment, the human can choose to delegate more decision rights to the system in specific, well-scoped areas.

### Self-Improvement (Core Requirement)

The system must be self-improving across two layers. This is not optional.

**1. Memory & Knowledge Improvement**
- Dream Cycles that enrich the brain, synthesize knowledge, improve skills/prompts at a high level, detect patterns in the founder’s judgment, and reduce noise over time.

**2. Code & System Evolution**
- The system should eventually be able to propose and implement improvements to its own code, orchestration logic, subagent behaviors, Agent Team structures, and tools.
- In the early stages, self-changes to the harness are tracked primarily via **GitHub Issues** in its own repository, with **auto-merge** enabled where appropriate. No mandatory human approval is required for harness self-improvement work at this time (see `SELF_EVOLUTION_VIA_ISSUES.md`).

The human can always step in, add approval gates later, or redirect self-improvement work via Issues or chat.

See:
- `architecture/SELF_IMPROVEMENT_AND_DREAM_CYCLES.md`
- `architecture/BRAIN_AND_GBRAIN_ROADMAP.md`
- `architecture/SELF_IMPROVEMENT_CODE_EVOLUTION.md`
- `architecture/SELF_EVOLUTION_VIA_ISSUES.md`
- `architecture/OWN_REPO_AND_SELF_PR.md`

## High-Level Architecture

```
Human
  ├── Chat (steering + directional input) 
  └── Kanban (review / approve / deny)

CEO Harness (this system)
  ├── CEO Orchestrator (holistic strategy + sequencing + priority management)
  ├── Subagent Manager (spawns & controls cheap research swarms — Kimi etc.)
  ├── Brain Coordination (memory layer — GBrain or equivalent)
  ├── Active Think Tank (research subagents that propose priorities & solutions)
  └── Delegation Engine (hands bigger work to external harnesses)

External Specialized Harnesses
  ├── Hermes → Deep planning / complex research swarms
  ├── Overstory (or Codex-based) → Implementation & coding
  └── Others as needed
```

## Two Paths for Work + Human Decision Authority

The CEO Orchestrator has two main ways to get things done, but in both cases the human remains the primary decision maker:

**Path A — Subagents (for research, exploration, and active thinking)**
- CEO directly spawns many lightweight subagents (often on cheap models like Kimi).
- These run in parallel as a "think tank".
- They are expected to generate **concrete proposals** (not just raw research).
- High observability: the user can inspect what the subagents are actually doing and their reasoning.
- This path is fast and cheap for breadth.
- Outputs surface as proposals for the human to review in the Kanban or chat.

**Path B — External Harnesses (for deep work)**
- For bigger, more complex efforts, the CEO creates a structured delegation to a mature external system (Hermes for planning, Overstory for building, etc.).
- This path is used when quality, structure, or long-running coordination matters more than raw speed/volume.
- The CEO Orchestrator reviews the output and prepares it for human decision.

**Core Principle on Decisions**:
The CEO Orchestrator prepares excellent work, makes recommendations, manages execution, and can eventually be granted authority over low-stakes or well-understood areas. However, the human (the real boss) makes most important decisions by default. This is enforced through the Kanban review loop and explicit approval steps.

The system’s job is to make the human’s decisions dramatically better informed and lower effort — not to replace the human as the decision maker.

See `architecture/DELEGATION-MODEL.md` for the detailed model.

## Current Focus Areas

- Making the CEO Orchestrator role and delegation model real.
- Building a lightweight but effective chat interface for human steering.
- Defining clean handoff formats between this harness and Hermes (starting point).
- Ensuring everything feeds a strong persistent memory layer.

This is explicitly a composition system, not a from-scratch agent platform.

### Foundational Decision: Own Repository + Self Pull Requests

The CEO Harness must live in its own dedicated Git repository (separate from any project it manages).

A core capability is that the system must be able to generate code changes to itself and open Pull Requests against its own repository.

This serves several purposes:
- Enforces human review for all meaningful code-level self-improvement (aligning with the principle that the human makes most decisions).
- Provides excellent auditability and history for every change the system makes to itself.
- Makes the harness truly external, portable, and safe to evolve over time.
- Allows the use of normal Git workflows, branch protection, CI, and review processes even for self-generated changes.

See `architecture/OWN_REPO_AND_SELF_PR.md` for the full rationale and implications.
