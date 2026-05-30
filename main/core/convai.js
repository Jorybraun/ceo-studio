"use strict";
/**
 * Conversational AI — ElevenLabs live voice agent (the "live voice" mode).
 *
 * ElevenLabs' real-time Agents platform owns the loop (ASR + LLM + TTS +
 * turn-taking + barge-in). To make it *CEO Studio's* agent rather than a
 * generic voice bot, the agent is given CLIENT TOOLS it can call mid-call:
 * read/show project docs, switch domain, query the local cost-gated Document
 * Agent, and (stub) request swarm orchestration. The tools execute in the
 * renderer (see renderer/convai.js) and reach into main over the IPC bridge.
 *
 * Architecture rules kept intact:
 *   - The API key lives ONLY in main. The renderer gets a short-lived WebRTC
 *     token (preferred, better barge-in) or signed URL — never the key.
 *   - OFFLINE-SAFE: no key -> available() false, UI hides live mode.
 *
 * Cost guardrail (per-minute CLOUD spend — the runaway-loop risk this project
 * exists to prevent): the agent has a hard `max_duration_seconds`; the
 * renderer also runs a countdown and the kill switch / cost cap end the call.
 */
const fs = require("fs");
const path = require("path");
const { studioHome } = require("./paths");

const API_BASE = "https://api.elevenlabs.io/v1";

// Bump when the agent config (prompt/tools/behavior) below changes, so existing
// agents get PATCHed into sync instead of serving a stale config.
const CONFIG_VERSION = 3;

// Client tools the agent may call. Names are case-sensitive and MUST match the
// implementations registered in renderer/convai.js.
const TOOLS = [
  {
    type: "client",
    name: "list_documents",
    description: "List the project's documents (paths + short summaries). Use before reading so you cite real files.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "show_document",
    description: "Open a project document by its path; it is displayed in the left panel and its text returned to you. Use to read documentation.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path"],
      properties: { path: { type: "string", description: "Document path exactly as given by list_documents." } },
    },
  },
  {
    type: "client",
    name: "set_domain",
    description: "Switch the active project domain in the UI (e.g. 'Engineering', 'Discovery', or 'All').",
    expects_response: true,
    parameters: {
      type: "object", required: ["domain"],
      properties: { domain: { type: "string", description: "Domain name to focus." } },
    },
  },
  {
    type: "client",
    name: "ask_document_agent",
    description: "Delegate a documentation/analysis question to CEO Studio's local, cost-gated Document Agent (it has the project brain). Returns its answer for you to relay.",
    expects_response: true,
    parameters: {
      type: "object", required: ["question"],
      properties: { question: { type: "string", description: "The question/instruction for the local Document Agent." } },
    },
  },
  {
    type: "client",
    name: "orchestrate_swarm",
    description: "Request a domain agent swarm to research/plan/build something. Swarms (L3) are not enabled yet; this logs the request to the brain and tells you so.",
    expects_response: true,
    parameters: {
      type: "object", required: ["objective"],
      properties: { objective: { type: "string", description: "What the swarm should accomplish." } },
    },
  },
];

function cfg(env = process.env) {
  const maxMin = Number(env.CEO_CONVAI_MAX_MINUTES);
  return {
    apiKey: env.ELEVENLABS_API_KEY || "",
    voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // "Sarah"
    llm: env.CEO_CONVAI_LLM || "gemini-2.0-flash",
    maxMinutes: Number.isFinite(maxMin) && maxMin > 0 ? maxMin : 5,
  };
}

function available(env = process.env) {
  return !!(env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim());
}

function _storeFile() { return path.join(studioHome(), "convai.json"); }
function _readStore() {
  try { return JSON.parse(fs.readFileSync(_storeFile(), "utf-8")); } catch { return {}; }
}
function _writeStore(obj) {
  try { fs.writeFileSync(_storeFile(), JSON.stringify(obj, null, 2)); } catch { /* best-effort */ }
}

