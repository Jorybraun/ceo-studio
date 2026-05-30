# Self-Evolution via GitHub Issues + Auto-Merge

**Status**: Current operating model for the harness's own self-improvement (early stage)

## Principle

The Project CEO Harness lives in its own dedicated Git repository. 

For changes the system wants to make to **itself**, the primary tracking mechanism is **GitHub Issues** (or the equivalent ticket system in whatever forge is used).

In the early stages:
- No human approval is required for changes the harness makes to its own codebase or configuration.
- Auto-merging (or direct commits on protected branches via automation, with proper safeguards) is acceptable and encouraged.

This allows the system to move fast on improving its own capabilities without creating friction for the human on meta-work.

## Why Issues Instead of Pull Requests (Initially)

- Issues are better for **tracking intent, discussion, and ongoing work** on self-improvement.
- A single issue can spawn multiple small PRs or direct commits as the system iterates on a self-improvement thread.
- It keeps the focus on **outcomes** ("Improve how the CEO Orchestrator proposes priorities") rather than every tiny code change requiring review.
- It aligns with the "agents are doing real work in the background" philosophy.

## How Self-Evolution Works (Current Model)

1. **Trigger**
   - A Dream Cycle, research subagent, CEO Orchestrator, or even an Agent Team identifies an opportunity to improve the harness itself.
   - Examples:
     - A new skill that would help research subagents produce better proposals.
     - An improvement to how the CEO Orchestrator manages recurring Agent Teams.
     - Better logging / observability for subagent activity.
     - Refinements to the documentation strategy or planning flow.

2. **Issue Creation**
   - The system creates a GitHub Issue in its own repository.
   - The issue clearly states:
     - The problem or opportunity
     - Why it matters
     - Proposed approach
     - Expected benefit
     - Any relevant context from the brain or recent activity

3. **Execution**
   - The system (via the CEO Orchestrator or delegated subagents) works on the issue.
   - It can create branches and small PRs as needed for implementation.
   - Because approval is not required at this stage, the system can auto-merge its own PRs (with CI passing).

4. **Tracking & Visibility**
   - All self-evolution work is tracked in the harness repo's Issues.
   - The human can monitor progress by looking at the Issues board / labels if desired.
   - High visibility is maintained through good issue descriptions and linked commits.

5. **Human Override**
   - At any point the human can step in:
     - Comment on an issue to change direction
     - Close an issue
     - Add approval requirements to specific labels or areas later
     - Move certain categories of self-changes back to requiring manual review

## Scope Limitations (Early Stage)

Even with auto-merge enabled for self-changes, the system should still respect sensible boundaries:

- Do not make changes that would remove the human's ability to regain control.
- Do not delete or heavily restructure core architecture documents without surfacing it clearly in an issue first.
- Security-sensitive changes (secrets handling, auth, permissions) should still be conservative.

These boundaries can be encoded as guidelines the CEO Orchestrator and dream cycles must follow.

## Future Evolution Path

This model is intended for the early / bootstrapping phase.

Later, as the system matures and the human gains confidence, we can introduce graduated controls such as:

- Requiring human approval on issues labeled "High Impact" or "Core Architecture".
- Moving high-risk categories back to mandatory PR reviews.
- Adding automated checks that block auto-merge on certain files or patterns.

For now: **Bias toward speed and momentum on self-improvement.**

## Relationship to the Application (PIPE-OS)

While the harness is improving itself via Issues + auto-merge, the **primary output** the human cares about is still the work done on the actual application (PIPE-OS).

Self-evolution of the harness is a means to an end: better research, better proposals, better priority management, and eventually better execution on the real product and marketing work.

## Open Questions

- What labels / issue templates should the system use for self-evolution work?
- Should there be a standing "Self-Improvement Backlog" project or milestone in the harness repo?
- How should the system communicate major self-changes to the human (e.g., a weekly summary issue)?
- When (if ever) should we introduce the first categories that require human sign-off again?

---

This model replaces the earlier assumption that every code change to the harness would require a human-reviewed PR. For the foreseeable future, the harness is allowed to improve itself with high autonomy, tracked primarily through GitHub Issues.