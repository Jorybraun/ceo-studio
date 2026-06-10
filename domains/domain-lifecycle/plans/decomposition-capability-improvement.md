# Plan: Improving Structured Decomposition Capabilities (Iterative Approach)

**Domain**: Domain Lifecycle  
**Status**: Planning Phase  
**Date**: 2026-06 (current)  
**Goal**: Build high-quality, domain-aware decomposition from briefs into well-structured plans — done carefully and iteratively, not as a big bang.

---

## Guardrails & Constraints (Important)

These rules are non-negotiable for this project:

- **Do not modify or destroy raw design documents.** The original design material in `docs/design/` (system-overview, domain-creation-process, handoff-protocol, critical-system-agents, agent-scoping-model, domain-terminology, recursive-document-linking) must remain untouched as the authoritative source. Any work that references them must treat them as read-only.
- **Do not implement tasks yet.** We are in an exploratory and design phase only. No production implementation, no large-scale agent runs, and no deployment of new decomposition behavior without explicit human sign-off at each step.
- **Testing / Evaluation Strategy is protected.** Work on defining or executing testing strategies, evaluation criteria, dogfooding plans, or automated assessment of the decomposer must **not** be implemented or executed by agents. This area must stay under direct human control for the foreseeable future. Agents may help analyze or propose ideas, but nothing in the testing strategy may be built or run without explicit approval.
- **Slow, deliberate iteration only.** We follow a Karpathy-style loop: small scoped experiments → human review → learnings → next tiny step. No "launch and see what happens" approach.
- **All changes must be documented here first.** Any proposed persona updates, tool changes, or experiments must be written into this plan document before any code or agent behavior is modified.

These guardrails exist because the goal is to perfect the capability piece by piece with high quality, not to rush an incomplete system.

---

## Current Issue (Walkthrough)

We are stuck in a loop:

1. **Excellent design exists**  
   The Domain Lifecycle vision (Domain Architect → explicit handoff → Agenda Agent triage → high-quality child plans on the correct domain board) is well documented in:
   - `docs/design/` (especially `domain-creation-process.md`, `handoff-protocol.md`, `critical-system-agents.md`)
   - `definition.md`
   - The personas in `docs/personas/`

2. **The execution layer is weak**  
   - Normal briefs created in the system are often low-quality or generic.
   - The default decomposition (`Decompose` button → Hermes kanban decompose) produces flat, low-context child tasks.
   - The Agenda Agent is still mostly a design placeholder. It has the right intent in its persona ("light triage", "decomposition awareness", "knows when to hand off deeper work"), but almost no real behavior or tools to do structured, high-quality decomposition.
   - We started one tool (`brief-decomposer.js` + the feature spec in `docs/features/brief-sectional-decomposer.md`), but it is early, not integrated into an agent loop, and not yet proven on real work.

3. **Consequence for this domain**  
   - The `domain-lifecycle` board is empty.
   - We are hesitant to put real work there because it would likely result in mediocre briefs and weak plans.
   - This creates a chicken-and-egg problem: we need good planning tools to do good work on this meta-domain, but we need to do the work to improve the tools.

4. **Recent partial progress**  
   - We organized all the design material cleanly inside this domain.
   - We switched the Agenda Agent to the `grok` provider (with `grok-build` model available).
   - We have a first version of a sectional decomposer.
   - We have the agent registry and team system still fully functional.

The core gap is: **We do not yet have a reliable way for an agent (or human + agent) to take a complex domain-level brief/handoff and turn it into excellent, sectioned, provenance-linked child plans.**

---

## Guiding Principles for This Work

- **Go slow and high-quality**. No big launches. Small, testable increments.
- **Use the system to build the system** (Karpathy-style loop). Use the agent registry, personas, and current tools to help improve the decomposition capabilities.
- **Everything lives inside this domain**. Requirements, plans, experiments, and learnings for this capability should be documented here.
- **Human judgment stays in the loop** for a long time. We are not aiming for full autonomy quickly.
- **Measure what "good" looks like** before scaling.

---

## High-Level Iterative Strategy (Karpathy Loop)

We will treat the improvement of decomposition as its own small project with repeated cycles:

