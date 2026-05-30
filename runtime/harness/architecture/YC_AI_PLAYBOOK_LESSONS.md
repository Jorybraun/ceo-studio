# YC AI Playbook Lessons — Applied to the CEO Harness

**Source:** "Inside YC's AI Playbook" (Pete Koomen interview, closely tied to Garry Tan's thinking and GBrain)

This document extracts the most practical, actionable ideas from how Y Combinator actually runs agents at scale, and maps them to the Project CEO Harness architecture.

## 1. Dream Cycles / Self-Improving Loops (Highest Value)

### What YC does:
- They run nightly "dream cycles" — autonomous background agents that review conversations, meeting transcripts, decisions, and artifacts.
- These agents identify improvements, refine skills/prompts, and update the shared brain automatically.
- Small, high-quality improvements compound over time into organizational superintelligence.

### How we can apply it:

This is one of the strongest patterns for your system.

**Recommended implementation:**
- The CEO Orchestrator (or dedicated background workers) should periodically run "dream cycles".
- These cycles would:
  - Review recent chat conversations (especially your steering input).
  - Look at approved/rejected Kanban items and the reasoning.
  - Analyze research outputs from subagents.
  - Identify patterns in what you care about.
  - Propose improvements to prompts, skill definitions, or even new standing research topics.
  - Update the brain with synthesized insights.

This directly supports your desire for agents that are "constantly doing research and in a think tank."

**Start small version:**
Even a simple daily job that summarizes the last week's chat + decisions and surfaces 3-5 insights or priority suggestions would be extremely valuable.

## 2. GBrain as the Shared Organizational Brain

### What YC does:
- They built GBrain specifically because normal databases + vector search weren't good enough for agents.
- They deliberately **denormalize and structure data for agents**, not just for humans.
- The brain becomes the persistent, queryable memory that all agents apprentice to.

### How we can apply it:

You already like GBrain — this reinforces using it as the central memory layer.

**Key practices to adopt:**
- When ingesting information (chat logs, research outputs, meeting notes, decisions, artifacts), structure it in ways that are agent-friendly (clear entities, relationships, provenance, summaries + raw transcripts).
- Use GBrain's synthesis + gap analysis capabilities heavily.
- Make the dream cycles write back into GBrain (this is how their system compounds).

The CEO Orchestrator should treat GBrain as its long-term memory and primary source of truth about your judgment, priorities, and project history.

## 3. Recording Everything as a Default Primitive

### What YC does:
- They default to recording meetings, conversations, decisions, and outputs.
- This raw material feeds the dream cycles and the shared brain.
- "It's like the closest thing to us being able to connect our brains."

### How we can apply it:

This is already partially in your design (chat logging into the brain), but we should make it more deliberate.

**Recommendations:**
- Treat chat conversations as first-class recorded artifacts.
- When subagents or external harnesses do work, encourage (or require) them to produce clear artifacts that get logged.
- For important decisions, explicitly capture the rationale in a structured way.
- Over time, build the habit of "default public + recorded" inside the system.

This directly feeds both the brain and future dream cycles.

## 4. Skill Registry + DRY/MECE Resolvers

### What YC does:
- Instead of every agent having its own messy, duplicated prompts, they built a central, discoverable registry of skills.
- They emphasize **Skillify** (the meta-skill of creating good skills), DRY (don't repeat yourself), and MECE (mutually exclusive, collectively exhaustive) thinking when designing skills.
- Agents learn to compose existing skills rather than reinventing prompts every time.

### How we can apply it:

This is excellent for avoiding chaos as you add more subagents and capabilities.

**Recommended approach:**
- Create a central "Skill Registry" (could start as a well-organized folder in the brain or a simple system).
- When building new capabilities for research subagents or planning agents, define them as reusable skills with clear inputs/outputs.
- The CEO Orchestrator (and later subagents) should prefer composing existing skills over writing one-off prompts.
- Over time, this registry becomes one of the most valuable assets in the system.

This pairs very well with your goal of not reinventing things.

## 5. AI as the Operating System / Building Layer (Not Features)

### What YC does:
- They didn't just add "AI features" on top of old workflows.
- They gave agents real power (e.g., direct SQL access to their production database) and rebuilt processes around what agents can now do.
- This created Jevons Paradox — usage exploded once friction was removed.

### How we can apply it:

This supports the deeper philosophy of the CEO Harness.

**Implications:**
- The CEO Harness shouldn't just be "another tool" on top of your current way of working.
- It should gradually become the primary way work gets initiated, prioritized, researched, and delegated.
- Give the system (especially the CEO Orchestrator and research subagents) real access and power — not just read-only summaries.

## 6. Chat as the Best Human Interface

### What YC does:
- They concluded that natural chat is currently the best interface for humans to steer and interact with sophisticated agent systems.
- It is the least constraining and closest to how people actually think.

### How we can apply it:

This strongly validates the direction you've already chosen (Chat as the high-bandwidth steering channel, Kanban as the review surface).

We should double down on making the chat experience excellent for injecting vision, priorities, and corrections.

## 7. Culture as a Prerequisite (Important Context)

### What YC does:
- This kind of deep agent system only works at scale with high-trust, default-public, recording-by-default culture.
- Low trust and information hoarding kill the shared brain.

### How we can apply it:

This is less directly under our control, but worth being aware of:
- The more you treat the system as a trusted thinking partner (and actually record important conversations/decisions into it), the better it will get.
- The inverse is also true.

## Summary — Top 4 Ideas to Prioritize

From the YC playbook, the highest-leverage things for your CEO Harness right now are:

1. **Dream Cycles** — Build background jobs that review everything and improve the system over time (this is the "constantly working" part you want).
2. **Strong use of GBrain** — Treat it as the real long-term memory and make dream cycles write back into it.
3. **Recording as default** — Make it easy and natural to capture important context so the brain and dream cycles have good material.
4. **Skill Registry thinking** — Start designing capabilities in a reusable, composable way instead of one-off prompts (especially as you add more Kimi subagents).

These four ideas are battle-tested at YC and map extremely well to the architecture we're building.

---

Would you like me to:
- Turn the top ideas into concrete next steps or architecture updates?
- Design a first version of "Dream Cycles" for the CEO Harness?
- Create a Skill Registry structure we can start using?

Just tell me which direction to execute on.