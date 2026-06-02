---
name: dogfood
description: "Systematic exploratory QA of web apps using Chrome DevTools MCP, Electron CDP, or the closest available browser automation transport. Use to find bugs, capture evidence, and produce a structured dogfood report."
version: 1.1.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [qa, testing, chrome-mcp, cdp, browser, web, dogfood]
    related_skills: []
---

# Dogfood: Chrome MCP Web QA

Use this skill for exploratory QA of web apps, Electron apps with a debug port,
and authenticated product flows. The goal is not a shallow smoke test; it is a
bug-finding pass with reproducible evidence.

## Inputs

Get or infer:

1. Target URL or Electron CDP endpoint.
2. Scope: feature area, user flow, or "full site".
3. Output directory, default `./dogfood-output`.

If credentials are needed, inspect project `e2e/` docs first. Do not stop just
because `E2E_EMAIL` / `E2E_PASSWORD` are missing from env when test credentials
are documented in the repo.

## Preferred Tooling

Prefer Chrome DevTools MCP connected to the real browser or app:

- Web app: launch/attach Chrome MCP to the target browser.
- Electron app: launch with remote debugging, for CEO Studio use:
  - `npm run start:debug`
  - `npm run smoke:electron`
  - CDP endpoint: `http://127.0.0.1:9222`

Use the available Chrome MCP/CDP equivalents for:

- Navigate/open page.
- Take DOM/accessibility snapshot.
- Read console messages and page errors.
- Click/type/press/scroll.
- Evaluate JavaScript for app state only when UI inspection is insufficient.
- Capture screenshots for evidence.

If Chrome MCP is unavailable, use the closest browser automation tool available
in the environment, but keep the same evidence standard.

## Workflow

### Phase 1: Plan

Create:

```text
{output_dir}/
  screenshots/
  report.md
```

Build a compact test map:

- Landing/home and navigation.
- Authenticated entry if in scope.
- Primary user flows.
- Forms, validation, empty states, loading/error states.
- Responsive or overflow-prone surfaces.
- Known risky areas from recent code changes.

### Phase 2: Explore

For each page or feature:

1. Navigate to the page.
2. Capture DOM/accessibility snapshot.
3. Check console errors immediately after navigation.
4. Capture screenshot or visual observation.
5. Exercise interactive elements:
   - Links, buttons, tabs, menus, modals.
   - Form valid/invalid/empty submission.
   - Keyboard `Tab` / `Enter` where relevant.
   - Scroll and below-the-fold content.
   - Rapid or repeated clicks for fragile controls.
6. After every meaningful interaction, check:
   - Console errors.
   - URL/state changes.
   - Expected vs actual UI behavior.

### Phase 3: Collect Evidence

For each issue, record:

- URL.
- Environment/viewport when relevant.
- Reproduction steps.
- Expected behavior.
- Actual behavior.
- Console errors or network failures.
- Screenshot path under `{output_dir}/screenshots/`.

Classify using `references/issue-taxonomy.md`.

### Phase 4: Categorize

De-duplicate issues, assign final severity/category, and sort by severity:
Critical, High, Medium, Low.

### Phase 5: Report

Write `{output_dir}/report.md` using
`templates/dogfood-report-template.md`.

Include:

- Executive summary and issue counts.
- Summary table.
- Per-issue steps, expected/actual, console errors, and screenshot references.
- Testing notes: tested, not tested, blockers, tool limitations.

Use `MEDIA:<screenshot_path>` for inline evidence references.

## Chrome MCP / CDP Notes

- Always check console output after navigation and significant interactions.
- Prefer UI-level actions over direct JavaScript mutation.
- Use JavaScript evaluation to inspect state, local storage, route state, or app
  APIs when UI evidence is ambiguous.
- For Electron, verify the preload/API bridge as part of app-smartness checks.
  In CEO Studio this means checking `window.ceo`, project open, registry/model
  APIs, and relevant IPC paths through the renderer.
- If screenshots are blank on WebGL/canvas-heavy pages, do not auto-fail the
  pass. Cross-check with DOM snapshot, console, pixel/canvas checks, and app
  state. Note the capture limitation in the report.

## PIPE-OS / Discovery Routing

When dogfooding PIPE discovery or role-discovery:

- Read `e2e/` first for auth/test account flow.
- Read `references/pipe-discover-dogfood.md` for expected checkpoints.
- If asked to log findings to Kanban, first inspect the discovery markdown board
  before assuming a Hermes SQLite board named `discovery`.
- Use the issue shape in `references/pipe-os-discovery-kanban-routing.md`.

