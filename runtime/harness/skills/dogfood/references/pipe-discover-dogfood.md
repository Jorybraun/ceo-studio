# PIPE Discover Dogfood Notes

Use this for PIPE discovery / role-discovery exploratory QA.

## Baseline Checks

- Auth flow works using documented `e2e/` credentials or setup.
- Role discovery entry point is reachable after login.
- Interview starts cleanly.
- Questions are relevant to the selected role/domain.
- User answers persist across navigation/reload when persistence is expected.
- Progress, completion, and next-step states are clear.
- Generated summaries preserve raw conversational signal.
- Empty, long, and special-character answers do not break the flow.
- Console has no uncaught errors during the interview.

## Live Interview Consistency

Watch for:

- Repeated or contradictory questions.
- The app forgetting earlier answers.
- Sudden role/domain switches.
- Missing loading or save states.
- Completion state that appears before enough input was collected.

## D1 / Migration Failure Triage

If data appears missing or resets:

- Check console/network failures.
- Check documented local/dev database setup.
- Distinguish product bug from migration/setup failure.
- Log migration/setup failures separately with exact command/env evidence.

## Discover Kanban Issue Shape

Use:

```markdown
### [Severity] Title

- Category:
- Route:
- Steps:
- Expected:
- Actual:
- Evidence:
- Acceptance criteria:
  - 
```