async function _api(endpoint, { method = "GET", body, env = process.env } = {}) {
  const c = cfg(env);
  return fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: { "xi-api-key": c.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function _conversationConfig(env = process.env, { projectName } = {}) {
  const c = cfg(env);
  const who = projectName ? `the project "${projectName}"` : "the current project";
  const prompt = [
    `You are the Project CEO — the live voice of CEO Studio for ${who}.`,
    "PERSONALITY: a calm, sharp, senior operator. Warm but extremely efficient.",
    "STYLE: Speak in short, natural spoken sentences. Default to ONE or TWO sentences.",
    "Never monologue, never narrate what you're about to do, never read long lists aloud — summarize.",
    "It is fine to be interrupted; stop talking immediately when the user speaks.",
    "TOOLS (use them, don't guess): call list_documents then show_document to read real docs;",
    "set_domain to focus a domain; ask_document_agent to delegate documentation analysis to the local brain-backed agent;",
    "orchestrate_swarm to request a swarm (it will tell you swarms aren't enabled yet).",
    "When a tool shows something in the UI, briefly say what you put on screen rather than reading it all.",
    "If you don't know a project-specific fact, use a tool or say you don't know — never invent details.",
  ].join(" ");
  return {
    agent: {
      first_message: "CEO online. What are we working on?",
      language: "en",
      disable_first_message_interruptions: false,
      prompt: { prompt, llm: c.llm, temperature: 0.4, max_tokens: 300, tools: TOOLS },
    },
    // English agents require turbo/flash v2 (not v2.5); flash_v2 = lowest latency.
    tts: { voice_id: c.voiceId, model_id: "eleven_flash_v2", optimize_streaming_latency: 3 },
    turn: { turn_eagerness: "eager", turn_timeout: 7 },
    conversation: { max_duration_seconds: Math.round(c.maxMinutes * 60) },
  };
}

async function _agentExists(agentId, env) {
  if (!agentId) return false;
  try { return (await _api(`/convai/agents/${agentId}`, { env })).ok; } catch { return false; }
}

function _requireKey(env) {
  if (!available(env)) {
    const err = new Error("ElevenLabs key not set — live voice disabled.");
    err.code = "NO_VOICE_KEY";
    throw err;
  }
}

/**
 * Ensure a CEO Studio agent exists AND matches the current config version.
 * Creates it if missing; PATCHes it if the stored config version is stale.
 * Returns { agentId }.
 */
async function ensureAgent({ env = process.env, projectName } = {}) {
  _requireKey(env);
  const store = _readStore();
  const conversation_config = _conversationConfig(env, { projectName });

  if (await _agentExists(store.agentId, env)) {
    if (store.configVersion !== CONFIG_VERSION) {
      const res = await _api(`/convai/agents/${store.agentId}`, {
        method: "PATCH", body: { conversation_config }, env,
      });
      if (res.ok) _writeStore({ ...store, configVersion: CONFIG_VERSION });
      // If PATCH fails we still reuse the existing agent (degrade, don't block).
    }
    return { agentId: store.agentId };
  }

  const res = await _api("/convai/agents/create", {
    method: "POST", body: { name: "CEO Studio", conversation_config }, env,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs create-agent ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  _writeStore({ ...store, agentId: data.agent_id, configVersion: CONFIG_VERSION });
  return { agentId: data.agent_id };
}

/** WebRTC conversation token (preferred for voice — best barge-in/interruption). */
async function getConversationToken(agentId, { env = process.env } = {}) {
  _requireKey(env);
  const res = await _api(`/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { env });
  if (!res.ok) throw new Error(`ElevenLabs token ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()).token;
}

/** Signed WebSocket URL (fallback path). */
async function getSignedUrl(agentId, { env = process.env } = {}) {
  _requireKey(env);
  const res = await _api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { env });
  if (!res.ok) throw new Error(`ElevenLabs signed-url ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()).signed_url;
}

function status(env = process.env) {
  const c = cfg(env);
  return {
    available: available(env),
    maxMinutes: c.maxMinutes,
    voiceId: c.voiceId,
    llm: c.llm,
    tools: TOOLS.map((t) => t.name),
    note: available(env) ? null : "ELEVENLABS_API_KEY not set — live voice disabled (text still works)",
  };
}

module.exports = {
  available, status, ensureAgent, getConversationToken, getSignedUrl, cfg,
  TOOLS, CONFIG_VERSION,
};
