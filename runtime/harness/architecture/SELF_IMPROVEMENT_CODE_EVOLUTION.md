# Self-Improvement: Code & System Evolution

**Status**: Core requirement (added after user clarification)

The CEO Harness must be self-improving not only in its *memory and knowledge*, but also in its **actual code, skills, behaviors, and architecture**.

This is a significant escalation from classic "dream cycle" memory enrichment (like GBrain's citation fixing, entity enrichment, and synthesis). The system should eventually be able to improve and evolve its own software and operational logic.

## Scope of Code-Level Self-Improvement

Self-improvement at the code level can include (in rough order of ambition and risk):

### Level 1: Skill & Prompt Evolution (Safest starting point)
- Agents analyze what works and doesn't.
- They propose improvements to existing skills, prompts, or agent instructions.
- These are reviewed and approved via Kanban before being applied.
- Example: "The Social Media Research skill is consistently missing competitive analysis. Here's an improved version."

### Level 2: New Skill Creation
- Agents identify recurring needs that don't have good tooling yet.
- They design and propose entirely new skills or subagent behaviors.
- Again, human review before activation.

### Level 3: Process & Workflow Improvement
- Agents suggest better ways to structure recurring work (e.g., how Agent Teams should operate, better proposal formats, improved triage processes).
- This can include changes to how the CEO Orchestrator itself works at a process level.

### Level 4: Actual Code Changes
- Agents propose modifications to the actual source code of the CEO Harness (orchestration logic, subagent runners, integration layers, etc.).
- This requires strong review, testing, and safety mechanisms.
- Changes would still go through human approval (and likely a proper code review + deployment process).

### Level 5: Architectural Evolution (Very advanced)
- Agents identify structural limitations in the current design and propose significant refactors or new abstractions.
- This is long-term and high-risk.

## Critical Constraints (Non-Negotiable)

Because the human must remain the primary decision maker:

1. **No autonomous code changes** — The system can propose, generate diffs, explain rationale, and even run tests, but it cannot merge or deploy changes to itself without explicit human approval.

2. **High visibility** — Every proposed code change must come with clear reasoning, impact analysis, and (where possible) before/after behavior.

3. **Safety & Review Process** — Code-level changes should eventually flow through a more rigorous path than normal Kanban items (e.g., "Code Change Proposal" with required testing, rollback plan, etc.).

4. **Gradual Capability** — We start with Level 1 (skill/prompt improvement) and only unlock higher levels once the system has proven it can do lower levels well and the human has explicitly granted permission.

## How Code Changes Are Proposed and Reviewed

The primary mechanism for code-level self-improvement is **Pull Requests against the harness's own repository**.

When the system identifies a worthwhile code improvement (via Dream Cycles, subagents, or the CEO Orchestrator), it will:

1. Create a branch in its own repo.
2. Make the code change(s).
3. Open a Pull Request with a clear description of the rationale, impact, testing approach, and rollback plan.
4. Surface the PR for human review (this becomes the main decision point for code changes).

This approach gives us:
- Natural human oversight (the human reviews PRs the normal way).
- Full git history and audit trail.
- Easy rollback.
- Compatibility with branch protection rules and CI.

The human remains the default approver for any meaningful change. Over time, low-risk categories could be considered for more automated merging (only with explicit human permission).

See `architecture/OWN_REPO_AND_SELF_PR.md` for the detailed design of this capability.

## Relationship to Existing Tools

We should lean on existing capabilities where possible rather than building everything from scratch:

- Use strong coding agents (your Codex plan, Overstory-style systems, or future better tools) when generating actual code changes.
- Use the `mm` tool (multimodal context) when agents need to deeply understand the current codebase.
- Keep the core orchestration relatively stable and small ("thin harness") so that self-modification is less dangerous.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agents introduce subtle bugs while improving themselves | Strong review process + testing requirements + human approval gate |
| The system optimizes for the wrong things | Keep the human as the ultimate judge of what "better" means |
| Self-improvement becomes too expensive or noisy | Budget controls + CEO Orchestrator filtering proposals before they reach the human |
| Loss of human understanding/control | Maintain high observability — the human must always be able to see *why* a change was proposed |

## Starting Small

We do **not** need to implement full code evolution on day one.

A realistic progression:

1. **Early**: Agents can only propose improvements to their own prompts/skills (Level 1). These are reviewed in the normal Kanban.
2. **Medium**: Agents can propose new skills and small process changes.
3. **Later**: With explicit human permission and stronger safeguards, agents can propose actual code changes to the harness itself.

The important thing is designing the overall system from the beginning with the *capability* for code-level self-improvement in mind, even if we turn the dial up slowly.

## Open Questions

- What should the review process look like for code changes vs. normal proposals?
- Should there be a separate "System Evolution" Kanban or board?
- How do we let the human easily audit or roll back self-initiated changes?
- Should self-improvement be allowed to create entirely new types of subagents or teams?

---

This document should be read alongside `SELF_IMPROVEMENT_AND_DREAM_CYCLES.md`. Together they define the full scope of self-improvement for the CEO Harness — both memory/brain improvement *and* code/system evolution.