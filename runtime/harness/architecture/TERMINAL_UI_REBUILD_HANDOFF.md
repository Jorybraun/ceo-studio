# Handoff: Rebuilding the Agent Terminal UI (real interactive terminal)

Status: first implementation landed for the Terminal nav surface
Date: 2026-06-03

## 2026-06-03 implementation update

CEO Studio now has the first real xterm/node-pty implementation for the
Terminal nav surface:

- Dependencies added: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`,
  `@xterm/addon-webgl`, and `@xterm/addon-unicode11`.
- Renderer bundle: `renderer/puti.js` builds to `renderer/puti.bundle.js` and
  `renderer/puti.bundle.css` through `npm run build:puti`.
- Main bridge: `main/core/pty-terminal.js` owns node-pty clients that run
  `tmux attach-session -t =<session>:<window>`.
- IPC/preload: `terminal:open`, `terminal:input`, `terminal:resize`,
  `terminal:close`, `terminal:data`, and `terminal:exit` are exposed through
  `window.ceo`.
- Fallback: if live PTY attach fails, the Terminal nav degrades to the existing
  `registry:terminal` snapshot path and marks the status as fallback.
- Studio Sessions now click through to that Terminal nav: the active session
  swarm strip and the Active Workers detail list open PuTI/xterm with the
  selected agent preloaded.

The dashboard terminal, inline session inspector, and agent overlay terminal
still use the snapshot APIs and should be converted after the Terminal nav is
dogfooded. Session worker click-through uses the live Terminal nav instead of
embedding a second xterm instance.

## Goal

Replace the current "scrape the tmux pane and dump it as plain text" agent
terminal with a **real, interactive terminal emulator** in the cockpit — like
PuTTY / a proper TTY: ANSI colors, live streaming, real keyboard input
(arrows, ctrl-keys, TUI navigation), cursor, scrollback, and resize.

This is about the *terminal pane itself*, not about agent protocols.

## Original state (before the first implementation)

The agent terminal is a polled, read-mostly plain-text snapshot.

| Piece | Where | What it does |
| --- | --- | --- |
| Markup | `renderer/index.html:220` | `<pre id="as-output" ... whitespace-pre-wrap>` — a plain `<pre>`, no emulator |
| Render loop | `renderer/app.js` `pollAgentSurface()` (~2150) | `out.textContent = r.output` on a `setInterval` (1500ms terminal / 3000ms logs) |
| Read | `registryTerminal` -> `main/core/mount.js` `snapshot()` (144) | `tmux capture-pane -p -S -300` — flat text, last 300 lines |
| Input | `#as-input` -> `registryTerminalSend` -> `mount.js` `send()` (155) | `tmux send-keys -l <text>` + `Enter` — line-at-a-time only |
| Deps | `package.json` | no `xterm`, no `node-pty` |

### Why it needs a rebuild
1. **No ANSI / formatting.** Agent CLIs (e.g. Devin CLI) draw boxes, spinners,
   and color via escape codes; as `textContent` they render as garbled text.
2. **Not interactive.** Input is line-based `send-keys`; you can't drive a TUI
   (arrow keys, `/plan`, Ctrl-C, prompts, menus, scroll).
3. **Polling, not streaming.** A 1.5s `capture-pane` snapshot flickers, loses
   cursor position, and lags behind the live session.
4. **No resize / scrollback.** Fixed to the tmux pane geometry and 300 lines;
   the pane doesn't reflow to the panel size.

## Target design (PuTTY/xterm-style)

Embed a real terminal emulator in the renderer, backed by a live byte stream
both directions. There is a working precedent to copy: the **Hermes dashboard**
embeds a real `hermes --tui` using `xterm.js` (WebGL renderer + `addon-fit` +
`addon-unicode11`) over a PTY WebSocket bridge (`hermes_cli/pty_bridge.py` +
`@app.websocket("/api/pty")`). Mirror that shape in Electron.

