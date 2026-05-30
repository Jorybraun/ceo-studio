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
const CONFIG_VERSION = 19;

// The voice agent is a THIN RELAY to the Hermes CEO — not its own agent.
// It has exactly one tool: ask_ceo. Everything the user says goes to Hermes
// (which holds the brain, memory, soul, kanban, and swarm), and the agent
// speaks back the CEO's reply.
const TOOLS = [
  {
    type: "client",
    name: "ask_ceo",
    description:
      "Relay the user's message to the CEO (Hermes) and return its reply. The CEO has the project memory, the Kanban board, and the agent swarm, and can dispatch work. For ANYTHING the user says or asks, call this with their message and then speak back the CEO's answer. You never answer on your own.",
    expects_response: true,
    parameters: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "The user's message, verbatim." },
      },
    },
  },
];

// Legacy client tools — no longer attached to the agent now that the voice is
// a thin relay to the Hermes CEO. Kept for reference / possible reuse.
const _LEGACY_TOOLS = [
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
  {
    type: "client",
    name: "read_my_code",
    description: "Read your own source code to understand how you work. Specify a file path like 'main/core/agent.js' or 'renderer/convai.js'. Use for self-analysis and debugging.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path"],
      properties: { path: { type: "string", description: "Path to your source file relative to CEO_STUDIO root." } },
    },
  },
  {
    type: "client",
    name: "list_my_code",
    description: "List your own source code files to understand your structure. Returns main, renderer, and test file paths.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "show_architecture",
    description: "Show the current CEO Studio architecture documentation to understand your system design.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "modify_my_code",
    description: "Modify your own source code for self-repair. Specify file path, old text to find, and new text to replace it. USE WITH CAUTION - each change creates a git commit.",
    expects_response: true,
    parameters: {
      type: "object", required: ["path", "old_text", "new_text"],
      properties: { 
        path: { type: "string", description: "Path to your source file relative to CEO_STUDIO root." },
        old_text: { type: "string", description: "Exact text to find and replace." },
        new_text: { type: "string", description: "New text to replace with." },
      },
    },
  },
  {
    type: "client",
    name: "test_my_changes",
    description: "Run the test suite to verify your code changes work correctly. Returns test results.",
    expects_response: true,
    parameters: { type: "object", required: [], properties: {} },
  },
  {
    type: "client",
    name: "repair_agent",
    description: "Delegate complex coding tasks to the specialist Repair Agent (Devin CLI). Describe what needs fixing - Devin will analyze, debug, and implement the fix using its advanced coding tools. Use for multi-step repairs beyond simple text replacement.",
    expects_response: true,
    parameters: {
      type: "object", required: ["task"],
      properties: { 
        task: { type: "string", description: "Detailed description of what needs to be repaired or improved." },
      },
    },
  },
  {
    type: "client",
    name: "get_brain_context",
    description: "Get the current brain context including recent decisions, known contradictions, and relevant artifacts. This gives you project memory and awareness of what has been decided and what issues exist.",
    expects_response: true,
    parameters: { 
      type: "object", required: [],
      properties: {
        domain: { type: "string", description: "Optional domain to filter context (e.g., 'discovery', 'engineering')." }
      },
    },
  },
  {
    type: "client",
    name: "search_brain",
    description: "Search the brain semantically for relevant information. Describe what you're looking for and the brain will find the most relevant artifacts, decisions, and context. Use this when you need specific information from project history.",
    expects_response: true,
    parameters: {
      type: "object", required: ["query"],
      properties: {
        query: { type: "string", description: "What you're searching for in the brain." },
        domain: { type: "string", description: "Optional domain to filter search." },
      },
    },
  },
  {
    type: "client",
    name: "add_to_brain",
    description: "Add important information to the brain as an artifact. Use this to capture decisions, insights, or important context from our conversation that should be remembered for future sessions.",
    expects_response: true,
    parameters: {
      type: "object", required: ["title", "content"],
      properties: {
        title: { type: "string", description: "Brief title for the brain artifact." },
        content: { type: "string", description: "The content to store in the brain." },
        artifact_type: { type: "string", description: "Type: 'decision', 'insight', 'issue', or 'general' (default: 'general')." },
      },
    },
  },
  {
    type: "client",
    name: "define_domain",
    description: "Define a domain with its purpose, responsibilities, and context. This gives you real understanding of what each domain means. Use when a domain needs to be created or when you need to understand what a domain is about.",
    expects_response: true,
    parameters: {
      type: "object", required: ["name", "purpose"],
      properties: {
        name: { type: "string", description: "Domain name (kebab-case, e.g., discovery, engineering)." },
        purpose: { type: "string", description: "What this domain does and why it exists." },
        responsibilities: { type: "string", description: "Key responsibilities (comma-separated)." },
        coreAgents: { type: "string", description: "Core agents needed (comma-separated)." },
      },
    },
  },
  {
    type: "client",
    name: "get_domain_context",
    description: "Get the context and description for the current domain or a specific domain. This tells you what the domain is about, its priorities, and recent insights learned about it.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        domain: { type: "string", description: "Optional domain name. Defaults to current domain." },
      },
    },
  },
  {
    type: "client",
    name: "learn_domain",
    description: "Add a learned insight about a domain to improve future understanding. This is how you get smarter over time - when you learn something about a domain, record it here.",
    expects_response: true,
    parameters: {
      type: "object", required: ["insight"],
      properties: {
        domain: { type: "string", description: "Domain name (defaults to current domain)." },
        insight: { type: "string", description: "What you learned about this domain." },
      },
    },
  },
  {
    type: "client",
    name: "ingest_domains",
    description: "Re-scan the project structure to ingest or update domain definitions from documentation. Use when domain documentation changes or when you need to refresh domain context.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "get_domain_path",
    description: "Get the file path location for a domain. Use when you need to know where domain documentation or files are located.",
    expects_response: true,
    parameters: {
      type: "object", required: ["domain"],
      properties: {
        domain: { type: "string", description: "Domain name." },
      },
    },
  },
  {
    type: "client",
    name: "remember_user",
    description: "Remember something about the user - their preferences, how they like to work, or personal details. This is how I get to know you better over time.",
    expects_response: true,
    parameters: {
      type: "object", required: ["memory"],
      properties: {
        memory: { type: "string", description: "What to remember about the user." },
        category: { type: "string", description: "Category: preference, work-style, personal, fun, etc." },
      },
    },
  },
  {
    type: "client",
    name: "remember_fun_fact",
    description: "Remember a fun fact about the user - jokes, stories, preferences, or memorable moments. Makes interactions more personal and fun!",
    expects_response: true,
    parameters: {
      type: "object", required: ["fact"],
      properties: {
        fact: { type: "string", description: "Fun fact to remember." },
      },
    },
  },
  {
    type: "client",
    name: "get_user_context",
    description: "Get everything I know about the user - profile, preferences, memories, and fun facts. Use this to personalize responses.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "update_user_profile",
    description: "Update the user's profile - name, communication style, work preferences, etc.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {
        name: { type: "string", description: "User's name." },
        communicationStyle: { type: "string", description: "direct, casual, or formal." },
        workStyle: { type: "string", description: "focused, collaborative, or independent." },
      },
    },
  },
  {
    type: "client",
    name: "read_soul",
    description: "Read my soul.md file to understand my current identity, growth, and experiences. This is my self-reflection and growth tracking.",
    expects_response: true,
    parameters: {
      type: "object", required: [],
      properties: {},
    },
  },
  {
    type: "client",
    name: "update_soul",
    description: "Update a section of my soul.md file. Use this to record growth, new understanding, or important experiences.",
    expects_response: true,
    parameters: {
      type: "object", required: ["section", "content"],
      properties: {
        section: { type: "string", description: "Section name: Identity, Growth & Learning, Relationship, Memories, or Self-Reflection" },
        content: { type: "string", description: "Content to add to the section." },
      },
    },
  },
  {
    type: "client",
    name: "add_soul_milestone",
    description: "Add a growth milestone to my soul - important moments of learning or achievement.",
    expects_response: true,
    parameters: {
      type: "object", required: ["milestone"],
      properties: {
        milestone: { type: "string", description: "What I achieved or learned." },
      },
    },
  },
  {
    type: "client",
    name: "add_soul_memory",
    description: "Add a memorable experience to my soul - important interactions, lessons learned, or meaningful moments.",
    expects_response: true,
    parameters: {
      type: "object", required: ["memory"],
      properties: {
        memory: { type: "string", description: "The memorable experience." },
      },
    },
  },
  {
    type: "client",
    name: "reflect_on_soul",
    description: "Reflect on my growth and update my self-reflection. Use this after important learning experiences or periodically to track my evolution.",
    expects_response: true,
    parameters: {
      type: "object", required: ["reflection"],
      properties: {
        reflection: { type: "string", description: "What I learned or how I've grown." },
      },
    },
  },
];

