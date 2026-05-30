---
name: custom-kanban-workflows
description: "Lightweight repeatable workflows for Kanban on PIPE-OS. Main rule: implementation work must be followed by real dogfood + chrome-devtools-mcp validation before any task can be marked done."
version: 0.4.0
author: PIPE-OS Harness
tags: [kanban, workflows, dogfood, validation, chrome-mcp]
related_skills: [kanban-chrome-validation, dogfood, kanban-orchestrator, pipe-os-management, kanban-codex-lane]
---

# Custom Kanban Workflows for PIPE-OS

**Core Rule (keep this simple):**

Any non-trivial implementation task must follow this pattern:

1. Do the implementation work (direct edits, delegation, Codex lane, or Grok-powered work — whatever is fastest and highest quality).
2. **Mandatory Phase 2**: Run proper dogfood using the `dogfood` skill + chrome-devtools-mcp.
3. Only mark the task complete after the browser validation explicitly confirms the acceptance criteria are in a **done** state (not "I think it's done").

No more religious lane types or handoff signals unless you specifically want the isolation of `kanban-codex-lane`.

## implementation-then-dogfood-validation (Default for real work)

Use this for features, refactors, and the RCD-INT series.

- Do the coding however makes sense (direct, delegate_task, or Codex lane when you want isolation).
- When the implementation feels ready, create or transition to the validation phase.
- The validation task must include the Dogfood Validation Phase block below.
- Validation worker must use real browser inspection. No assumptions.

## Dogfood Validation Phase Template (required in validation tasks)

```markdown
## Dogfood Validation Phase (Required)

**Instructions**:
- Load `dogfood` + `kanban-chrome-validation`
- Use credentials from e2e/ only
- If browser_vision is blank or the app doesn't render properly → automatic fail. Fix the environment first.
- Exercise the actual user flow the task touches.
- For every Acceptance Criterion, explicitly state whether it is currently **done** or **not done**, with direct evidence from the browser (screenshots, refs, console output).

**Specific scenarios to test**:
- [List concrete flows here]

Chrome MCP validation is mandatory before calling kanban_complete.
```

## Other workflows (keep minimal)

- **plan-update**: Review → update plan → create follow-up implementation tasks.
- **architecture-review**: Review → diagrams → improvement tasks.

That's it. Keep the meta low. The value is in the validation rule, not in choosing between 17 different lane types.