### Components
1. **Renderer: xterm.js terminal.**
   - Add deps: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`,
     `@xterm/addon-unicode11`.
   - Replace `<pre id="as-output">` (for the Terminal tab) with an xterm
     `Terminal` mounted in a container; keep the Logs/room tab as-is (that one is
     structured text, not a TTY).
   - `term.onData(bytes => ipc send to main)` for keystrokes; write incoming
     bytes with `term.write(bytes)`. Fit on container resize -> send new
     cols/rows to main.
2. **Main: live PTY/tmux byte bridge** (replaces poll + send-keys).
   - Spawn a PTY via `node-pty` that runs `tmux attach-session -t <session>:<win>`.
   - The PTY is a temporary UI client attached to the durable tmux session. Closing
     the PTY must detach only the UI client and must not kill the tmux session or
     the agent process.
   - Main owns all PTY processes. Renderer never shells out and never sees the
     filesystem/process details.
   - New IPC is event-driven:
     - `terminal:open` -> `{ ok, terminalId, session, window }`
     - `terminal:input` -> write bytes to PTY
     - `terminal:resize` -> `pty.resize(cols, rows)`
     - `terminal:close` -> kill/detach the PTY client
     - `terminal:data` -> streamed bytes main -> renderer
     - `terminal:exit` -> PTY ended / detached / errored
3. **Keep the registry/tmux model.** tmux stays the session host (source of
   truth per `TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`); we are only
   upgrading how the pane is *viewed and driven*.

### Recommended path
Go with **node-pty attaching to tmux** for a true PuTTY-like experience.

Do **not** start with "xterm over polled `capture-pane`" unless the team only
wants a visual prototype. `tmux capture-pane -p` strips terminal escapes by
default; using xterm against repeated snapshots will either lose colors or
duplicate scrollback unless the implementation also uses `capture-pane -e` and a
clear/redraw strategy. That is useful as a fallback, not the main path.

If `node-pty` cannot compile in the Electron environment, keep the existing
snapshot APIs live and file a visible agent-terminal bug. Do not replace the
current working terminal view with a broken native dependency.

## Implementation contract

### Dependencies

Add:

```bash
npm install node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-unicode11
```

Because `node-pty` is a native module, verify it works under Electron, not just
Node. If needed, add an Electron rebuild step:

```bash
npx electron-rebuild -f -w node-pty
```

Record the actual rebuild command in `package.json` only after it is proven on
this repo.

### Main process module

Create `main/core/pty-terminal.js`.

Responsibilities:

- Resolve an agent id to the current tmux `session` and `window` using the same
  registry/mount lookup rules as `main/core/mount.js`.
- Refuse to open a terminal if the tmux session is not alive. The UI should tell
  the user to mount the agent first.
- Spawn a PTY:

```js
pty.spawn("tmux", ["attach-session", "-t", `${session}:${window}`], {
  name: "xterm-256color",
  cols,
  rows,
  cwd: projectPath || process.cwd(),
  env: { ...preparedEnv, TERM: "xterm-256color" },
});
```

- Store terminals by `terminalId`:

```js
{
  terminalId,
  agentId,
  session,
  window,
  pty,
  webContentsId,
  createdAt,
  lastActiveAt,
  outputBytes,
}
```

- Forward data only to the renderer that opened the PTY. Avoid global broadcast
  to every window.
- On renderer navigation/destroy or app quit, close all PTYs owned by that
  renderer.
- Bound memory: keep no unbounded server-side scrollback. xterm owns scrollback;
  main may keep a small recent buffer only for reconnect diagnostics.
- On PTY close, send `terminal:exit` with `{ terminalId, exitCode, signal }`.

### IPC contract

Add to `main/index.js`:

```js
ipcMain.handle("terminal:open", (event, { agentId, cols, rows }) => ...)
ipcMain.handle("terminal:input", (_event, { terminalId, data }) => ...)
ipcMain.handle("terminal:resize", (_event, { terminalId, cols, rows }) => ...)
ipcMain.handle("terminal:close", (_event, terminalId) => ...)
```

Events main -> renderer:

```js
webContents.send("terminal:data", { terminalId, data })
webContents.send("terminal:exit", { terminalId, exitCode, signal, reason })
```

Add to `main/preload.js`:

```js
terminalOpen(info)
terminalInput(terminalId, data)
terminalResize(terminalId, cols, rows)
terminalClose(terminalId)
onTerminalData(handler)
onTerminalExit(handler)
```

Return an unsubscribe function from event subscriptions so renderer cleanup is
explicit.

### Renderer component

Create a small terminal controller, either in `renderer/app.js` first or a new
`renderer/terminal.js` once the shape is stable.

State:

```js
{
  terminalId,
  agentId,
  term,
  fitAddon,
  webglAddon,
  unicodeAddon,
  disposables,
  resizeObserver,
}
```

Rules:

- Terminal tab opens a PTY only when selected and an agent is mounted.
- Logs tab remains the room transcript and must not be replaced with xterm.
- Closing the agent surface or switching agents closes the PTY subscription.
- Re-opening the same agent terminal creates a new PTY client attached to the
  same tmux session; it does not spawn a new agent.
- `term.onData(data => window.ceo.terminalInput(terminalId, data))`.
- Fit on open, on panel resize, and after fullscreen toggle.
- Use xterm scrollback, not DOM text scrollback.
- On PTY exit, show a small status line and leave the terminal buffer visible.

## Tmux attach details

Important: `tmux attach-session -t <session>:<window>` attaches a client to an
existing tmux session/window. It is not the same as reading a pane snapshot.

Implementation must guarantee:

- Closing the UI terminal detaches/kills only the `tmux attach` client created by
  node-pty.
- It must not call `tmux kill-session` unless the user explicitly unmounts the
  agent.
- Multiple UI viewers may attach to the same tmux window. This is acceptable for
  read/drive, but only one active human should type at a time. Do not try to
  enforce that in v1; document it in the UI if needed.
- Window targeting should use `mount.resolveWindow(session, preferred)` semantics
  or expose an equivalent helper. Persisted `tmux_window` can be stale.
- If an agent is watcher-only and the only window is `watcher`, terminal view
  should attach to `watcher` but the UI should continue to emphasize that the
  preferred interaction path is room messaging.

## Fallback path

Keep these existing APIs during rollout:

- `registry:terminal`
- `registry:terminal_send`
- `agents:terminal_snapshot`
- `agents:terminal_send`

If `node-pty` import fails, or `terminal:open` fails because the native module is
missing, the UI should fall back to the current snapshot view and show:

> Live PTY unavailable; using snapshot terminal.

That fallback should be treated as degraded, not success.

## Incremental plan
1. Done: add dependencies and prove `require("node-pty")` works inside checks.
2. Done: add `main/core/pty-terminal.js` plus IPC/preload methods.
3. Done for Terminal nav: convert `renderer/puti.js` to xterm/node-pty.
   Studio Sessions can now open that Terminal nav with a selected lead/worker.
   Dashboard, inline session inspector, and agent overlay remain on snapshot
   APIs for the first pass.
4. Done for Terminal nav: add resize handling and cleanup on agent switch,
   reconnect, renderer destroy, and app quit.
5. Next: dogfood with a mounted cheap/non-paid agent first, then a paid agent only via
   explicit human action.
6. Convert `renderer/dashboard.js`, the inline `#panel-inspect` fallback, and
   the agent overlay terminal tab to the same terminal component.
