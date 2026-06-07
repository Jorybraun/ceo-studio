# Plan — Greenfield Agent-Driven, Mount-First Cockpit Rebuild

**Status:** Draft for CEO/architect decision · **Owner:** PM · **Type:** Rebuild brief + build prompt
**Scope:** core-4 only (sessions, tasks, agents, personas) · **Not a port** (greenfield, do not clone the old app)

---

## 1. BRIEF (PM coordination format)

**Board (of record):** `ceo-studio` (Hermes Kanban).
> Honesty note: this brief was authored without live board access, so there is no linked task ID yet and existing related tasks were not verified. Close this gap before dispatch.

**Domain context:** Touches the **studio/cockpit** surface + the **harness** (mount, agent registry, personas) + **voice**. The intelligence is **external** and stays: Hermes (CEO, OAuth, no key) + the Python harness + the devin/hermes CLIs. This app is only the cockpit.

**Current rendered state:**
> Described from code, not from observing the UI (PM has no render access).

Today: an Electron cockpit where agent-driven UI is **partial** (AG-UI renders into a *left panel* only), mounting agents is a **bolted-on** terminal view, and most surface area (channels, kanban UI, convai/ElevenLabs, domains, autonomy panels) is throwaway. The agent→UI render loop, the unified durable CEO session, and agent-launching all already exist in pieces.

**Problem / mismatch:** The product wants the **agent as the full UI driver** and **mount as the founding primitive** — but the current app has agent-UI as a side panel and mount as an afterthought, buried under bloat. Refactoring toward the vision is slower than a sharp greenfield because most code would be deleted and the requirements are now clear.

**Constraints (hard):**
- No-API-key CEO; all think paths via the Hermes relay (`hermes chat -q` / durable session).
- **Hybrid control** (anti-lag): agent owns structure/content/decisions; surface owns instant local interaction.
- **Safety/cost is foundational**: kill switch + cost guard wrap every agent-initiated action; cap concurrent mounts. (Runaway cost is the threat this project exists to prevent.)
- One durable session = three synced views (surface / terminal / chat).
- Registry discipline: small composable vocabulary + graceful fallback.
- No ElevenLabs / no paid STT-TTS. Siri via free Shortcuts.
- core-4 only. Do **not** clone old screens.

**Acceptance criteria:** see Definition of Done in the build prompt below.

**Open decision blocking full dispatch:** the **stack** — A (cross-platform web/Electron, recommended), B (native Swift, Apple-first), or B-lite (A + Swift Siri companion).

**Dispatch decision:** **NOT READY — needs one clarification (stack)** + a linked board task. Everything else is specified. Once the stack is set, dispatch as a **phased** build to a builder/Devin worker (isolated worktree, `npm run check` + `npm test` gate).

---

## 2. E2E RISKS OF A FULL REBUILD (eyes open)

1. **Rewrite trap / second-system effect.** Rebuilds stall before usefulness, and greenfield invites over-ambition. Mitigation: hard scope discipline (core-4 only), enforced.
2. **Implicit brain contract + hard-won lessons.** The old code encodes the 120s CEO timeout, `sessionMiss` retry, friendly error mapping, AGUI fenced-block parsing, durable-session persistence. Extract the contract + lessons before building.
3. **Latency UX is a design problem.** Agent-drives-everything + 6–120s turns ⇒ must separate instant local interaction from slow agent decisions from day one (hybrid control).
4. **Safety + cost is foundational.** An agent with full UI control that can launch agents can spawn runaway cost. Kill switch, cost guard, mount caps from the first commit.
5. **Testing agent-authored UI.** Screens are generated; need contract tests on registry + event channel + brain seams, plus golden intent→UI tests.
6. **Mount-as-primitive risk depends on stack.** PTY + terminal emulator + multiplexing is mature on web (node-pty/xterm), less so on native Swift (SwiftTerm).
7. **Siri e2e is more than a Shortcut.** Shortcuts time out (~10–60s) vs long turns ⇒ async/streaming; iPhone can’t reach localhost ⇒ stable port + LAN/Tailscale + auth.
8. **Migration continuity.** Old app is under active dev; expect parallel maintenance or a cutover feature gap.

---

