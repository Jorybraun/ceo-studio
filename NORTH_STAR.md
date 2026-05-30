# CEO Studio — North Star

## One sentence

**CEO Studio is an agnostic desktop application and cost-guarded agent runtime that lets a human steer an AI "Project CEO" — which, over time, grows from a single Document Agent into a strategic manager that orchestrates domain-based agent swarms.**

## Why this exists

Two problems, one root cause.

1. **Documentation rot & re-explanation.** Docs, code, and plans drift apart. Every agent session starts by re-explaining the project.
2. **Credit burn.** A previous attempt let agents spawn agents with no spending guardrails and burned all credits.

The root cause is the same: **there is rich strategic intent (the `harness/` planning corpus) but no safe runtime and human interface to execute it.** CEO Studio is that runtime and interface.

## Relationship to the existing `harness/`

The PIPE-OS `harness/` directory already designed the *thinking system*: CEO Orchestrator, domains, brain/GBrain memory, subagent think-tanks, delegation to Hermes/Overstory, dream cycles, and curation of external skills (gstack, GBrain, Anthropic).

What it lacks — by its own admission — is:
- A real runtime that automatically drives the orchestrator (today it's manual `launch-agent` + tmux + Hermes profiles).
- **Hard cost controls** (the harness docs list "hard budgets, throttling, token tracking" as *Current Gaps*).
- A coherent human interface.

**CEO Studio does not reinvent the harness. It is the runtime + UI + guardrail layer that makes the harness vision real.** It reuses the harness's assets directly:

| Harness asset | How CEO Studio uses it |
|---|---|
| `personas/`, `skills/` (incl. gstack-derived) | Loadable agent roles/skills |
| Brain artifact contract (`BRAIN_AND_GBRAIN_ROADMAP.md`) | Context & memory format (see below) |
| Domains (`PLANNING-FLOW-AND-DOMAINS.md`) | Multi-domain model per project |
| Delegation model (Hermes/Overstory/subagents) | Swarm orchestration at the top of the ladder |
| GBrain | Future synthesis/query backend for memory |
| Kanban review loop | Human decision-authority surface |

## Non-negotiable principles

1. **Human is the primary decision maker.** Agents propose and execute *within approved bounds*. Strategic decisions go through a review loop.
2. **Cost is guarded by hardware, not hope.** Hard per-session and per-day caps, a live token/$ meter, and a kill switch. No agent can spawn another agent without a budget allocation. This is the lesson of the credit burn and it is enforced from Level 0.
3. **Reversibility over permission for docs.** The Document Agent may edit docs *autonomously* because every change lands as a git commit on a branch — git is the undo button. (Spending is *not* reversible, hence the hard caps.)
4. **Agnostic & multi-project.** CEO Studio is not "the PIPE app." It mounts any project folder, discovers its domains, and keeps per-project memory.
5. **Record first, synthesize later.** Raw transcripts/artifacts are first-class; synthesis (dream cycles, GBrain) is derived and never destructive.
6. **Observability is mandatory.** Every agent action, token spend, and file change is visible.

## The Capability Ladder

CEO Studio is built as a ladder. Each rung is independently valuable and must prove itself (especially on trust and cost) before the next is built.

- **L0 — Foundation.** Agnostic Electron app, project+domain model, brain (context/memory) contract, and the cost meter + hard caps. *No autonomy yet.*
- **L1 — Document Agent.** A single agent that loads project+domain context and **autonomously keeps documentation coherent** — finds contradictions/drift, edits docs on a branch, commits each change. Hard cost cap; git is the safety net. **This is the wedge and the trust test.**
- **L2 — CEO Manager.** A single strategic agent across all domains. Reads the brain index, produces *work packages*, runs the Kanban review loop, and runs the first **dream cycle** (judgment patterns, contradictions, stale plans). Still one agent — no swarms.
- **L3 — Swarm Orchestration.** The CEO Manager delegates: cheap **subagent think-tanks** for breadth and **external harnesses** (Hermes for planning, Overstory for code) for depth — per domain. Leverages gstack skills + GBrain. Governed by **hard swarm budgets** and an activation protocol.
- **L4 — Self-improvement.** Dream cycles enrich the brain and refine skills/prompts; optional self-PR against CEO Studio's own repo.

## What "done" looks like (the eventual product)

A Claude-Desktop-style app where you open any project, see a calm red presence, talk to your Project CEO, and review its proposals. Behind the calm interface it remembers everything about the project, keeps the docs honest, and — when you allow it and within a budget you set — dispatches domain swarms to research, plan, and build, surfacing only clean decisions for you to approve.

The build order is the ladder. We are starting at **L0 → L1**.
