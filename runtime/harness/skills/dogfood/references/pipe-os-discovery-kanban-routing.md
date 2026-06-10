# PIPE-OS Discovery Kanban Routing

Use this when the user asks to log discovery or role-discovery dogfood findings
to Kanban.

## Routing Rule

1. Check the project-domain markdown board first:
   - `harness/context/discovery-team/mgmt/kanban.md`
   - `context/discovery-team/mgmt/kanban.md`
   - any project-local documented discovery board path.
2. Do not assume there is a Hermes SQLite board named `discovery`.
3. If the SQLite board is unavailable or corrupt, still log confirmed findings
   to the discovery markdown board.
4. Treat the SQLite board repair as a separate infrastructure bug.

## Finding Shape

Each logged issue should include:

- Title: concise user-visible failure.
- Severity/category.
- URL or route.
- Reproduction steps from Chrome MCP/CDP.
- Expected behavior.
- Actual behavior.
- Evidence:
  - screenshot path
  - console/network errors
  - relevant DOM/app state
- Acceptance criteria:
  - fix behavior
  - add or update regression coverage
  - validate in Chrome MCP/CDP

## Recommended Lane

- Confirmed product defect: Bug / Triage.
- Missing requirement or ambiguous behavior: Planning / Discovery.
- Broken test infra or corrupted board: Engineering bug, linked back to the
  discovery finding.

