# ADR-0001 — Native Swift Cockpit for the Agent-Driven, Mount-First Rebuild

**Status:** Proposed (Architect review of `Plan/agent-driven-mount-first-rebuild.md`) · 2026-06-03
**Owner:** Architect — discovery domain
**Supersedes:** the open "stack" decision in `Plan/agent-driven-mount-first-rebuild.md` §1/§3 (resolves it to native Swift)
**Decision authority:** requires CEO sign-off to move Proposed → Accepted. ADRs are immutable once accepted; a new ADR supersedes.

---

## Decision

Build the greenfield cockpit as a **native Apple (macOS-first, iOS companion) Swift/SwiftUI app**, not a cross-platform web/Electron shell. The external "brain" — the Hermes CEO, the Python harness, the `devin`/`hermes` CLIs, and `tmux` — is reused **as-is** and is NOT rebuilt.

One sub-decision is deliberately left **OPEN** with a recommended default: see [Open: the Node boundary](#open-the-node-boundary-recommended-default--sidecar).

---

## Why this decision exists

The product's two non-negotiable pillars are **"agent is the full UI driver"** and **"mount is the founding primitive,"** plus zero-paid-voice Siri control. The team has chosen an Apple-first native product. This ADR records the consequences of that choice and the invariants it must not break, so a builder does not:

1. re-make the API-key-CEO mistake,
2. demote the raw transcript from first-class to a render cache, or
3. under-budget the terminal/render risk that native Swift introduces.

---

## Key finding that reframes effort

The plan frames option A (web/Electron) as "reuses the one hard working asset (`@ag-ui/client`)" and Swift as "highest effort — implement the AG-UI consumer yourself." Reading the code, that framing is partly wrong:

- The brain→surface protocol is **CLI-text-based**, not AG-UI-native generative UI. The CEO emits a fenced ` ```agui {json} ``` ` block inside plain `hermes chat -q` output; the server regex-extracts it and ships it as a single AG-UI `STATE_SNAPSHOT` (`main/core/agui-server.js`).
- The current component registry is **display-only** — ~11 static components (heading, markdown, card, table, callout, mermaid, …) with **no form, no button, and no bidirectional event channel** (`renderer/agui/registry.js`).
- `@ag-ui/client` only provides SSE transport + `verifyEvents` + state application, consumed in ~300 lines (`renderer/agui/client.src.js`).

Consequences:

- **Pillar A (agent drives the *entire*, bidirectional UI) is greenfield in EVERY stack** — the working app does not have it today.
- The only Swift-specific loss is a small SSE/event consumer + a render registry (~300 LOC-equivalent).
- There is **no official Swift AG-UI SDK** (supported SDKs: TS, Python, Kotlin, Go, Dart, Java, Rust, Ruby, C++), but the app **does not need one** because the protocol is just "parse a fenced JSON block out of CLI stdout."

---

## Decision detail — load-bearing sub-decisions

1. **UI:** a SwiftUI dynamic component renderer driven by an AG-UI-shaped state tree. Unknown component types render as a labelled fallback (never crash) — mirror the semantics of `renderer/agui/registry.js`.
2. **Transport:** a Swift SSE client consuming the same event-stream shape the Node `agui-server` emits today: `RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END → STATE_SNAPSHOT → RUN_FINISHED` (or `RUN_ERROR`).
3. **Terminal / mount:** SwiftTerm (`LocalProcessTerminalView`) attached to `tmux attach-session -t =<session>:<window>`. Mount lifecycle = `launch-agent --name <id>` (Python) + tmux verbs (`capture-pane` / `send-keys` / `kill-session` / `has-session`) — identical to `main/core/mount.js`, just driven from Swift `Process`.
4. **Voice:** drop ElevenLabs / `convai` entirely. TTS = `AVSpeechSynthesizer`; STT = `SFSpeechRecognizer` (on-device, free); Siri = App Intents / SiriKit. A long-turn **async job relay** (return a job id, then poll/stream) is still required because Shortcuts/App Intents time out (~10–60s) before a 120s agent turn.
5. **Brain calls:** shell `hermes chat -q` against the **DEFAULT** Hermes profile (no `-p`, no API key).

---

## Open: the Node boundary (recommended default = sidecar)

A/B/B-lite is the wrong axis. The code decomposes cleanly into a **brain-seam layer** (`hermes.js` relay, `agui-server.js` SSE adapter, `pty-terminal.js`, `cost.js`, durable-session persistence — already effectively a local server) and a **view layer**. "Full native Swift UI" is settled; the highest-leverage open question is **where the Swift↔existing-code boundary sits**:

| Option | What it means | Risk |
|---|---|---|
| **Swift-pure** | Reimplement the entire brain-seam layer in Swift; no Node at all. | **Highest.** Re-derives the implicit brain contract (120s timeout, `sessionMiss` retry, fenced-block parsing, `session_id:` footer parsing, durable-session file) from scratch. |
| **Swift UI + Node sidecar** (RECOMMENDED DEFAULT) | Native SwiftUI front-end; keep the working Node brain-seam as a bundled local daemon (SSE + a PTY/websocket bridge). Swift owns rendering, terminal, voice, App Intents only. | **Much lower.** Preserves hard-won lessons verbatim. |

**Resolution path:** keep this open and decide it with the tracer-bullet spikes below. Default to **sidecar** unless the SSE-consumer spike proves the pure-Swift relay is cheap and safe.

---

## Invariants that MUST be preserved (non-negotiable)

1. **No-API-key CEO** — Swift shells `hermes chat -q` against the default Hermes profile; never wire a keyed OpenAI/Anthropic provider as the CEO. (`AGENTS.md`, `E2E_PLAN.md`)
2. **Raw transcript is primary / record-first** (`NORTH_STAR.md` #5) — AG-UI snapshots are *derived and ephemeral*; the transcript store is the source of truth. Today that is `session-capture.js` + `sessions.appendTranscript`. It must be re-homed, not dropped.
3. **Cost guard + kill switch from commit 1** (`NORTH_STAR.md` #2) — hard `$/session` + `$/day` caps, live meter, global kill switch, concurrent-mount cap. The *spawn* guardrail already lives **below the UI** in the Python `launch-agent` (`config/cost_limits.py`) and must remain authoritative regardless of UI language. The model-call meter (`main/core/cost.js`) must be re-homed (or kept in the sidecar).
4. **Durable session-state contract** — read/write `<workspace>/brain/rooms/<room>/agents/<agent>.json` with shape `{ agent, room, provider, model, session_id, created_at }` **byte-compatibly**, so the surface, terminal, chat, and programmatic dispatch converge on ONE durable session. This is a cross-process contract with the harness `agent_adapter`.
5. **Offline-safe boot** — boots and passes tests with no API key and no network; grep proves no keyed CEO provider and no ElevenLabs dependency.

---

## Consequences

**Positive**
- Native Siri/voice — on-device, free, first-class (App Intents + SiriKit + `SFSpeechRecognizer` + `AVSpeechSynthesizer`). Deletes the ElevenLabs `convai` path.
- Single native process; no Electron/node-pty packaging tax; tighter macOS integration.

**Negative**
- Terminal stack regresses from battle-tested `xterm.js` + `node-pty` to single-maintainer SwiftTerm (open bugs: #330 Sonoma frame height, #370 `LocalProcess` termination ordering, #486 streaming-scroll on background-queue feeds).
- The whole view layer is rebuilt; the working JS renderer/main is discarded.
- Mermaid has no native renderer — diagrams would need an embedded `WKWebView`, reintroducing web.
- Apple-only.
- Three maintained languages (Python harness + Hermes CLI + Swift); existing team JS muscle is dropped.

---

## Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | SwiftTerm maturity; the mount pillar depends on it | HIGH | Tracer-bullet spike on a real `tmux attach` before commit; pin a vetted version; budget upstream-patch time; fallback = sidecar PTY over websocket into a SwiftUI view. |
| R2 | Implicit brain-contract loss (timeouts, retries, parsing) | HIGH | Prefer the Node sidecar; if pure-Swift, port `hermes.js` behavior line-by-line with contract tests. |
| R3 | Transcript demoted to a render cache | HIGH (Architect mandate) | Transcript store is a first-class module with its own tests; the AG-UI snapshot derives FROM it. |
| R4 | Cost-guard drift between Swift and Python | MED | Keep `config/cost_limits.py` authoritative for spawns; single source of truth for caps. |
| R5 | Siri long-turn timeout | MED | Async job relay (job id + poll/stream), per plan §G. |

---

## Alternatives considered

- **A — web/Electron:** reuses the working renderer + `@ag-ui/client` + `xterm`/`node-pty`; cross-platform; weaker native Siri. Rejected per the Apple-first product choice.
- **B-lite — web + thin Swift App Intents companion:** keeps the working asset, adds native Siri depth. Strongest risk-adjusted option; rejected per the full-native directive but recorded as the **fallback** if the R1/R2 spikes go badly.

---

## Experiments to reduce unknowns (do BEFORE the full build)

1. **Tracer bullet 1:** SwiftUI renders a hard-coded AG-UI component tree (markdown, card, table, fallback) — proves the dynamic registry.
2. **Tracer bullet 2:** SwiftTerm attaches to a live `tmux attach-session` for a real mounted agent; type + resize + detach cleanly — proves the mount pillar and resolves R1.
3. **Spike:** a Swift SSE consumer against the existing Node `agui-server` — measures the true cost of the sidecar-vs-pure boundary and resolves the [Open decision](#open-the-node-boundary-recommended-default--sidecar).

---

## Anti-regression rules

- Never wire a keyed provider as the CEO. Never reintroduce ElevenLabs.
- Never let the AG-UI snapshot become the source of truth over the transcript.
- Never ship a mount path that can spawn agents without passing the Python cost guardrail.
- The agent-state JSON shape is a cross-process contract — changing it requires a new ADR.

---

## Related

- `Plan/agent-driven-mount-first-rebuild.md` — the brief this resolves
- `NORTH_STAR.md`, `E2E_PLAN.md` — invariants
- `runtime/harness/architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md` — tmux-as-adapter decision
- `main/core/{hermes,agui-server,mount,pty-terminal,cost}.js` — the seams being re-homed
- `renderer/agui/{client.src,registry}.js` — the AG-UI surface being re-derived
