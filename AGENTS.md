# CEO Studio — Agent Operating Rules

Read this before touching the model/provider/chat layer, orchestration layer, or docs.

## The CEO Is Hermes. There Is No API Key.

- The conversational **CEO is the Hermes agent** (provider configured in Hermes, e.g. `xai-oauth`), authed via OAuth/funded. It is an agent in the Hermes registry, not a raw API model.
- There is **no `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` required for the conversational CEO**. Never wire a keyed OpenAI/Anthropic provider as the CEO. Never reintroduce `OPENAI_API_KEY=...` to make CEO chat work.
- All CEO chat/think paths route through the Hermes relay: `main/core/hermes.js` (`ask()` / `askCeo()`) -> `hermes chat -q`. Renderer chat (`window.ceo.ask` -> IPC `agent:ask`) delegates to this relay. Voice uses the same relay.
- The Hermes CEO owns the brain/memory/soul (`~/.hermes/SOUL.md`) and tools. CEO Studio is a face + cockpit on top of it.
- **The CEO is a unified, mountable agent.** It is registered as the `ceo` agent in `runtime/harness/agents/agents.json` (`provider: hermes`, `launch_mode: hermes_profile`, empty `profile` = the **default Hermes profile = OAuth**, `room: discovery`, `tmux_session: pipe-ceo`). So it is mountable and viewable as a tmux terminal exactly like other agents. The chat box is unified with that mounted session: `agent:ask` -> `hermes.askCeo()` runs the relay in the CEO agent's workdir and persists the rolling Hermes session id to the same state file the harness `agent_adapter` uses (`<workspace>/brain/rooms/discovery/agents/ceo.json`), so the chat box, the viewable terminal, and a programmatic `bin/agent` dispatch (provider hermes, agent `ceo`) converge on one durable CEO session. Empty profile = no `-p` flag = no API key; never give the `ceo` agent a keyed provider.
- `main/core/llm.js` `createProvider()` exists only for the optional autonomous Document Agent feature. It is not the conversational CEO. Leave `CEO_MODEL_PROVIDER=null` unless that specific feature is being wired; even then prefer a Hermes-backed provider over API keys.

## Models / Providers

- Orchestrator + workers run on the provider selected in Hermes (currently `xai-oauth` for this setup unless explicitly changed).
- Provider choice is an operational configuration decision; keep it explicit and documented when changed.
- Utility model paths must be explicitly documented as utility-only, not CEO chat.

## Mounted Agents Are Persona-Aware

- "Mounting" an agent runs `runtime/harness/bin/launch-agent --name <id>`, which starts the agent's provider CLI in a tmux session (the human-typeable "main" window) plus a persona-aware `domain-room watch` watcher window. Per the accepted tmux decision (`runtime/harness/architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`), **tmux is only the TTY/visibility adapter; the agent registry is canonical and launches are idempotent.** Do not regress that.
- The INTERACTIVE session (what a human types into) must operate in-character from its first message — not just the watcher. launch-agent seeds the persona brief (`personas.persona_preamble`) as an always-on context file (`AGENTS.md` + `CLAUDE.md`) into the agent's per-(room,agent) workdir (`<workspace>/brain/rooms/<room>/agents/<agent>/`, git-ignored) and launches the external CLI in that workdir, so cwd-aware CLIs (devin/claude) load it as always-on context. The mechanism + helpers live in `runtime/harness/agents/personas.py` (`agent_context_markdown`, `seed_agent_context`).
- This complements the existing programmatic path (`agent_adapter.converse`/`dispatch`), which already prepends `persona_preamble` on the first turn.

## Swarm / Kanban Cockpit

- Board of record: `hermes kanban` (SQLite at `~/.hermes/kanban/boards/<slug>/`). Main project board: `ceo-studio`.
- The gateway hosts the auto-dispatcher. When it is stopped, nothing auto-spawns; control spawns via `hermes kanban dispatch --max N` and use `--dry-run` first.
- Give workers a real workspace: create tasks with `--workspace dir:<repo>` or `--workspace worktree:<repo> --branch <name>`. A `scratch` task resolves to an empty directory and wastes the run.
- Safe pattern for code tasks: isolated git worktree under `.worktrees/<name>` (git-excluded), dispatch `--max 1`, watch (`hermes kanban log <id>`), review the diff, merge or discard.
- Every task body should state architecture constraints so workers do not re-make the API-key CEO mistake.

