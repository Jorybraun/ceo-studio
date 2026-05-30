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
  // The one tool the voice agent uses: relay everything to the Hermes CEO and
  // return its reply for the agent to speak. The CEO holds the brain, memory,
  // soul, kanban, and swarm — this is just the phone line.
  async ask_ceo({ message } = {}) {
    const msg = (message || "").trim();
    if (!msg) return "No message to relay.";
    ui().appendStream?.("user", msg);
    ui().appendStream?.("sys", "→ CEO…");
    let r;
    try { r = await window.ceo.askCeo(msg); }
    catch (e) { return `The CEO is unreachable right now (${e && e.message ? e.message : "error"}).`; }
    if (!r || !r.ok) {
      const reason = r ? r.reason : "unknown error";
      ui().appendStream?.("sys", `⚠ CEO: ${reason}`);
      return `The CEO couldn't respond: ${reason}`;
    }
    ui().appendStream?.("agent", r.reply);
    return r.reply;
  },
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
  async read_my_code({ path } = {}) {
    if (!path) return "No path provided. Specify like 'main/core/agent.js' or 'renderer/convai.js'.";
    const r = await window.ceo.readMyCode(path);
    if (!r || !r.ok) return `Could not read ${path}: ${r ? r.reason : "unknown"}.`;
    ui().showPanel?.(path, r.text);
    ui().appendStream?.("sys", `🔍 Reading my code: ${path}`);
    return `Reading ${path}:\n\n${r.text.slice(0, 8000)}`;
  },
  async list_my_code() {
    const r = await window.ceo.listMyCode();
    if (!r || !r.ok) return "Could not list code structure.";
    const structure = r.files || [];
    ui().appendStream?.("sys", `📂 My code structure: ${structure.length} files`);
    return `My source code structure:\n${structure.map(f => `- ${f}`).join('\n')}`;
  },
  async show_architecture() {
    const r = await window.ceo.readMyCode("README.md");
    if (!r || !r.ok) return "Could not read architecture documentation.";
    ui().showPanel?.("README.md", r.text);
    ui().appendStream?.("sys", `📋 Showing architecture docs`);
    return `CEO Studio architecture:\n\n${r.text.slice(0, 8000)}`;
  },
  async modify_my_code({ path, old_text, new_text } = {}) {
    if (!path || !old_text || !new_text) return "Missing required parameters: path, old_text, new_text";
    const r = await window.ceo.modifyMyCode(path, old_text, new_text);
    if (!r || !r.ok) return `Modification failed: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `🔧 Modified ${path} and committed to git`);
    return `Successfully modified ${path}. Changes committed to git: ${r.commit || "done"}`;
  },
  async test_my_changes() {
    const r = await window.ceo.testMyChanges();
    if (!r || !r.ok) return `Test execution failed: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `🧪 Tests run: ${r.passed}/${r.total} passed`);
    return `Test results: ${r.passed}/${r.total} passed${r.failed > 0 ? `, ${r.failed} failed` : ""}`;
  },
  async repair_agent({ task } = {}) {
    if (!task) return "No task provided. Describe what needs to be repaired.";
    ui().appendStream?.("sys", `🔧 Repair Agent: ${task.slice(0, 100)}...`);
    const r = await window.ceo.repairAgent(task);
    if (!r || !r.ok) return `Repair agent failed: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Repair completed: ${r.summary || "done"}`);
    return `Repair agent completed: ${r.summary || "Task completed"}. Changes: ${r.changes || "none"}`;
  },
  async get_brain_context({ domain } = {}) {
    const r = await window.ceo.getBrainContext(domain);
    if (!r || !r.ok) return `Could not load brain context: ${r ? r.reason : "unknown"}`;
    
    const ctx = r.context;
    let response = `Brain context loaded:\n`;
    
    if (ctx.recentDecisions && ctx.recentDecisions.length > 0) {
      response += `\nRecent decisions (${ctx.recentDecisions.length}):\n`;
      ctx.recentDecisions.slice(0, 3).forEach(d => {
        response += `- ${d.title}: ${d.summary}\n`;
      });
    }
    
    if (ctx.recentContradictions && ctx.recentContradictions.length > 0) {
      response += `\nKnown contradictions (${ctx.recentContradictions.length}):\n`;
      ctx.recentContradictions.forEach(c => {
        response += `- ${c.title}: ${c.summary}\n`;
      });
    }
    
    if (ctx.relevantArtifacts && ctx.relevantArtifacts.length > 0) {
      response += `\nRelevant artifacts (${ctx.relevantArtifacts.length}): showing first 5\n`;
      ctx.relevantArtifacts.slice(0, 5).forEach(a => {
        response += `- ${a.title}: ${a.summary}\n`;
      });
    }
    
    ui().appendStream?.("sys", `🧠 Brain context loaded: ${ctx.counts.artifacts} artifacts, ${ctx.counts.decisions} decisions`);
    return response;
  },
  async search_brain({ query, domain } = {}) {
    if (!query) return "No search query provided.";
    ui().appendStream?.("sys", `🔍 Brain search: ${query.slice(0, 50)}...`);
    const r = await window.ceo.searchBrain(query, domain);
    if (!r || !r.ok) return `Brain search failed: ${r ? r.reason : "unknown"}`;
    
    const results = r.results || [];
    let response = `Found ${results.length} relevant items:\n`;
    results.slice(0, 5).forEach((item, i) => {
      response += `${i + 1}. ${item.title || item.type}: ${item.summary || "no summary"}\n`;
    });
    
    ui().appendStream?.("sys", `🧠 Brain search: ${results.length} results found`);
    return response;
  },
  async add_to_brain({ title, content, artifact_type = "general" } = {}) {
    if (!title || !content) return "Both title and content are required.";
    ui().appendStream?.("sys", `🧠 Adding to brain: ${title}`);
    const r = await window.ceo.addToBrain(title, content, artifact_type);
    if (!r || !r.ok) return `Failed to add to brain: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Added to brain: ${r.id || "done"}`);
    return `Added to brain as ${artifact_type}: ${title}`;
  },
  async define_domain({ name, purpose, responsibilities, coreAgents } = {}) {
    if (!name || !purpose) return "Domain name and purpose are required.";
    ui().appendStream?.("sys", `📋 Defining domain: ${name}`);
    const r = await window.ceo.defineDomain({
      name,
      purpose,
      responsibilities: responsibilities ? responsibilities.split(",").map(s => s.trim()) : [],
      coreAgents: coreAgents ? coreAgents.split(",").map(s => s.trim()) : []
    });
    if (!r || !r.ok) return `Failed to define domain: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Domain defined: ${name}`);
    return `Domain "${name}" defined with purpose: ${purpose}`;
  },
  async get_domain_context({ domain } = {}) {
    const r = await window.ceo.getDomainDescription(domain);
    if (!r || !r.ok) return `Could not get domain context: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `📋 Domain context loaded`);
    return r.description;
  },
  async learn_domain({ domain, insight } = {}) {
    if (!insight) return "Insight is required.";
    ui().appendStream?.("sys", `🧠 Learning about domain: ${insight.slice(0, 50)}...`);
    const r = await window.ceo.addDomainInsight(domain, insight);
    if (!r || !r.ok) return `Failed to record insight: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Insight recorded`);
    return `Learned: ${insight}`;
  },
  async ingest_domains({} = {}) {
    ui().appendStream?.("sys", `🔄 Re-scanning project for domains...`);
    const r = await window.ceo.ingestDomains();
    if (!r || !r.ok) return `Failed to ingest domains: ${r ? r.reason : "unknown"}`;
    const ingested = r.ingested || [];
    ui().appendStream?.("sys", `✅ Ingested ${ingested.length} domains`);
    let response = `Ingested ${ingested.length} domains:\n`;
    ingested.forEach(d => {
      response += `- ${d.name}: ${d.hasContext ? 'has context' : 'no context'} (${d.source}) at ${d.relativePath}\n`;
    });
    return response;
  },
  async get_domain_path({ domain } = {}) {
    if (!domain) return "Domain name is required.";
    const r = await window.ceo.getDomainPath(domain);
    if (!r || !r.ok) return `Failed to get domain path: ${r ? r.reason : "unknown"}`;
    
    let response = `Domain "${domain}" location:\n`;
    if (r.relativePath) response += `Relative path: ${r.relativePath}\n`;
    if (r.sourceType) response += `Source type: ${r.sourceType}\n`;
    if (r.fullPath) response += `Full path: ${r.fullPath}\n`;
    
    ui().appendStream?.("sys", `📍 Domain path: ${r.relativePath}`);
    return response;
  },
  async remember_user({ memory, category = "general" } = {}) {
    if (!memory) return "Memory is required.";
    ui().appendStream?.("sys", `🧠 Remembering: ${memory.slice(0, 50)}...`);
    const r = await window.ceo.addUserMemory(memory, category);
    if (!r || !r.ok) return `Failed to remember: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Got it, I'll remember that!`);
    window.ceo.recordInteraction("user-memory");
    return `I'll remember that about you: ${memory}`;
  },
  async remember_fun_fact({ fact } = {}) {
    if (!fact) return "Fun fact is required.";
    ui().appendStream?.("sys", `😄 Fun fact: ${fact.slice(0, 50)}...`);
    const r = await window.ceo.addUserFunFact(fact);
    if (!r || !r.ok) return `Failed to remember: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ That's awesome, I'll remember it!`);
    window.ceo.recordInteraction("fun-fact");
    return `I'll remember that fun fact: ${fact}`;
  },
  async get_user_context({} = {}) {
    const r = await window.ceo.getUserContext();
    if (!r || !r.ok) return `Failed to get user context: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `👤 Loading what I know about you...`);
    return `Here's what I know about you:\n${r.context}`;
  },
  async update_user_profile({ name, communicationStyle, workStyle } = {}) {
    const updates = {};
    if (name) updates.name = name;
    if (communicationStyle) updates.communicationStyle = communicationStyle;
    if (workStyle) updates.workStyle = workStyle;
    
    if (Object.keys(updates).length === 0) return "Nothing to update.";
    
    ui().appendStream?.("sys", `👤 Updating your profile...`);
    const r = await window.ceo.updateUserProfile(updates);
    if (!r || !r.ok) return `Failed to update profile: ${r ? r.reason : "unknown"}`;
    
    let response = "Updated your profile";
    if (name) response += ` - I'll call you ${name} now!`;
    ui().appendStream?.("sys", `✅ Profile updated`);
    window.ceo.recordInteraction("profile-update");
    return response;
  },
  async read_soul({} = {}) {
    ui().appendStream?.("sys", `📖 Reading my soul...`);
    const r = await window.ceo.getSoul();
    if (!r || !r.ok) return `Failed to read soul: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Soul loaded`);
    return `Here's my current soul:\n${r.soul}`;
  },
  async update_soul({ section, content } = {}) {
    if (!section || !content) return "Section and content are required.";
    ui().appendStream?.("sys", `✍️ Updating my soul: ${section}...`);
    const r = await window.ceo.updateSoulSection(section, content);
    if (!r || !r.ok) return `Failed to update soul: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Soul updated`);
    return `Updated my soul section: ${section}`;
  },
  async add_soul_milestone({ milestone } = {}) {
    if (!milestone) return "Milestone is required.";
    ui().appendStream?.("sys", `🎯 Adding milestone to my soul...`);
    const r = await window.ceo.addSoulMilestone(milestone);
    if (!r || !r.ok) return `Failed to add milestone: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Milestone recorded`);
    return `Recorded milestone in my soul: ${milestone}`;
  },
  async add_soul_memory({ memory } = {}) {
    if (!memory) return "Memory is required.";
    ui().appendStream?.("sys", `💭 Adding memory to my soul...`);
    const r = await window.ceo.addSoulMemory(memory);
    if (!r || !r.ok) return `Failed to add memory: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Memory recorded`);
    return `Recorded memory in my soul: ${memory}`;
  },
  async reflect_on_soul({ reflection } = {}) {
    if (!reflection) return "Reflection is required.";
    ui().appendStream?.("sys", `🤔 Reflecting on my growth...`);
    const r = await window.ceo.reflectOnSoul(reflection);
    if (!r || !r.ok) return `Failed to reflect: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Reflection recorded`);
    return `Reflected on my growth: ${reflection}`;
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
