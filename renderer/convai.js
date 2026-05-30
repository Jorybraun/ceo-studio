// CEO Studio — live voice (ElevenLabs Conversational AI).
//
// ES module (loaded with <script type="module">). It opens the real-time
// agent session in the browser using a short-lived SIGNED URL fetched from
// main (the API key never reaches the renderer). ElevenLabs owns the loop:
// mic streaming, ASR, the agent LLM, TTS playback, turn-taking, barge-in.
//
// Guardrails: the session auto-ends at maxMinutes (also enforced server-side
// by the agent's max_duration_seconds), and the kill switch / cost cap end it
// immediately (driven from app.js via window.CEOConvai.stop).

import { Conversation } from "https://esm.sh/@elevenlabs/client@1.9.0";

const ui = () => window.ceoUI || {};
const btn = document.getElementById("live-call");
const label = document.getElementById("live-call-label");
const icon = document.getElementById("live-call-icon");

let conversation = null;
let active = false;
let starting = false;   // synchronous guard against double-start (rapid clicks)
let endTimer = null;
let countdownTimer = null;
let available = false;

function setLabel(text, live) {
  if (label) label.textContent = text;
  if (icon) icon.textContent = live ? "⏹️" : "🎙️";
  if (btn) {
    btn.classList.toggle("bg-red-600", !!live);
    btn.classList.toggle("border-red-500", !!live);
    btn.classList.toggle("bg-neutral-800", !live);
  }
}

// Client tools the live agent can invoke mid-conversation. Names MUST match
// the tool definitions in main/core/convai.js (TOOLS). Each returns a STRING
// that ElevenLabs appends to the agent's context (expects_response: true).
const clientTools = {
  async list_documents() {
    const docs = await window.ceo.docsList();
    if (!docs || !docs.length) return "No documents are indexed for this project.";
    return docs.slice(0, 60).map((d) => `- ${d.path}${d.summary ? `: ${d.summary}` : ""}`).join("\n");
  },
  async show_document({ path } = {}) {
    if (!path) return "No path provided.";
    const r = await window.ceo.docsRead(path);
    if (!r || !r.ok) return `Could not open ${path}: ${r ? r.reason : "unknown"}.`;
    ui().showPanel?.(path, r.text);
    ui().appendStream?.("sys", `📄 Showing ${path}`);
    return `Now displaying "${path}". Contents:\n\n${r.text.slice(0, 6000)}`;
  },
  async set_domain({ domain } = {}) {
    if (!domain) return "No domain provided.";
    ui().setDomainUI?.(domain);
    ui().appendStream?.("sys", `🧭 Domain → ${domain}`);
    return `Domain set to ${domain}.`;
  },
  async ask_document_agent({ question } = {}) {
    if (!question) return "No question provided.";
    ui().appendStream?.("user", `🎙️ ${question}`);
    const out = await window.ceo.ask(question);
    if (out.cost) ui().renderMeter?.(out.cost);
    if (out.halted) return `The local agent is halted by the cost guardrail: ${out.text}`;
    ui().appendStream?.("agent", out.text);
    return out.text || "(no answer)";
  },
  async orchestrate_swarm({ objective } = {}) {
    const r = await window.ceo.swarmRequest(objective || "");
    ui().appendStream?.("sys", `🐝 Swarm requested: ${objective || ""}`);
    return r && r.message ? r.message : "Swarm orchestration is not enabled yet.";
  },
};

async function start() {
  if (active || starting) return;       // never open a second session
  starting = true;
  if (!available) { ui().setVoiceStatus?.("Live voice disabled (no ELEVENLABS_API_KEY)."); starting = false; return; }
  if (!ui().hasProject?.()) { ui().appendStream?.("sys", "Open a project first."); starting = false; return; }

  ui().setVoiceStatus?.("Connecting live voice…");
  setLabel("Connecting…", true);

  // Ask the user's browser for mic access up front (clear UX).
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    ui().setVoiceStatus?.(`Mic unavailable: ${e.message}`);
    setLabel("Start live voice", false);
    starting = false;
    return;
  }

  // Get a connection token from main (key stays server-side). Also gives the cap.
  const res = await window.ceo.convaiStart();
  if (!res || !res.ok) {
    ui().setVoiceStatus?.(`Live voice error: ${res ? res.reason : "unknown"}`);
    setLabel("Start live voice", false);
    starting = false;
    return;
  }
  const maxMinutes = res.maxMinutes || 5;

  // Prefer WebRTC (best interruption/barge-in); fall back to WebSocket.
  const connOpts = res.token
    ? { conversationToken: res.token }
    : { signedUrl: res.signedUrl };

  try {
    conversation = await Conversation.startSession({
      ...connOpts,
      clientTools,
      onConnect: () => {
        active = true;
        starting = false;
        ui().setAgentState?.("listening");
        ui().appendStream?.("sys", `Live voice connected (auto-ends in ${maxMinutes} min).`);
        armGuardrails(maxMinutes);
      },
      onDisconnect: () => { cleanup("disconnected"); },
      onError: (msg) => {
        ui().appendStream?.("sys", `Live voice error: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
        cleanup("error");
      },
      onModeChange: (m) => {
        const mode = m && m.mode;
        if (mode === "speaking") ui().setAgentState?.("speaking");
        else ui().setAgentState?.("listening");
      },
      onMessage: (m) => {
        if (!m || !m.message) return;
        const kind = m.source === "user" ? "user" : "agent";
        ui().appendStream?.(kind, m.message);
      },
    });
    setLabel("End live voice", true);
    starting = false;
  } catch (e) {
    ui().setVoiceStatus?.(`Could not start live voice: ${e.message}`);
    setLabel("Start live voice", false);
    cleanup("start-failed");
  }
}

function armGuardrails(maxMinutes) {
  const endAt = Date.now() + maxMinutes * 60 * 1000;
  clearTimeout(endTimer);
  clearInterval(countdownTimer);
  endTimer = setTimeout(() => stop("time cap reached"), maxMinutes * 60 * 1000);
  countdownTimer = setInterval(() => {
    if (!active) return;
    const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(1, "0");
    const ss = String(left % 60).padStart(2, "0");
    ui().setVoiceStatus?.(`🔴 Live — ${mm}:${ss} left (per-minute billing)`);
  }, 1000);
}

async function stop(reason) {
  clearTimeout(endTimer);
  clearInterval(countdownTimer);
  if (conversation) {
    try { await conversation.endSession(); } catch { /* */ }
  }
  cleanup(reason);
}

function cleanup(reason) {
  conversation = null;
  active = false;
  starting = false;
  clearTimeout(endTimer);
  clearInterval(countdownTimer);
  setLabel("Start live voice", false);
  ui().setAgentState?.("idle");
  if (reason !== undefined) ui().setVoiceStatus?.(reason ? `Live voice ended (${reason}).` : "");
}

function toggle() { if (active) stop("ended by user"); else start(); }

// Expose to app.js (kill switch / cost guardrail call stop()).
window.CEOConvai = { toggle, stop, isActive: () => active };

if (btn) btn.addEventListener("click", toggle);

// Probe availability; disable the control if no key is configured.
(async () => {
  try {
    const st = await window.ceo.convaiStatus();
    available = !!(st && st.available);
    if (!available) {
      if (btn) btn.disabled = true;
      ui().setVoiceStatus?.(st && st.note ? st.note : "Live voice disabled (no ELEVENLABS_API_KEY).");
    }
  } catch { /* live voice optional */ }
})();
