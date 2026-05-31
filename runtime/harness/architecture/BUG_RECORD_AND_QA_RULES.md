# Canonical Bug Record Template

Use this template for any bug where the internal context, implementation intent, or expected state does not match the rendered UI or observed output.

## Bug Record

- Bug ID:
- Title:
- Date discovered:
- Reporter:
- Owner:
- Status: New | Triaged | In progress | Blocked | Ready for review | Verified | Closed
- Severity: Critical | High | Medium | Low
- Priority:
- Affected surface: (screen, component, flow, API, workflow, doc, automation, etc.)
- Environment: (app version, branch/commit, browser/device/OS, profile, build/runtime)
- Related task / issue:

### Problem Summary
Short description of the mismatch between intended context and rendered UI.

### Internal Context vs Rendered UI
- Intended internal context:
- Rendered / observed state:
- Delta / mismatch:

### Reproduction Steps
1.
2.
3.
4.

### Expected Result
What should happen, based on the intended context.

### Actual Result
What actually happened in the rendered UI or output.

### Evidence
- Screenshots / screen recording:
- Console logs:
- Network logs:
- DOM / state dump:
- Relevant file or commit references:
- Other proof:

### Impact Assessment
- User impact:
- Workflow impact:
- Regression risk:
- Scope / blast radius:

### Suspected Cause
Known or likely root cause, if any.

### Resolution Plan
- Proposed fix:
- Validation needed:
- Rollback / mitigation plan, if applicable:

### Acceptance Criteria
- [ ] The rendered UI matches the intended context.
- [ ] The mismatch is no longer reproducible.
- [ ] Evidence of the fix is attached.
- [ ] The bug is reviewed and verified by the owner or reviewer.

### Resolution Status
- Not started
- Investigating
- Fixed
- Verified
- Won't fix
- Duplicate
- Deferred

### Notes
Any extra context, links, or follow-up items.

---

# Workflow Rule: Approval Policy

Approvals are not required for drafts, briefs, plans, workflow documents, research notes, or other non-destructive internal artifacts.

Approval is required before any destructive, irreversible, privileged, or external action, including but not limited to:
- deleting or overwriting important data
- changing production systems
- sending external communications
- publishing or merging changes that have user-visible impact
- performing actions that materially affect shared state, access, or permissions

Default rule:
- If the work is advisory, exploratory, or documentation-only, proceed without approval.
- If the work changes shared reality outside the draft/document boundary, request approval first.

---

# Workflow Rule: Render-State QA

A task cannot be closed until the rendered UI matches the intended internal context and there is visible proof.

Required closeout evidence:
- A rendered view or screenshot showing the final state
- Confirmation that the observed UI matches the intended spec/context
- Any relevant logs or diagnostics if the issue involved a mismatch or regression

Closure rule:
- If the UI looks correct only in code or intent but not in the rendered result, the task remains open.
- If there is no visible proof, the task remains open.
- If the rendered state diverges from the intended context, reopen or keep the task in progress until reconciled.

