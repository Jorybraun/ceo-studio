# Dogfood Issue Taxonomy

## Severity

Critical:
- Data loss, security exposure, unavailable app, payment/auth dead end, or a
  primary user flow cannot complete.

High:
- Major feature broken, authenticated flow unreliable, incorrect persistence, or
  user can complete only with a non-obvious workaround.

Medium:
- Secondary feature broken, confusing validation, visual overlap that affects
  use, accessibility issue with clear user impact, or recurring console errors.

Low:
- Cosmetic issue, minor copy/content problem, harmless console warning, or polish
  issue that does not block the flow.

## Categories

Functional:
- Wrong behavior, broken interaction, failed persistence, broken route, bad state.

Visual:
- Layout overlap, clipping, overflow, broken image, inconsistent spacing, poor
  responsive rendering.

Accessibility:
- Keyboard trap, missing focus state, inaccessible labels, contrast problem,
  modal focus issue.

Console:
- JavaScript error, unhandled promise rejection, failed resource, noisy repeated
  warning with user-visible risk.

UX:
- Confusing flow, unclear state, missing feedback, destructive action ambiguity.

Content:
- Incorrect text, stale instructions, typo that changes meaning, wrong metadata.

