# CEO Studio

**An agnostic desktop app + cost-guarded agent runtime that lets a human steer an AI "Project CEO" — growing from a single Document Agent into a manager that orchestrates domain-based agent swarms.**

CEO Studio is the runtime + UI + guardrail layer that realizes the vision already designed in `PIPE-OS/harness/`. It does not reinvent that strategy; it makes it executable and safe.

---

## Source of truth (read these first, in order)

1. **`NORTH_STAR.md`** — the vision, the relationship to `harness/`, non-negotiable principles, and the L0→L4 capability ladder. *(why / where)*
2. **`E2E_PLAN.md`** — the concrete, sequenced build plan: the Brain (context/memory) contract, the cost-guardrail system, level-by-level scope, milestones M0→M4, repo shape. *(what / when / how)*
3. **`runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md`** — current implemented domain-board, bug, goal, provenance, autonomy, self-repair, and orchestration-org model. *(current autonomy reality)*
4. **`runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`** — docs passoff rules and the `docs-steward` agent/skill. *(how docs stay current)*
5. **Domain lifecycle specs** (now owned inside the domain at `domains/domain-lifecycle/docs/design/`): the 7 core docs + personas. These represent the June 2026 design discussion that defined how domains are created, kept healthy, and triaged. *(domain model & agent roles evolution)*

If anything elsewhere contradicts these documents, update the stale doc rather than letting drift accumulate.

## Current status

**CEO Studio is beyond the original M0 shell.** The app mounts projects, detects domains, initializes the per-project Brain, enforces the cost meter + kill switch, and routes conversational CEO chat through Hermes (`main/core/hermes.js` -> `hermes chat -q`). The cockpit now includes Hermes Kanban board/task views, domain-board brief and bug intake, provenance, layered goals, deterministic goal reviews, conservative autonomy cycles, blocked-lane escalation, self-repair bug intake, a dedicated `self-repair-engineer` handoff path, orchestration org routing, live voice tools, and docs-steward handoff checks.

The optional `DocumentAgent`/`LLMProvider` path still exists for document-agent experiments. It is not the conversational CEO and must not replace the Hermes CEO relay.

### Run it
```bash
cd CEO_STUDIO
npm install
npm start        # launches the Electron app
npm run start:debug # launches with CDP on localhost:9222 for Chrome/Electron MCP debugging
npm run smoke:electron # tests the running debug app through the CDP/MCP transport
npm run qa:self  # self-QA pass: CDP scenarios + bug-lane logging for findings
npm test         # core + headless main-process tests (no API key needed)
npm run check    # syntax + docs stewardship gate
npm run docs:check

# Autonomy runner (the self-driving swarm): primary surface is in-app
# (window.ceo.runnerStart/runnerStatus/...), CLI fallback below.
npm run autonomy:dry-run   # one cycle: plan/assign/review decisions, NO spend, NO board mutations
npm run autonomy:once      # one live cycle, capped to 1 Devin worker
npm run autonomy:start     # loop on the policy interval (Devin swe-1.6 workers)
```

### Autonomy runner (self-driving swarm)

`main/core/autonomy-runner.js` makes the Kanban board move itself: each cycle it
reviews goals, **decomposes** planning briefs, **assigns** unassigned work to the
owning registry agent (via `orchestration-org`), **executes** ready work by
spawning real **Devin `swe-1.6`** workers (each in an isolated git worktree on its
own `auto/<board>-<task>` branch), and runs a **strong review/test gate** —
nothing reaches Done until `npm run check` + `npm test` pass, after which the
branch is fast-forward-merged. Failures block the task and file a self-repair bug.
Workers are swarm-aware (A2A): the Devin config ships the `hermes` (Kanban) and
`gbrain` MCP servers, so every worker reads the live board, sees its siblings, and
coordinates via Kanban comments. Headcount is orchestrator-driven
(`maxConcurrentWorkers: 0` = unlimited). See
`runtime/harness/architecture/AUTONOMY_RUNNER_PLAN.md`.