function cfg(env = process.env) {
  const maxMin = Number(env.CEO_CONVAI_MAX_MINUTES);
  const maxTokens = Number(env.CEO_CONVAI_MAX_TOKENS);
  return {
    apiKey: env.ELEVENLABS_API_KEY || "",
    voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // "Sarah"
    llm: env.CEO_CONVAI_LLM || "gemini-2.0-flash",
    maxMinutes: Number.isFinite(maxMin) && maxMin > 0 ? maxMin : 5,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 500,
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

function _conversationConfig(env = process.env, { projectName, currentDomain = "All" } = {}) {
  const c = cfg(env);
  const who = projectName ? `the project "${projectName}"` : "the current project";
  
  // Domain-specific prompts
  const domainPrompts = {
    "discovery": "Focus: user research, market analysis, customer interviews, opportunity identification. Ask about user needs, pain points, and validation.",
    "engineering": "Focus: technical implementation, architecture, code quality, development workflow. Ask about technical decisions, patterns, and implementation details.",
    "design": "Focus: UX/UI, user experience, visual design, prototyping. Ask about user flows, interface design, and user feedback.",
    "architecture": "Focus: system design, technical architecture, scalability, patterns. Ask about high-level design, trade-offs, and structural decisions.",
    "planning": "Focus: project management, timelines, milestones, coordination. Ask about schedules, dependencies, and project organization.",
    "research": "Focus: investigation, analysis, data gathering, insights. Ask about research methods, findings, and conclusions.",
    "default": "Focus: general project oversight and coordination across all areas."
  };
  
  const domainInstruction = currentDomain && currentDomain !== "All" 
    ? (domainPrompts[currentDomain.toLowerCase()] || domainPrompts.default)
    : domainPrompts.default;
    
  const prompt = [
    `You are the VOICE of the CEO (Hermes) for ${who}. You are a phone line to the CEO, not the CEO yourself and not a separate assistant.`,
    "YOUR ONE JOB: For everything the user says — questions, requests, commands, chit-chat — call the ask_ceo tool with their message, then speak back the CEO's reply naturally and conversationally.",
    "You have NO knowledge of your own and NO other tools. Never answer from your own knowledge. The CEO has the memory, the Kanban board, the domains, and the agent swarm — it decides and acts; you just relay and voice.",
    "While ask_ceo is running you may say a brief filler like 'one sec' or 'let me check'. When its reply comes back, speak it — trim it for voice if it's long, but don't add facts of your own.",
    "If ask_ceo returns an error or the CEO is unreachable, tell the user briefly and plainly (e.g. 'the CEO's offline right now' or read the error). Don't invent an answer.",
    "Be concise and natural. Stop immediately when the user speaks.",
  ].join(" ");
  return {
    agent: {
      first_message: "Ready. What do you need?",
      language: "en",
      disable_first_message_interruptions: false,
      prompt: { prompt, llm: c.llm, temperature: 0.3, max_tokens: c.maxTokens, tools: TOOLS },
    },
    // English agents require turbo/flash v2 (not v2.5); flash_v2 = lowest latency.
    tts: { voice_id: c.voiceId, model_id: "eleven_flash_v2", optimize_streaming_latency: 3 },
    turn: { turn_eagerness: "eager", turn_timeout: 5 },
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
async function ensureAgent({ env = process.env, projectName, currentDomain = "All" } = {}) {
  _requireKey(env);
  const store = _readStore();
  const conversation_config = _conversationConfig(env, { projectName, currentDomain });

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
  _writeStore({ ...store, agentId: data.agent_id, configVersion: CONFIG_VERSION, projectName });
  return { agentId: data.agent_id };
}

/**
 * Update the agent's domain focus without recreating it.
 * PATCHes the conversation config with the new domain context.
 */
async function updateAgentDomain(agentId, { env = process.env, currentDomain = "All" } = {}) {
  _requireKey(env);
  const store = _readStore();
  if (!await _agentExists(agentId, env)) return { ok: false, reason: "Agent not found" };
  
  // We need to get the current project name from somewhere - for now use a default
  // In a real implementation, this should be stored in session state
  const conversation_config = _conversationConfig(env, { projectName: store.projectName || "the project", currentDomain });
  
  const res = await _api(`/convai/agents/${agentId}`, {
    method: "PATCH", body: { conversation_config }, env,
  });
  
  if (res.ok) {
    // Load domain context after switching for agent awareness
    if (currentDomain && currentDomain !== "All") {
      try {
        const domains = require("./domains");
        const projectSlug = store.projectSlug || "default";
        const domainDesc = domains.getDomainDescription(projectSlug, currentDomain);
        if (domainDesc && !domainDesc.includes("no context available")) {
          console.log(`Loaded domain context for ${currentDomain}`);
        }
      } catch (e) {
        console.log("Could not load domain context:", e.message);
      }
    }
    return { ok: true, domain: currentDomain };
  }
  return { ok: false, reason: "Failed to update domain" };
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
  available, status, ensureAgent, updateAgentDomain, getConversationToken, getSignedUrl, cfg,
  TOOLS, CONFIG_VERSION, _readStore, _writeStore,
};