**Cycle Structure (repeat):**
1. **Define a tiny, clear scope** for this iteration (e.g., "Improve section extraction + proposal quality for one specific type of brief").
2. **Build or improve the smallest possible thing** (persona instructions, tool enhancements, prompt techniques, evaluation criteria).
3. **Test it** using real or synthetic briefs related to Domain Lifecycle (or other domains).
4. **Run it with agents from the registry** (including the grok-powered ones) in a controlled way.
5. **Review the output** (human + agent critique).
6. **Capture learnings** in this plan document or supporting docs.
7. **Decide the next tiny increment**.

This is deliberately not "build the full decomposer then launch it".

---

## Proposed Phased Approach (High Level)

**Phase 0: Grounding & Current State** (Current)
- Clarify the exact problem and success criteria.
- Inventory existing pieces (current decomposer, ticket-planner, provenance, agent registry, etc.).
- Decide on evaluation methods.

**Phase 1: Strengthen the Agenda Agent's Decomposition Awareness**
- Improve the `agenda-agent` persona specifically for structured decomposition.
- Give it better tools/instructions for using existing capabilities (current `brief-decomposer`, `ticket-planner`, reading design docs, etc.).
- Test in small, supervised sessions.

**Phase 2: Improve the Core Decomposer Tool**
- See the dedicated `../plans/decomposer-spec-and-plan.md` for the detailed spec (Agenda Items as primary output, registry matching + new persona proposals when needed, full structure including brief reference + action items).
- Iterate on `brief-decomposer.js` (or extracted logic) based on real usage feedback from this spec.
- Add better proposal review UX (even if simple at first).
- Focus on quality of generated Agenda Items (that can lead to child briefs/swarms) over features.

**Phase 3: Closed-Loop Agent Work**
- Set up small teams from the agent registry that include the (improving) Agenda Agent + supporting agents.
- Have them work on Domain Lifecycle sub-problems in a controlled way.
- Use the output to further train/improve the decomposition behavior.

**Phase 4: Integration & Dogfooding**
- Make the improved decomposition available in the normal UI/voice flow.
- Dogfood heavily on this domain itself.
- Only then consider broader use.

**Phase 5: Evaluation & Hardening**
- Define clear metrics for "good decomposition".
- Build light evaluation harness.
- Decide when the capability is ready for production use on important work.

---

## Next Immediate Step (Slow Mode)

We will **not** move into implementation or detailed task breakdown yet.

Current next step is only alignment and grounding:

1. **Confirm the problem statement** — The user should review the "Current Issue" section above and the guardrails. We only proceed once this feels accurate.
2. **Define success at a high level** (not metrics yet) — What would "noticeably better decomposition" feel like for work in this domain? We discuss this together first.
3. **Decide the absolute smallest safe first experiment** (if any) — Something tiny that can be done with heavy human oversight, using the agent registry if appropriate.

Only after the above three are aligned will we consider creating the first tiny iteration plan.

**Strong reminder:** Nothing in the Testing Strategy / Evaluation area may be designed or executed by agents without explicit human approval. This area remains human-only for now.

---

**This document is the single source of truth for this improvement effort.**

All thinking, constraints, experiments, and decisions will be captured here. We move only as fast as the user is comfortable with.

---

## Safest Execution Strategy (Recommended Approach)

Given the constraints (protect raw docs, human-only control over testing strategy, follow new agent protocol, go slow), here is the recommended safest way to execute this plan:

### Core Principle
**Human (you) owns the steering wheel, architecture fidelity, and all evaluation decisions.** Agents are powerful tools for acceleration in narrow, reviewable scopes — they are not autonomous drivers on this project.

### Division of Labor (Safest Split)

**Human does (non-delegable for now):**
- All updates to this plan document and high-level strategy.
- Definition and evolution of the "testing strategy" / evaluation criteria (explicitly protected).
- Final approval of any changes to agent personas that will be used in production or on real work.
- Deciding when a small experiment graduates to the next phase.
- Creating any kanban tasks related to this effort (full briefs that link to this plan).
- Reviewing and merging all code changes (even from agents).
- Ensuring adherence to the Domain Lifecycle architecture (from `docs/design/` and `definition.md`).