## 3. BUILD PROMPT (with features)

> Self-contained spec for a builder/Devin worker. Encodes architecture constraints so a worker won’t re-make the API-key-CEO mistake. Set the **stack** before dispatch.

````text
BUILD TASK: Greenfield "agent-driven, mount-first" cockpit (NOT a port)

Build a NEW desktop app from scratch. Do NOT clone or port the existing CEO Studio
renderer/main code. Re-derive a SMALL, sharp app from the vision + features below.
Reuse ONLY: (a) the external "brain" it talks to, (b) the AG-UI client library.
Use the old repo as a reference for the CONTRACT, never as code to copy.

## VISION — TWO NON-NEGOTIABLE PILLARS
1. AGENT IS THE FULL UI DRIVER. The app is a generic render surface. The mounted agent
   emits the ENTIRE UI (nav, layout, forms, content) as an AG-UI component tree; the app
   renders it from a component registry and sends user events back. NO hand-built screens
   the agent can't drive. If a human sees it, an agent authored it.
2. MOUNT IS THE FOUNDING PRIMITIVE. The surface IS a mount of an agent session. The
   driving agent is itself mountable, viewable as a raw terminal, and typeable. The AG-UI
   surface, the raw terminal, and the chat are THREE VIEWS OF ONE durable session.
   Launching an agent = mounting it. Orchestration = mounting + routing between mounts.

## SCOPE — CORE-4 ONLY
sessions, tasks, agents, personas. No channels, no kanban UI, no ElevenLabs, no domains
clone. Anything else must be re-derived as an agent-driven component, not ported.

## ──────────────── FEATURES ────────────────

### A. AGENT-DRIVEN UI (the spine)
- Component registry: a SMALL, composable core vocabulary (layout/container, nav, text,
  markdown, form + inputs, list, table, card, code, terminal-embed, mount-tile, action
  button). Unknown types render as a labelled fallback — never crash.
- Render loop: agent emits a fenced ```agui {json}``` UI tree -> parse -> validate ->
  mount as shared state; prose outside the block streams as assistant text.
- Bidirectional event channel: user interactions (click, submit, select, navigate) post
  structured events back into the driving agent's session as the next turn's input.
- Streaming + hybrid control: stream tokens; show skeleton/loading/progress while the
  agent thinks (6-120s). Local interactions (scroll/focus/optimistic state) NEVER block
  on the agent.

### B. MOUNT (the primitive)
- Mount an agent = spawn its provider CLI in a PTY via the harness `launch-agent --name
  <id>`; the persona is seeded by the harness on launch (do not reimplement seeding).
- Raw terminal view per mount (full xterm-class emulator); user can type directly.
- Multiplex many concurrent mounts; mount lifecycle = start / observe / kill / restart.
- One durable session per agent; surface + terminal + chat stay in sync and survive an
  app restart (resume the persisted session id).
- Swap which mounted agent drives the surface.

### C. AGENTS (registry + orchestration)
- Read the declarative registry (agents.json); agents are config, not code.
- Roster: which agents exist, which are mounted, their provider/persona/room/status —
  itself rendered by an agent, not a hardcoded screen.
- Agent-launches-agent: a mounted agent can mount another agent (orchestration); the new
  mount appears as an agent-rendered surface with a viewable terminal.
- Route/handoff between mounts (the driver can delegate a turn to another agent).

### D. SESSIONS
- Create / resume / switch working sessions, each bound to an agent (+ room).
- One durable rolling session id (shared across the three views); persist + resume.
- Transcript/history per session; reopen restores state.

### E. TASKS
- Lightweight task list (create / update / complete), rendered as agent-driven components.
- Back it with the existing Hermes Kanban store (thin view) OR a local store — pick one,
  state the choice. Do NOT rebuild a full kanban UI.
- Dispatch a task to an agent = mount/route to that agent with the task as context.

### F. PERSONAS
- Persona applied at mount-time by the harness; show which persona an agent runs.
- Pick a persona when mounting (from the persona library); no bespoke persona editor.

### G. VOICE / SIRI CONTROL (zero paid STT/TTS)
- macOS/iOS Shortcut: Dictate Text (free STT) -> POST to the app's local relay -> Speak
  Text (free TTS). Siri funnels into the SAME mounted session that drives the UI.
