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

## Autonomy Runner (self-driving swarm)

- `main/core/autonomy-runner.js` is the self-driving loop. Per cycle, per board: goal review + blocked analysis → decompose planning briefs → assign unassigned work to the owning registry agent (`orchestration-org`) → execute ready work with real **Devin `swe-1.6`** workers → strong review/test gate. Drive it from inside the app (`window.ceo.runnerStart/runnerStatus/runnerRunOnce/runnerStop/runnerConfigure`) or via `npm run autonomy:dry-run|once|start`.
- **Execution is the Devin CLI, run directly** (`devin --model swe-1.6 -p`). Do NOT try to make a Hermes profile-worker run Devin — Hermes has no Devin model provider. The Hermes board stays the source of truth for lanes/claiming/comments.
- **Worktree isolation is mandatory for workers**: each worker runs in `.worktrees/<board>-<task>` on branch `auto/<board>-<task>` off HEAD, so concurrent workers never corrupt each other or the (often dirty) main tree. `.worktrees/` is git-ignored. The review gate verifies inside the worktree and only fast-forward-merges on green; conflicts stay in review for a human/orchestrator merge.
- **Nothing reaches Done without passing `npm run check` + `npm test`.** A failing gate blocks the task and files a self-repair bug. Never weaken this gate or fake a pass.
- **A2A**: the Devin config ships the `hermes` (Kanban) + `gbrain` MCP servers; workers read the live board, see sibling workers (roster injected into the prompt + published to `<brain>/autonomy/runner/swarm.json`), and coordinate via Kanban comments. Headcount is orchestrator-driven (`maxConcurrentWorkers: 0` = unlimited).
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