## Conversational Brief Intake (typed + voice parity)

- A **brief** is the canonical work object: a `[Brief]` Hermes Kanban task with 7 required fields (title, goal, domain, currentRenderedState, problemMismatch, acceptanceCriteria, nextAction). Creation is gated by `domainBoard.createBrief` (IPC `domain_board:create_brief`); it also writes the durable Brief Run. This is the ONLY enforced creation path — never bypass it with a raw `hermes kanban` task for briefs.
- **Both the voice agent and the text chat box can create + decompose briefs conversationally.** Voice uses the ElevenLabs `create_brief` client tool. The typed CEO chat box uses the **Brief Builder** (`renderer/brief-builder.js`), hooked into `runTurn()` via `maybeHandle()`: type "create a brief …" (or use `+ → New brief`) and it runs draft → review → create → optional decompose, reusing the same IPC (`briefIntakeDraft`, `createBrief`, `proposeBriefDecomposition`, `applyBriefDecomposition`).
- Drafting the 7 fields from free text is Hermes-backed and deterministic to parse: `main/core/brief-intake.js` (`draftBrief` + pure `parseBriefDraft`/`missingFields`, mirroring `domain-board` required fields). It only drafts for human review; the renderer confirms before `createBrief`. Keep the missing-field rule in `brief-intake.js` in sync with `domain-board.missingBriefFields`.

## Autonomy Runner (self-driving swarm)

- `main/core/autonomy-runner.js` is the self-driving loop. Per cycle, per board: goal review + blocked analysis → decompose planning briefs → assign unassigned work to the owning registry agent (`orchestration-org`) → execute ready work with real **Devin `swe-1.6`** workers → strong review/test gate. Drive it from inside the app (`window.ceo.runnerStart/runnerStatus/runnerRunOnce/runnerStop/runnerConfigure`) or via `npm run autonomy:dry-run|once|start`.
- **The CEO owns agent lifecycle, not only delegation.** A handoff or delegation request is incomplete until CEO Studio promotes the work, dispatches the selected registry agent, monitors the live worker, reviews/integrates evidence, routes failures into repair, and advances the board. The CEO should continue the loop autonomously until the goal is verified or a concrete human-only decision is required.
- **Execution is the Devin CLI, run directly** (`devin --model <model> -p`). Do NOT try to make a Hermes profile-worker run Devin — Hermes has no Devin model provider. The Hermes board stays the source of truth for lanes/claiming/comments.
- **Worker model / cost control:** each worker runs `agent.model` (registry, default `swe-1.6`). `policy.modelOverride`, when set, forces the WHOLE swarm onto one model regardless of registry — set it to a promo/cheap model (e.g. `adaptive-promo`, from `runtime/harness/models/catalog.json`) to keep autonomy off paid `swe-1.6` credits. Promo models can expire; confirm the id is still live before relying on it.
- **Worktree isolation is mandatory for workers**: each worker runs in `.worktrees/<board>-<task>` on branch `auto/<board>-<task>` off HEAD, so concurrent workers never corrupt each other or the (often dirty) main tree. `.worktrees/` is git-ignored. The review gate verifies inside the worktree, then LANDS the work per `policy.integrationMode`: `"merge"` (default) fast-forward-merges into the local main checkout on green; `"pr"` (the **merge-manager**) pushes the verified branch and opens a GitHub PR via `gh`, promoting the task to Done only once that PR actually merges. Either way a branch that cannot integrate cleanly stays blocked for a human/orchestrator merge rather than being silently orphaned.
- **Nothing reaches Done without passing `npm run check` + `npm test`.** A failing gate blocks the task and files a self-repair bug. Never weaken this gate or fake a pass.
- **A2A**: the Devin config ships the `hermes` (Kanban) + `gbrain` MCP servers; workers read the live board, see sibling workers (roster injected into the prompt + published to `<brain>/autonomy/runner/swarm.json`), and coordinate via Kanban comments. Headcount is capped: `maxConcurrentWorkers` defaults to a finite ceiling (`3`) and `maxDispatchPerCycle` to `3`. `0` means unlimited but is an **explicit opt-in only** — the default must never be unlimited, because an unconfigured runner defaulting to unlimited concurrency is how a runaway self-repair loop burned a large amount of spend.
- **Self-repair $-spiral guard (mandatory):** a failed worker can file a repair task that is dispatched to another paid worker. If repairs are unbounded, a repair-of-a-repair on an unsatisfiable gate (e.g. a browser-E2E acceptance gate no headless `devin -p` worker can pass) loops forever and burns money. The runner tags each auto-generated repair task with its generation (`state.repairChains`) and, once a failing task reaches `policy.maxRepairGenerations` (default `1`), **escalates to a human/CEO decision (task left blocked) instead of dispatching another worker.** This applies to all three failure sites (reap acceptance gate, review integration conflict, review test gate). Never remove this cap or set it unbounded by default. Newly spawned workers are persisted to `workers.json` immediately so a crash/restart cannot leak an unreapable runaway worker.
- **Human-required gate:** tasks a headless `devin -p` worker can never verify (a real phone call, two-way device audio, on-device Siri/App-Intents, a manual dogfood pass, device/browser E2E) must be listed in `policy.humanRequiredTaskIds` or carry a `[human-required]` marker in their title/body. The EXECUTE phase **skips** these — escalates once with a comment, never dispatches a worker, and leaves them in their lane (NOT auto-blocked, so the unblocker never grabs them) — so they never start the failure→repair spiral in the first place. Dispatching paid workers at unsatisfiable acceptance gates is exactly what produced ~80% self-generated meta-task noise on the boards.
- **Unblocker recursion guard (mandatory):** the blocked-lane unblocker (`main/core/unblocker.js`) creates a child clarify/CEO-decision/`[Unblock]` task for a blocked item. If that meta-task later blocks, the naive behavior creates *another* clarify layer — the `Clarify blocker for [Clarify blocker for …]` nesting that fanned a swarm of paid workers over the same dead end. `isUnblockMetaTask()` detects an unblocker-generated meta-task and, when one is itself blocked, **escalates it to a human decision (no new child task) instead of recursing.** This is the clarify-chain companion to the repair-generation cap above.
- **Oversight report (no silent abandonment):** `autonomy-runner.report()` (CLI `npm run autonomy:report`; IPC `runner:report` → `window.ceo.runnerReport()`) is the read-only inventory of every task's true disposition by cross-referencing the board, the runner state, the live worker roster, and git: `live`, `open-pr`, `in-review`, `needs-human` (repair-cap escalation or human-required), `delivered`, `stranded`, `blocked`, and the standout alarm **`diverged`** — the board says `done` but the task's `auto/*` branch never reached the base branch. This surface exists because the runner's merge-on-green / block-on-red logic previously had no "completed-but-unlanded" view, so ~17 lanes were silently abandoned. Spawns nothing; safe to run anytime.
- Execution/repair registry agents (builder, planner, architect, self-repair-engineer, docs-steward, pm, ba, …) are mapped to `provider: devin`, `model: swe-1.6`, `dispatch_profile: devin` in `runtime/harness/agents/agents.json`. The Critical System design-placeholder agents (domain-architect/agenda-agent/ba-document-guard) keep their own providers.