7. Remove terminal polling from converted terminal surfaces only after xterm
   streaming is proven.
8. Later cleanup: decide whether to delete or keep snapshot APIs as a diagnostic
   fallback.

## Open decisions
- **Native module policy**: add `electron-rebuild` now or only if local install
  proves it is required?
- **Terminal ownership**: one PTY per visible terminal tab is simplest. Do not
  share one PTY client across renderer surfaces in v1.
- **Surface unification**: convert `renderer/app.js` first, then extract a shared
  helper before touching dashboard/session inspector.
- **Window selection**: v1 attaches to the resolved default window. A window
  switcher can come after the terminal is stable.
- **Paid agent behavior**: mounting a paid agent from an explicit UI action may
  pass `allowPaid`; terminal attachment itself must not spawn paid sessions.

## How to verify
- `npm run start:debug` (CDP 9222).
- Open CEO Studio, open a project, open Agents, mount a non-paid/cheap agent if
  one is available.
- Open the agent detail terminal:
  - output streams without clicking Refresh,
  - ANSI colors/boxes render correctly,
  - typing appears immediately,
  - arrow keys and Ctrl-C are sent as control bytes,
  - resize/fullscreen changes the terminal dimensions,
  - closing/reopening the terminal does not kill the tmux session,
  - switching to Logs does not keep duplicate PTY subscriptions alive,
  - switching back to Terminal creates one clean PTY client.
- Regression checks:
  - room/log tab still reads the A2A transcript,
  - dashboard terminal still works through the snapshot fallback until converted,
  - mounting/unmounting an agent still updates registry state,
  - `npm run check`,
  - `npm test`.

## Failure modes to guard against

- **Duplicate terminals**: every tab switch opens another PTY and old ones keep
  streaming. Fix with explicit `terminalClose()` cleanup and subscription
  disposables.
- **Killing the agent**: closing the xterm kills tmux session instead of only the
  attach client. Never call `kill-session` from terminal close.
- **Broken native dependency**: app fails to boot because `node-pty` cannot load.
  Lazy-require it inside `pty-terminal.js` and return a degraded error.
- **Unbounded output**: main process accumulates terminal output forever. Keep
  output buffer small or none.
- **Stale tmux window**: persisted `tmux_window` points at a window that no
  longer exists. Resolve against live tmux windows before attach.
- **Paid surprise**: opening a terminal should attach to an already-mounted
  session. It should not spawn a paid agent behind the user's back.

## References
- Hermes dashboard terminal precedent: `~/.hermes/hermes-agent/AGENTS.md`
  ("TUI in the Dashboard" — xterm.js + WebGL + fit + unicode11 + `pty_bridge.py`
  + `/api/pty` websocket).
- Current surface: `renderer/app.js` (`pollAgentSurface`), `renderer/index.html`
  (`#as-output`), `main/core/mount.js` (`snapshot`/`send`).
- `runtime/harness/architecture/TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`
  (tmux stays the session host; this only changes the view/drive layer).
