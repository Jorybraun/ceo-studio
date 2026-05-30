# Workflow: implementation-plus-dogfood-validation

**For**: Items in **In Progress** (and any builder/execution work) when the stage-map binds the card to a team that uses this workflow.

**Core Rule** (non-negotiable on PIPE-OS):

Any non-trivial implementation task **must** follow this pattern:

1. Do the implementation work (direct edits, delegation via harem, Codex lane, or whatever is fastest + highest quality).
2. **Mandatory Phase 2**: Run proper dogfood using the `dogfood` skill + real browser automation (chrome-devtools-mcp or equivalent).
3. Only mark the task complete (move to Done or Review) after the browser validation explicitly confirms the acceptance criteria are in a **done** state — not "I think it's done".

No more religious lane types or handoff signals unless you specifically want the isolation of a dedicated lane.

## Detailed Steps

### Implementation Phase
- Work against the approved assets from the upstream planning workflow (usually `discovery-planning-triage` or equivalent).
- Keep changes minimal and reviewable.
- Update docs, tests, and any living mocks as you go.
- Post visible progress + links into the domain room.

### Dogfood Validation Phase (Required Before Done)

When the implementation feels ready:

1. Create or transition the card into the validation sub-phase (or a linked validation task).
2. Load `dogfood` + `kanban-chrome-validation` (or the current equivalent skills).
3. Use only credentials from the approved e2e/ test accounts.
4. If the browser vision is blank, the app doesn't render properly, or the flow is broken → **automatic fail**. Fix the environment or the code first.
5. Exercise the actual user flow(s) the task touches.
6. For **every** Acceptance Criterion in the originating Kanban item / spec:
   - Explicitly state whether it is currently **done** or **not done**.
   - Provide direct evidence (screenshots, console output, element references, video if the tool supports it).

Only after the validation worker has produced this evidence and it is reviewed/annotated can the card move forward.

## Template (paste into validation tasks or Kanban notes)

```markdown
## Dogfood Validation Phase (Required)

**Instructions**:
- Load `dogfood` + `kanban-chrome-validation`
- Use credentials from e2e/ only
- If browser_vision is blank or the app doesn't render properly → automatic fail. Fix the environment first.
- Exercise the actual user flow the task touches.
- For every Acceptance Criterion, explicitly state whether it is currently **done** or **not done**, with direct evidence from the browser (screenshots, refs, console output).

**Specific scenarios to test**:
- [List the concrete flows from the card here]

Chrome MCP (or equivalent) validation is mandatory before calling any "complete" or "move to Done" action.
```

## Why This Exists

The previous culture of "I implemented it, it probably works, mark it done" produced too much rot. This workflow makes real usage the gate, not developer belief.

## Relationship to Other Workflows

- Usually follows a planning workflow (`discovery-planning-triage` or similar) that produced the approved assets + acceptance criteria.
- Can be used by any execution team (builders, feature squads, etc.) once the stage-map points at this workflow for the In Progress column.

## Anti-Patterns

- Marking a card Done on the strength of unit tests or manual local run only.
- Skipping the browser validation step "because it's just a small change".
- Using fake or privileged accounts that hide the real user experience.

## Success Signal

The only cards that reach Done under this workflow are ones where a real user (or realistic automated browser session) has exercised the flow and the evidence is attached and reviewed.

## References

- `skills/custom-kanban-workflows/SKILL.md` (source of the mandatory validation rule)
- The originating Kanban item and its acceptance criteria
- Current stage binding in the domain's `mgmt/stage-map.md`
