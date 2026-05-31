# CEO Studio — Agent Operating Rules

Read this before touching the model/provider/chat layer. These rules exist because
the same mistake keeps getting made.

## THE CEO IS HERMES. THERE IS NO API KEY.

- The conversational **CEO is the Hermes agent** (provider `openai-codex`, authed via
  **OAuth** — funded). It is an agent in the Hermes registry, not a raw API model.
- **There is NO `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, and none is required.** Never
  wire a keyed OpenAI/Anthropic provider as the CEO. Never reintroduce
  `OPENAI_API_KEY=...` to make the CEO "work".
- All CEO chat/think paths route through the **Hermes relay**: `main/core/hermes.js`
  `ask()` → `hermes chat -q`. The renderer's chat (`window.ceo.ask` → IPC `agent:ask`)
  delegates to this relay. Voice uses the same relay.
- The Hermes CEO owns the brain/memory/soul (`~/.hermes/SOUL.md`) and tools. CEO Studio
  is a **face + cockpit** on top of it.
- `main/core/llm.js` `createProvider()` (OpenAI/Anthropic/Null) exists ONLY for the
  optional autonomous Document Agent feature — it is **not** the conversational CEO.
  Leave `CEO_MODEL_PROVIDER=null` unless that specific feature is being wired, and even
  then prefer a Hermes-backed provider over an API key.

## Models / providers (never get stuck)

- Orchestrator + workers run on **codex** (`gpt-5.3-codex`, provider `openai-codex`),
  which is funded. The orchestrator must NEVER depend on Grok.
  - `~/.hermes/profiles/kanban-orchestrator/config.yaml` → codex
  - `~/.hermes/profiles/pipe/config.yaml` (worker) → codex
- Grok (`xai-oauth`) is at most an optional worker, never the brain.

## Swarm / Kanban cockpit (how work gets done)

- Board of record: `hermes kanban` (SQLite at `~/.hermes/kanban/boards/<slug>/`).
  Main project board: `ceo-studio`.
- The gateway hosts the auto-dispatcher. When it's **stopped**, nothing auto-spawns —
  you control every spawn via `hermes kanban dispatch --max N` (use `--dry-run` first).
- Give workers a real workspace: create tasks with
  `--workspace dir:<repo>` or `--workspace worktree:<repo> --branch <name>`.
  A `scratch` task resolves to an EMPTY dir (no repo) and will waste the run.
- Safe pattern for code tasks: isolated git worktree under `.worktrees/<name>`
  (git-excluded), dispatch `--max 1`, watch (`hermes kanban log <id>`), review the diff,
  merge or discard.
- Every task body should state the architecture constraints above so workers don't
  re-make the OpenAI mistake.

## Verification

- `npm test` (core + boot + voice; no key needed).
- Confirm the CEO relay: `hermes chat -q "say hi" -Q --yolo --accept-hooks`.

## Implementation Honesty

- **NEVER mock something to pass a test** - Implement real functionality
- **NEVER cheat on completion** - Only mark done when actually implemented
- **NEVER lie about what's done** - Be honest about real vs planned vs mocked
- **ALWAYS distinguish between:**
  - Infrastructure that works (HTTP servers, communication, logging)
  - Mocked responses (fake agent responses, simulated execution)
  - Planned features (documentation, design documents)
  - Implemented features (actual working code)
- **ALWAYS be explicit about what's real vs simulated**
- **NO fake implementations that just return mock responses**
