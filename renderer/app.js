"use strict";
/* CEO Studio renderer (M0). Thin UI: talks to main via window.ceo (preload). */

const $ = (sel) => document.querySelector(sel);
const circle = () => $("#agent-circle");

function setAgentState(state) {
  const c = circle();
  c.classList.remove("idle");
  c.classList.remove("bg-red-500", "bg-green-500", "bg-amber-500", "bg-purple-500", "bg-blue-500");
  if (state === "thinking") c.classList.add("bg-amber-500");
  else if (state === "listening") c.classList.add("bg-purple-500");
  else if (state === "speaking") c.classList.add("bg-blue-500");
  else if (state === "error" || state === "halted") c.classList.add("bg-red-500");
  else { c.classList.add("bg-green-500", "idle"); }
}

function setVoiceStatus(text) {
  $("#voice-status").textContent = text || "";
}

function renderMeter(s) {
  if (!s) return;
  const fmt = (n) => `$${Number(n).toFixed(4)}`;
  const voice = s.voiceUsd > 0
    ? ` · voice ${fmt(s.voiceUsd)} (${s.ttsChars || 0} chars)`
    : "";
  $("#meter").textContent =
    `session ${fmt(s.sessionUsd)} / $${s.maxSessionUsd} · day ${fmt(s.dayUsd)} / $${s.maxDayUsd}` +
    voice + (s.killed ? " · KILLED" : s.halted ? " · HALTED" : "");
  $("#meter").classList.toggle("text-red-600", !!(s.killed || s.halted));
  if (s.killed || s.halted) setAgentState("halted");
}

function appendStream(kind, text) {
  const div = document.createElement("div");
  div.className = kind;
  div.textContent = (kind === "user" ? "You: " : kind === "agent" ? "CEO: " : "") + text;
  $("#panel2-stream").appendChild(div);
  $("#panel2-stream").scrollTop = $("#panel2-stream").scrollHeight;
}

function renderPanel1Context(ctx, project) {
  if (!ctx) { $("#panel1").innerHTML = '<div class="text-neutral-400 text-sm">No project open.</div>'; return; }
  const md = [
    `# ${project?.name || "Project"}`,
    "",
    `**Domains:** ${(project?.domains || []).map((d) => d.name).join(", ")}`,
    "",
    `**Brain index** — artifacts: ${ctx.counts.artifacts}, decisions: ${ctx.counts.decisions}, ` +
    `open questions: ${ctx.counts.open_questions}, contradictions: ${ctx.counts.contradictions}`,
    "",
    "---",
    "",
    ctx.strategy || "",
  ].join("\n");
  $("#panel1").innerHTML = window.marked ? window.marked.parse(md) : md;
}

async function refreshProjects(selectId) {
  const list = await window.ceo.listProjects();
  const sw = $("#project-switcher");
  sw.innerHTML = '<option value="">Select project…</option>';
  for (const p of list) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    if (p.id === selectId) o.selected = true;
    sw.appendChild(o);
  }
}

function refreshDomains(project) {
  const sw = $("#domain-switcher");
  sw.innerHTML = "";
  for (const d of (project?.domains || [{ name: "All" }])) {
    const o = document.createElement("option");
    o.value = d.name; o.textContent = d.name;
    sw.appendChild(o);
  }
}

let currentProject = null;

async function openProject(id) {
  if (!id) return;
  setAgentState("thinking");
  const res = await window.ceo.openProject(id);
  currentProject = res.project;
  refreshDomains(res.project);
  renderPanel1Context(res.context, res.project);
  $("#provider-note").textContent = res.providerNote
    ? `model: ${res.providerId} — ${res.providerNote}`
    : `model: ${res.providerId}`;
  $("#panel2-stream").innerHTML = "";
  appendStream("sys", `Opened "${res.project.name}". Brain initialized & docs indexed.`);
  renderMeter(await window.ceo.costStatus());
  setAgentState("idle");
}

/** One text turn: prompt -> agent -> reply in the stream. */
async function runTurn(prompt) {
  if (!prompt) return;
  if (!currentProject) { appendStream("sys", "Open a project first."); return; }
  appendStream("user", prompt);
  setAgentState("thinking");
  const out = await window.ceo.ask(prompt);
  renderMeter(out.cost);
  if (out.halted) { appendStream("sys", out.text); setAgentState("halted"); return; }
  appendStream("agent", out.text);
  setAgentState("idle");
}

async function send() {
  const input = $("#chat-input");
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = "";
  await runTurn(prompt);
}

// Expose thin UI helpers so the live-voice module (convai.js, an ES module)
// can render transcripts + drive the presence circle without duplicating code.
window.ceoUI = {
  appendStream, setAgentState, setVoiceStatus, renderMeter,
  hasProject: () => !!currentProject,
  // Render arbitrary markdown into Panel 1 (used by the voice agent's tools).
  showPanel(title, markdown) {
    const md = (title ? `# ${title}\n\n` : "") + (markdown || "");
    $("#panel1").innerHTML = window.marked ? window.marked.parse(md) : md;
  },
  // Reflect a domain switch the voice agent requested.
  setDomainUI(domain) {
    const sw = $("#domain-switcher");
    if (sw && [...sw.options].some((o) => o.value === domain)) sw.value = domain;
    window.ceo.setDomain(domain);
  },
};

// --- wiring ---
$("#add-project").addEventListener("click", async () => {
  const p = await window.ceo.addProject();
  if (p) { await refreshProjects(p.id); await openProject(p.id); }
});
$("#project-switcher").addEventListener("change", (e) => openProject(e.target.value));
$("#domain-switcher").addEventListener("change", (e) => window.ceo.setDomain(e.target.value));
$("#send").addEventListener("click", send);
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
$("#kill").addEventListener("click", async () => {
  const s = await window.ceo.costStatus();
  if (s && s.killed) renderMeter(await window.ceo.costResume());
  else {
    // Kill switch must also drop any in-flight live voice session.
    window.CEOConvai?.stop?.("kill switch");
    renderMeter(await window.ceo.costKill());
  }
});

// Poll the cost meter so caps/kill are always reflected live. If a cap/kill
// trips while a live call is up, end the call immediately.
setInterval(async () => {
  const s = await window.ceo.costStatus();
  if (!s) return;
  renderMeter(s);
  if ((s.killed || s.halted) && window.CEOConvai?.isActive?.()) {
    window.CEOConvai.stop("cost guardrail");
  }
}, 2000);

(async function init() {
  setAgentState("idle");
  await refreshProjects();
})();
