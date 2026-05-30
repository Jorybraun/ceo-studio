# CEO Studio

**An agnostic desktop app + cost-guarded agent runtime that lets a human steer an AI "Project CEO" — growing from a single Document Agent into a manager that orchestrates domain-based agent swarms.**

CEO Studio is the runtime + UI + guardrail layer that realizes the vision already designed in `PIPE-OS/harness/`. It does not reinvent that strategy; it makes it executable and safe.

---

## Source of truth (read these first, in order)

1. **`NORTH_STAR.md`** — the vision, the relationship to `harness/`, non-negotiable principles, and the L0→L4 capability ladder. *(why / where)*
2. **`E2E_PLAN.md`** — the concrete, sequenced build plan: the Brain (context/memory) contract, the cost-guardrail system, level-by-level scope, milestones M0→M4, repo shape. *(what / when / how)*

If anything elsewhere contradicts these two documents, **these two win.** Update them rather than letting docs drift (that drift is the exact problem this tool exists to kill).

## Current status

**M0 (L0 foundation) is built and verified.** The agnostic Electron app mounts any project, detects domains, initializes a per-project Brain, and enforces the cost meter + hard caps + kill switch. The model-agnostic `LLMProvider` and the **Document Agent (M1) entry point** are wired and run offline with a `NullProvider`. Next: turn M1 "real" (configure a model + implement contradiction scanning and autonomous doc-edit commits).

### Run it
```bash
cd CEO_STUDIO
npm install
npm start        # launches the Electron app
npm test         # core + headless main-process tests (no API key needed)
```

### Make M1 real (optional, needs a key)
```bash
export CEO_MODEL_PROVIDER=anthropic   # or openai
export ANTHROPIC_API_KEY=...          # or OPENAI_API_KEY
export CEO_MODEL=claude-sonnet        # optional
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
    llm.js              # model-agnostic LLMProvider (null/openai/anthropic)
    agent.js            # Document Agent (M1 entry point), cost-gated
renderer/               # switchers + red presence circle + 2 panels + live meter
test/                   # core.test.js + main.boot.test.js (20 + 7 checks)
```

Everything past M1 is gated on the Document Agent proving it is trustworthy and cheap.

## Document map

| Doc | Role | Status |
|---|---|---|
| `NORTH_STAR.md` | Vision + capability ladder | **Source of truth** |
| `E2E_PLAN.md` | End-to-end build plan | **Source of truth** |
| `DOMAIN_DESIGN.md` | UI/runtime design notes (L0/L3 mechanics: Electron, panels, agent-controlled rendering) | Design notes — subordinate to the plan |
| `NEXT_STEPS.md` | Concrete L0/L1 implementation scaffolding (code snippets) | Design notes — subordinate to the plan |
| `EXTERNAL_INTEGRATIONS.md` | How we reuse `harness/` skills + patterns | Partially stale — see banner |
| `ARCHITECTURE.md` | Earlier architecture draft | **Superseded** by `E2E_PLAN.md` |
| `SUMMARY.md` | Earlier executive summary | **Superseded** by `NORTH_STAR.md` |

## For a Devin (cloud agent) picking this up

See the **"Implementation notes for Devin"** section at the end of `E2E_PLAN.md`. The plan is written to be implementable by a cloud agent on any model: tasks are self-contained, reference files by relative path, and each level has explicit exit criteria. Start at milestone **M0**.

A related cleanup task for the *existing* swarm runtime lives at `../PIPE/PIPE-OS/harness/SWARM_ISSUES.md`.