`npm start` now verifies the Hermes gateway during app startup. `npm run start:debug` sets `CEO_STUDIO_REMOTE_DEBUG_PORT=9222`, which lets Chrome DevTools MCP attach to the running Electron renderer. With the debug app running, `npm run smoke:electron` verifies the renderer preload bridge, Hermes CEO status, project opening, orchestration org routing, autonomy status, board columns, and brief/bug intake contracts through that same transport. `npm run qa:self` goes further: it runs named self-QA scenarios, saves `dogfood-output/self-qa/report.md`, creates/updates the roadmap goal "Make CEO Studio self-QA to a functional state", and files new confirmed failures to the `ceo-studio` bug lane. The separate `electron-debug-mcp` server can also launch Electron itself with a debug port, but CEO Studio does not require it for normal startup.

### Optional utility/document-agent model config
```bash
export CEO_MODEL_PROVIDER=null        # default; conversational CEO still uses Hermes
# cost caps (defaults $5 session / $20 day):
export CEO_MAX_SESSION_USD=5 CEO_MAX_DAY_USD=20
npm start
```

### M0 layout (built)
```
main/
  index.js              # Electron main + IPC
  preload.js            # safe IPC bridge (contextIsolation)
  core/
    paths.js            # per-project ~/.ceo-studio/<slug>/ storage
    projects.js         # mount any folder + domain detection + registry
    brain.js            # context/memory: artifact contract + JSONL indexes
    cost.js             # CostMeter: hard caps + kill switch + per-call ledger
    hermes.js           # Hermes CEO relay (conversational CEO)
    llm.js              # optional model-agnostic LLMProvider for document-agent utilities
    domain-board.js     # enforced brief/bug/child-task intake
    provenance.js       # brief/task/bug/asset relationship graph
    goals.js            # daily/weekly/monthly/quarterly/roadmap goals
    autonomy*.js        # goal review + blocked analysis + conservative scheduler
    orchestration-org.js # lane -> team/workflow/persona routing model
    agent.js            # Document Agent (M1 entry point), cost-gated
renderer/               # switchers + red presence circle + 2 panels + live meter
runtime/harness/         # skills, personas, teams, workflows, architecture docs
scripts/docs-check.js    # docs handoff gate
test/                   # core + boot + voice + AGUI checks
```

Autonomous work remains conservative: reviews and blocked analysis can write artifacts/comments, but automatic task creation still requires an explicit planner/CEO path until promotion policy is defined.

## Document map

| Doc | Role | Status |
|---|---|---|
| `NORTH_STAR.md` | Vision + capability ladder | **Source of truth** |
| `E2E_PLAN.md` | End-to-end build plan | **Source of truth** |
| `DOMAIN_DESIGN.md` | UI/runtime design notes (L0/L3 mechanics: Electron, panels, agent-controlled rendering) | Design notes — subordinate to the plan |
| `NEXT_STEPS.md` | Concrete L0/L1 implementation scaffolding (code snippets) | Design notes — subordinate to the plan |
| `runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md` | Current domain-board/autonomy/org-routing implementation | **Current source of truth for autonomy work** |
| `runtime/harness/architecture/AUTONOMY_RUNNER_PLAN.md` | Plan for persistent herder/autonomy runner and truthful command surface | Active plan |
| `runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md` | Docs steward agent/skill and handoff gate | **Current source of truth for docs upkeep** |
| `domains/domain-lifecycle/docs/design/*.md` + `docs/personas/` | Domain lifecycle design history (June 2026): creation process, handoff protocol, critical agents, scoping, terminology, recursive linking | **Canonical home inside the Domain Lifecycle domain** |
| `EXTERNAL_INTEGRATIONS.md` | How we reuse `harness/` skills + patterns | Partially stale — see banner |
| `ARCHITECTURE.md` | Earlier architecture draft | **Superseded** by `E2E_PLAN.md` |
| `SUMMARY.md` | Earlier executive summary | **Superseded** by `NORTH_STAR.md` |

## For a Devin (cloud agent) picking this up

See the **"Implementation notes for Devin"** section at the end of `E2E_PLAN.md`. The plan is written to be implementable by a cloud agent on any model: tasks are self-contained, reference files by relative path, and each level has explicit exit criteria. Start at milestone **M0**.

A related cleanup task for the *existing* swarm runtime lives at `../PIPE/PIPE-OS/harness/SWARM_ISSUES.md`.