## Documentation Handoff (Mandatory)

Any agent or human changing behavior, architecture, routing, provider setup, IPC tools, voice tools, autonomy, or registry/org structure must do a docs pass before handoff.

The passoff contract:

1. Identify which docs are authoritative for the change.
2. Update those docs in the same change.
3. If the change introduces or renames an agent/tool/workflow, update the registry and any relevant skill/persona docs.
4. Run `npm run docs:check` or `npm run check`.
5. If docs are intentionally not updated, leave a visible reason in the final handoff.

The dedicated docs owner is `docs-steward` in `runtime/harness/agents/agents.json`, using `runtime/harness/personas/general/docs-steward.md` and `runtime/harness/skills/docs-steward/SKILL.md`.

## Verification

- `npm run check` (syntax + docs handoff gate).
- `npm test` (core + boot + voice + AGUI; no CEO key needed).
- Confirm the CEO relay when changing Hermes chat behavior: `hermes chat -q "say hi" -Q --yolo --accept-hooks`.

## Implementation Honesty

- **Never mock something to pass a test**; implement real functionality.
- **Never cheat on completion**; mark done only when actually implemented.
- **Never lie about what is done**; distinguish real vs planned vs mocked.
- Always distinguish:
  - Infrastructure that works (HTTP servers, communication, logging)
  - Mocked responses (fake agent responses, simulated execution)
  - Planned features (documentation, design documents)
  - Implemented features (actual working code)
- Be explicit about real vs simulated behavior.
- No fake implementations that just return mock responses.
