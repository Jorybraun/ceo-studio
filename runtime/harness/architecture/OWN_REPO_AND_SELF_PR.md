# Own Repository + Self Pull Request Capability

**Status**: Core architectural decision

The Project CEO Harness must live in its own dedicated repository and be capable of creating Pull Requests against itself.

## Why This Matters

This is not just a portability detail — it is a fundamental design choice that enables safe, reviewable, and auditable self-improvement at the code level.

### Key Benefits

1. **Clean Separation**
   - The harness is completely external to any project it manages.
   - It can be pointed at multiple target projects (as discussed in MULTI-PROJECT.md) without being entangled in any of them.

2. **Natural Human Review for Code Changes**
   - When the system proposes improvements to its own code, skills, orchestration logic, or architecture, it opens a Pull Request.
   - The human reviews the PR using normal GitHub / GitLab tooling (comments, suggestions, approvals).
   - This is the primary enforcement point for "Agents propose. The human decides." at the code level.

3. **Excellent Audit Trail & History**
   - Every code change the system ever makes to itself has a full PR history, discussion, and diff.
   - This is far superior to agents directly editing files in place.

4. **Safety & Rollback**
   - Standard git workflows apply: branches, reviews, CI checks, and easy rollbacks via `git revert` or reverting the PR.
   - The human can require certain checks (tests, linting, security scans) before merging self-generated PRs.

5. **Psychological & Philosophical Clarity**
   - It makes the power dynamic explicit: the system is improving *its own tools*, but the human remains the ultimate owner and gatekeeper of the repository.

## How Self Pull Requests Would Work (High Level)

1. **Trigger**: A Dream Cycle, research subagent, or the CEO Orchestrator itself identifies a worthwhile improvement to the harness code or configuration.

2. **Generation**: The system creates a branch, makes the code change(s), writes a clear PR description explaining the rationale, impact, and testing approach.

3. **Submission**: It opens a Pull Request against the harness repository (using the Git hosting provider's API).

4. **Human Review**: You review the PR (just like any other PR). You can:
   - Approve and merge
   - Request changes
   - Comment and discuss
   - Close without merging

5. **Optional Automation**: Over time you can add rules such as:
   - Auto-run tests + linting on self-generated PRs
   - Require the CEO Orchestrator to include specific sections in the PR description
   - Only allow merging of low-risk categories without human review (once you're comfortable)

## Technical Requirements

To support this, the harness (when running in production/24/7 mode) will need:

- Git credentials with permission to create branches and open PRs on its own repository.
- Access to the Git hosting provider API (GitHub, GitLab, etc.).
- A clear way to distinguish "self-generated" PRs (e.g., via labels, author, or commit messages).
- Proper scoping so the harness can only modify its own repo (not the target projects unless explicitly given permission).

## Scope & Guardrails

Even though the system can open PRs on itself, the **human remains the default approver** for any meaningful change.

We should design this with clear categories over time:

- **Low risk** (e.g., minor prompt tweaks, documentation in the repo): Could eventually be auto-approved with logging.
- **Medium risk** (new skills, process changes): Requires human review.
- **High risk** (core orchestration logic, security-sensitive code, changes to decision authority): Always requires explicit human approval.

The system should be capable of proposing changes in all categories, but the approval bar is controlled by the human.

## Relationship to Other Documents

- See `SELF_IMPROVEMENT_CODE_EVOLUTION.md` for the broader vision of code-level self-improvement.
- See `PORTABILITY.md` for the external/agnostic philosophy.
- See `MULTI-PROJECT.md` for how one harness repo can manage multiple target projects.
- See `SELF_IMPROVEMENT_AND_DREAM_CYCLES.md` for the memory + background job side of self-improvement.

## Open Questions

- Should the harness repo itself have a "System Evolution" Kanban or board that surfaces self-PR proposals?
- How do we handle cases where the system wants to change its own permissions or configuration files?
- What is the minimal viable CI/CD setup the harness repo should have from day one to safely accept self-generated PRs?
- Should there be a "human-only" branch protection pattern for the most sensitive parts of the codebase?

---

This capability (own repo + ability to open PRs on itself) is now considered a foundational requirement for the long-term vision of the Project CEO Harness. All future design work on self-improvement, especially at the code level, should assume this model.