- ASYNC relay endpoint: return immediately with a job id, then poll/stream — because
  Shortcuts HTTP times out (~10-60s) while agent turns can take 120s.
- iPhone reach: bind a STABLE port on the LAN interface (not just 127.0.0.1) behind a
  shared-secret header. No ElevenLabs, no paid voice.

### H. SAFETY & COST (foundational, not a feature flag)
- Global kill switch halts all agent-initiated actions instantly.
- Cost guard wraps every agent action (esp. mounting agents); cap concurrent mounts.
- Filter high-risk self-modifying actions. Assume runaway-cost is the primary threat.

## EXTERNAL BRAIN CONTRACT (reuse as-is; do NOT rebuild intelligence)
- CEO/agent chat: relay via `hermes chat -q ...`. The CEO is the DEFAULT Hermes profile
  (OAuth/funded). THERE IS NO API KEY AND NONE IS REQUIRED. Never wire a keyed
  OpenAI/Anthropic provider as the CEO.
- Durable session id: persist + resume so chat/terminal/dispatch converge on ONE session.
- Agent registry: read agents.json (config-driven).
- Mount: harness `launch-agent`; your app spawns/observes/types/kills the PTY process.
- Personas: seeded by the harness into the agent workdir on launch.
- AG-UI: first-party @ag-ui/client (HttpAgent over a local SSE server).

## STACK (DECISION INPUT — set before building; default = A)
- [A] (recommended) Cross-platform web in an Electron shell; reuse @ag-ui/client +
  node-pty + xterm.js. Fastest; reuses the one hard working asset.
- [B] Native Swift (SwiftUI), Apple-first, native Siri/App Intents. NOTE: no supported
  Swift AG-UI SDK — implement the AG-UI SSE/event consumer + state patching yourself;
  use SwiftTerm + a PTY wrapper. Keep the Python/CLI brain as backend. Highest effort.
- [B-lite] A + a thin native Swift App Intents companion for deep Siri only.

## SUGGESTED PHASING (ship incrementally, not big-bang)
M1 Render loop: registry + agent emits full UI + bidirectional events + streaming.
M2 Mount: PTY + terminal view + one-session-three-views sync + durable resume.
M3 Orchestration: registry read + roster + agent-launches-agent + routing.
M4 Sessions+Tasks: session CRUD/resume + lightweight tasks.
M5 Voice/Siri: async relay + Shortcut + LAN/auth.
Safety+cost (H) is wired from M1 onward, not last.

## DELIVERABLES
1. ARCHITECTURE.md: render loop, mount model (one session/three views), brain seams,
   hybrid-control + safety model, registry vocabulary.
2. Running app meeting the DoD.
3. Tests: contract tests (registry + event channel + brain seams); golden intent->UI
   tests; offline-safe boot (no network/key).

## DEFINITION OF DONE (acceptance criteria)
- Launching the app mounts an agent session; the AGENT renders the entire initial UI
  (no hardcoded home screen).
- The session is viewable as a raw terminal AND typeable; surface/terminal/chat stay in
  sync on one durable session id that survives a restart.
- A mounted agent can launch/mount another agent; that mount appears as an agent-rendered
  surface with a viewable terminal.
- Siri drives the session by voice end-to-end with ZERO paid STT/TTS via the async relay
  (no timeout failure on a long turn).
- Kill switch halts all agent-initiated actions; concurrent mounts are capped.
- Boots and passes tests with no API key and no network.
- Grep proves no keyed CEO provider and no ElevenLabs dependency.

## NON-GOALS
Porting old screens; ElevenLabs/live-voice; channels; bespoke kanban UI; rebuilding the
harness or Hermes; feature parity with the old app.
````

---

## 4. NEXT ACTIONS

1. **Decide the stack** (A / B / B-lite). Default recommendation: **A**, then add **B-lite** when native Siri depth is wanted.
2. Bind the prompt to the chosen stack (name exact AG-UI client + terminal libs; drop irrelevant stack notes).
3. Create the linked `ceo-studio` board task and attach this plan.
4. Dispatch M1 to a builder/Devin worker in an isolated worktree; gate with `npm run check` + `npm test`.