**Agents (from registry, using grok or other configured providers) can be used for:**
- Analysis: "Read the current brief-decomposer.js + the design docs in docs/design/ + this plan. Produce a structured markdown report on gaps."
- Proposal generation: "Based on the above, draft 3 small, testable improvements to the decomposer logic or the agenda-agent persona. Output as files in plans/ for human review."
- Documentation support: Drafting updates to feature specs, AGENTS.md for the domain, etc. (human reviews).
- Code review assistance: "Review this diff against the architecture and this plan. List risks and suggested fixes."
- Synthetic test case generation (proposals only, not execution).
- Running very narrow, human-supervised experiments once the scope is tiny and the testing approach for that experiment has been human-defined.

**Strictly forbidden for agents on this project (until explicitly lifted by human):**
- Making changes to raw design documents in `docs/design/`.
- Defining, implementing, or running anything in the Testing Strategy / Evaluation area.
- Creating kanban tasks or dispatching work without a human-created parent brief that references this plan.
- Running the decomposer (or future versions) on real Domain Lifecycle work or other important briefs until the human has approved the evaluation method for that run.
- Autonomous multi-step loops without human checkpoints after each step.

### How to Use the Agent Registry for This (Safest Way)

1. **Dedicated small team**: Consider adding a small "decomposition-improvement" team in the agent registry (e.g. in `runtime/harness/agents/agents.json` or project-level override). Members could include the grok-powered agenda-agent + supporting personas (e.g. a "decomposition-analyst", "protocol-follower-reviewer").

2. **Task creation protocol (mandatory)**:
   - Human always creates the kanban task first on the appropriate board (recommend starting on `ceo-studio` with domain tag, or carefully on `domain-lifecycle` once we have a couple of high-quality seed briefs).
   - The task brief **must** include:
     - Link to this plan document.
     - Explicit scope (tiny).
     - Reference to the guardrails.
     - Required output format (e.g. "write only to plans/ subfolder, no code changes").
     - "Follow the new agent protocol: use worktree, --dry-run first if dispatching, produce reviewable artifacts."

3. **Execution environment for agents**:
   - Always use isolated git worktrees: `--workspace worktree:CEO_STUDIO --branch wip/decomp-improvement-xxx`
   - Dispatch with `--dry-run --max 1` first.
   - Human watches logs (`hermes kanban log <id>`).
   - After run: Human reviews the diff + any produced documents in `plans/`.
   - Only then decide to merge or discard.

4. **Karpathy Loop Execution**:
   - Each cycle = one very narrow kanban task created by human.
   - Agent(s) produce proposals/artifacts.
   - Human reviews, decides what to keep/incorporate (often by manually editing or carefully applying).
   - Update this plan document with learnings.
   - Repeat. No batching of big changes.

### Recommendation on "Maybe I should just implement it?"

Yes — for the core logic improvements to `brief-decomposer.js` and critical persona changes, **you implementing (or pair-programming with very tight agent assistance)** is currently the safest and highest-quality path.

Use agents heavily for:
- Pre-work analysis and research.
- Generating multiple alternative proposals.
- Writing tests and evaluation harness scaffolding (but you define the actual strategy).
- Post-change review and documentation.

This way the "new agent protocol" is followed (agents operate inside proper harness tasks with isolation and human review), the raw documents stay pristine, and the testing strategy remains under your direct control.

This hybrid (human core implementation + agent augmentation in narrow scopes) is the lowest-risk way to make steady progress while still getting the benefit of using the system to improve itself.

---

## How This Safest Path Maps to the Phased Approach

- **Phase 0 and 1**: Mostly human + agent analysis/proposal work. Very few or no code changes initially.
- **Phase 2**: Human-led small refactors to the decomposer, with agents doing analysis and test proposal generation.
- **Phase 3**: Only after several successful small human-reviewed cycles. Start with agents working on synthetic or low-stakes examples.
- Later phases only when the loop has proven itself multiple times under the above constraints.

All updates to this plan must include a note on how the change adheres to the Safest Execution Strategy above.
