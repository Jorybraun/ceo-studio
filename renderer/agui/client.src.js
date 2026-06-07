// AGUI client — HttpAgent + rich chat stream (#panel2-stream) + left panel registry.

import { HttpAgent } from "@ag-ui/client";
import { renderUi, COMPONENT_TYPES } from "./registry.js";

const $ = (id) => document.getElementById(id);
function panel() {
  if (window.StudioSessions && window.StudioSessions.getArtifactHost) {
    const host = window.StudioSessions.getArtifactHost();
    if (host) return host;
  }
  return $("panel-content-body") || $("panel-content") || $("panel1");
}
const chatHost = () => $("panel2-stream");

let agent = null;
let ready = false;
let running = false;
let initPromise = null;

function leadLabel() {
  if (window.StudioSessions && window.StudioSessions.getActive) {
    const s = window.StudioSessions.getActive();
    if (s && s.leadAgentId) return s.leadAgentId;
  }
  return "CEO";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdHtml(text) {
  const t = String(text || "");
  return window.marked ? window.marked.parse(t) : esc(t);
}

// --- AGUI chat stream (panel2) ---
let _turn = null;
let _proseBuf = "";
let _toolEls = new Map();

function chatResetTurn() {
  _turn = null;
  _proseBuf = "";
  _toolEls.clear();
}

function chatAppendUser(text) {
  const host = chatHost();
  if (!host) return;
  const el = document.createElement("article");
  el.className = "agui-msg agui-msg-user";
  el.innerHTML = `
    <div class="agui-msg-meta"><span class="agui-msg-role">You</span></div>
    <div class="agui-msg-body prose prose-invert prose-sm max-w-none">${mdHtml(text)}</div>`;
  host.appendChild(el);
  host.scrollTop = host.scrollHeight;
}

function chatAppendSys(text) {
  const host = chatHost();
  if (!host) return;
  const el = document.createElement("div");
  el.className = "agui-msg agui-msg-sys";
  el.textContent = text;
  host.appendChild(el);
  host.scrollTop = host.scrollHeight;
}

function chatAppendAssistant(text, label) {
  const host = chatHost();
  if (!host) return;
  const el = document.createElement("article");
  el.className = "agui-msg agui-msg-assistant";
  el.innerHTML = `
    <div class="agui-msg-meta"><span class="agui-msg-role agui-badge">${esc(label || leadLabel())}</span></div>
    <div class="agui-msg-body prose prose-invert prose-sm max-w-none">${mdHtml(text)}</div>`;
  host.appendChild(el);
  host.scrollTop = host.scrollHeight;
}

function chatStartAssistant() {
  const host = chatHost();
  if (!host) return;
  chatResetTurn();
  _turn = document.createElement("article");
  _turn.className = "agui-msg agui-msg-assistant agui-msg-live";
  _turn.innerHTML = `
    <div class="agui-msg-meta">
      <span class="agui-msg-role agui-badge">${esc(leadLabel())}</span>
      <span class="agui-run-pill hidden">running</span>
    </div>
    <div class="agui-thinking hidden"></div>
    <div class="agui-msg-body prose prose-invert prose-sm max-w-none agui-prose"></div>
    <div class="agui-tools"></div>
    <div class="agui-steps"></div>`;
  host.appendChild(_turn);
  host.scrollTop = host.scrollHeight;
}

function chatProseEl() {
  return _turn && _turn.querySelector(".agui-prose");
}

function chatFlushProse() {
  const el = chatProseEl();
  if (el) el.innerHTML = mdHtml(_proseBuf);
  const host = chatHost();
  if (host) host.scrollTop = host.scrollHeight;
}

function chatDelta(delta) {
  if (!_turn) chatStartAssistant();
  _proseBuf += delta;
  chatFlushProse();
}

function chatFinishAssistant(ok) {
  if (!_turn) return;
  const pill = _turn.querySelector(".agui-run-pill");
  if (pill) {
    // Only show the pill while streaming; hide it when the turn completes
    pill.classList.add("hidden");
    pill.classList.remove("agui-run-pill-err");
  }
  _turn.classList.remove("agui-msg-live");
}

function chatToolStart(event) {
  if (!_turn) chatStartAssistant();
  const tools = _turn.querySelector(".agui-tools");
  if (!tools) return;
  const id = event.toolCallId || event.id || `tool-${_toolEls.size}`;
  const name = event.toolCallName || event.name || "tool";
  const el = document.createElement("div");
  el.className = "agui-tool agui-tool-live";
  el.dataset.toolId = id;
  el.innerHTML = `<span class="agui-tool-name">${esc(name)}</span><span class="agui-tool-state">…</span>`;
  tools.appendChild(el);
  _toolEls.set(id, el);
  chatHost() && (chatHost().scrollTop = chatHost().scrollHeight);
}

function chatToolEnd(event) {
  const id = event.toolCallId || event.id;
  const el = id && _toolEls.get(id);
  if (!el) return;
  el.classList.remove("agui-tool-live");
  const st = el.querySelector(".agui-tool-state");
  if (st) st.textContent = "✓";
}

function chatStepStart(event) {
  if (!_turn) chatStartAssistant();
  const steps = _turn.querySelector(".agui-steps");
  if (!steps) return;
  const name = event.stepName || event.name || "step";
  const el = document.createElement("div");
  el.className = "agui-step";
  el.textContent = `▶ ${name}`;
  steps.appendChild(el);
}

function render(state) {
  const ui = state && state.ui;
  if (ui && ui.components && ui.components.length) {
    const host = panel();
    renderUi(host, ui);
    if (host && host.id === "session-artifact-host") {
      host.classList.remove("hidden", "empty:hidden");
    }
    if (window.StudioSessions && window.StudioSessions.showArtifactPanel) {
      window.StudioSessions.showArtifactPanel();
    }
  }
}

function cleanupOldPills() {
  const host = chatHost();
  if (!host) return;
  host.querySelectorAll('.agui-msg-assistant').forEach((msg) => {
    const pill = msg.querySelector('.agui-run-pill');
    if (!pill) return;
    // Hide pills on completed (non-live) turns
    if (!msg.classList.contains('agui-msg-live')) {
      pill.classList.add('hidden');
      return;
    }
    // For live turns, if the pill says "running" (never started streaming),
    // it was an aborted turn — mark it done and hide
    if (pill.textContent === 'running') {
      pill.classList.add('hidden');
      msg.classList.remove('agui-msg-live');
    }
  });
}

async function init() {
  let url = null;
  try { url = window.ceo && window.ceo.aguiUrl ? await window.ceo.aguiUrl() : null; }
  catch { url = null; }
  const host = chatHost();
  if (!url) {
    console.warn("[agui] no server url; AGUI disabled");
    if (host && !host.dataset.aguiBoot) {
      host.dataset.aguiBoot = "1";
      chatAppendSys("AGUI offline — start the app and open a project. Chat will use plain fallback until the AGUI bridge is up.");
    }
    return;
  }
  agent = new HttpAgent({ url, fetch: window.fetch.bind(window) });
  ready = true;
  console.log("[agui] client connected to", url, "components:", COMPONENT_TYPES.join(","));
  render(agent.state || {});
  if (host) {
    host.classList.add("agui-chat-host");
    if (host.children.length === 0 || host.textContent.includes("Create or open")) {
      chatAppendSys("Chat ready — ask the CEO anything.");
    }
  }
  cleanupOldPills();
}

function whenReady(ms = 10000) {
  if (ready) return Promise.resolve(true);
  if (!initPromise) {
    initPromise = new Promise((resolve) => {
      const tick = () => {
        if (ready) return resolve(true);
        if (Date.now() - start > ms) return resolve(false);
        setTimeout(tick, 80);
      };
      const start = Date.now();
      tick();
    });
  }
  return initPromise;
}

/**
 * Run one AGUI turn: rich chat stream + optional left-panel UI snapshot.
 */
async function run(message, opts = {}) {
  const msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "empty" };
  const okReady = await whenReady();
  if (!okReady || !agent) return { ok: false, reason: "AGUI not ready" };
  if (running) return { ok: false, reason: "A turn is already running" };
  running = true;

  if (!opts.skipUser) chatAppendUser(msg);

  let errored = null;
  chatStartAssistant();

  const subscriber = {
    onRunStartedEvent: () => {
      const pill = _turn && _turn.querySelector(".agui-run-pill");
      if (pill) { pill.textContent = "streaming"; pill.classList.remove("hidden"); }
    },
    onTextMessageContentEvent: ({ event }) => {
      if (event && event.delta) chatDelta(event.delta);
    },
    onToolCallStartEvent: ({ event }) => { if (event) chatToolStart(event); },
    onToolCallEndEvent: ({ event }) => { if (event) chatToolEnd(event); },
    onStepStartedEvent: ({ event }) => { if (event) chatStepStart(event); },
    onStateSnapshotEvent: ({ event, state, agent: a }) => {
      const st = (event && event.snapshot) || state || (a && a.state) || {};
      render(st);
      if (window.StudioSessions && window.StudioSessions.refreshSessionDetail) {
        window.StudioSessions.refreshSessionDetail();
      }
    },
    onStateDeltaEvent: ({ state, agent: a }) => { render(state || (a && a.state) || {}); },
    onStateChanged: ({ state, agent: a }) => { render(state || (a && a.state) || {}); },
    onRunErrorEvent: ({ event }) => { errored = (event && event.message) || "run error"; },
    onRunFinishedEvent: () => { chatFinishAssistant(true); },
  };

  try {
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: msg });
    await agent.runAgent({}, subscriber);
    if (!errored) chatFinishAssistant(true);
  } catch (e) {
    errored = e && e.message ? e.message : String(e);
    chatFinishAssistant(false);
  } finally {
    running = false;
  }

  if (errored) {
    chatAppendSys(`⚠ ${errored}`);
    return { ok: false, reason: errored };
  }
  const last = [...(agent.messages || [])].reverse().find((m) => m.role === "assistant");
  return { ok: true, reply: (last && last.content) || _proseBuf || "" };
}

window.CEOAgui = {
  run,
  whenReady,
  isReady: () => ready,
  appendUser: chatAppendUser,
  appendSys: chatAppendSys,
  appendAssistant: chatAppendAssistant,
  renderUi: (ui) => render({ ui }),
  showAgui: (ui) => { render({ ui }); },
};

function boot() {
  initPromise = init();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
