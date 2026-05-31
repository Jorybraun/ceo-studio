// AGUI client (renderer side) — connects to the local AGUI server in main using
// the OFFICIAL @ag-ui/client HttpAgent, runs turns, and drives two surfaces:
//   1. The left panel (#panel1): rendered from AG-UI shared state `ui` via the
//      component registry. STATE_SNAPSHOT / STATE_DELTA are applied by the SDK.
//   2. The chat stream (#panel2-stream): assistant prose streamed token-by-token
//      from TEXT_MESSAGE_CONTENT events.
//
// Bundled to client.bundle.js by esbuild (npm run build:agui) and exposed as
// window.CEOAgui so the plain-script app.js / convai.js can call it.

import { HttpAgent } from "@ag-ui/client";
import { renderUi, COMPONENT_TYPES } from "./registry.js";

const $ = (id) => document.getElementById(id);
const panel = () => $("panel-content-body") || $("panel-content") || $("panel1");

let agent = null;
let ready = false;
let running = false;

// --- streaming assistant line in the chat panel ---
let _streamEl = null;
function streamReset() { _streamEl = null; }
function streamDelta(delta) {
  const host = $("panel2-stream");
  if (!host) return;
  if (!_streamEl) {
    _streamEl = document.createElement("div");
    _streamEl.className = "agent";
    _streamEl.textContent = "CEO: ";
    host.appendChild(_streamEl);
  }
  _streamEl.textContent += delta;
  host.scrollTop = host.scrollHeight;
}

function render(state) {
  const ui = state && state.ui;
  renderUi(panel(), ui);
}

async function init() {
  let url = null;
  try { url = window.ceo && window.ceo.aguiUrl ? await window.ceo.aguiUrl() : null; }
  catch { url = null; }
  if (!url) { console.warn("[agui] no server url; AGUI disabled"); return; }
  // The SDK stores fetch as a property and calls it as `this.fetch(...)`, which
  // detaches it from `window` and throws "Illegal invocation". Pass a bound fetch.
  agent = new HttpAgent({ url, fetch: window.fetch.bind(window) });
  ready = true;
  console.log("[agui] client connected to", url, "components:", COMPONENT_TYPES.join(","));
  // Prime the panel with its idle state.
  render(agent.state || {});
}

/**
 * Run one turn through the CEO over AGUI. Streams prose into the chat and
 * mounts any UI the CEO emits into the left panel. Returns the final reply text.
 */
async function run(message) {
  const msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "empty" };
  if (!ready || !agent) return { ok: false, reason: "AGUI not ready" };
  if (running) return { ok: false, reason: "A turn is already running" };
  running = true;
  streamReset();

  let errored = null;
  const subscriber = {
    onTextMessageContentEvent: ({ event }) => { if (event && event.delta) streamDelta(event.delta); },
    onStateSnapshotEvent: ({ event, state, agent: a }) => {
      const st = (event && event.snapshot) || state || (a && a.state) || {};
      render(st);
    },
    onStateDeltaEvent: ({ state, agent: a }) => { render(state || (a && a.state) || {}); },
    onStateChanged: ({ state, agent: a }) => { render(state || (a && a.state) || {}); },
    onRunErrorEvent: ({ event }) => { errored = (event && event.message) || "run error"; },
  };

  try {
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: msg });
    await agent.runAgent({}, subscriber);
  } catch (e) {
    errored = e && e.message ? e.message : String(e);
  } finally {
    running = false;
  }

  if (errored) return { ok: false, reason: errored };
  const last = [...(agent.messages || [])].reverse().find((m) => m.role === "assistant");
  return { ok: true, reply: (last && last.content) || (_streamEl && _streamEl.textContent) || "" };
}

window.CEOAgui = {
  run,
  isReady: () => ready,
  // Let other modules push a UI tree directly (e.g. voice tools) without a turn.
  renderUi: (ui) => render({ ui }),
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else { init(); }
