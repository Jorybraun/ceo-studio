# Self-Improvement & Dream Cycles — CEO Harness

**Status**: Core architectural requirement

The Project CEO Harness must be self-improving. This is one of the most important characteristics for long-term success.

## Goal of Self-Improvement

The system should get meaningfully better over time at:

- Understanding the founder’s actual judgment and priorities
- Generating higher-quality proposals that are more likely to be approved
- Knowing when to do research vs. when to ask for input
- Reducing noise and busywork for the human
- Better managing subagents and teams
- Surface the right information at the right time

Importantly, self-improvement should **increase the quality of support** for the human, not gradually remove the human from decision-making.

## Dream Cycles (The Main Self-Improvement Mechanism)

Dream Cycles are periodic background processes (running daily, or on a continuous low-intensity schedule) that do autonomous work while the human is not actively steering.

### What a Dream Cycle Can Do

A Dream Cycle can perform any combination of the following (starting small and expanding):

1. **Judgment Modeling**
   - Review recent chat messages, Kanban decisions (approvals, rejections, comments), and proposals.
   - Extract patterns in what the human cares about (tone, level of detail, risk tolerance, what gets rejected quickly, etc.).
   - Update an internal "Founder Judgment Model" stored in the brain.

2. **Brain Enrichment**
   - Synthesize scattered research and conversations into higher-quality entries in the brain.
   - Detect and flag contradictions or stale information.
   - Create or improve synthesized "truth" pages.

3. **Skill & Prompt Improvement**
   - Review which skills/prompts used by subagents produced good vs. poor results.
   - Propose improvements or new skills.
   - Update the central Skill Registry over time.

4. **Noise Reduction**
   - Learn what kinds of proposals the human almost always rejects and reduce how often they are generated.
   - Improve filtering and prioritization of what gets surfaced in the Kanban.

5. **Opportunity & Problem Detection**
   - Run lightweight ongoing research on standing topics (market trends, competitor moves, internal bottlenecks).
   - Surface new potential priorities or experiments for the human to consider.

6. **Team & Subagent Tuning**
   - Suggest adjustments to existing Agent Teams (e.g., "The Social Media Team would benefit from adding a stronger analyst role").
   - Identify when certain subagent types are consistently underperforming.

## Relationship to Human Decision Authority

Self-improvement must respect the core principle:

> **Agents propose. The human decides.**

Dream Cycles can:
- Get better at preparing proposals
- Reduce low-value work
- Surface better options
- Learn the human’s preferences

Dream Cycles should **not**:
- Start making important decisions autonomously without explicit permission
- Change the human’s review burden without consent
- Modify core strategy or direction without going through the normal proposal + Kanban flow

The human can later choose to delegate certain categories of decisions to the system once it has demonstrated strong judgment in those areas.

## Implementation Approach (Phased)

**Phase 0 (Minimal Starting Point)**
- Basic logging of all chat input + Kanban decisions into the brain.
- Simple periodic job that summarizes recent activity and surfaces 3–5 insights or patterns for the human.

**Phase 1**
- Judgment modeling (extracting preferences from approvals/rejections).
- Basic skill improvement suggestions.
- Noise reduction in proposals.

**Phase 2**
- Full dream cycle with synthesis, contradiction detection, and ongoing research topics.
- Ability for the system to propose new standing Agent Teams or research directions.
- More sophisticated feedback loops.

**Phase 3+**
- Deeper autonomy in well-scoped areas (once explicitly granted).
- Cross-project learning (if running multiple projects).
- Advanced self-optimization of subagent behavior and team structures.

## Technical Enablers

Self-improvement depends heavily on:

- Strong persistent memory (GBrain or equivalent)
- High-quality recording of conversations, decisions, and reasoning traces
- Structured outputs from subagents and teams (makes learning easier)
- Good observability (so the dream cycle can analyze what actually happened)
- A job queue / background execution system that can run reliably 24/7

## Open Questions

- How much compute / cost budget should dream cycles have by default?
- Should the human be able to pause or throttle self-improvement?
- How do we make the outputs of dream cycles visible and reviewable (especially when they propose changes to skills or processes)?
- Should dream cycles be allowed to spawn their own lightweight research subagents?

---

This document should be treated as a core part of the architecture. Every major component (subagents, Agent Teams, CEO Orchestrator, Kanban, chat, brain) should be designed with self-improvement in mind from the beginning.