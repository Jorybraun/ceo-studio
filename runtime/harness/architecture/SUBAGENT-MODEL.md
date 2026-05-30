# Subagent Model — CEO Harness Architecture

**Status**: Core design decision (May 2026)

This document captures the specific direction chosen for how the CEO Harness will manage cheaper models (especially Kimi) and research-oriented work.

## Core Decision

The CEO Harness will **directly spawn and manage subagents**, rather than only delegating to fully external harnesses for everything.

Key points:
- Cheap, high-volume models (Kimi, etc.) will primarily be used as **subagents** under the direct control of the CEO Orchestrator.
- The CEO Harness is responsible for creating, assigning, monitoring, and terminating these subagents.
- This is different from (but complementary to) delegating large blocks of work to mature external systems like Hermes or Overstory.

## Two Layers of Delegation

We are distinguishing between two things:

| Layer | What it is | Primary Use Case | Management Style | Visibility |
|-------|------------|------------------|------------------|----------|
| **Subagents** (inside CEO Harness) | Lightweight, short-to-medium lived agents spawned by the Orchestrator (often on cheap models like Kimi) | Research, trend scanning, problem identification, proposal generation, parallel exploration | Direct control by CEO Orchestrator (create, assign, kill, monitor) | High — full internals visible |
| **External Harnesses** (Hermes, Overstory, etc.) | Mature, standalone agent platforms | Deep planning swarms, complex implementation work, long-running coding agents | Delegation via structured handoff requests | Medium — we see outputs + some status, not every internal step |

This gives us the best of both worlds:
- Cheap, fast, massive parallelism for research/think tank work (via subagents).
- High-quality, well-orchestrated execution for harder work (via external harnesses when appropriate).

## Active Think Tank Mode (Preferred)

The user explicitly chose the **active** version of the research/think tank capability.

### What this means:

Research subagents are not just dumping raw findings into the brain.

Instead, they are expected to:
- Identify real problems and opportunities.
- Generate **concrete proposals** (e.g., "We should prioritize building X because of Y trend. Here is the evidence and rough impact.").
- Suggest experiments or next steps.
- Propose priority changes.

These proposals then surface through the normal Kanban review flow (or directly in chat when urgent).

This turns the think tank from a passive knowledge base into an active strategic advisor.

## Decision Authority — Human First

The human (the real CEO/boss) makes most decisions.

Subagents and teams are expected to do excellent work and generate **strong proposals**, but they do not have autonomous decision rights on important matters by default. All meaningful proposals surface through the Kanban (or chat for urgent items) for human review.

The CEO Orchestrator’s job is to prepare decisions extremely well — not to make them on the human’s behalf unless explicitly authorized for specific low-stakes categories.

This is the default stance: **Agents propose. The human decides.**

Over time, as the brain captures the founder’s judgment more accurately, the human can choose to delegate more decision authority to the system.

## Observability Requirements (Non-Negotiable)

The user wants **high visibility** into what the subagents are actually doing.

This is a first-class requirement, not a nice-to-have.

### What must be visible:

1. **Live / Near-real-time activity**
   - What each subagent is currently working on.
   - Current task / goal.
   - Recent tool calls and actions.

2. **Reasoning traces**
   - Why the subagent made certain decisions.
   - Intermediate thoughts / chain-of-thought (when available).

3. **Full conversation / interaction history**
   - Between the CEO Orchestrator and subagents.
   - Between subagents if they collaborate.

4. **Artifacts produced**
   - Research notes, drafts, data, prototypes, etc.
   - Not just the final polished output.

5. **Resource usage** (nice to have early, important later)
   - Token spend per subagent / per task.
   - Model being used.
   - Runtime duration.

### Why this matters

- Trust: The user wants to understand the internals, especially early on while the system is still learning their judgment.
- Debugging: When something goes wrong (or produces low-quality output), being able to inspect the actual work is essential.
- Learning: The user wants to see how good the system is getting over time.
- Selective involvement: High visibility makes it easier to jump in at the right moment (as described in the Kanban + Chat model).

This level of observability has significant implications:
- We need structured logging + tracing for all subagent activity.
- The chat interface should eventually allow drilling into specific subagent runs.
- The brain should store not just final results, but rich traces and artifacts.
- We may need a simple dashboard or rich terminal view for monitoring active swarms.

## Implications for the CEO Orchestrator

The CEO Orchestrator now has additional responsibilities:

- **Subagent lifecycle management**: Create the right number and types of subagents for a given research thrust. Kill or redirect them when they're going down unproductive paths.
- **Proposal synthesis**: Take raw output from many subagents and turn it into coherent, reviewable proposals for the Kanban.
- **Observability routing**: Decide what level of detail to surface to the human vs keep in the brain for later inspection.
- **Cost & quality routing**: Decide when to use cheap subagents (Kimi swarm for breadth) vs stronger models (deeper reasoning or final proposal writing).

## Relationship to External Harnesses

This subagent model does **not** replace delegation to Hermes / Overstory.

Example division of labor:

- **Wide research & opportunity spotting** → CEO spawns 20–50 cheap Kimi subagents (active think tank mode).
- **Deep planning on a chosen direction** → CEO creates a delegation request to Hermes.
- **Actual building / implementation** → Delegation to Overstory or Codex-based workflows.

The CEO Orchestrator's job includes knowing when to use which approach.

## Open Questions / Next Work

- How do we actually implement cheap subagent spawning (Kimi API + orchestration layer)?
- What does the observability surface look like in practice? (Simple logs first? Rich dashboard later?)
- How do we prevent subagent swarms from becoming noisy or expensive without strong guidance from the CEO?
- How do proposals from active research subagents flow cleanly into the Kanban without overwhelming the user?

---

This model (CEO as subagent orchestrator + active proposals + high visibility) is now a core part of the architecture. All future design work on the research/think tank capability should follow these principles.