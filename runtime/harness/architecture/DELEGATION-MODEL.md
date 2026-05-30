# Delegation Model — Composing Existing Harnesses

**Core Principle**: The Project CEO Harness does **not** build its own low-level agents or coding harnesses. It is a strategic meta-orchestration layer that composes and directs existing specialized agent harnesses.

We reuse battle-tested systems instead of reinventing them.

## Role Mapping (Current Thinking)

| Role / Capability                  | Tool / Harness          | Why |
|------------------------------------|-------------------------|-----|
| **Strategic direction, cross-domain sequencing, CEO-level judgment** | This harness (Project CEO Harness) | This is the new system we're building. It thinks about the project as a whole. |
| **Planning, research, requirements, design exploration, user journeys** | **Hermes** (especially Hermes Kanban + swarms) | User likes the Kanban flow. Hermes already has strong swarm + planning capabilities. Planning agents should live here. |
| **Actual coding, implementation, code review, merging** | **Overstory** (or similar coding agent harness) | Mature multi-agent coding orchestration with worktrees, mail bus, observability, and runtime adapters. No need to rebuild this. |
| **Long-term memory, synthesis, gap analysis, persistent context across time** | **GBrain** | Designed exactly for this problem. Self-improving brain with graph + synthesis. Prevents project rot. |
| **Inter-agent structured communication + visibility** | Borrow patterns from Overstory (mail) + Hermes (Kanban coordination) | We don't need to build the bus from scratch. |
| **Raw chat interface for human steering** | This harness (simple chat tool + logging) | Lightweight capture layer that feeds the brain and triggers delegations. |

## How Delegation Works (High Level)

1. **Human steers via Chat** (or Kanban comments)
   - Example: You tell the CEO Orchestrator your thinking about discovery interviews.

2. **CEO Orchestrator decides what kind of work is needed**
   - This might be "deep planning and exploration work".
   - It does **not** spin up its own agents to do the research.

3. **CEO Orchestrator creates a Delegation Request**
   - It packages:
     - The strategic intent (from you + its own reasoning)
     - Specific planning/research/design objectives
     - Constraints
     - What "done" looks like for this delegation
     - References to relevant brain context

4. **It hands the request to the appropriate external harness**
   - For planning/research/design work → Sends it to Hermes (via whatever integration we build — API, shared folder, task queue, etc.)
   - For coding work → Sends it to Overstory

5. **External harness executes with high agency**
   - Hermes runs its Kanban swarm or planning agents.
   - Work happens inside Hermes' own system (with its own visibility).

6. **Results come back**
   - Hermes (or Overstory) produces artifacts (specs, designs, research summaries, code, etc.).
   - These are handed back to the CEO Harness.

7. **CEO Harness processes the output**
   - Runs it through quality / strategic filters.
   - Updates the brain.
   - Surfaces a clean work package in the Kanban for human review.

8. **Human reviews in Kanban** (primary interface)
   - Approve, deny, or jump back into chat to give more direction.

## Why This Model

- Avoids reinventing complex agent orchestration (the user is explicitly tired of this).
- Lets each tool do what it's best at.
- Keeps the CEO Harness relatively lightweight and focused on strategy + human interface + memory coordination.
- Makes the whole system more portable and future-proof (easy to swap in better tools later).

## Integration Philosophy

We will create **thin adapters** in `harness/integrations/` rather than trying to deeply embed other systems.

Examples of integration surface:
- Hermes: Task submission + result retrieval (possibly via Kanban items, shared docs, or API if available).
- Overstory: Similar — hand off implementation tasks.
- GBrain: Primary brain substrate (ingest conversations, query for context, use for synthesis).

The CEO Harness owns the "what should we do and in what order" and "does this align with the overall strategy" layer. It does **not** own the "how do we make 8 agents collaborate on a design doc" layer.

## Next

- Define concrete handoff format between CEO Harness and Hermes for planning work.
- Prototype a minimal Hermes delegation stub.
- Decide how much visibility we want to pull from the external harnesses back into our Kanban / chat.
