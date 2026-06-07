"use strict";
/* CEO Studio renderer (M0). Thin UI: talks to main via window.ceo (preload). */

const $ = (sel) => document.querySelector(sel);
const circle = () => $("#agent-circle");
const panelContent = () => $("#panel-content-body") || $("#panel-content") || $("#panel1");

function setAgentState(state) {
  const c = circle();
  if (!c) return;
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
  const stream = $("#panel2-stream");
  if (!stream) return;
  const div = document.createElement("div");
  div.className = kind;
  div.textContent = (kind === "user" ? "You: " : kind === "agent" ? "CEO: " : "") + text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

function renderPanel1Context(ctx, project) {
  if (!ctx) { panelContent().innerHTML = '<div class="text-neutral-400 text-sm">No project open.</div>'; return; }
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
  panelContent().innerHTML = window.marked ? window.marked.parse(md) : md;
  setPanelTitle(project?.name || "Project");
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

let currentProject = null;
let currentDomain = "All";
let selectedFile = null;
let filePaneOpen = false;
let panelFullscreen = false;
let focusedTask = null;
let briefRunOpsTimer = null;
let ceoContextTray = [];
let chatInputContexts = [];   // { path, title } file references attached to the chat composer
let domainArchitectSession = null;
let escalationPanelOpen = false;
let escalationNotifications = [];

function setPanelTitle(text) {
  const title = $("#panel-title");
  if (title) title.textContent = text || "Panel";
}

function notificationBody(n) {
  const reason = n.reason ? `<div class="mt-1 text-xs text-neutral-400">${esc(n.reason)}</div>` : "";
  return `
    <div class="border-b border-neutral-800 p-3" data-notification-id="${esc(n.id)}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-neutral-100">${esc(n.title || "Human attention needed")}</div>
          <div class="mt-0.5 text-[11px] font-mono text-neutral-500">${esc(n.board || "board")} / ${esc(n.taskId || "task")}</div>
        </div>
        <span class="rounded border border-red-800/60 bg-red-950/40 px-1.5 py-0.5 text-[10px] uppercase text-red-300">${esc(n.severity || "high")}</span>
      </div>
      <div class="mt-2 text-xs leading-5 text-neutral-300">${esc(n.body || "Decision required.")}</div>
      ${reason}
      <div class="mt-3 flex gap-2">
        <button class="notif-open rounded-md bg-cyan-700 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-600">${esc(n.actionLabel || "Open task")}</button>
        <button class="notif-ack rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">Acknowledge</button>
      </div>
    </div>`;
}

function renderEscalationPanel() {
  const panel = $("#human-escalation-panel");
  if (!panel) return;
  if (!escalationPanelOpen) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="sticky top-0 border-b border-neutral-800 bg-neutral-950 p-3">
      <div class="text-sm font-semibold text-neutral-100">Human escalations</div>
      <div class="mt-0.5 text-xs text-neutral-500">Blocked work that needs your decision or access.</div>
    </div>
    ${escalationNotifications.length
      ? escalationNotifications.map(notificationBody).join("")
      : '<div class="p-4 text-sm text-neutral-500">No human escalations.</div>'}`;
}

async function refreshEscalations() {
  if (!currentProject || !window.ceo.notificationsList) {
    escalationNotifications = [];
  } else {
    const r = await window.ceo.notificationsList({ type: "human_escalation", includeRead: false, limit: 20 }).catch(() => null);
    escalationNotifications = (r && r.ok && r.notifications) || [];
  }
  const badge = $("#human-escalation-count");
  const button = $("#human-escalations");
  const count = escalationNotifications.length;
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }
  if (button) {
    button.classList.toggle("border-red-700", count > 0);
    button.classList.toggle("text-red-200", count > 0);
  }
  renderEscalationPanel();
}

function renderArchitectureOverview() {
  const ui = {
    title: "Current architecture",
    components: [
      {
        type: "card",
        title: "PIPE Discovery Micro-App: current code path",
        body: "The main process owns project state, domain scope, the project brain, Hermes relay, GBrain, jobs, voice, and all IPC. The renderer is a thin cockpit; preload exposes the only safe API surface.",
      },
      {
        type: "mermaid",
        diagram: [
          "flowchart TB",
          "  U[User / Operator] --> R[Renderer UI\nrenderer/app.js + dashboard.js]",
          "  R --> P[Preload bridge\nwindow.ceo IPC API]",
          "  P --> M[Main process\nmain/index.js]",
          "  M --> S[Session state\nproject / domain / cost / provider / agent]",
          "  M --> D[Domain store\nmain/core/domains.js]",
          "  M --> B[Project brain\nmain/core/brain.js]",
          "  M --> G[GBrain bridge\nmain/core/gbrain.js + gbrain CLI]",
          "  M --> H[Hermes CEO relay\nmain/core/hermes.js]",
          "  M --> J[Job queue + ticket packs\nmain/core/jobs.js + ticket-planner.js]",
          "  M --> V[Voice / ConvAI\nmain/core/voice.js + convai.js]",
          "  M --> A[AGUI server\nmain/core/agui-server.js]",
          "  A --> R",
          "  B --> T[Docs / artifacts index]",
          "  D --> T",
          "  H --> K[Kanban / swarm / room]\n",
          "  P --> C[Renderer panel renderers\nmarked + mermaid + registry]",
          "  C --> L[Left panel\n#panel1]",
        ].join("\n"),
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Renderer is thin and never touches Node directly.",
          "Main is the authority for state, file access, and live CEO operations.",
          "Project brain and GBrain are separate knowledge paths; Hermes is the conversational CEO.",
          "The left panel can render markdown, cards, and Mermaid diagrams through AGUI or direct panel rendering.",
        ],
      },
    ],
  };
  if (window.CEOAgui && window.CEOAgui.showAgui) window.CEOAgui.showAgui(ui);
  else {
    setPanelTitle(ui.title);
    const fallback = [`# ${ui.title}`, "", "```mermaid", ui.components[1].diagram, "```"].join("\n");
    panelContent().innerHTML = window.marked ? window.marked.parse(fallback) : fallback;
  }
}

function setStudioFocus(title, subtitle, mode = "Studio") {
  const modeEl = $("#studio-mode-pill");
  const titleEl = $("#studio-focus-title");
  const subEl = $("#studio-focus-subtitle");
  if (modeEl) modeEl.textContent = mode;
  if (titleEl) titleEl.textContent = title || "Project cockpit";
  if (subEl) subEl.textContent = subtitle || "Open a project, pick a domain, or click a kanban task to start a planning session.";
}

function setFilePaneOpen(open) {
  filePaneOpen = !!open;
  const pane = $("#file-pane");
  const toggle = $("#file-pane-toggle");
  if (pane) pane.classList.toggle("hidden", !filePaneOpen);
  if (toggle) {
    toggle.textContent = filePaneOpen ? "×" : "☰";
    toggle.title = filePaneOpen ? "Hide files" : "Show files";
  }
}

function setPanelFullscreen(on) {
  panelFullscreen = !!on;
  const panel = $("#panel1");
  const btn = $("#panel-fullscreen");
  if (panel) panel.classList.toggle("panel-fullscreen", panelFullscreen);
  if (btn) {
    btn.textContent = panelFullscreen ? "⛌" : "⛶";
    btn.title = panelFullscreen ? "Exit fullscreen" : "Toggle fullscreen";
  }
}

async function refreshDomains(project, selectName = currentDomain) {
  const sw = $("#domain-switcher");
  sw.innerHTML = "";
  let list = project?.domains || [{ name: "All" }];
  try {
    const r = await window.ceo.getAllDomains();
    if (r && r.ok && r.domains && r.domains.length) {
      const byName = new Map(list.map((d) => [d.name.toLowerCase(), d]));
      for (const d of r.domains) if (!byName.has(d.name.toLowerCase())) byName.set(d.name.toLowerCase(), d);
      list = [...byName.values()];
    }
  } catch { /* domain store is optional before project open */ }
  if (!list.some((d) => d.name === "All")) list.unshift({ name: "All" });
  for (const d of list) {
    const o = document.createElement("option");
    o.value = d.name; o.textContent = d.name;
    if (d.name === selectName) o.selected = true;
    sw.appendChild(o);
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function slugifyName(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "new-domain";
}

function splitLines(s) {
  return String(s || "")
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function agentLabel(agent) {
  return agent?.name || agent?.displayName || agent?.id || agent?.profile || "agent";
}

function personaLabel(persona) {
  return persona?.name || persona?.id || "persona";
}

function skillLabel(skill) {
  return skill?.name || skill?.id || "skill";
}

function renderTreeNodes(nodes, depth = 0) {
  return (nodes || []).map((n) => {
    const pad = `padding-left:${depth * 10 + 4}px`;
    if (n.type === "dir") {
      return `<details open>
        <summary class="cursor-pointer select-none rounded px-1 py-0.5 hover:bg-neutral-800/70 text-neutral-500" style="${pad}">${esc(n.name)}</summary>
        ${renderTreeNodes(n.children, depth + 1)}
      </details>`;
    }
    return `<button class="file-node block w-full text-left rounded px-1 py-0.5 hover:bg-neutral-800/70 text-neutral-300 truncate" style="${pad}" data-path="${esc(n.path)}" title="${esc(n.path)}">${esc(n.name)}</button>`;
  }).join("");
}

async function refreshFileTree(domain = currentDomain) {
  const host = $("#file-tree");
  if (!host) return;
  if (!currentProject) {
    host.innerHTML = '<div class="text-neutral-600 px-1 py-2">Open a project to browse files.</div>';
    return;
  }
  host.innerHTML = '<div class="text-neutral-600 px-1 py-2">Loading files...</div>';
  try {
    const r = await window.ceo.docsTree(domain);
    if (!r || !r.ok) {
      host.innerHTML = `<div class="text-red-400/80 px-1 py-2">${esc(r ? r.reason : "Could not load files")}</div>`;
      return;
    }
    const note = r.truncated ? '<div class="text-[11px] text-amber-400/80 px-1 py-1">File list truncated.</div>' : "";
    host.innerHTML = `${note}${renderTreeNodes(r.tree) || '<div class="text-neutral-600 px-1 py-2">No readable files found.</div>'}`;
  } catch (e) {
    host.innerHTML = `<div class="text-red-400/80 px-1 py-2">${esc(e.message)}</div>`;
  }
}

async function showFile(path) {
  if (!path) return;
  const r = await window.ceo.docsRead(path);
  if (!r || !r.ok) {
    setVoiceStatus(`Could not open ${path}: ${r ? r.reason : "unknown"}`);
    return;
  }
  selectedFile = { path, text: r.text };
  window.ceoUI.showPanel(path, r.text);
  setFilePaneOpen(false);
  setVoiceStatus(`Showing ${path}`);
  window.CEOConvai?.syncContext?.(`opened file ${path}`);
}

function renderTaskMarkdown({ board, task, comments = [] }) {
  const status = task.status || task.state || "";
  const meta = [
    task.id ? `- **Task:** \`${task.id}\`` : "",
    board ? `- **Board:** \`${board}\`` : "",
    status ? `- **Status:** ${status}` : "",
    task.assignee ? `- **Owner:** ${task.assignee}` : "",
    task.priority ? `- **Priority:** P${task.priority}` : "",
  ].filter(Boolean).join("\n");
  const body = String(task.body || "").trim() || "_No task body yet._";
  const commentMd = comments.length
    ? comments.map((c) => {
        const who = c.author || c.created_by || "comment";
        const when = c.created_at ? new Date(c.created_at * 1000).toLocaleString() : "";
        return `### ${who}${when ? ` · ${when}` : ""}\n\n${String(c.body || "").trim()}`;
      }).join("\n\n")
    : "_No comments yet._";
  return [
    `# ${task.title || "Planning task"}`,
    "",
    "## Planning Brief",
    "",
    meta || "_No metadata._",
    "",
    "## Current Task Body",
    "",
    body,
    "",
    "## Discussion / Evidence",
    "",
    commentMd,
    "",
    "---",
    "",
    "## Planning Moves",
    "",
    "- Ask the CEO to clarify the desired outcome, constraints, and acceptance criteria.",
    "- Ask for the domain boundary if this spans more than one domain.",
    "- Ask which agents/personas should participate before execution begins.",
  ].join("\n");
}

function assigneeName(a) {
  return typeof a === "string" ? a : (a.profile || a.name || a.assignee || a.id || "");
}

function safeIpc(call, fallback = null) {
  try { return Promise.resolve(call()).catch(() => fallback); }
  catch { return Promise.resolve(fallback); }
}

function taskGoalLinks(goalsRes, taskId) {
  const goals = (goalsRes && goalsRes.goals) || [];
  return goals.filter((goal) =>
    (goal.links || []).some((link) => String(link.workId || "") === String(taskId || "")));
}

function renderTaskContextPanel({ task, provenance, goalsRes, autonomyRes }) {
  const taskId = task && task.id;
  const events = (provenance && provenance.events) || [];
  const children = events.filter((event) => event.parent && String(event.parent.id || "") === String(taskId || "") && event.child).map((event) => event.child);
  const parents = events.filter((event) => event.child && String(event.child.id || "") === String(taskId || "") && event.parent).map((event) => ({
    ...event.parent,
    relationship: event.metadata && event.metadata.relationship,
  }));
  const assets = events.filter((event) => event.parent && String(event.parent.id || "") === String(taskId || "") && event.asset).map((event) => event.asset);
  const linkedGoals = taskGoalLinks(goalsRes, taskId);
  const autonomyOk = autonomyRes && autonomyRes.ok;
  const policy = (autonomyOk && autonomyRes.policy) || {};
  const state = (autonomyOk && autonomyRes.state) || {};
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : "never";
  const goalsHtml = linkedGoals.length
    ? linkedGoals.slice(0, 4).map((goal) => `<div class="rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
        <div class="text-[10px] uppercase tracking-wider text-neutral-600">${esc(goal.layer || "goal")} · ${esc(goal.status || "active")}</div>
        <div class="mt-1 text-sm leading-snug text-neutral-200">${esc(goal.title || goal.id)}</div>
        ${goal.outcome ? `<div class="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">${esc(goal.outcome)}</div>` : ""}
      </div>`).join("")
    : `<div class="text-xs text-neutral-600">No goal link recorded for this task.</div>`;
  const parentHtml = parents.length
    ? parents.slice(0, 5).map((parent) => `<div class="flex items-start gap-2 text-xs">
        <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70"></span>
        <span class="min-w-0"><span class="font-mono text-neutral-400">${esc(parent.id)}</span>${parent.title ? ` <span class="text-neutral-500">${esc(parent.title)}</span>` : ""}${parent.relationship ? ` <span class="text-neutral-700">${esc(parent.relationship)}</span>` : ""}</span>
      </div>`).join("")
    : `<div class="text-xs text-neutral-600">No parent brief recorded.</div>`;
  const childHtml = children.length
    ? children.slice(0, 5).map((child) => `<div class="flex items-start gap-2 text-xs">
        <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500/70"></span>
        <span class="min-w-0"><span class="font-mono text-neutral-400">${esc(child.id)}</span>${child.title ? ` <span class="text-neutral-500">${esc(child.title)}</span>` : ""}</span>
      </div>`).join("")
    : `<div class="text-xs text-neutral-600">No child work recorded.</div>`;
  const assetHtml = assets.length
    ? assets.slice(0, 5).map((asset) => `<div class="flex items-start gap-2 text-xs">
        <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70"></span>
        <span class="min-w-0"><span class="text-neutral-300">${esc(asset.title || asset.id)}</span>${asset.path ? ` <span class="break-all font-mono text-neutral-600">${esc(asset.path)}</span>` : ""}</span>
      </div>`).join("")
    : `<div class="text-xs text-neutral-600">No assets recorded.</div>`;
  return `<div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
    <div class="text-[10px] uppercase tracking-wider text-neutral-600">Planning Context</div>
    <div class="mt-3 space-y-3">
      <div>
        <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-700">Goal alignment</div>
        <div class="space-y-2">${goalsHtml}</div>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <div>
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-700">Parent brief</div>
          <div class="space-y-1.5">${parentHtml}</div>
        </div>
        <div>
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-700">Child work</div>
          <div class="space-y-1.5">${childHtml}</div>
        </div>
        <div>
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-700">Assets</div>
          <div class="space-y-1.5">${assetHtml}</div>
        </div>
      </div>
      <div class="rounded-lg border border-neutral-800 bg-neutral-950/55 p-2 text-xs leading-5 text-neutral-500">
        Autonomy: <span class="${autonomyRes && autonomyRes.running ? "text-emerald-300" : "text-neutral-300"}">${autonomyRes && autonomyRes.running ? "running" : "stopped"}</span>
        ${autonomyOk ? ` · ${esc(policy.mode || "propose")} · interval ${esc(policy.intervalMinutes || 60)}m · last ${esc(lastRun)}` : ` · ${esc((autonomyRes && autonomyRes.reason) || "unavailable")}`}
      </div>
    </div>
  </div>`;
}

function briefRunRows(items, emptyText, formatter) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return `<div class="text-xs text-neutral-600">${esc(emptyText)}</div>`;
  return rows.slice(-8).reverse().map(formatter).join("");
}

function meetingProposalActionLabel(type) {
  return {
    decision: "Record decision",
    agenda: "Approve agenda",
    blocker: "Approve & block",
    evidence: "Attach evidence",
    completion: "Record completion",
  }[type] || "Approve";
}

function meetingProposalCard(proposal, synthesis) {
  const pending = proposal.status === "pending";
  const tone = {
    decision: "border-cyan-900/60 text-cyan-200",
    agenda: "border-amber-900/60 text-amber-200",
    blocker: "border-red-900/60 text-red-200",
    evidence: "border-emerald-900/60 text-emerald-200",
    completion: "border-violet-900/60 text-violet-200",
  }[proposal.type] || "border-neutral-800 text-neutral-300";
  return `<article class="rounded-lg border ${tone} bg-neutral-950/55 p-3">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] uppercase text-neutral-600">${esc(proposal.type || "proposal")}</div>
        <div class="mt-1 text-xs font-medium text-neutral-200">${esc(proposal.title || proposal.body || "Meeting proposal")}</div>
      </div>
      <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] ${pending ? "text-amber-300" : proposal.status === "materialized" ? "text-emerald-300" : "text-neutral-500"}">${esc(proposal.status || "pending")}</span>
    </div>
    <div class="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-neutral-400">${esc(proposal.body || "")}</div>
    ${pending ? `<div class="mt-3 flex flex-wrap gap-1.5">
      <button type="button" class="brief-run-proposal-action rounded-md ${proposal.type === "blocker" ? "bg-red-700 hover:bg-red-600" : "bg-cyan-700 hover:bg-cyan-600"} px-2 py-1 text-[10px] text-white" data-action="approve" data-synthesis-id="${esc(synthesis.id)}" data-proposal-id="${esc(proposal.id)}" data-proposal-type="${esc(proposal.type)}">${esc(meetingProposalActionLabel(proposal.type))}</button>
      <button type="button" class="brief-run-proposal-action rounded-md border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-action="reject" data-synthesis-id="${esc(synthesis.id)}" data-proposal-id="${esc(proposal.id)}" data-proposal-type="${esc(proposal.type)}">Reject</button>
    </div>` : ""}
  </article>`;
}

function meetingSynthesisCard(synthesis) {
  const proposals = synthesis.proposals || [];
  const pending = proposals.filter((item) => item.status === "pending").length;
  return `<article id="brief-run-synthesis-${esc(synthesis.id)}" class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-xs font-medium text-neutral-200">${esc(synthesis.title || synthesis.room || "Meeting synthesis")}</div>
        <div class="mt-1 truncate font-mono text-[10px] text-neutral-600">${esc(synthesis.room || synthesis.meetingId || "")}</div>
      </div>
      <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] ${pending ? "text-amber-300" : "text-emerald-300"}">${pending ? `${pending} pending` : "reviewed"}</span>
    </div>
    ${synthesis.requirementsPath ? `<button type="button" class="brief-run-open-asset mt-2 max-w-full truncate font-mono text-[10px] text-cyan-400 hover:text-cyan-300" data-path="${esc(synthesis.requirementsPath)}">${esc(synthesis.requirementsPath)}</button>` : ""}
    <div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">${proposals.map((proposal) => meetingProposalCard(proposal, synthesis)).join("")}</div>
  </article>`;
}

function briefRunMeetingCard(meeting) {
  const transcript = (meeting.transcript || []).slice(-4);
  const scheduled = meeting.scheduledFor ? new Date(meeting.scheduledFor).toLocaleString() : "";
  const room = meeting.room || "";
  const statusColor = meeting.status === "done"
    ? "text-emerald-300"
    : meeting.status === "running"
      ? "text-cyan-300"
      : "text-amber-300";
  return `<article class="brief-run-meeting rounded-lg border border-neutral-800 bg-neutral-950/55 p-3" data-meeting-id="${esc(meeting.id || "")}" data-room="${esc(room)}" data-synthesis-id="${esc(meeting.synthesisId || "")}">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-medium text-neutral-200">${esc(meeting.title || meeting.agenda || meeting.id || "Meeting")}</div>
        <div class="mt-1 truncate text-[10px] text-neutral-600">${esc(room || scheduled || "not started")}</div>
      </div>
      <span class="brief-run-meeting-status rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] ${statusColor}">${esc(meeting.status || "scheduled")}</span>
    </div>
    <div class="mt-2 text-[11px] leading-5 text-neutral-500">${esc(meeting.criteria || meeting.agenda || "")}</div>
    <pre class="brief-run-meeting-feed mt-2 max-h-32 overflow-auto rounded-md border border-neutral-800 bg-black/65 p-2 font-mono text-[10px] leading-relaxed text-neutral-400 whitespace-pre-wrap">${esc(transcript.length ? transcript.map((entry) => `[${entry.speaker || "agent"}] ${entry.body || ""}`).join("\n\n") : (room ? "Waiting for room activity..." : scheduled ? `Scheduled ${scheduled}` : "No room activity."))}</pre>
    <div class="brief-run-meeting-requirements ${meeting.requirements ? "" : "hidden"} mt-2 max-h-28 overflow-auto rounded-md border border-emerald-900/50 bg-emerald-950/10 p-2 text-[10px] leading-5 text-emerald-100/75 whitespace-pre-wrap">${esc(meeting.requirements || "")}</div>
    <div class="mt-2 flex flex-wrap gap-1.5">
      ${room ? `<button type="button" class="brief-run-meeting-refresh rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-room="${esc(room)}">Refresh</button>
        <button type="button" class="brief-run-meeting-open rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-room="${esc(room)}">Open room</button>` : ""}
      ${meeting.requirements && meeting.synthesisId ? `<button type="button" class="brief-run-jump-synthesis rounded-md border border-amber-800/70 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-950/30" data-synthesis-id="${esc(meeting.synthesisId)}">${meeting.pendingProposalCount ? `Review ${meeting.pendingProposalCount}` : "Reviewed"}</button>` : ""}
      ${meeting.requirements && !meeting.synthesisId ? `<button type="button" class="brief-run-meeting-synthesize rounded-md border border-amber-800/70 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-950/30" data-meeting-id="${esc(meeting.id)}">Synthesize</button>` : ""}
      ${!room && meeting.status === "scheduled" ? `<button type="button" class="brief-run-meeting-start-scheduled rounded-md bg-cyan-700 px-2 py-1 text-[10px] text-white hover:bg-cyan-600" data-meeting-id="${esc(meeting.id)}">Start now</button>` : ""}
    </div>
  </article>`;
}

function renderBriefRunWorkspace(workspace, task) {
  if (!workspace || !workspace.ok || !workspace.applicable || !workspace.run) return "";
  const run = workspace.run;
  const brief = run.brief || {};
  const validation = run.validation || {};
  const clean = validation.ok === true;
  const missing = validation.missing || [];
  const warnings = validation.warnings || [];
  const checklist = run.progressChecklist || [];
  const linkedSessions = workspace.sessions || [];
  const activeAgents = workspace.activeAgents || [];
  const linkedMeetings = workspace.meetings || [];
  const meetingSyntheses = workspace.meetingSyntheses || run.meetingSyntheses || [];
  const agendaItems = workspace.agendaItems || [];
  const assets = workspace.assets || [];
  const completedWork = workspace.completedWork || [];
  const meetingMembers = [...new Set(activeAgents.map((agent) => agent.agentId).filter(Boolean))].join(",") || "ceo";
  const sessionRows = briefRunRows(linkedSessions, "No linked sessions.", (session) => `
    <button type="button" class="brief-run-open-session flex w-full items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2 text-left hover:border-cyan-600/40" data-session-id="${esc(session.id)}">
      <span class="h-2 w-2 rounded-full ${session.phase === "done" ? "bg-neutral-600" : "bg-emerald-500"}"></span>
      <span class="min-w-0 flex-1 truncate text-xs text-neutral-200">${esc(session.title)}</span>
      <span class="text-[10px] uppercase text-neutral-500">${esc(session.phase || "explore")}</span>
    </button>`);
  const agentRows = briefRunRows(activeAgents, "No linked agents.", (agent) => `
    <div class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2">
      <span class="h-2 w-2 rounded-full ${agent.status === "running" || agent.status === "active" ? "bg-emerald-500" : agent.status === "error" ? "bg-red-500" : "bg-neutral-600"}"></span>
      <span class="min-w-0 flex-1 truncate text-xs text-neutral-200">${esc(agent.agentId)}</span>
      <span class="text-[10px] text-neutral-500">${esc(agent.role || agent.status || "")}</span>
    </div>`);
  const meetingRows = briefRunRows(linkedMeetings, "No linked meetings.", briefRunMeetingCard);
  const synthesisRows = meetingSyntheses.length
    ? meetingSyntheses.slice().reverse().map(meetingSynthesisCard).join("")
    : `<div class="text-xs text-neutral-600">No completed meeting synthesis to review.</div>`;
  const pendingMeetingProposals = meetingSyntheses.reduce(
    (total, item) => total + (item.proposals || []).filter((proposal) => proposal.status === "pending").length,
    0,
  );
  const agendaRows = briefRunRows(agendaItems, "No Agenda Items recorded.", (item) => `
    <div class="rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2">
      <div class="text-xs text-neutral-200">${esc(item.title || item.body || "")}</div>
      <div class="mt-1 text-[10px] text-neutral-600">${esc(item.status || item.type || "proposed")}</div>
    </div>`);
  const assetRows = briefRunRows(assets, "No context assets linked.", (item) => `
    <button type="button" class="brief-run-open-asset block w-full rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2 text-left hover:border-cyan-700/50" data-path="${esc(item.path || "")}" ${item.path ? "" : "disabled"}>
      <div class="truncate text-xs text-neutral-200">${esc(item.title || item.path || item.id || "Asset")}</div>
      <div class="mt-1 truncate font-mono text-[10px] text-neutral-600">${esc(item.path || item.kind || item.id || "")}</div>
    </button>`);
  const completionRows = briefRunRows(completedWork, "No completed-work summaries.", (item) => `
    <div class="rounded-lg border border-emerald-900/40 bg-emerald-950/10 px-3 py-2">
      <div class="text-xs font-medium text-emerald-100/90">${esc(item.title || "Completed work")}</div>
      <div class="mt-1 line-clamp-4 text-[11px] leading-5 text-neutral-400">${esc(item.body || item.summary || "")}</div>
    </div>`);
  const liveTerminalCards = activeAgents
    .filter((agent) => agent.terminal && agent.terminal.alive)
    .map((agent) => activeAgentTerminalCard({
      id: agent.agentId,
      name: agent.name || agent.agentId,
      provider: agent.provider,
      model: agent.model,
      mounted: true,
      tmux_session: agent.terminal.session,
      tmux_window: agent.terminal.window,
    })).join("");
  const decisionRows = briefRunRows(run.decisions, "No decisions recorded.", (item) => `
    <div class="rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2 text-xs text-neutral-300">${esc(item.body || item.title || "")}</div>`);
  const evidenceRows = briefRunRows(run.evidence, "No evidence recorded.", (item) => `
    <div class="rounded-lg border border-neutral-800 bg-neutral-950/55 px-3 py-2 text-xs text-neutral-300">${esc(item.body || item.title || "")}</div>`);
  const eventRows = briefRunRows(run.events, "No run events yet.", (event) => `
    <div class="flex gap-2 border-b border-neutral-800/60 py-1.5 text-[11px] last:border-0">
      <span class="shrink-0 text-neutral-600">${event.at ? esc(new Date(event.at).toLocaleString()) : ""}</span>
      <span class="min-w-0 text-neutral-400">${esc(event.summary || event.type || "updated")}</span>
    </div>`);
  return `<section class="rounded-2xl border ${clean ? "border-emerald-700/35" : "border-amber-700/45"} bg-neutral-950/55 p-4">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <div class="text-sm font-semibold text-neutral-100">Brief Run</div>
          <span class="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] ${clean ? "text-emerald-300" : "text-amber-300"}">${clean ? "clean" : "blocked"}</span>
          <span class="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-500">${esc(run.status || "planning")}</span>
        </div>
        <div class="mt-1 truncate font-mono text-[10px] text-neutral-600">${esc(run.id)}</div>
      </div>
      <button id="brief-run-save" type="button" class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500">Save Document</button>
      <button id="brief-run-create-session" type="button" class="rounded-md border border-cyan-700/70 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-900/40">Start Conversation</button>
      <button id="brief-run-dry-run" type="button" class="rounded-md border border-amber-700/60 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/30">Focused Dry-Run</button>
    </div>
    ${(missing.length || warnings.length) ? `<div class="mt-3 flex flex-wrap gap-1.5">
      ${missing.map((item) => `<span class="rounded border border-red-800/60 bg-red-950/30 px-2 py-0.5 text-[10px] text-red-300">missing ${esc(item)}</span>`).join("")}
      ${warnings.map((item) => `<span class="rounded border border-amber-800/50 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-300">${esc(item)}</span>`).join("")}
    </div>` : ""}
    <div class="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div class="space-y-3">
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label class="text-[11px] text-neutral-500">Title
            <input id="brief-run-title" value="${esc(brief.title || task.title || "")}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
          <label class="text-[11px] text-neutral-500">Domain
            <input id="brief-run-domain" value="${esc(brief.domain || run.domain || "All")}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
        </div>
        <label class="block text-[11px] text-neutral-500">Goal
          <textarea id="brief-run-goal" rows="2" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc(brief.goal || "")}</textarea>
        </label>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label class="text-[11px] text-neutral-500">Current rendered state
            <textarea id="brief-run-current" rows="3" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc(brief.currentRenderedState || "")}</textarea>
          </label>
          <label class="text-[11px] text-neutral-500">Problem / mismatch
            <textarea id="brief-run-problem" rows="3" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc(brief.problemMismatch || "")}</textarea>
          </label>
        </div>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label class="text-[11px] text-neutral-500">Constraints
            <textarea id="brief-run-constraints" rows="4" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc((brief.constraints || []).join("\n"))}</textarea>
          </label>
          <label class="text-[11px] text-neutral-500">Acceptance criteria
            <textarea id="brief-run-acceptance" rows="4" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc((brief.acceptanceCriteria || []).join("\n"))}</textarea>
          </label>
        </div>
        <label class="block text-[11px] text-neutral-500">Next action
          <textarea id="brief-run-next" rows="2" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc(brief.nextAction || "")}</textarea>
        </label>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label class="text-[11px] text-neutral-500">Owner
            <input id="brief-run-owner" value="${esc(brief.owner || task.assignee || "")}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
          <label class="text-[11px] text-neutral-500">Persona
            <input id="brief-run-persona" value="${esc(brief.persona || "")}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
          <label class="text-[11px] text-neutral-500">Goal ID
            <input id="brief-run-goal-id" value="${esc(brief.goalId || run.goalId || "")}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
        </div>
        <label class="block text-[11px] text-neutral-500">Source references
          <textarea id="brief-run-source-refs" rows="2" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">${esc((brief.sourceRefs || []).join("\n"))}</textarea>
        </label>
      </div>
      <div class="space-y-3">
        <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Progress Checklist</div>
          <div class="space-y-2">${checklist.map((item) => `
            <label class="flex items-start gap-2 text-xs text-neutral-300">
              <input type="checkbox" class="brief-run-check mt-0.5 accent-cyan-500" data-check-id="${esc(item.id)}" ${item.done ? "checked" : ""} ${item.id === "brief-clean" ? "disabled" : ""} />
              <span>${esc(item.label)}</span>
            </label>`).join("")}</div>
          <button id="brief-run-save-checklist" type="button" class="mt-3 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800">Save Checklist</button>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-1">
          <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Linked Sessions</div>
            <div class="space-y-2">${sessionRows}</div>
          </div>
          <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Active Agents</div>
            <div class="space-y-2">${agentRows}</div>
          </div>
        </div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Decisions</div>
          <div class="space-y-2">${decisionRows}</div>
          <div class="mt-2 flex gap-2">
            <input id="brief-run-decision-input" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" placeholder="Record decision" />
            <button id="brief-run-add-decision" type="button" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Add</button>
          </div>
        </div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Evidence</div>
          <div class="space-y-2">${evidenceRows}</div>
          <div class="mt-2 flex gap-2">
            <input id="brief-run-evidence-input" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" placeholder="Record evidence" />
            <button id="brief-run-add-evidence" type="button" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Add</button>
          </div>
        </div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Run Events</div>
          <div>${eventRows}</div>
        </div>
      </div>
    </div>
    <div id="brief-run-operations" class="mt-4 space-y-4">
      <section id="brief-run-meeting-review" class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
        <div class="mb-3 flex items-center gap-2">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Meeting Follow-up Review</div>
          <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] ${pendingMeetingProposals ? "text-amber-300" : "text-neutral-500"}">${pendingMeetingProposals} pending</span>
        </div>
        <div class="space-y-3">${synthesisRows}</div>
      </section>
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-3 flex items-center gap-2">
            <div class="text-[10px] uppercase tracking-wider text-neutral-600">Linked Meetings</div>
            <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">${linkedMeetings.length}</span>
            <button id="brief-run-refresh-operations" type="button" class="ml-auto rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800">Refresh</button>
          </div>
          <div class="space-y-2">${meetingRows}</div>
        </section>
        <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Create Working Room</div>
          <label class="mt-3 block text-[11px] text-neutral-500">Title
            <input id="brief-run-meeting-title" value="${esc(`${run.title} working room`)}" class="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" />
          </label>
          <label class="mt-2 block text-[11px] text-neutral-500">Agenda
            <textarea id="brief-run-meeting-agenda" rows="3" class="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100">Review progress, risks, decisions, and next actions for this Brief Run.</textarea>
          </label>
          <label class="mt-2 block text-[11px] text-neutral-500">Participants
            <input id="brief-run-meeting-members" value="${esc(meetingMembers)}" class="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" />
          </label>
          <label class="mt-2 block text-[11px] text-neutral-500">Schedule time
            <input id="brief-run-meeting-when" type="datetime-local" value="${esc(meetingDateTimeLocal())}" class="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" />
          </label>
          <label class="mt-2 flex items-center gap-2 text-[11px] text-neutral-400">
            <input id="brief-run-meeting-paid" type="checkbox" class="accent-cyan-500" />
            Allow paid providers
          </label>
          <div class="mt-3 flex gap-2">
            <button id="brief-run-meeting-start" type="button" class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500">Start now</button>
            <button id="brief-run-meeting-schedule" type="button" class="rounded-md border border-cyan-700/70 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/30">Schedule</button>
          </div>
        </section>
      </div>
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Agenda Items</div>
          <div class="space-y-2">${agendaRows}</div>
          <div class="mt-2 flex gap-2">
            <input id="brief-run-agenda-input" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" placeholder="Proposed Agenda Item" />
            <button id="brief-run-add-agenda" type="button" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Add</button>
          </div>
        </section>
        <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Context Assets</div>
          <div class="space-y-2">${assetRows}</div>
          <div class="mt-2 flex gap-2">
            <input id="brief-run-asset-path" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" placeholder="Relative file path" />
            <button id="brief-run-add-asset" type="button" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Link</button>
          </div>
        </section>
        <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
          <div class="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Completed Work</div>
          <div class="space-y-2">${completionRows}</div>
          <div class="mt-2 flex gap-2">
            <input id="brief-run-completion-input" class="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100" placeholder="Completion summary" />
            <button id="brief-run-add-completion" type="button" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Add</button>
          </div>
        </section>
      </div>
      <section class="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
        <div class="mb-3 flex items-center gap-2">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Live Agent Terminals</div>
          <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">${activeAgents.filter((agent) => agent.terminal?.alive).length}</span>
        </div>
        <div id="brief-run-terminal-grid">${liveTerminalCards
          ? `<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${liveTerminalCards}</div>`
          : `<div class="text-xs text-neutral-600">No linked agent tmux sessions are live.</div>`}</div>
      </section>
    </div>
    <pre id="brief-run-result" class="hidden mt-3 max-h-64 overflow-auto rounded-xl border border-neutral-800 bg-black/70 p-3 font-mono text-[11px] text-emerald-100/85 whitespace-pre-wrap"></pre>
    <div id="brief-run-msg" class="mt-2 min-h-4 text-xs text-neutral-500"></div>
  </section>`;
}

function renderTaskHtml({ board, task, comments = [], assignees = [], log = "", provenance = null, goalsRes = null, autonomyRes = null, briefRun = null }) {
  const status = task.status || task.state || "";
  const currentAssignee = task.assignee || "";
  const options = [
    `<option value="none" ${!currentAssignee ? "selected" : ""}>Unassigned</option>`,
    ...assignees.map((a) => {
      const name = assigneeName(a);
      return name ? `<option value="${esc(name)}" ${name === currentAssignee ? "selected" : ""}>${esc(name)}</option>` : "";
    }).filter(Boolean),
  ].join("");
  const body = String(task.body || "").trim() || "No task body yet.";
  const commentHtml = comments.length
    ? comments.map((c) => `<div class="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
        <div class="text-[10px] uppercase tracking-wider text-neutral-600">${esc(c.author || c.created_by || "comment")}${c.created_at ? ` · ${esc(new Date(c.created_at * 1000).toLocaleString())}` : ""}</div>
        <div class="mt-2 whitespace-pre-wrap text-sm text-neutral-300">${esc(c.body || "")}</div>
      </div>`).join("")
    : `<div class="text-sm text-neutral-600">No comments yet.</div>`;
  return `<div class="space-y-4">
    <div class="rounded-3xl border border-cyan-500/25 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.9),rgba(10,10,10,0.95))] p-5">
      <div class="flex flex-wrap items-start gap-4">
        <div class="min-w-0 flex-1">
          <div class="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Task Planning</div>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">${esc(task.title || "Planning task")}</h1>
          <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-500">
            <span class="rounded-full border border-neutral-800 bg-black/30 px-2 py-1 font-mono">${esc(task.id || "")}</span>
            <span class="rounded-full border border-neutral-800 bg-black/30 px-2 py-1">${esc(board || "board")}</span>
            <span class="rounded-full border border-neutral-800 bg-black/30 px-2 py-1">${esc(status || "unknown")}</span>
          </div>
        </div>
        <button class="task-action rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" data-action="specify">Triage/specify</button>
        <button class="task-action rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" data-action="decompose">Decompose</button>
        <button class="task-action rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500" data-action="promote">Ready</button>
        <button id="task-dispatch" class="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500">Start worker</button>
      </div>
    </div>

    ${renderBriefRunWorkspace(briefRun, task)}

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside class="space-y-3">
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Assign owner / agent profile</div>
          <div class="mt-3 flex gap-2">
            <select id="task-assignee" class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100">${options}</select>
            <button id="task-assign-save" class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-700">Save</button>
          </div>
          <div id="task-action-msg" class="mt-2 min-h-4 text-xs text-neutral-500">Tasks without assignees will not dispatch.</div>
        </div>
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Brief</div>
          <div class="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">${esc(body)}</div>
        </div>
        ${renderTaskContextPanel({ task, provenance, goalsRes, autonomyRes })}
      </aside>
      <section class="space-y-3">
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="mb-3 flex items-center">
            <div class="text-[10px] uppercase tracking-wider text-neutral-600">Worker log</div>
            <button id="task-log-refresh" class="ml-auto rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">Refresh</button>
          </div>
          <pre id="task-log-output" class="max-h-[280px] overflow-auto rounded-xl border border-neutral-800 bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/85">${esc(log || "No worker log yet.")}</pre>
        </div>
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Comments / decisions</div>
          <div class="mt-3 space-y-2">${commentHtml}</div>
        </div>
      </section>
    </div>
  </div>`;
}

function setBriefRunMessage(message, result = null) {
  const msg = $("#brief-run-msg");
  if (msg) msg.textContent = message || "";
  const out = $("#brief-run-result");
  if (out && result != null) {
    out.textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 8000);
    out.classList.toggle("hidden", !out.textContent);
  }
}

function briefRunDocumentFromForm() {
  const value = (id) => ($("#" + id) && $("#" + id).value || "").trim();
  return {
    title: value("brief-run-title"),
    domain: value("brief-run-domain"),
    goal: value("brief-run-goal"),
    currentRenderedState: value("brief-run-current"),
    problemMismatch: value("brief-run-problem"),
    constraints: splitLines(value("brief-run-constraints")),
    acceptanceCriteria: splitLines(value("brief-run-acceptance")),
    nextAction: value("brief-run-next"),
    owner: value("brief-run-owner"),
    persona: value("brief-run-persona"),
    goalId: value("brief-run-goal-id"),
    sourceRefs: splitLines(value("brief-run-source-refs")),
  };
}

async function updateFocusedBriefRun(patch, successMessage) {
  if (!focusedTask || !window.ceo.briefRunUpdate) return null;
  setBriefRunMessage("saving...");
  let result = {};
  try {
    result = await window.ceo.briefRunUpdate(focusedTask.board, focusedTask.taskId, patch);
  } catch (e) {
    result = { ok: false, reason: String(e) };
  }
  if (!result || !result.ok) {
    setBriefRunMessage(`save failed: ${result ? result.reason : "unknown"}`, result);
    return result;
  }
  await openTaskInStudio(focusedTask);
  const state = result.run || (result.workspace && result.workspace.run);
  setBriefRunMessage(successMessage || "saved", {
    validation: state && state.validation,
    updatedAt: state && state.updatedAt,
  });
  return result;
}

async function saveBriefRunDocument() {
  await updateFocusedBriefRun({
    brief: briefRunDocumentFromForm(),
    eventType: "brief_document_saved",
    actor: "human",
    summary: "Brief document saved and revalidated",
  }, "document saved and revalidated");
}

async function saveBriefRunChecklist() {
  const items = Array.from(document.querySelectorAll(".brief-run-check")).map((input) => ({
    id: input.dataset.checkId,
    label: (input.parentElement && input.parentElement.textContent || input.dataset.checkId || "").trim(),
    done: !!input.checked,
  }));
  await updateFocusedBriefRun({
    progressChecklist: items,
    eventType: "brief_checklist_saved",
    actor: "human",
    summary: "Progress checklist updated",
  }, "checklist saved");
}

async function addBriefRunEntry(kind) {
  const input = kind === "decision" ? $("#brief-run-decision-input") : $("#brief-run-evidence-input");
  const body = input && input.value.trim();
  if (!body) return;
  if (input) input.value = "";
  const patch = kind === "decision"
    ? { decision: { body }, eventType: "decision_recorded", actor: "human", summary: body }
    : { evidenceItem: { body }, eventType: "evidence_recorded", actor: "human", summary: body };
  await updateFocusedBriefRun(patch, `${kind} recorded`);
}

async function addBriefRunOperationalEntry(kind) {
  const configs = {
    agenda: {
      input: "#brief-run-agenda-input",
      patch: (body) => ({
        agendaItem: { title: body, body, status: "proposed", type: "brief-run" },
        eventType: "agenda_item_recorded",
        actor: "human",
        summary: body,
      }),
      success: "agenda item recorded",
    },
    completion: {
      input: "#brief-run-completion-input",
      patch: (body) => ({
        completionSummary: { title: "Completed work", body, source: "human" },
        eventType: "completion_summary_recorded",
        actor: "human",
        summary: body,
      }),
      success: "completion summary recorded",
    },
  };
  const config = configs[kind];
  if (!config) return;
  const input = $(config.input);
  const body = input && input.value.trim();
  if (!body) return;
  input.value = "";
  await updateFocusedBriefRun(config.patch(body), config.success);
}

async function recordBriefRunAsset() {
  if (!focusedTask || !window.ceo.recordBriefAsset) return;
  const input = $("#brief-run-asset-path");
  const assetPath = input && input.value.trim();
  if (!assetPath) return;
  setBriefRunMessage("linking context asset...");
  let result = {};
  try {
    result = await window.ceo.recordBriefAsset({
      board: focusedTask.board,
      parentKind: "brief",
      parentId: focusedTask.taskId,
      assetKind: "context",
      assetId: assetPath,
      title: assetPath.split("/").filter(Boolean).pop() || assetPath,
      path: assetPath,
      summary: "Brief Run context asset",
      requestedBy: "human",
    });
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (!result || !result.ok) {
    setBriefRunMessage(`asset link failed: ${result ? result.reason : "unknown"}`, result);
    return;
  }
  input.value = "";
  await openTaskInStudio(focusedTask);
  setBriefRunMessage("context asset linked");
}

function briefRunMeetingDraft() {
  const value = (selector) => ($(selector) && $(selector).value || "").trim();
  const scheduledValue = value("#brief-run-meeting-when");
  const scheduledDate = scheduledValue ? new Date(scheduledValue) : null;
  return {
    title: value("#brief-run-meeting-title"),
    agenda: value("#brief-run-meeting-agenda"),
    members: value("#brief-run-meeting-members"),
    allowPaid: !!($("#brief-run-meeting-paid") && $("#brief-run-meeting-paid").checked),
    scheduledFor: scheduledDate && !Number.isNaN(scheduledDate.getTime())
      ? scheduledDate.toISOString()
      : "",
  };
}

async function runBriefRunMeetingAction(action, meetingId = "") {
  if (!focusedTask) return;
  const methods = {
    start: window.ceo.briefRunMeetingStart,
    schedule: window.ceo.briefRunMeetingSchedule,
    startScheduled: window.ceo.briefRunMeetingStartScheduled,
  };
  const method = methods[action];
  if (!method) return;
  const draft = briefRunMeetingDraft();
  if (action === "schedule" && !draft.scheduledFor) {
    setBriefRunMessage("choose a valid schedule time");
    return;
  }
  setBriefRunMessage(action === "schedule" ? "scheduling meeting..." : "starting meeting...");
  let result = {};
  try {
    result = action === "startScheduled"
      ? await method(focusedTask.board, focusedTask.taskId, meetingId)
      : await method(focusedTask.board, focusedTask.taskId, draft);
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (!result || !result.ok) {
    setBriefRunMessage(`meeting action failed: ${result ? result.reason : "unknown"}`, result);
    return;
  }
  await openTaskInStudio(focusedTask);
  setBriefRunMessage(action === "schedule" ? "meeting scheduled" : "meeting room started");
}

async function synthesizeBriefRunMeeting(meetingId) {
  if (!focusedTask || !meetingId || !window.ceo.briefRunMeetingSynthesize) return;
  setBriefRunMessage("synthesizing meeting follow-up...");
  let result = {};
  try {
    result = await window.ceo.briefRunMeetingSynthesize(focusedTask.board, focusedTask.taskId, meetingId);
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (!result || !result.ok) {
    setBriefRunMessage(`meeting synthesis failed: ${result ? result.reason : "unknown"}`, result);
    return;
  }
  await openTaskInStudio(focusedTask);
  setBriefRunMessage(result.changed ? "meeting proposals ready for review" : "meeting synthesis already current");
}

async function reviewBriefRunMeetingProposal(button) {
  if (!focusedTask || !button || !window.ceo.briefRunMeetingProposalAction) return;
  const action = button.dataset.action;
  const proposalType = button.dataset.proposalType;
  if (action === "approve" && proposalType === "blocker") {
    const approved = window.confirm("Approve this blocker and move the parent Hermes task to blocked?");
    if (!approved) return;
  }
  button.disabled = true;
  setBriefRunMessage(action === "approve" ? "materializing approved proposal..." : "rejecting proposal...");
  let result = {};
  try {
    result = await window.ceo.briefRunMeetingProposalAction({
      board: focusedTask.board,
      taskId: focusedTask.taskId,
      synthesisId: button.dataset.synthesisId,
      proposalId: button.dataset.proposalId,
      action,
      humanApproved: action === "approve",
      approvedBy: "human",
    });
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (!result || !result.ok) {
    button.disabled = false;
    setBriefRunMessage(`proposal review failed: ${result ? result.reason : "unknown"}`, result);
    return;
  }
  await openTaskInStudio(focusedTask);
  setBriefRunMessage(action === "approve" ? "proposal approved and recorded" : "proposal rejected");
}

function jumpToBriefRunSynthesis(synthesisId) {
  if (!synthesisId) return;
  const node = document.getElementById(`brief-run-synthesis-${synthesisId}`);
  if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function openBriefRunMeeting(room) {
  if (!room) return;
  await openView("meetings");
  await openPastMeetingRoom(room);
}

async function refreshBriefRunMeeting(room) {
  if (!room || !window.ceo.meetingRoom) return;
  const card = Array.from(document.querySelectorAll(".brief-run-meeting"))
    .find((node) => node.dataset.room === room);
  if (!card) return;
  let result = {};
  try {
    result = await window.ceo.meetingRoom(room);
  } catch {
    return;
  }
  if (!result || !result.ok) return;
  const feed = card.querySelector(".brief-run-meeting-feed");
  const status = card.querySelector(".brief-run-meeting-status");
  const requirements = card.querySelector(".brief-run-meeting-requirements");
  const entries = (result.feed || []).slice(-4);
  if (feed) {
    feed.textContent = entries.length
      ? entries.map((entry) => `[${entry.speaker || "agent"}] ${entry.body || ""}`).join("\n\n")
      : "Waiting for room activity...";
    feed.scrollTop = feed.scrollHeight;
  }
  if (status) {
    status.textContent = result.running ? "running" : "done";
    status.className = `brief-run-meeting-status rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] ${result.running ? "text-cyan-300" : "text-emerald-300"}`;
  }
  if (requirements) {
    requirements.textContent = result.requirements || "";
    requirements.classList.toggle("hidden", !result.requirements);
  }
  if (result.requirements && !card.dataset.synthesisId && card.dataset.synthesisId !== "loading") {
    card.dataset.synthesisId = "loading";
    await synthesizeBriefRunMeeting(card.dataset.meetingId);
  }
}

async function refreshBriefRunOperations({ reload = false } = {}) {
  if (!focusedTask || !document.getElementById("brief-run-operations")) return;
  if (reload) {
    await openTaskInStudio(focusedTask);
    return;
  }
  const agentIds = [...new Set(Array.from(
    document.querySelectorAll("#brief-run-terminal-grid .active-agent-card"),
  ).map((node) => node.dataset.agent).filter(Boolean))];
  const rooms = [...new Set(Array.from(
    document.querySelectorAll("#brief-run-operations .brief-run-meeting[data-room]"),
  ).map((node) => node.dataset.room).filter(Boolean))];
  await Promise.all([
    ...agentIds.map((agentId) => refreshActiveAgentTerminal(agentId, { quiet: true })),
    ...rooms.map((room) => refreshBriefRunMeeting(room)),
  ]);
}

function stopBriefRunOpsTimer() {
  if (!briefRunOpsTimer) return;
  clearInterval(briefRunOpsTimer);
  briefRunOpsTimer = null;
}

function startBriefRunOpsTimer() {
  stopBriefRunOpsTimer();
  if (!document.getElementById("brief-run-operations")) return;
  refreshBriefRunOperations();
  briefRunOpsTimer = setInterval(() => {
    if (!document.getElementById("brief-run-operations")) {
      stopBriefRunOpsTimer();
      return;
    }
    refreshBriefRunOperations();
  }, 2500);
}

async function createBriefRunSession() {
  if (!focusedTask || !window.StudioSessions || !window.StudioSessions.prepareBriefSession) return;
  const draft = {
    board: focusedTask.board,
    taskId: focusedTask.taskId,
    runId: `${focusedTask.board}:${focusedTask.taskId}`,
    title: ($("#brief-run-title") && $("#brief-run-title").value || focusedTask.taskTitle || "Brief Run").trim(),
    leadAgentId: ($("#brief-run-owner") && $("#brief-run-owner").value || "ceo").trim() || "ceo",
  };
  await openView("sessions");
  const result = await window.StudioSessions.prepareBriefSession(draft);
  if (!result || !result.ok) {
    appendSys(`Could not prepare brief conversation: ${result ? result.reason : "unknown"}`);
    return;
  }
}

async function openBriefRunSession(id) {
  if (!id) return;
  const result = await window.ceo.sessionsSetActive(id);
  if (!result || !result.ok) {
    setBriefRunMessage(`session unavailable: ${result ? result.reason : "unknown"}`, result);
    return;
  }
  await openView("sessions");
}

async function runBriefFocusedDryRun() {
  if (!focusedTask || !window.ceo.runnerRunOnce) return;
  setBriefRunMessage("running focused autonomy dry-run...");
  let result = {};
  try {
    result = await window.ceo.runnerRunOnce({
      policy: {
        boards: [focusedTask.board],
        targetTaskIds: [focusedTask.taskId],
        domain: currentDomain || "All",
        dryRun: true,
        execute: true,
        maxDispatchPerCycle: 1,
      },
    });
  } catch (e) {
    result = { ok: false, reason: String(e) };
  }
  const phases = result && result.phases || {};
  setBriefRunMessage(result && result.ok ? "focused dry-run complete" : `dry-run failed: ${result ? result.reason : "unknown"}`, {
    ok: !!(result && result.ok),
    errors: result && result.errors || [],
    plan: phases.plan || [],
    assign: phases.assign || [],
    execute: phases.execute || [],
    review: phases.review || [],
  });
}

async function openTaskInStudio({ board, taskId, taskTitle, taskStatus } = {}) {
  if (!taskId) return;
  stopBriefRunOpsTimer();
  focusedTask = { board, taskId, taskTitle, taskStatus };
  setAgentState("thinking");
  setStudioFocus(taskTitle || taskId, `${board || "board"} / ${taskStatus || "task"} / planning focus`, "Planning");
  window.CEOConvai?.syncContext?.(`task → ${board || "board"} / ${taskId}`);
  setPanelTitle("Planning Brief");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading task context...</div>';
  try {
    if (window.ceo.ceoFocusTask) await window.ceo.ceoFocusTask({ ...focusedTask });
    const [r, assigneesRes, logRes, provenanceRes, goalsRes, autonomyRes, briefRunRes] = await Promise.all([
      window.ceo.ceoTaskDetail ? window.ceo.ceoTaskDetail(board, taskId) : null,
      window.ceo.ceoAssignees ? safeIpc(() => window.ceo.ceoAssignees(board)) : null,
      window.ceo.ceoTaskLog ? safeIpc(() => window.ceo.ceoTaskLog({ board, taskId })) : null,
      window.ceo.provenanceGraph ? safeIpc(() => window.ceo.provenanceGraph()) : null,
      window.ceo.listGoals ? safeIpc(() => window.ceo.listGoals({ domain: currentDomain })) : null,
      window.ceo.autonomyStatus ? safeIpc(() => window.ceo.autonomyStatus()) : null,
      window.ceo.briefRunGet ? safeIpc(() => window.ceo.briefRunGet(board, taskId)) : null,
    ]);
    if (!r || !r.ok) {
      const md = [
        `# ${taskTitle || taskId}`,
        "",
        `Could not load full task detail: ${r ? r.reason : "task detail IPC unavailable"}`,
        "",
        "You can still discuss this task with the CEO in the chat panel.",
      ].join("\n");
      window.ceoUI.showPanel("Planning Brief", md);
    } else {
      setPanelTitle("Task Planning");
      panelContent().innerHTML = renderTaskHtml({
        board,
        task: r.task || {},
        comments: r.comments || [],
        assignees: (assigneesRes && assigneesRes.assignees) || [],
        log: (logRes && logRes.ok && logRes.out) || "",
        provenance: provenanceRes && provenanceRes.ok ? provenanceRes : null,
        goalsRes: goalsRes && goalsRes.ok ? goalsRes : null,
        autonomyRes,
        briefRun: briefRunRes && briefRunRes.ok ? briefRunRes : null,
      });
      startBriefRunOpsTimer();
    }
    appendStream("sys", `Planning focus loaded: ${taskTitle || taskId}. Ask the CEO for a domain plan, acceptance criteria, risks, or the right agent team.`);
    const input = $("#chat-input");
    if (input) {
      input.placeholder = "Plan this task with the Project CEO...";
      input.focus();
    }
  } catch (e) {
    window.ceoUI.showPanel("Planning Brief", `# ${taskTitle || taskId}\n\nCould not load task context: ${e.message}`);
    setVoiceStatus(`Task focus failed: ${e.message}`);
  } finally {
    setAgentState("idle");
  }
}

function taskCardHtml(boardSlug, status, task) {
  const body = task.body ? `<div class="mt-1.5 line-clamp-2 text-[11px] text-neutral-500">${esc(task.body)}</div>` : "";
  const owner = task.assignee || "unassigned";
  return `<button class="studio-task-card block w-full rounded-xl border border-neutral-800 bg-neutral-950/55 p-3 text-left transition hover:border-cyan-500/50 hover:bg-cyan-950/20"
            data-board="${esc(boardSlug)}"
            data-task-id="${esc(task.id)}"
            data-task-title="${esc(task.title)}"
            data-task-status="${esc(status)}">
    <div class="text-sm font-medium leading-snug text-neutral-100">${esc(task.title)}</div>
    ${body}
    <div class="mt-2 flex items-center gap-2 text-[10px] text-neutral-600">
      <span>${esc(owner)}</span>
      ${task.priority ? `<span>P${esc(task.priority)}</span>` : ""}
      <span class="ml-auto font-mono">${esc(task.id)}</span>
    </div>
  </button>`;
}

function domainMiniList(items, emptyText, formatter) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2 text-xs text-neutral-600">${esc(emptyText)}</div>`;
  return `<div class="space-y-2">${list.slice(0, 8).map(formatter).join("")}</div>`;
}

function domainArtifactRows(items, emptyText) {
  return domainMiniList(items, emptyText, (item) => `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs font-medium text-neutral-300">${esc(item.title || item.name || item.path)}</div>
        <div class="mt-0.5 truncate font-mono text-[10px] text-neutral-600">${esc(item.path || "")}</div>
      </div>
      ${item.path ? `<button class="domain-context-add shrink-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-context-kind="artifact" data-context-title="${esc(item.title || item.name || item.path)}" data-context-path="${esc(item.path)}">Context</button>` : ""}
    </div>
  </div>`);
}

function domainAgendaRows(items) {
  return domainMiniList(items, "No captured Agenda Items yet.", (item) => `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="rounded border border-cyan-500/25 bg-cyan-950/25 px-1.5 py-0.5 text-[10px] text-cyan-300">${esc(item.type || "feature")}</span>
          <span class="min-w-0 truncate text-xs font-medium text-neutral-300">${esc(item.title)}</span>
        </div>
        <div class="mt-1 text-[10px] uppercase tracking-wider text-neutral-600">${esc(item.status || "proposed")} &middot; human approval required</div>
      </div>
      <button class="domain-context-add shrink-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-context-kind="agenda" data-context-title="${esc(item.title)}" data-context-path="${esc(`domains/${slugifyName(currentDomain)}/captured-agenda-items.md`)}">Context</button>
    </div>
  </div>`);
}

function domainHandoffRows(items) {
  return domainMiniList(items, "No handoffs captured yet.", (item) => `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="rounded border border-amber-500/25 bg-amber-950/20 px-1.5 py-0.5 text-[10px] text-amber-300">${esc(item.status || "pending")}</span>
          <span class="min-w-0 truncate text-xs font-medium text-neutral-300">${esc(item.title)}</span>
        </div>
        <div class="mt-1 truncate font-mono text-[10px] text-neutral-600">${esc(item.path || item.id || "")}</div>
      </div>
      ${item.path ? `<button class="domain-context-add shrink-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-context-kind="handoff" data-context-title="${esc(item.title)}" data-context-path="${esc(item.path)}">Context</button>` : ""}
    </div>
  </div>`);
}

function domainLifecycleSection(title, body, actionHtml = "") {
  return `<section class="rounded-2xl border border-neutral-800 bg-neutral-950/35 p-4">
    <div class="mb-3 flex items-center gap-2">
      <h2 class="text-sm font-semibold text-neutral-200">${esc(title)}</h2>
      ${actionHtml ? `<div class="ml-auto">${actionHtml}</div>` : ""}
    </div>
    ${body}
  </section>`;
}

function contextKey(item) {
  return `${item.kind || "artifact"}:${item.path || item.title}`;
}

function renderCeoContextTray() {
  const rows = ceoContextTray.length
    ? ceoContextTray.map((item) => `<div class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2">
        <span class="rounded border border-cyan-500/20 bg-cyan-950/20 px-1.5 py-0.5 text-[10px] text-cyan-300">${esc(item.kind || "artifact")}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-neutral-300">${esc(item.title || item.path)}</span>
        <span class="hidden max-w-[280px] truncate font-mono text-[10px] text-neutral-600 md:block">${esc(item.path || "")}</span>
        <button class="domain-context-remove rounded-md px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200" data-context-key="${esc(contextKey(item))}">Remove</button>
      </div>`).join("")
    : `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2 text-xs text-neutral-600">No CEO context selected. Add domain artifacts from the sections below.</div>`;
  return `<section class="rounded-2xl border border-cyan-500/25 bg-cyan-950/10 p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-neutral-100">CEO Context</h2>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${ceoContextTray.length} selected</span>
      <div class="ml-auto flex gap-2">
        <button id="domain-context-clear" ${ceoContextTray.length ? "" : "disabled"} class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">Clear</button>
        <button id="domain-context-ask" ${ceoContextTray.length ? "" : "disabled"} class="rounded-md bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40">Ask CEO</button>
      </div>
    </div>
    <div class="space-y-2">${rows}</div>
  </section>`;
}

function memberSummary(agent) {
  if (!agent) return "missing";
  const caps = (agent.capabilities || []).slice(0, 3).join(", ");
  return [agent.provider || "unknown", agent.persona || "no persona", caps].filter(Boolean).join(" / ");
}

function teamContextText(team, agentsById, lanes) {
  const members = (team.members || []).map((id) => {
    const agent = agentsById.get(id);
    return `- ${id}: ${memberSummary(agent)}`;
  }).join("\n") || "- No members";
  const owned = lanes.filter((lane) => lane.team === team.name);
  const laneText = owned.length
    ? owned.map((lane) => `- ${lane.lane}: ${lane.queueRole || "no queue role"} / ${lane.workflow || "no workflow"}`).join("\n")
    : "- No lanes route to this team";
  return [
    `Team: ${team.name}`,
    "",
    "Members:",
    members,
    "",
    "Routed Lanes:",
    laneText,
  ].join("\n");
}

function renderTeamsDomainIntelligence({ registry = {}, orchestration = {} } = {}) {
  const agents = registry.agents || [];
  const teams = registry.teams || [];
  const lanes = orchestration.lanes || [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const laneTeams = new Set(lanes.map((lane) => lane.team).filter(Boolean));
  const registryTeamNames = new Set(teams.map((team) => team.name));
  const missingTeams = [...laneTeams].filter((name) => !registryTeamNames.has(name));
  const unusedTeams = teams.filter((team) => !laneTeams.has(team.name));
  const cards = teams.length ? teams.map((team) => {
    const ownedLanes = lanes.filter((lane) => lane.team === team.name);
    const missingMembers = (team.members || []).filter((id) => !agentsById.has(id));
    const capabilitySet = new Set();
    for (const id of team.members || []) {
      const agent = agentsById.get(id);
      for (const cap of agent?.capabilities || []) capabilitySet.add(cap);
    }
    const context = teamContextText(team, agentsById, lanes);
    const memberRows = (team.members || []).map((id) => {
      const agent = agentsById.get(id);
      return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">${esc(agent?.name || id)}</span>
          <span class="rounded border ${agent ? "border-neutral-700 text-neutral-400" : "border-red-500/30 text-red-300"} px-1.5 py-0.5 text-[10px]">${esc(agent ? agent.provider || "unknown" : "missing")}</span>
        </div>
        <div class="mt-1 truncate text-[10px] text-neutral-600">${esc([agent?.persona, ...(agent?.capabilities || []).slice(0, 3)].filter(Boolean).join(" / ") || "No persona or capabilities")}</div>
      </div>`;
    }).join("") || `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2 text-xs text-neutral-600">No members yet.</div>`;
    return `<section class="rounded-2xl border border-neutral-800 bg-neutral-950/35 p-4">
      <div class="mb-3 flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-neutral-100">${esc(team.name)}</h3>
          <div class="mt-1 text-[10px] uppercase tracking-wider text-neutral-600">${(team.members || []).length} members · ${ownedLanes.length} routed lanes · ${capabilitySet.size} capabilities</div>
        </div>
        <button class="domain-context-add rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800"
          data-context-kind="team"
          data-context-title="${esc(`Team: ${team.name}`)}"
          data-context-text="${esc(context)}">Context</button>
      </div>
      <div class="mb-3 flex flex-wrap gap-1.5">${ownedLanes.length ? ownedLanes.map((lane) => `<span class="rounded border border-cyan-500/20 bg-cyan-950/15 px-2 py-0.5 text-[10px] text-cyan-200">${esc(lane.lane)}</span>`).join("") : `<span class="rounded border border-amber-500/25 bg-amber-950/15 px-2 py-0.5 text-[10px] text-amber-300">not routed</span>`}</div>
      <div class="space-y-2">${memberRows}</div>
      ${missingMembers.length ? `<div class="mt-3 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-200">Missing agents: ${esc(missingMembers.join(", "))}</div>` : ""}
    </section>`;
  }).join("") : `<div class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4 text-sm text-neutral-500">No registry teams found.</div>`;
  const gapRows = [
    ...missingTeams.map((name) => `Orchestration references missing team: ${name}`),
    ...unusedTeams.map((team) => `Team has no routed lane yet: ${team.name}`),
    ...teams.flatMap((team) => (team.members || []).filter((id) => !agentsById.has(id)).map((id) => `${team.name} references missing agent: ${id}`)),
  ];
  return `<section class="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-neutral-100">Team Intelligence</h2>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${teams.length} teams</span>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${agents.length} agents</span>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${lanes.length} lane policies</span>
    </div>
    <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${cards}</div>
    <div class="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/45 p-3">
      <div class="text-[10px] uppercase tracking-wider text-neutral-600">Gaps / Ambiguity</div>
      <div class="mt-2 space-y-1 text-xs text-neutral-400">${gapRows.length ? gapRows.map((gap) => `<div>${esc(gap)}</div>`).join("") : `<div class="text-neutral-600">No missing teams or members detected. Scope is still not first-class; teams are project-level registry entries today.</div>`}</div>
    </div>
  </section>`;
}

async function addDomainContextFromButton(btn) {
  const item = {
    kind: btn.dataset.contextKind || "artifact",
    title: btn.dataset.contextTitle || btn.dataset.contextPath || "Selected context",
    path: btn.dataset.contextPath || "",
    text: btn.dataset.contextText || "",
    domain: currentDomain,
  };
  if (!item.path && !item.title) return;
  const key = contextKey(item);
  if (!ceoContextTray.some((x) => contextKey(x) === key)) ceoContextTray.push(item);
  setVoiceStatus(`Added CEO context: ${item.title}`);
  await renderStudioBoard(currentDomain);
}

async function removeDomainContext(key) {
  ceoContextTray = ceoContextTray.filter((item) => contextKey(item) !== key);
  await renderStudioBoard(currentDomain);
}

async function readContextItem(item) {
  if (item.text) return item;
  if (!item.path || !window.ceo.docsRead) {
    return { ...item, text: "" };
  }
  try {
    const r = await window.ceo.docsRead(item.path);
    return { ...item, text: r && r.ok ? String(r.text || "").slice(0, 6000) : `Could not read ${item.path}: ${r ? r.reason : "unknown"}` };
  } catch (e) {
    return { ...item, text: `Could not read ${item.path}: ${e.message}` };
  }
}

async function askCeoAboutContext() {
  if (!ceoContextTray.length) return;
  setVoiceStatus("Reading selected domain context...");
  const loaded = await Promise.all(ceoContextTray.map(readContextItem));
  const prompt = [
    `Use the selected ${currentDomain} domain artifacts below as the primary context.`,
    "Tell me what is useful, what is missing, and what the next concrete step should be.",
    "Keep actions proposal-only unless I explicitly approve creating Kanban work or dispatching agents.",
    "",
    ...loaded.map((item, idx) => [
      `## Context ${idx + 1}: ${item.title}`,
      `Kind: ${item.kind}`,
      `Path: ${item.path || "inline"}`,
      "",
      item.text || "(no file content available)",
      "",
    ].join("\n")),
  ].join("\n");
  setVoiceStatus("Asking CEO with selected context...");
  await runTurn(prompt);
  setVoiceStatus("CEO context sent.");
}

async function renderStudioBoard(domain = currentDomain) {
  if (!currentProject) {
    renderPanel1Context(null, null);
    return;
  }
  setPanelTitle(domain && domain !== "All" ? `${domain} Domain` : currentProject.name);
  setStudioFocus(currentProject.name, domain && domain !== "All" ? `Domain focus: ${domain}` : "Project-wide planning cockpit", domain && domain !== "All" ? "Domain" : "Studio");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading domain board...</div>';
  try {
    const boardsRes = window.ceo.ceoBoardsForDomain ? await window.ceo.ceoBoardsForDomain(domain) : null;
    const boards = (boardsRes && boardsRes.boards) || [];
    const selected = boards[0] || null;
    const boardSlug = selected ? selected.slug : null;
    const data = boardSlug && window.ceo.ceoBoard ? await window.ceo.ceoBoard(boardSlug) : null;
    const domainRes = domain && domain !== "All" && window.ceo.getDomain ? await window.ceo.getDomain(domain) : null;
    const domainDef = domainRes && domainRes.ok ? domainRes.domain : null;
    const isTeamsDomain = domainDef && (domainDef.slug === "teams" || String(domainDef.name || "").toLowerCase() === "teams");
    let teamsDomainHtml = "";
    if (isTeamsDomain) {
      let registry = {};
      let orchestration = {};
      try {
        [registry, orchestration] = await Promise.all([
          window.ceo.registryList ? window.ceo.registryList() : null,
          window.ceo.orchestrationSummary ? window.ceo.orchestrationSummary({ domain }) : null,
        ]);
      } catch {
        registry = {};
        orchestration = {};
      }
      teamsDomainHtml = renderTeamsDomainIntelligence({ registry: registry || {}, orchestration: orchestration || {} });
    }
    const cols = (data && data.ok && data.columns) || {};
    const baseOrder = ["planning", "triage", "bug", "todo", "ready", "running", "blocked", "review", "done"];
    const ordered = baseOrder.concat(Object.keys(cols).filter((s) => !baseOrder.includes(s)));
    const lanes = ordered.length ? ordered.map((status) => {
      const tasks = cols[status] || [];
      return `<section class="min-w-[240px] flex-1 rounded-2xl border border-neutral-800 bg-neutral-950/35">
        <div class="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          <span class="h-2 w-2 rounded-full bg-cyan-400/80"></span>
          <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">${esc(status)}</span>
          <span class="ml-auto text-[11px] text-neutral-600">${tasks.length}</span>
        </div>
        <div class="space-y-2 p-2">${tasks.map((t) => taskCardHtml(boardSlug, status, t)).join("") || '<div class="px-2 py-3 text-xs text-neutral-700">empty</div>'}</div>
      </section>`;
    }).join("") : '<div class="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-500">No tasks on this board yet.</div>';

    const domainPurpose = domainDef?.purpose || "This domain has not been defined yet. Use + -> New domain, or ask the voice CEO to define its purpose, goal, and team.";
    const domainGoal = domainDef?.overarchingGoal || domainDef?.currentState || "";
    const team = (domainDef?.coreAgents || []).filter(Boolean);
    const responsibilities = (domainDef?.boundaries || domainDef?.responsibilities || []).filter(Boolean);
    const features = (domainDef?.features || domainDef?.activeEpics || []).filter(Boolean);
    const relationships = (domainDef?.relationships || domainDef?.interfaces || []).filter(Boolean);
    const artifacts = domainDef?.artifacts || {};
    const handoffs = artifacts.handoffs || [];
    const agendaItems = domainDef?.agendaItems || [];
    const docs = [...(artifacts.featureDocs || []), ...(artifacts.designDocs || [])];
    const personas = artifacts.personaDocs || [];
    const showLifecycle = domain && domain !== "All" && domainDef;
    const lifecycleHtml = showLifecycle ? `<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      ${domainLifecycleSection("Definition", `<div class="space-y-3 text-sm text-neutral-400">
        <p class="leading-6">${esc(domainPurpose)}</p>
        ${domainGoal ? `<p class="leading-6"><span class="text-neutral-500">Goal:</span> ${esc(domainGoal)}</p>` : `<div class="text-xs text-neutral-600">No long-term goal captured.</div>`}
        <div>${domainArtifactRows([{ title: "definition.md", path: domainDef.artifactPaths?.definition || "" }], "definition.md is missing.")}</div>
      </div>`)}
      ${domainLifecycleSection("Captured Agenda Items", domainAgendaRows(agendaItems), `<button id="domain-propose-agenda" class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800">Triage handoffs</button>`)}
      ${domainLifecycleSection("Handoffs", domainHandoffRows(handoffs), `<button id="domain-create-handoff" class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800">New handoff</button>`)}
      ${domainLifecycleSection("Plans", domainArtifactRows(artifacts.plans, "No plans captured yet."))}
      ${domainLifecycleSection("Requirements", domainArtifactRows(artifacts.requirements, "No requirements captured yet."))}
      ${domainLifecycleSection("Agendas / Meetings", domainArtifactRows(artifacts.agendas, "No meeting outputs captured yet."), `<button id="domain-first-meeting" class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800">Dogfood meeting</button>`)}
      ${domainLifecycleSection("Docs", domainArtifactRows(docs, "No feature or design docs captured yet."))}
      ${domainLifecycleSection("Personas", domainArtifactRows(personas, "No domain persona docs captured yet."))}
    </div>` : "";

    panelContent().innerHTML = `<div class="space-y-5">
      <div class="rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.9),rgba(10,10,10,0.95))] p-5">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">${domain && domain !== "All" ? "Domain Planning" : "Project Planning"}</div>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">${esc(domain && domain !== "All" ? domain : currentProject.name)}</h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">${esc(domain && domain !== "All" ? domainPurpose : "Project-wide planning across all domains. Pick a domain when you want its goal, team, and task board.")}</p>
            ${domainGoal ? `<p class="mt-2 max-w-3xl text-sm leading-6 text-cyan-100/80"><span class="text-neutral-500">Goal:</span> ${esc(domainGoal)}</p>` : ""}
            ${responsibilities.length ? `<div class="mt-3 flex flex-wrap gap-2">${responsibilities.slice(0, 5).map((r) => `<span class="rounded-full border border-neutral-800 bg-black/30 px-2 py-1 text-[11px] text-neutral-300">${esc(r)}</span>`).join("")}</div>` : ""}
            ${features.length ? `<div class="mt-2 flex flex-wrap gap-2">${features.slice(0, 5).map((r) => `<span class="rounded-full border border-cyan-500/20 bg-cyan-950/15 px-2 py-1 text-[11px] text-cyan-200/90">${esc(r)}</span>`).join("")}</div>` : ""}
            ${relationships.length ? `<div class="mt-2 text-xs text-neutral-500">Relationships: ${esc(relationships.join(", "))}</div>` : ""}
          </div>
          <button id="studio-add-task" data-board="${esc(boardSlug || "")}" class="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_28px_rgba(8,145,178,0.25)] transition hover:bg-cyan-500">Add task</button>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div class="rounded-xl border border-neutral-800 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-wider text-neutral-600">Board</div><div class="mt-1 truncate font-mono text-xs text-neutral-300">${esc(boardSlug || "none")}</div></div>
          <div class="rounded-xl border border-neutral-800 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-wider text-neutral-600">Domain</div><div class="mt-1 truncate text-xs text-neutral-300">${esc(domain || "All")}</div></div>
          <div class="rounded-xl border border-neutral-800 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-wider text-neutral-600">Tasks</div><div class="mt-1 text-xs text-neutral-300">${Object.values(cols).reduce((n, list) => n + list.length, 0)}</div></div>
          <div class="rounded-xl border border-neutral-800 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-wider text-neutral-600">Team</div><div class="mt-1 truncate text-xs text-neutral-300">${esc(team.length ? team.join(", ") : "not assigned")}</div></div>
        </div>
      </div>
      ${showLifecycle ? renderCeoContextTray() : ""}
      ${teamsDomainHtml}
      ${lifecycleHtml}
      <section class="rounded-2xl border border-neutral-800 bg-neutral-950/35 p-4">
        <div class="mb-3 flex items-center gap-2">
          <h2 class="text-sm font-semibold text-neutral-200">Board / Work</h2>
          <span class="ml-auto font-mono text-[10px] text-neutral-600">${esc(boardSlug || "no board")}</span>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-2">${lanes}</div>
      </section>
    </div>`;
  } catch (e) {
    window.ceoUI.showPanel("Domain", `Could not load domain board: ${e.message}`);
  }
}

async function createDomainHandoffFromView() {
  if (!currentProject || !currentDomain || currentDomain === "All" || !window.ceo.createDomainHandoff) return;
  const title = prompt("Handoff title:", `${currentDomain} handoff`);
  if (!title || !title.trim()) return;
  const r = await window.ceo.createDomainHandoff({
    domain: currentDomain,
    title: title.trim(),
    status: "pending",
    userConfirmation: true,
    sourceLinks: [`domains/${slugifyName(currentDomain)}/definition.md`, `domains/${slugifyName(currentDomain)}/captured-agenda-items.md`],
    capturedEntities: ["Domain package confirmed by human"],
    suggestedAgendaItems: [
      { type: "handoff-triage", title: `Triage ${title.trim()}`, priority: "high" },
      { type: "documentation", title: `Check docs handoff for ${currentDomain}`, priority: "normal" },
    ],
    body: "Manual handoff created from the domain cockpit. Agenda Agent should acknowledge and propose next Agenda Items only.",
  });
  setVoiceStatus(r && r.ok ? "Handoff captured." : `Handoff failed: ${r ? r.reason : "unknown"}`);
  await renderStudioBoard(currentDomain);
}

async function triageDomainHandoffFromView() {
  if (!currentProject || !currentDomain || currentDomain === "All" || !window.ceo.proposeAgendaFromHandoff) return;
  const proposal = await window.ceo.proposeAgendaFromHandoff({ domain: currentDomain });
  if (!proposal || !proposal.ok) {
    setVoiceStatus(`Triage failed: ${proposal ? proposal.reason : "unknown"}`);
    return;
  }
  let created = 0;
  for (const item of proposal.proposals || []) {
    const r = await window.ceo.createAgendaItem({ domain: currentDomain, item });
    if (r && r.ok) created++;
  }
  setVoiceStatus(`Agenda Agent proposed ${created} item${created === 1 ? "" : "s"}.`);
  await renderStudioBoard(currentDomain);
}

async function startDomainDogfoodMeeting() {
  if (!currentProject || !currentDomain || currentDomain === "All" || !window.ceo.meetingStart) return;
  const agenda = "Plan the first complete Domain Creation workflow implementation.";
  const criteria = "Produce a concrete implementation plan, risks, required artifacts, and next Agenda Items for the selected domain.";
  const members = "domain-architect,agenda-agent,docs-steward,self-repair-engineer";
  const info = {
    room: `domain-creation-${slugifyName(currentDomain)}-${Date.now()}`,
    agenda,
    criteria,
    members,
    allowPaid: false,
  };
  const r = await window.ceo.meetingStart(info);
  if (!r || !r.ok) {
    if (window.ceo.createAgendaItem) {
      await window.ceo.createAgendaItem({
        domain: currentDomain,
        item: {
          type: "bug/system repair",
          title: "Repair Domain Lifecycle dogfood meeting provider/registry support",
          priority: "high",
          source: "domain-cockpit meeting start",
          body: `Meeting start failed: ${r ? r.reason : "unknown"}. Provider/registry support must be fixed or explicitly documented before this capability is considered complete.`,
        },
      });
    }
    setVoiceStatus(`Meeting failed; captured repair Agenda Item.`);
    await renderStudioBoard(currentDomain);
    return;
  }
  navMeetingRoom = r.room;
  navMeetingMeta = { domain: currentDomain, agenda, participants: members, expectedOutcome: criteria, saved: false };
  setVoiceStatus(`Meeting started: ${r.room}`);
  await openView("meetings");
  const roomLabel = $("#nav-mtg-room"); if (roomLabel) roomLabel.textContent = r.room;
  pollNavMeeting();
  stopNavMeetingPoll();
  navMeetingTimer = setInterval(pollNavMeeting, 2500);
}

async function openProject(id) {
  if (!id) return;
  setAgentState("thinking");
  const res = await window.ceo.openProject(id);
  currentProject = res.project;
  currentDomain = "All";
  selectedFile = null;
  await refreshDomains(res.project, currentDomain);
  await refreshFileTree(currentDomain);
  await renderStudioBoard(currentDomain);
  const providerNote = $("#provider-note");
  if (providerNote) {
    providerNote.textContent = res.providerNote
      ? `model: ${res.providerId} — ${res.providerNote}`
      : `model: ${res.providerId}`;
  }
  const stream = $("#panel2-stream");
  if (stream) stream.innerHTML = "";
  appendStream("sys", `Opened "${res.project.name}". Brain initialized & docs indexed.`);
  renderMeter(await window.ceo.costStatus());
  await refreshEscalations();
  setAgentState("idle");
  window.CEOConvai?.syncContext?.(`opened project ${res.project.name}`);
}

/** One text turn: AGUI-rich chat in panel2 + artifacts in panel1 when available. */
async function runTurn(prompt) {
  if (!prompt) return;
  // Conversational brief creation: if the user is building a brief (or just
  // asked to), the Brief Builder consumes this turn (draft → create → decompose).
  if (window.BriefBuilder && await window.BriefBuilder.maybeHandle(prompt)) return;
  if (window.StudioSessions && window.StudioSessions.ensureAutoSession && window.StudioSessions.runTurn) {
    const sessionReady = await window.StudioSessions.ensureAutoSession(prompt);
    if (sessionReady && sessionReady.ok) return window.StudioSessions.runTurn(prompt);
    if (window.StudioSessions.isChatActive && window.StudioSessions.isChatActive()) {
      return window.StudioSessions.runTurn(prompt);
    }
  }
  setAgentState("thinking");

  if (window.CEOAgui) {
    const out = await window.CEOAgui.run(prompt);
    if (out && out.ok) {
      setAgentState("idle");
      return;
    }
    if (out && out.reason === "A turn is already running") return;
    if (window.CEOAgui.appendSys) {
      window.CEOAgui.appendSys(`⚠ ${out ? out.reason : "AGUI unreachable"} — using fallback.`);
    } else {
      appendStream("sys", `⚠ ${out ? out.reason : "AGUI unreachable"}`);
    }
  }

  // Fallback: plain stream + Document Agent / Hermes ask
  appendStream("user", prompt);
  if (!currentProject) { appendStream("sys", "Open a project first."); setAgentState("idle"); return; }
  const out = await window.ceo.ask(prompt);
  renderMeter(out.cost);
  if (out.halted) { appendStream("sys", out.text); setAgentState("halted"); return; }
  appendStream("agent", out.text);
  setAgentState("idle");
}

// --- Rich chat input helpers -------------------------------------------------

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  const maxH = 220;
  el.style.height = Math.min(el.scrollHeight, maxH) + "px";
}

function renderChatContextPills() {
  const host = $("#chat-context-pills");
  if (!host) return;
  if (!chatInputContexts.length) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  host.classList.remove("hidden");
  host.innerHTML = chatInputContexts.map((ctx) =>
    `<span class="chat-context-pill inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-700/30 px-2 py-0.5 text-[11px] text-neutral-300">
      <span class="truncate max-w-[180px]">${esc(ctx.title || ctx.path)}</span>
      <button class="chat-context-remove ml-0.5 text-neutral-500 hover:text-neutral-200" data-path="${esc(ctx.path)}" title="Remove">×</button>
    </span>`
  ).join("");
}

async function addChatContext() {
  const path = window.prompt("Attach file path (relative to project root):", selectedFile ? selectedFile.path : "");
  if (!path || !path.trim()) return;
  const trimmed = path.trim();
  if (chatInputContexts.some((c) => c.path === trimmed)) return;
  chatInputContexts.push({ path: trimmed, title: trimmed });
  renderChatContextPills();
}

function removeChatContext(path) {
  chatInputContexts = chatInputContexts.filter((c) => c.path !== path);
  renderChatContextPills();
}

function insertCodeBlock() {
  const input = $("#chat-input");
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const block = "```\n\n```";
  input.value = before + block + after;
  const cursor = start + 4; // inside the code block
  input.setSelectionRange(cursor, cursor);
  input.focus();
  autoResizeTextarea(input);
}

async function buildChatPromptWithContext(rawPrompt) {
  if (!chatInputContexts.length) return rawPrompt;
  const chunks = [];
  for (const ctx of chatInputContexts) {
    try {
      const r = await window.ceo.docsRead(ctx.path);
      const text = r && r.ok ? String(r.text || "").slice(0, 4000) : `(could not read ${ctx.path})`;
      chunks.push(`--- file: ${ctx.path} ---\n${text}`);
    } catch (e) {
      chunks.push(`--- file: ${ctx.path} ---\n(error: ${e.message})`);
    }
  }
  return [chunks.join("\n\n"), rawPrompt].join("\n\n");
}

async function send() {
  const input = $("#chat-input");
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = "";
  input.style.height = "auto";
  const fullPrompt = await buildChatPromptWithContext(prompt);
  chatInputContexts = [];
  renderChatContextPills();
  await runTurn(fullPrompt);
}

function closeCreateMenu() {
  const menu = $("#create-menu");
  if (menu) menu.classList.add("hidden");
}

function collectDomainWizardDraft() {
  return {
    name: $("#domain-name")?.value.trim() || "",
    purpose: $("#domain-purpose")?.value.trim() || "",
    overarchingGoal: $("#domain-goal")?.value.trim() || "",
    boundaries: splitLines($("#domain-responsibilities")?.value || ""),
    features: splitLines($("#domain-features")?.value || ""),
    relationships: splitLines($("#domain-relationships")?.value || ""),
    coreAgents: [...document.querySelectorAll('input[name="domain-agent"]:checked')].map((x) => x.value).filter(Boolean),
    kanbanBoard: $("#domain-board")?.value || "",
    relativePath: $("#domain-path")?.value.trim() || "",
  };
}

function applyDomainArchitectDraftToForm(session) {
  const draft = session?.draft || {};
  const set = (id, value) => { const el = $(`#${id}`); if (el) el.value = value || ""; };
  set("domain-name", draft.name);
  set("domain-purpose", draft.purpose);
  set("domain-goal", draft.overarchingGoal);
  set("domain-responsibilities", (draft.boundaries || draft.responsibilities || []).join("\n"));
  set("domain-features", (draft.features || draft.activeEpics || []).join("\n"));
  set("domain-relationships", (draft.relationships || draft.interfaces || []).join("\n"));
  set("domain-path", draft.relativePath || (draft.name ? `domains/${slugifyName(draft.name)}` : ""));
  const board = $("#domain-board");
  if (board && draft.kanbanBoard) board.value = draft.kanbanBoard;
  for (const input of document.querySelectorAll('input[name="domain-agent"]')) {
    input.checked = (draft.coreAgents || []).includes(input.value);
  }
}

function renderDomainArchitectPanel(session = domainArchitectSession) {
  const host = $("#domain-architect-panel");
  if (!host) return;
  if (!session) {
    host.innerHTML = `<div class="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-4">
      <div class="text-[10px] uppercase tracking-wider text-cyan-300/80">Domain Architect</div>
      <div class="mt-2 text-sm font-medium text-neutral-100">Guided creation interview</div>
      <p class="mt-2 text-xs leading-5 text-neutral-500">Start an interview session. The agent tracks missing essentials and only creates the domain after explicit confirmation.</p>
      <button id="domain-architect-start" class="mt-3 w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500">Start interview</button>
    </div>`;
    return;
  }
  const outline = session.outline || [];
  const current = session.currentQuestion || "Review the definition.";
  const active = outline.find((item) => item.focused);
  const transcript = session.transcript || [];
  const deepDives = session.deepDives || [];
  host.innerHTML = `<div class="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-4">
    <div class="flex items-center gap-2">
      <div class="text-[10px] uppercase tracking-wider text-cyan-300/80">Domain Architect</div>
      <span class="ml-auto rounded border border-neutral-700 bg-neutral-950/60 px-1.5 py-0.5 text-[10px] text-neutral-400">${session.readyToConfirm ? "ready" : "interviewing"}</span>
    </div>
    <div class="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
      ${active ? `<div class="mb-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-2 py-1 text-[11px] text-cyan-100">Focused: ${esc(active.label)}</div>` : ""}
      <div class="text-xs font-medium text-neutral-200">${esc(current)}</div>
      <textarea id="domain-architect-answer" rows="4" class="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="Answer this question, then record it..."></textarea>
      <button id="domain-architect-answer-save" ${session.readyToConfirm && !active ? "disabled" : ""} class="mt-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">Record answer</button>
    </div>
    <div class="mt-3 space-y-1.5">
      ${outline.map((item) => `<button class="domain-architect-outline w-full text-left flex items-center gap-2 rounded-lg border ${item.focused ? "border-cyan-500/60 bg-cyan-950/25" : "border-neutral-800 bg-neutral-950/45"} px-2 py-1.5 hover:border-cyan-500/40" data-field="${esc(item.key)}">
        <span class="h-2 w-2 rounded-full ${item.complete ? "bg-emerald-500" : "bg-amber-500"}"></span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs text-neutral-300">${esc(item.label)}</span>
          <span class="block truncate text-[10px] text-neutral-600">${esc(Array.isArray(item.value) ? item.value.join(", ") : item.value)}</span>
        </span>
        <span class="text-[10px] text-neutral-600">${item.complete ? "captured" : "missing"}</span>
      </button>`).join("")}
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button id="domain-architect-apply" class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Apply draft</button>
      <button id="domain-architect-ask" class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Ask Hermes</button>
      <button id="domain-architect-deep-dive" ${active ? "" : "disabled"} class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">Deep dive</button>
      <button id="domain-architect-confirm" ${session.readyToConfirm ? "" : "disabled"} class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40">Confirm & create</button>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2 text-[10px] text-neutral-500">
      <div class="rounded-lg border border-neutral-800 bg-neutral-950/35 px-2 py-1">Transcript turns: ${transcript.length}</div>
      <div class="rounded-lg border border-neutral-800 bg-neutral-950/35 px-2 py-1">Deep dives: ${deepDives.length}</div>
    </div>
    <div id="domain-architect-msg" class="mt-2 min-h-4 text-[10px] text-neutral-500">${session.missing?.length ? `Missing: ${session.missing.join(", ")}` : "Ready for confirmation."}</div>
  </div>`;
}

async function startDomainArchitectInterview() {
  if (!window.ceo.domainArchitectStart) return;
  const r = await window.ceo.domainArchitectStart(collectDomainWizardDraft());
  if (!r || !r.ok) {
    setVoiceStatus(`Domain Architect failed: ${r ? r.reason : "unknown"}`);
    return;
  }
  domainArchitectSession = r.session;
  renderDomainArchitectPanel();
  setVoiceStatus("Domain Architect interview started.");
}

async function focusDomainArchitectSection(field) {
  if (!domainArchitectSession || !field || !window.ceo.domainArchitectFocus) return;
  const r = await window.ceo.domainArchitectFocus({ id: domainArchitectSession.id, field });
  if (!r || !r.ok) {
    setVoiceStatus(`Domain Architect focus failed: ${r ? r.reason : "unknown"}`);
    return;
  }
  domainArchitectSession = r.session;
  renderDomainArchitectPanel();
}

async function saveDomainArchitectAnswer() {
  const answer = $("#domain-architect-answer")?.value.trim();
  const msg = $("#domain-architect-msg");
  if (!domainArchitectSession || !answer) {
    if (msg) msg.textContent = "Answer required.";
    return;
  }
  if (msg) msg.textContent = "Recording...";
  const r = await window.ceo.domainArchitectAnswer({ id: domainArchitectSession.id, answer });
  if (!r || !r.ok) {
    if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`;
    return;
  }
  domainArchitectSession = r.session;
  applyDomainArchitectDraftToForm(domainArchitectSession);
  renderDomainArchitectPanel();
}

async function captureDomainArchitectDeepDive() {
  const msg = $("#domain-architect-msg");
  const note = $("#domain-architect-answer")?.value.trim() || "";
  if (!domainArchitectSession || !window.ceo.domainArchitectDeepDive) return;
  if (!domainArchitectSession.activeFocus) {
    if (msg) msg.textContent = "Select an outline section first.";
    return;
  }
  const r = await window.ceo.domainArchitectDeepDive({
    id: domainArchitectSession.id,
    field: domainArchitectSession.activeFocus,
    note,
  });
  if (!r || !r.ok) {
    if (msg) msg.textContent = `deep dive failed: ${r ? r.reason : "unknown"}`;
    return;
  }
  domainArchitectSession = r.session;
  renderDomainArchitectPanel();
  setVoiceStatus("Deep dive captured as an Agenda Item proposal.");
}

async function askHermesDomainArchitect() {
  const draft = collectDomainWizardDraft();
  const prompt = [
    "Act as the Domain Architect for a domain creation interview.",
    "Review the current draft below. Ask only the next missing essential question, or say it is ready for confirmation.",
    "Do not create the domain. Do not create Kanban work.",
    "",
    JSON.stringify(draft, null, 2),
  ].join("\n");
  await runTurn(prompt);
}

async function confirmDomainArchitectSession() {
  if (!domainArchitectSession || !window.ceo.domainArchitectConfirm) return;
  const msg = $("#domain-architect-msg");
  if (msg) msg.textContent = "Creating confirmed domain...";
  const r = await window.ceo.domainArchitectConfirm(domainArchitectSession.id);
  if (!r || !r.ok) {
    if (msg) msg.textContent = `create failed: ${r ? r.reason : "unknown"}`;
    return;
  }
  await refreshDomains(currentProject, r.definition.name);
  await window.ceoUI.setDomainUI(r.definition.name);
  setVoiceStatus(`Domain Architect created: ${r.definition.name}`);
}

async function createProject() {
  closeCreateMenu();
  const p = await window.ceo.addProject();
  if (p) { await refreshProjects(p.id); await openProject(p.id); }
}

async function openDomainWizard(seed = {}) {
  closeCreateMenu();
  if (!currentProject) { setVoiceStatus("Open a project first."); return; }
  setPanelTitle("New Domain");
  setStudioFocus(currentProject.name, "Define the domain's meaning, long goal, board, and team.", "New Domain");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading domain workspace...</div>';

  let agents = [];
  let boards = [];
  try {
    const [agentRes, boardRes] = await Promise.all([
      window.ceo.listAgents ? window.ceo.listAgents() : null,
      window.ceo.ceoBoards ? window.ceo.ceoBoards() : null,
    ]);
    agents = (agentRes && agentRes.agents) || [];
    boards = (boardRes && boardRes.boards) || [];
  } catch {
    agents = [];
    boards = [];
  }

  const defaultName = seed.name || "";
  const defaultSlug = slugifyName(defaultName || "new-domain");
  const defaultBoard = seed.kanbanBoard || currentProject.slug || (boards[0] && boards[0].slug) || "";
  const boardOptions = [
    `<option value="">No board yet</option>`,
    ...boards.map((b) => {
      const slug = b.slug || b.name || b;
      return `<option value="${esc(slug)}" ${slug === defaultBoard ? "selected" : ""}>${esc(slug)}</option>`;
    }),
  ].join("");
  const agentChecks = agents.length
    ? agents.map((agent) => {
        const id = agent.id || agent.profile || agent.name;
        const label = agentLabel(agent);
        const checked = (seed.coreAgents || []).includes(id) ? "checked" : "";
        return `<label class="group flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-950/45 p-3 transition hover:border-cyan-500/40 hover:bg-cyan-950/10">
          <input type="checkbox" name="domain-agent" value="${esc(id)}" ${checked} class="mt-1 accent-cyan-500" />
          <span class="min-w-0">
            <span class="block text-sm font-medium text-neutral-200">${esc(label)}</span>
            <span class="block truncate text-[11px] text-neutral-600">${esc([agent.type, agent.persona, agent.status].filter(Boolean).join(" / "))}</span>
          </span>
        </label>`;
      }).join("")
    : `<div class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-3 text-sm text-neutral-500">No agents found in the registry yet.</div>`;
  domainArchitectSession = null;

  panelContent().innerHTML = `<div class="space-y-5">
    <div class="rounded-3xl border border-cyan-500/25 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.9),rgba(8,8,8,0.96))] p-5">
      <div class="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Domain Creation</div>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">Define a domain</h1>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">A domain is a strategic ownership area inside the project: what it means, why it exists, what long goal it serves, which board tracks it, and which agents are on the team.</p>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section class="space-y-3 rounded-3xl border border-neutral-800 bg-neutral-950/40 p-4">
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Domain name</span>
          <input id="domain-name" value="${esc(defaultName)}" placeholder="discovery, checkout, billing, docs..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500" />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Meaning / purpose</span>
          <textarea id="domain-purpose" rows="3" placeholder="What does this domain own? Why does it exist?" class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc(seed.purpose || "")}</textarea>
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Overarching goal</span>
          <textarea id="domain-goal" rows="3" placeholder="What is the long-running outcome this domain is trying to make true?" class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc(seed.overarchingGoal || "")}</textarea>
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Boundaries / ownership</span>
          <textarea id="domain-responsibilities" rows="4" placeholder="One per line: planning, intake, UX research, launch readiness..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc((seed.responsibilities || []).join("\n"))}</textarea>
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Initial features / capabilities</span>
          <textarea id="domain-features" rows="4" placeholder="One per line: handoff workflow, meeting artifact flow, scheduling integration..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc((seed.features || seed.initialFeatures || []).join("\n"))}</textarea>
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Relationships / dependencies</span>
          <textarea id="domain-relationships" rows="3" placeholder="One per line: domains, boards, agents, systems, or teams this connects to..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc((seed.relationships || seed.interfaces || []).join("\n"))}</textarea>
        </label>
      </section>

      <aside class="space-y-3">
        <div id="domain-architect-panel"></div>
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Board and files</div>
          <label class="mt-3 block text-xs text-neutral-500">Kanban board</label>
          <select id="domain-board" class="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100">${boardOptions}</select>
          <label class="mt-3 block text-xs text-neutral-500">Project path</label>
          <input id="domain-path" value="${esc(seed.relativePath || `domains/${defaultSlug}`)}" class="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100" />
          <label class="mt-3 flex items-center gap-2 text-sm text-neutral-300">
            <input id="domain-scaffold" type="checkbox" checked class="accent-cyan-500" />
            Create/update scaffold folder
          </label>
        </div>
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Domain team</div>
          <div class="mt-3 max-h-[320px] space-y-2 overflow-auto">${agentChecks}</div>
        </div>
      </aside>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button id="domain-create-save" class="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">Create domain</button>
      <button id="domain-draft-ceo" class="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800">Ask Hermes</button>
      <button id="domain-create-cancel" class="rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-900">Cancel</button>
      <span id="domain-create-msg" class="text-xs text-neutral-500"></span>
    </div>
  </div>`;
  renderDomainArchitectPanel();
}

async function saveDomainFromWizard() {
  const msg = $("#domain-create-msg");
  const name = $("#domain-name")?.value.trim();
  if (!name) { if (msg) msg.textContent = "Domain name is required."; return; }
  const purpose = $("#domain-purpose")?.value.trim() || "";
  const overarchingGoal = $("#domain-goal")?.value.trim() || "";
  const responsibilities = splitLines($("#domain-responsibilities")?.value || "");
  const features = splitLines($("#domain-features")?.value || "");
  const relationships = splitLines($("#domain-relationships")?.value || "");
  const coreAgents = [...document.querySelectorAll('input[name="domain-agent"]:checked')].map((x) => x.value).filter(Boolean);
  const kanbanBoard = $("#domain-board")?.value || null;
  const relativePath = $("#domain-path")?.value.trim() || `domains/${slugifyName(name)}`;
  const createScaffold = !!$("#domain-scaffold")?.checked;
  if (msg) msg.textContent = "Creating domain...";
  const r = await window.ceo.defineDomain({
    name,
    purpose,
    overarchingGoal,
    currentState: overarchingGoal,
    priorities: overarchingGoal ? [overarchingGoal] : [],
    activeEpics: features,
    features,
    relationships,
    boundaries: responsibilities,
    responsibilities,
    coreAgents,
    kanbanBoard,
    createScaffold,
    relativePath: createScaffold ? relativePath : null,
  });
  if (!r || !r.ok) {
    if (msg) msg.textContent = `Domain setup failed: ${r ? r.reason : "unknown"}`;
    setVoiceStatus(`Domain setup failed: ${r ? r.reason : "unknown"}`);
    return;
  }
  await refreshDomains(currentProject, r.definition.name);
  await window.ceoUI.setDomainUI(r.definition.name);
  setVoiceStatus(`Domain ready: ${r.definition.name}`);
}

async function createDomain() {
  await openDomainWizard();
}

async function openTaskWizard(boardOverride = null, seed = {}) {
  closeCreateMenu();
  if (!currentProject) { setVoiceStatus("Open a project first."); return; }
  let boardSlug = boardOverride;
  if (!boardSlug && seed.board) boardSlug = seed.board;
  if (!boardSlug) {
    const boardsRes = window.ceo.ceoBoardsForDomain ? await window.ceo.ceoBoardsForDomain(currentDomain) : null;
    boardSlug = boardsRes && boardsRes.boards && boardsRes.boards[0] ? boardsRes.boards[0].slug : null;
  }
  if (!boardSlug) { setVoiceStatus("No board available for this domain."); return; }
  let assignees = [];
  let personas = [];
  let skills = [];
  try {
    const [assigneeRes, personaRes, skillRes] = await Promise.all([
      window.ceo.ceoAssignees ? window.ceo.ceoAssignees(boardSlug) : null,
      window.ceo.listPersonas ? window.ceo.listPersonas() : null,
      window.ceo.listSkills ? window.ceo.listSkills() : null,
    ]);
    assignees = (assigneeRes && assigneeRes.assignees) || [];
    personas = (personaRes && personaRes.personas) || [];
    skills = (skillRes && skillRes.skills) || [];
  } catch {
    assignees = [];
    personas = [];
    skills = [];
  }
  const assigneeOptions = [
    `<option value="">Unassigned</option>`,
    ...assignees.map((a) => {
      const name = assigneeName(a);
      return name ? `<option value="${esc(name)}">${esc(name)}</option>` : "";
    }).filter(Boolean),
  ].join("");
  const personaOptions = [
    `<option value="">No persona overlay</option>`,
    ...personas.map((p) => `<option value="${esc(p.id)}" ${p.id === seed.persona ? "selected" : ""}>${esc(personaLabel(p))}</option>`),
  ].join("");
  const skillChecks = skills.length
    ? skills.map((skill) => {
        const checked = (seed.skills || []).includes(skill.id) ? "checked" : "";
        return `<label class="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950/45 p-2 text-xs text-neutral-300 hover:border-cyan-500/40">
          <input type="checkbox" name="task-new-skill" value="${esc(skill.id)}" ${checked} class="mt-0.5 accent-cyan-500" />
          <span><span class="block">${esc(skillLabel(skill))}</span><span class="block text-[10px] text-neutral-600">${esc(skill.category || "")}</span></span>
        </label>`;
      }).join("")
    : `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 p-2 text-xs text-neutral-500">No skills registered.</div>`;
  setPanelTitle("New Task");
  setStudioFocus(currentDomain && currentDomain !== "All" ? currentDomain : currentProject.name, `Create a planning task on ${boardSlug}.`, "New Task");
  panelContent().innerHTML = `<div class="space-y-5">
    <div class="rounded-3xl border border-cyan-500/25 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.9),rgba(8,8,8,0.96))] p-5">
      <div class="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Task Intake</div>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">Add a task to ${esc(currentDomain || "this domain")}</h1>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">This creates a real Hermes Kanban task. Keep it planning-first: outcome, context, constraints, and who should own the next move.</p>
    </div>
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section class="space-y-3 rounded-3xl border border-neutral-800 bg-neutral-950/40 p-4">
        <input id="task-new-board" type="hidden" value="${esc(boardSlug)}" />
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Title</span>
          <input id="task-new-title" value="${esc(seed.title || "")}" placeholder="Clear task outcome..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500" />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Planning brief</span>
          <textarea id="task-new-body" rows="8" placeholder="Context, acceptance criteria, constraints, relevant files, and what planning decision is needed..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc(seed.body || "")}</textarea>
        </label>
      </section>
      <aside class="space-y-3">
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4">
          <div class="text-[10px] uppercase tracking-wider text-neutral-600">Routing</div>
          <label class="mt-3 block text-xs text-neutral-500">Lane</label>
          <select id="task-new-status" class="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100">
            <option value="triage" ${!seed.status || seed.status === "triage" ? "selected" : ""}>Triage / planning</option>
            <option value="bug" ${seed.status === "bug" ? "selected" : ""}>Bug</option>
            <option value="todo" ${seed.status === "todo" ? "selected" : ""}>Todo</option>
            <option value="ready" ${seed.status === "ready" ? "selected" : ""}>Ready</option>
          </select>
          <label class="mt-3 block text-xs text-neutral-500">Owner / agent</label>
          <select id="task-new-assignee" class="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100">${assigneeOptions}</select>
          <label class="mt-3 block text-xs text-neutral-500">Persona</label>
          <select id="task-new-persona" class="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100">${personaOptions}</select>
          <div class="mt-3 text-xs text-neutral-500">Skills</div>
          <div class="mt-2 grid max-h-[180px] grid-cols-1 gap-2 overflow-auto">${skillChecks}</div>
        </div>
        <div class="rounded-2xl border border-neutral-800 bg-neutral-950/45 p-4 text-xs leading-5 text-neutral-500">
          Board: <span class="font-mono text-neutral-300">${esc(boardSlug)}</span><br>
          Domain: <span class="text-neutral-300">${esc(currentDomain || "All")}</span>
        </div>
      </aside>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button id="task-new-save" class="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">Create task</button>
      <button id="task-new-cancel" class="rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-900">Cancel</button>
      <span id="task-new-msg" class="text-xs text-neutral-500"></span>
    </div>
  </div>`;
  const ownerSelect = $("#task-new-assignee");
  if (ownerSelect && seed.assignee) ownerSelect.value = seed.assignee;
}

async function saveTaskFromWizard() {
  const msg = $("#task-new-msg");
  const board = $("#task-new-board")?.value || "";
  const title = $("#task-new-title")?.value.trim() || "";
  if (!title) { if (msg) msg.textContent = "Task title is required."; return; }
  const body = $("#task-new-body")?.value || "";
  const status = $("#task-new-status")?.value || "triage";
  const assignee = $("#task-new-assignee")?.value || null;
  const persona = $("#task-new-persona")?.value.trim() || null;
  const skills = [...document.querySelectorAll('input[name="task-new-skill"]:checked')].map((x) => x.value).filter(Boolean);
  const finalBody = [
    body,
    persona ? `\n\nPersona: ${persona}` : "",
    skills.length ? `\n\nSkills: ${skills.join(", ")}` : "",
  ].join("").trim();
  if (msg) msg.textContent = "Creating task...";
  const r = await window.ceo.ceoAddTask({ board, status, title, body: finalBody, assignee, persona });
  if (!r || !r.ok) {
    if (msg) msg.textContent = `Task add failed: ${r ? r.reason : "unknown"}`;
    setVoiceStatus(`Task add failed: ${r ? r.reason : "unknown"}`);
    return;
  }
  setVoiceStatus("Task added.");
  await renderStudioBoard(currentDomain);
}

async function createTask(boardOverride = null) {
  await openTaskWizard(boardOverride);
}

// Expose thin UI helpers so the live-voice module (convai.js, an ES module)
// can render transcripts + drive the presence circle without duplicating code.
// --- Studio nav rail: the left rail opens workspace panels --------------
// Each nav item renders a view into the main content panel (#panel-content-body).
// Views: domain (existing planning board), board (Kanban), tasks (flat list),
// agents (registry roster), teams (registry teams), channels (rooms/DMs),
// meetings (working session).
let studioView = "domain";
let navMeetingOpts = null;     // cached {agents, teams, personas} for the meetings view
let navMeetingRoom = null;
let navMeetingTimer = null;
let navMeetingMeta = null;
let navMeetingCreateOpen = false;
let navMeetingPastRooms = [];
let navMeetingScheduled = [];
const NAV_COL_ORDER = ["planning", "triage", "bug", "todo", "ready", "running", "blocked", "scheduled", "review", "done"];

function setActiveNav(view) {
  document.querySelectorAll("#studio-nav .nav-item").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("bg-neutral-800", active);
    b.classList.toggle("text-neutral-100", active);
    b.classList.toggle("text-neutral-300", !active);
  });
}

function navEmpty(msg) {
  return `<div class="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-500">${esc(msg)}</div>`;
}

async function currentBoardSlug() {
  if (!window.ceo.ceoBoardsForDomain) return null;
  let res = {};
  try { res = await window.ceo.ceoBoardsForDomain(currentDomain); } catch { res = {}; }
  const boards = (res && res.boards) || [];
  return (boards[0] && boards[0].slug) || (res && res.current)
    || (currentProject && currentProject.slug) || null;
}

async function renderBoardView() {
  setPanelTitle("Board");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading board…</div>';
  const slug = await currentBoardSlug();
  if (!slug) { panelContent().innerHTML = navEmpty("No Kanban board for this domain yet."); return; }
  let data = {};
  try { data = await window.ceo.ceoBoard(slug); } catch { data = {}; }
  const cols = (data && data.columns) || {};
  const present = Object.keys(cols);
  const ordered = NAV_COL_ORDER.concat(present.filter((c) => !NAV_COL_ORDER.includes(c)));
  if (!ordered.length) { panelContent().innerHTML = navEmpty(`Board "${slug}" is empty.`); return; }
  const lanes = ordered.map((status) => {
    const tasks = cols[status] || [];
    const cards = tasks.map((t) => `
      <div class="studio-task-card cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/70 p-2.5 hover:border-neutral-700 transition"
           data-board="${esc(slug)}" data-task-id="${esc(t.id)}" data-task-title="${esc(t.title)}" data-task-status="${esc(status)}">
        <div class="text-[13px] text-neutral-100 leading-snug">${esc(t.title)}</div>
        ${t.assignee ? `<div class="mt-1 text-[10px] text-neutral-500">${esc(t.assignee)}</div>` : ""}
      </div>`).join("") || '<div class="px-2 py-3 text-xs text-neutral-700">empty</div>';
    return `<section class="w-[240px] shrink-0 rounded-xl border border-neutral-800 bg-neutral-950/40">
      <div class="flex items-center gap-2 border-b border-neutral-800/70 px-3 py-2">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">${esc(status)}</span>
        <span class="ml-auto text-[11px] text-neutral-600">${tasks.length}</span>
      </div>
      <div class="space-y-2 p-2">${cards}</div>
    </section>`;
  }).join("");
  panelContent().innerHTML = `<div class="flex gap-3 overflow-x-auto pb-2">${lanes}</div>`;
}

async function renderTasksView() {
  setPanelTitle("Tasks");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading tasks…</div>';
  const slug = await currentBoardSlug();
  if (!slug) { panelContent().innerHTML = navEmpty("No board for this domain yet."); return; }
  let data = {};
  try { data = await window.ceo.ceoBoard(slug); } catch { data = {}; }
  const cols = (data && data.columns) || {};
  const rows = [];
  for (const status of Object.keys(cols)) {
    for (const t of cols[status] || []) rows.push({ ...t, status });
  }
  if (!rows.length) { panelContent().innerHTML = navEmpty(`No tasks on "${slug}".`); return; }
  panelContent().innerHTML = `<div class="space-y-1.5">${rows.map((t) => `
    <div class="studio-task-card cursor-pointer flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 hover:border-neutral-700 transition"
         data-board="${esc(slug)}" data-task-id="${esc(t.id)}" data-task-title="${esc(t.title)}" data-task-status="${esc(t.status)}">
      <span class="text-[10px] uppercase tracking-wider text-neutral-500 w-20 shrink-0">${esc(t.status)}</span>
      <span class="flex-1 min-w-0 truncate text-sm text-neutral-100">${esc(t.title)}</span>
      <span class="text-[10px] text-neutral-600 shrink-0">${esc(t.assignee || "—")}</span>
    </div>`).join("")}</div>`;
}

// --- Registry (agents + teams) — single source of truth for Agents/Teams.
let registryState = { agents: [], teams: [], personas: [], providers: [], models: {} };
let meetingRoomsState = [];
let agentDirectoryState = { query: "", provider: "all", capability: "all", status: "all", group: "all" };
let skillCatalogState = { skills: [], query: "" };
let activeAgentsTimer = null;
let goalsOpState = { message: "", output: "" };

async function loadRegistry() {
  const [reg, per, prov, mods] = await Promise.all([
    window.ceo.registryList ? window.ceo.registryList() : { agents: [], teams: [] },
    window.ceo.registryPersonas ? window.ceo.registryPersonas() : { personas: [] },
    window.ceo.registryProviders ? window.ceo.registryProviders() : { providers: ["vertex"] },
    window.ceo.registryModels ? window.ceo.registryModels() : { providers: {} },
  ]);
  const baseAgents = (reg && reg.agents) || [];
  const agents = await Promise.all(baseAgents.map(async (agent) => {
    if (!agent || !agent.tmux_session || !window.ceo.registryAlive) return { ...agent, mounted: false };
    try {
      const live = await window.ceo.registryAlive(agent.id);
      return { ...agent, mounted: !!(live && live.alive) };
    } catch {
      return { ...agent, mounted: false };
    }
  }));
  registryState = {
    agents,
    teams: (reg && reg.teams) || [],
    personas: (per && per.personas) || [],
    providers: (prov && prov.providers) || ["vertex"],
    models: (mods && mods.providers) || {},   // providerName -> [{id,label,...}]
  };
  return registryState;
}

function agentSubtitle(a) {
  const persona = a.persona ? esc(a.persona) : "no persona";
  const brain = esc(a.provider || "vertex") + (a.model ? ` · ${esc(a.model)}` : "");
  return `${persona} · ${brain}`;
}

function agentTeamNames(agentId) {
  return (registryState.teams || [])
    .filter((team) => (team.members || []).includes(agentId))
    .map((team) => team.name);
}

function agentGroupName(agent) {
  const id = String(agent.id || "").toLowerCase();
  const caps = (agent.capabilities || []).join(" ").toLowerCase();
  const persona = String(agent.persona || "").toLowerCase();
  if (id === "ceo" || caps.includes("strategy") || caps.includes("orchestration")) return "Leadership";
  if (caps.includes("implementation") || caps.includes("patches") || caps.includes("self-repair") || caps.includes("diagnostics") || caps.includes("test")) return "Execution";
  if (caps.includes("requirements") || caps.includes("research") || caps.includes("roadmap") || caps.includes("task-planning") || caps.includes("adr") || caps.includes("spec")) return "Planning";
  if (caps.includes("domain") || caps.includes("handoff") || caps.includes("document") || caps.includes("docs") || persona.includes("agenda")) return "Domain Systems";
  if (caps.includes("coordination") || caps.includes("synthesis") || persona.includes("facilitator")) return "Coordination";
  return "Specialists";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function agentDirectoryOptions() {
  const agents = registryState.agents || [];
  return {
    providers: uniqueSorted(agents.map((a) => a.provider || "unknown")),
    capabilities: uniqueSorted(agents.flatMap((a) => a.capabilities || [])),
    groups: uniqueSorted(agents.map(agentGroupName)),
  };
}

function agentMatchesDirectoryFilters(agent) {
  const state = agentDirectoryState;
  const teams = agentTeamNames(agent.id);
  const haystack = [
    agent.id,
    agent.name,
    agent.provider,
    agent.model,
    agent.persona,
    agent.description,
    ...(agent.capabilities || []),
    ...teams,
  ].join(" ").toLowerCase();
  const query = String(state.query || "").trim().toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (state.provider !== "all" && (agent.provider || "unknown") !== state.provider) return false;
  if (state.capability !== "all" && !(agent.capabilities || []).includes(state.capability)) return false;
  if (state.group !== "all" && agentGroupName(agent) !== state.group) return false;
  if (state.status === "mounted" && !agent.mounted) return false;
  if (state.status === "configured" && !agent.tmux_session) return false;
  if (state.status === "unmounted" && agent.mounted) return false;
  if (state.status === "disabled" && agent.enabled !== false) return false;
  if (state.status !== "disabled" && agent.enabled === false) return false;
  return true;
}

function agentCardHtml(agent) {
  const teams = agentTeamNames(agent.id);
  const group = agentGroupName(agent);
  const statusLabel = agent.mounted ? "live" : agent.tmux_session ? "mounted" : "available";
  const statusColor = agent.mounted ? "bg-emerald-500" : agent.tmux_session ? "bg-amber-500" : "bg-neutral-600";
  const caps = (agent.capabilities || []).slice(0, 5);
  return `<article class="team-agent-card rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 transition hover:border-cyan-500/40" data-agent="${esc(agent.id)}">
    <div class="flex items-start gap-3">
      <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}"></span>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-neutral-100">${esc(agent.name || agent.id)}</span>
          <span class="rounded border border-neutral-800 bg-neutral-950/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">${esc(group)}</span>
        </div>
        <div class="mt-1 truncate text-[11px] text-neutral-500">${agentSubtitle(agent)}</div>
        ${agent.description ? `<p class="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">${esc(agent.description)}</p>` : ""}
      </div>
      <div class="shrink-0 text-right">
        <div class="text-[10px] uppercase tracking-wider ${agent.mounted ? "text-emerald-400" : "text-neutral-500"}">${statusLabel}</div>
        <div class="mt-1 font-mono text-[10px] text-neutral-600">${esc(agent.provider || "unknown")}</div>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap gap-1.5">
      ${caps.length ? caps.map((cap) => `<button type="button" class="agent-filter-chip rounded border border-neutral-800 bg-neutral-950/55 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:border-cyan-700 hover:text-cyan-200" data-capability="${esc(cap)}">${esc(cap)}</button>`).join("") : `<span class="text-[10px] text-neutral-700">no capabilities tagged</span>`}
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      ${teams.length ? teams.slice(0, 3).map((team) => `<span class="rounded border border-neutral-800 bg-neutral-950/55 px-1.5 py-0.5 text-[10px] text-neutral-500">${esc(team)}</span>`).join("") : `<span class="text-[10px] text-neutral-700">no team</span>`}
      <div class="ml-auto flex flex-wrap gap-1.5">
        <button type="button" class="agent-action rounded-md bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500" data-action="use" data-agent="${esc(agent.id)}">Use</button>
        <button type="button" class="agent-action rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800" data-action="dm" data-agent="${esc(agent.id)}">DM</button>
        <button type="button" class="agent-action rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800" data-action="detail" data-agent="${esc(agent.id)}">Details</button>
      </div>
    </div>
  </article>`;
}

function liveTerminalAgents() {
  return (registryState.agents || []).filter((agent) => agent && agent.mounted && agent.tmux_session);
}

function activeAgentElement(agentId, selector) {
  return Array.from(document.querySelectorAll(selector)).find((el) => el.dataset.agent === agentId) || null;
}

function activeAgentTerminalCard(agent) {
  const tmuxWindow = agent.tmux_window || "main";
  return `<article class="active-agent-card min-h-[320px] rounded-xl border border-neutral-800 bg-neutral-950/50 p-3" data-agent="${esc(agent.id)}">
    <div class="mb-2 flex items-start gap-2">
      <span class="mt-1.5 h-2 w-2 rounded-full bg-emerald-500"></span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-neutral-100">${esc(agent.name || agent.id)}</div>
        <div class="mt-0.5 truncate font-mono text-[10px] text-neutral-500">${esc(agent.tmux_session)}:${esc(tmuxWindow)}</div>
      </div>
      <span class="active-agent-status rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-emerald-300" data-agent="${esc(agent.id)}">live</span>
    </div>
    <pre class="active-agent-output h-48 overflow-auto rounded-lg border border-neutral-800 bg-black/80 p-2 font-mono text-[11px] leading-relaxed text-emerald-100/85 whitespace-pre-wrap" data-agent="${esc(agent.id)}">Loading terminal...</pre>
    <div class="mt-2 flex min-w-0 items-center gap-1.5">
      <input class="active-agent-input min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-cyan-500" data-agent="${esc(agent.id)}" data-window="${esc(tmuxWindow)}" placeholder="Send terminal input..." />
      <button type="button" class="active-agent-send rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-500" data-agent="${esc(agent.id)}" data-window="${esc(tmuxWindow)}">Send</button>
    </div>
    <div class="mt-2 flex items-center gap-1.5">
      <button type="button" class="active-agent-refresh rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" data-agent="${esc(agent.id)}">Refresh</button>
      <button type="button" class="active-agent-open rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" data-agent="${esc(agent.id)}">Open full</button>
      <span class="ml-auto truncate text-[10px] text-neutral-600">${esc(agent.provider || "unknown")}${agent.model ? " / " + esc(agent.model) : ""}</span>
    </div>
  </article>`;
}

function activeAgentTerminalsHtml() {
  const liveAgents = liveTerminalAgents();
  const cards = liveAgents.length
    ? `<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${liveAgents.map(activeAgentTerminalCard).join("")}</div>`
    : navEmpty("No live agent tmux sessions.");
  return `<section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-neutral-100">Active Agent Terminals</div>
        <div class="mt-1 text-xs text-neutral-500">${liveAgents.length} live terminal${liveAgents.length === 1 ? "" : "s"}</div>
      </div>
      <button type="button" id="active-agents-refresh" class="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Refresh all</button>
    </div>
    ${cards}
  </section>`;
}

function stopActiveAgentsTimer() {
  if (activeAgentsTimer) {
    clearInterval(activeAgentsTimer);
    activeAgentsTimer = null;
  }
}

function startActiveAgentsTimer() {
  stopActiveAgentsTimer();
  refreshActiveAgentTerminals();
  activeAgentsTimer = setInterval(() => {
    if (studioView !== "agents" || !document.getElementById("active-agents-refresh")) {
      stopActiveAgentsTimer();
      return;
    }
    refreshActiveAgentTerminals({ quiet: true });
  }, 2500);
}

async function refreshActiveAgentTerminals(opts = {}) {
  const agents = liveTerminalAgents();
  if (!agents.length) return;
  await Promise.all(agents.map((agent) => refreshActiveAgentTerminal(agent.id, opts)));
}

async function refreshActiveAgentTerminal(agentId, opts = {}) {
  const output = activeAgentElement(agentId, ".active-agent-output");
  const status = activeAgentElement(agentId, ".active-agent-status");
  if (!output) return;
  if (!opts.quiet) output.textContent = "Loading terminal...";
  let result = {};
  try {
    result = await window.ceo.registryTerminal(agentId);
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (result && result.ok) {
    output.textContent = result.output || "(empty)";
    output.scrollTop = output.scrollHeight;
    if (status) {
      status.textContent = "live";
      status.className = "active-agent-status rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-emerald-300";
    }
    return;
  }
  output.textContent = `Terminal unavailable: ${result ? result.reason : "unknown"}`;
  if (status) {
    status.textContent = "offline";
    status.className = "active-agent-status rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-amber-300";
  }
}

async function sendActiveAgentTerminalInput(agentId) {
  const input = activeAgentElement(agentId, ".active-agent-input");
  const status = activeAgentElement(agentId, ".active-agent-status");
  if (!input) return;
  const text = input.value || "";
  if (!text.trim()) return;
  const tmuxWindow = input.dataset.window || "main";
  input.value = "";
  if (status) status.textContent = "sending";
  let result = {};
  try {
    result = await window.ceo.registryTerminalSend(agentId, text, tmuxWindow);
  } catch (e) {
    result = { ok: false, reason: e.message || String(e) };
  }
  if (!result || !result.ok) {
    if (status) {
      status.textContent = "failed";
      status.className = "active-agent-status rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-red-300";
    }
    const output = activeAgentElement(agentId, ".active-agent-output");
    if (output) output.textContent = `Send failed: ${result ? result.reason : "unknown"}`;
    return;
  }
  setTimeout(() => refreshActiveAgentTerminal(agentId, { quiet: true }), 250);
}

function agentDirectoryPrompt(agents) {
  const rows = agents.map((agent) => {
    const teams = agentTeamNames(agent.id);
    return `- ${agent.id}: ${agent.name || agent.id}; provider=${agent.provider || "unknown"}; persona=${agent.persona || "none"}; group=${agentGroupName(agent)}; capabilities=${(agent.capabilities || []).join(", ") || "none"}; teams=${teams.join(", ") || "none"}; mounted=${agent.mounted ? "yes" : "no"}; description=${agent.description || "none"}`;
  }).join("\n");
  return [
    "Use this agent registry snapshot to recommend the right operating team for my next goal.",
    "Map needed work to existing agents first. If an agent is missing, say exactly what role/capabilities to add.",
    "Do not create tasks or dispatch workers yet; propose the team and meeting/workflow shape.",
    "",
    rows || "- No matching agents.",
  ].join("\n");
}

function skillMatchesFilter(skill) {
  const query = String(skillCatalogState.query || "").trim().toLowerCase();
  if (!query) return true;
  const hay = [
    skill.id,
    skill.name,
    skill.category,
    skill.description,
    skill.source,
    ...(skill.capabilities || []),
    ...(skill.tags || []),
  ].join(" ").toLowerCase();
  return hay.includes(query);
}

function skillCardHtml(skill) {
  const caps = (skill.capabilities || []).slice(0, 6);
  return `<article class="skill-card rounded-xl border border-neutral-800 bg-neutral-900/60 p-3" data-skill="${esc(skill.id)}">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium text-neutral-100">${esc(skill.name || skill.id)}</span>
          <span class="rounded border border-neutral-800 bg-neutral-950/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">${esc(skill.source || "builtin")}</span>
        </div>
        <div class="mt-1 text-[11px] text-neutral-500">${esc(skill.category || "general")}</div>
        ${skill.description ? `<p class="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">${esc(skill.description)}</p>` : ""}
      </div>
      <button type="button" class="skill-route rounded-md bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500" data-skill="${esc(skill.id)}">Route</button>
    </div>
    <div class="mt-3 flex flex-wrap gap-1.5">
      ${caps.length ? caps.map((cap) => `<span class="rounded border border-neutral-800 bg-neutral-950/55 px-1.5 py-0.5 text-[10px] text-neutral-400">${esc(cap)}</span>`).join("") : `<span class="text-[10px] text-neutral-700">no inferred capabilities</span>`}
    </div>
  </article>`;
}

async function renderSkillsView() {
  setPanelTitle("Skills");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading skills...</div>';
  let res = {};
  try { res = window.ceo.listSkills ? await window.ceo.listSkills() : { skills: [] }; } catch { res = {}; }
  skillCatalogState.skills = (res && res.skills) || [];
  renderSkillsPanel();
}

function renderSkillsPanel(routeResult = null) {
  const skills = skillCatalogState.skills || [];
  const filtered = skills.filter(skillMatchesFilter);
  const byCategory = new Map();
  for (const skill of filtered) {
    const category = skill.category || "general";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(skill);
  }
  const groups = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, rows]) => `
    <section class="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-neutral-400">${esc(category)}</span>
        <span class="text-[10px] text-neutral-600">${rows.length}</span>
      </div>
      <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${rows.map(skillCardHtml).join("")}</div>
    </section>`).join("") || navEmpty("No skills match the current search.");
  const routeHtml = routeResult ? `<section class="rounded-2xl border border-cyan-700/40 bg-cyan-950/15 p-4">
    <div class="mb-2 text-sm font-semibold text-cyan-100">Route Preview</div>
    <div class="text-xs text-neutral-400">Lead: <span class="font-mono text-neutral-200">${esc(routeResult.leadAgent || "none")}</span></div>
    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">${(routeResult.team || []).map((agent) => `<div class="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2">
      <div class="flex items-center gap-2"><span class="text-sm text-neutral-100">${esc(agent.name || agent.id)}</span><span class="ml-auto text-[10px] text-neutral-500">${esc(agent.provider || "")}</span></div>
      <div class="mt-1 text-[10px] text-neutral-600">${esc((agent.reasons || []).join(", ") || "matched")}</div>
    </div>`).join("") || `<div class="text-xs text-neutral-600">No agent matches yet.</div>`}</div>
    ${routeResult.gaps && routeResult.gaps.length ? `<div class="mt-3 text-xs text-amber-300">${routeResult.gaps.map(esc).join("<br>")}</div>` : ""}
    <div class="mt-3 text-xs text-neutral-500">${esc(routeResult.dispatchPath || "")}</div>
  </section>` : "";
  panelContent().innerHTML = `<div class="space-y-4">
    <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-neutral-100">Skill Catalog</div>
          <div class="mt-1 text-xs text-neutral-500">Capability templates from CEO Studio, the harness, project skills, and local Kimi Desktop skills.</div>
        </div>
        <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-[11px] text-neutral-500">${skills.length} skills</span>
      </div>
      <input id="skill-search" value="${esc(skillCatalogState.query)}" placeholder="Search skills, sources, categories, capabilities..." class="mt-4 w-full rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
    </div>
    ${routeHtml}
    ${groups}
  </div>`;
}

async function routeSkillFromCatalog(skillId) {
  const objective = focusedTask?.taskTitle || $("#chat-input")?.value || "Route this capability to the right agents.";
  let route = {};
  try { route = await window.ceo.routeSkills({ skills: [skillId], objective, domain: currentDomain }); } catch (e) { route = { ok: false, reason: e.message }; }
  if (!route || !route.ok) {
    setVoiceStatus(`Skill route failed: ${route ? route.reason : "unknown"}`);
    return;
  }
  renderSkillsPanel(route);
}

async function renderAgentsView() {
  setPanelTitle("Agents");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading agents...</div>';
  await loadRegistry();
  renderAgentsPanel();
}

async function renderTeamsView() {
  setPanelTitle("Teams");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading teams...</div>';
  await loadRegistry();
  renderTeamsPanel();
}

function renderAgentsPanel() {
  const { agents } = registryState;
  const opts = agentDirectoryOptions();
  const filtered = agents.filter(agentMatchesDirectoryFilters);
  const mountedCount = agents.filter((a) => a.mounted).length;
  const configuredCount = agents.filter((a) => a.tmux_session).length;
  const devinCount = agents.filter((a) => a.provider === "devin").length;
  const missingPersonaCount = agents.filter((a) => !a.persona).length;
  const grouped = opts.groups.map((group) => ({
    group,
    agents: filtered.filter((agent) => agentGroupName(agent) === group),
  })).filter((item) => item.agents.length);
  const groupSections = grouped.length ? grouped.map((item) => `
    <section class="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-neutral-400">${esc(item.group)}</span>
        <span class="text-[10px] text-neutral-600">${item.agents.length}</span>
      </div>
      <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${item.agents.map(agentCardHtml).join("")}</div>
    </section>`).join("") : navEmpty("No agents match the current filters.");
  const providerOptions = [`<option value="all">All providers</option>`].concat(opts.providers.map((provider) => `<option value="${esc(provider)}" ${agentDirectoryState.provider === provider ? "selected" : ""}>${esc(provider)}</option>`)).join("");
  const capabilityOptions = [`<option value="all">All capabilities</option>`].concat(opts.capabilities.map((cap) => `<option value="${esc(cap)}" ${agentDirectoryState.capability === cap ? "selected" : ""}>${esc(cap)}</option>`)).join("");
  const groupOptions = [`<option value="all">All groups</option>`].concat(opts.groups.map((group) => `<option value="${esc(group)}" ${agentDirectoryState.group === group ? "selected" : ""}>${esc(group)}</option>`)).join("");

  panelContent().innerHTML = `
    <div class="space-y-4">
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-neutral-100">Agent Directory</div>
            <div class="mt-1 text-xs text-neutral-500">Registry-backed roster for selecting, mounting, messaging, and forming teams.</div>
          </div>
          <button id="agent-ask-ceo" class="rounded-md border border-cyan-700/60 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-900/40">Ask CEO to route</button>
          <button id="agent-new" class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500">+ New agent</button>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          ${detailRow("Agents", `${agents.length}`)}
          ${detailRow("Live / configured", `${mountedCount} / ${configuredCount}`)}
          ${detailRow("Devin workers", `${devinCount}`)}
          ${detailRow("Missing persona", `${missingPersonaCount}`)}
        </div>
        <div class="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <input id="agent-search" value="${esc(agentDirectoryState.query)}" placeholder="Search agent, role, team, capability..." class="min-w-0 rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          <select id="agent-filter-provider" class="rounded-lg border border-neutral-700 bg-neutral-950/60 px-2 py-2 text-xs text-neutral-100">${providerOptions}</select>
          <select id="agent-filter-capability" class="rounded-lg border border-neutral-700 bg-neutral-950/60 px-2 py-2 text-xs text-neutral-100">${capabilityOptions}</select>
          <select id="agent-filter-group" class="rounded-lg border border-neutral-700 bg-neutral-950/60 px-2 py-2 text-xs text-neutral-100">${groupOptions}</select>
          <select id="agent-filter-status" class="rounded-lg border border-neutral-700 bg-neutral-950/60 px-2 py-2 text-xs text-neutral-100">
            <option value="all" ${agentDirectoryState.status === "all" ? "selected" : ""}>All active</option>
            <option value="mounted" ${agentDirectoryState.status === "mounted" ? "selected" : ""}>Live only</option>
            <option value="configured" ${agentDirectoryState.status === "configured" ? "selected" : ""}>Configured terminal</option>
            <option value="unmounted" ${agentDirectoryState.status === "unmounted" ? "selected" : ""}>Not live</option>
            <option value="disabled" ${agentDirectoryState.status === "disabled" ? "selected" : ""}>Disabled</option>
          </select>
        </div>
        <div class="mt-2 flex items-center gap-2 text-[11px] text-neutral-600">
          <span>${filtered.length} visible</span>
          <button id="agent-filters-clear" class="rounded border border-neutral-800 px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200">Clear filters</button>
        </div>
      </div>
      ${activeAgentTerminalsHtml()}
      ${groupSections}
    </div>`;
  startActiveAgentsTimer();
}

function renderTeamsPanel() {
  const { agents, teams } = registryState;
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const teamCards = teams.length ? teams.map((t) => {
    const members = (t.members || []).map((id) => {
      const a = agentById.get(id);
      return `<div class="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-2.5 py-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-cyan-500/70"></span>
        <span class="text-sm text-neutral-200">${esc(a ? (a.name || a.id) : id)}</span>
        <span class="ml-auto text-[10px] text-neutral-500">${a ? agentSubtitle(a) : "not in registry"}</span>
        <button class="team-remove text-neutral-600 hover:text-red-400 text-xs ml-1" data-team="${esc(t.name)}" data-agent="${esc(id)}" title="Remove from team">✕</button>
      </div>`;
    }).join("") || '<div class="text-xs text-neutral-600">No members yet.</div>';
    const candidates = agents.filter((a) => !(t.members || []).includes(a.id));
    const addSel = candidates.length ? `
      <select class="team-add mt-2 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-xs text-neutral-100" data-team="${esc(t.name)}">
        <option value="">+ add member…</option>
        ${candidates.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join("")}
      </select>` : "";
    return `<section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-sm font-medium text-neutral-100">${esc(t.name)}</span>
        <span class="ml-auto text-[11px] text-neutral-500">${(t.members || []).length} members</span>
        <button class="team-delete text-neutral-600 hover:text-red-400 text-xs ml-1" data-team="${esc(t.name)}" title="Delete team">Delete</button>
      </div>
      <div class="space-y-1.5">${members}</div>
      ${addSel}
    </section>`;
  }).join("") : navEmpty("No teams yet. Click “New team” to assemble one from your roster.");

  panelContent().innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-neutral-100">Teams</span>
        <span class="text-[11px] text-neutral-500">${teams.length} team${teams.length === 1 ? "" : "s"}</span>
        <span class="text-[11px] text-neutral-600">${agents.length} available agents</span>
        <button id="team-new" class="ml-auto text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 rounded-md px-3 py-1 font-medium transition">+ New team</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${teamCards}</div>
    </div>`;
}

function renderRegistryPanel() {
  if (studioView === "agents") return renderAgentsPanel();
  if (studioView === "teams") return renderTeamsPanel();
  return renderAgentsPanel();
}

// --- Personas library view (file-backed markdown, project + domain scoped) --
// Personas are written under runtime/harness/personas/{domains/<domain>,general}.
// registry.listPersonas() reads the same tree, so anything created here is
// immediately assignable to agents in the New/Edit agent modal. Generation
// uses the Gemma utility model (Cloudflare AI Gateway), NOT the CEO (Hermes).
let personaListCache = [];

function personaScopeLabel() {
  return currentDomain && currentDomain !== "All"
    ? `${currentDomain} + shared` : "project-wide";
}

async function renderPersonasView() {
  setPanelTitle("Personas");
  if (!currentProject) { panelContent().innerHTML = navEmpty("Open a project to manage personas."); return; }
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading personas…</div>';
  let res = {};
  try { res = await window.ceo.personaFiles(); } catch { res = {}; }
  if (!res || !res.ok) { panelContent().innerHTML = navEmpty((res && res.reason) || "Could not load personas."); return; }
  personaListCache = res.personas || [];
  const cards = personaListCache.length ? personaListCache.map((p) => `
    <button class="persona-card text-left rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 hover:border-cyan-500/40 transition" data-id="${esc(p.id)}">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-neutral-100 truncate">${esc(p.name || p.id)}</span>
        <span class="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${p.scope === "domain" ? "bg-cyan-500/15 text-cyan-300" : "bg-neutral-800 text-neutral-400"}">${esc(p.scope)}</span>
      </div>
      <div class="mt-1 text-[11px] text-neutral-500 truncate">${esc(p.summary || "—")}</div>
    </button>`).join("")
    : navEmpty("No personas yet. Generate one with Gemma or create a blank one.");
  panelContent().innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-neutral-100">Personas</span>
        <span class="text-[11px] text-neutral-500">${personaListCache.length} · ${esc(personaScopeLabel())}</span>
        <button id="persona-generate" class="ml-auto text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-3 py-1 font-medium transition">✦ Generate with Gemma</button>
        <button id="persona-new" class="text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 rounded-md px-3 py-1 font-medium transition">+ Blank</button>
      </div>
      <div class="text-[11px] text-neutral-600">Personas saved here are assignable to agents in Agents -> New/Edit agent.</div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">${cards}</div>
    </div>`;
}

async function openPersonaEditor(id, opts = {}) {
  setPanelTitle(id ? `Persona · ${id}` : "New persona");
  let content = opts.content || "";
  let name = opts.name || id || "";
  if (id && !opts.content) {
    let r = {};
    try { r = await window.ceo.personaRead(id); } catch { r = {}; }
    if (r && r.ok) { content = r.content; name = r.name || id; }
    else { panelContent().innerHTML = navEmpty((r && r.reason) || "Could not read persona."); return; }
  }
  panelContent().innerHTML = `
    <div class="space-y-3 max-w-3xl">
      <button id="persona-back" class="text-xs text-neutral-400 hover:text-neutral-200">← Back to personas</button>
      <input type="hidden" id="pe-id" value="${esc(id || "")}" />
      <div class="flex items-center gap-2">
        <input id="pe-name" class="flex-1 bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 ${id ? "opacity-70" : ""}" value="${esc(name)}" placeholder="Persona name (e.g. Release Manager)" ${id ? "readonly" : ""} />
        <button id="pe-save" class="text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-4 py-1.5 font-medium transition">Save</button>
        ${id ? `<button id="pe-delete" class="text-sm bg-red-900/40 hover:bg-red-900/70 border border-red-900/60 text-red-300 rounded-md px-3 py-1.5 transition">Delete</button>` : ""}
      </div>
      <textarea id="pe-content" rows="22" class="w-full bg-neutral-950/60 border border-neutral-800 rounded-lg px-3 py-2 text-[13px] font-mono text-neutral-100 leading-relaxed focus:outline-none focus:ring-1 focus:ring-cyan-500/50" placeholder="# Role&#10;&#10;## Core Responsibility&#10;…">${esc(content)}</textarea>
      <span id="pe-msg" class="text-xs text-neutral-500"></span>
    </div>`;
  const ta = document.getElementById("pe-content");
  if (ta && !id) ta.focus();
}

function openPersonaGenerateModal() {
  const existing = document.getElementById("persona-gen-modal");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.id = "persona-gen-modal";
  wrap.className = "fixed inset-0 z-[80] bg-neutral-950/80 backdrop-blur-sm flex items-start justify-center p-6 pt-16 overflow-auto";
  wrap.innerHTML = `
    <div class="w-[460px] max-w-[92vw] rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl p-5 space-y-4">
      <div class="flex items-center">
        <span class="text-base font-semibold text-neutral-100">Generate persona with Gemma</span>
        <div class="flex-1"></div>
        <button id="pg-close" class="text-sm text-neutral-400 hover:text-neutral-100">✕</button>
      </div>
      <div class="text-[11px] text-neutral-500">Scope: ${esc(personaScopeLabel())}</div>
      <label class="block text-xs text-neutral-400">Role name
        <input id="pg-name" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100" placeholder="e.g. Release Manager" />
      </label>
      <label class="block text-xs text-neutral-400">Brief — what they own / how they behave
        <textarea id="pg-brief" rows="4" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100" placeholder="Owns cutting releases, changelogs, and rollback plans for the app."></textarea>
      </label>
      <div class="flex items-center gap-2">
        <button id="pg-go" class="text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-4 py-1.5 font-medium transition">Generate draft</button>
        <span id="pg-msg" class="text-xs text-neutral-500"></span>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
  document.getElementById("pg-close").addEventListener("click", () => wrap.remove());
  document.getElementById("pg-go").addEventListener("click", async () => {
    const name = (document.getElementById("pg-name").value || "").trim();
    const brief = (document.getElementById("pg-brief").value || "").trim();
    const msg = document.getElementById("pg-msg");
    if (!name) { if (msg) msg.textContent = "name required"; return; }
    if (msg) msg.textContent = "generating with Gemma…";
    let r = {};
    try { r = await window.ceo.personaGenerate(name, brief, false); } catch (e) { r = { ok: false, reason: e.message }; }
    if (!r || !r.ok) { if (msg) msg.textContent = "failed: " + ((r && r.reason) || "unknown"); return; }
    wrap.remove();
    // Open the draft in the editor so the user can review/edit before saving.
    openPersonaEditor(null, { content: r.content, name });
  });
}

async function savePersonaFromEditor() {
  const idField = document.getElementById("pe-id");
  const nameEl = document.getElementById("pe-name");
  const contentEl = document.getElementById("pe-content");
  const msg = document.getElementById("pe-msg");
  if (!nameEl || !contentEl) return;
  const id = (idField && idField.value) || nameEl.value.trim();
  const content = contentEl.value;
  if (!id) { if (msg) msg.textContent = "name required"; return; }
  if (!content.trim()) { if (msg) msg.textContent = "content is empty"; return; }
  if (msg) msg.textContent = "saving…";
  let r = {};
  try { r = await window.ceo.personaSave(id, content); } catch (e) { r = { ok: false, reason: e.message }; }
  if (!r || !r.ok) { if (msg) msg.textContent = "failed: " + ((r && r.reason) || "unknown"); return; }
  await renderPersonasView();
}

async function deletePersonaFromEditor() {
  const idField = document.getElementById("pe-id");
  const id = idField && idField.value;
  if (!id) return;
  if (!confirm(`Delete persona "${id}"? This removes the markdown file.`)) return;
  let r = {};
  try { r = await window.ceo.personaDelete(id); } catch (e) { r = { ok: false, reason: e.message }; }
  if (r && r.ok) await renderPersonasView();
}

// --- Agent create/edit modal (appended to <body> so panel re-renders don't wipe it).
function closeAgentModal() {
  const m = document.getElementById("agent-modal");
  if (m) m.remove();
}

// Build <option>s for the model dropdown from the captured catalog
// (registryState.models[provider]). Marks `current` selected; if `current` is
// set but not in the catalog, the "Custom…" option is selected instead.
function _modelSelectOptions(provider, current) {
  const list = (registryState.models && registryState.models[provider]) || [];
  const opts = [`<option value="">— default —</option>`];
  let matched = false;
  for (const m of list) {
    const sel = current && current === m.id ? "selected" : "";
    if (sel) matched = true;
    const ctx = m.context ? ` · ${esc(String(m.context))}` : "";
    opts.push(`<option value="${esc(m.id)}" ${sel}>${esc(m.label || m.id)}${ctx}</option>`);
  }
  const customSel = current && !matched ? "selected" : "";
  opts.push(`<option value="__custom__" ${customSel}>Custom…</option>`);
  return opts.join("");
}

function openAgentModal(agentId) {
  closeAgentModal();
  const editing = agentId ? registryState.agents.find((a) => a.id === agentId) : null;
  const personas = registryState.personas || [];
  const providers = registryState.providers || ["vertex"];
  const personaOpts = `<option value="">— none —</option>` +
    personas.map((p) => `<option value="${esc(p.id)}" ${editing && editing.persona === p.id ? "selected" : ""}>${esc(p.name || p.id)}</option>`).join("");
  const providerOpts = providers.map((p) => `<option value="${esc(p)}" ${editing && editing.provider === p ? "selected" : ""}>${esc(p)}</option>`).join("");
  const initialProvider = (editing && editing.provider) || providers[0] || "vertex";
  const modelOpts = _modelSelectOptions(initialProvider, editing && editing.model);
  const wrap = document.createElement("div");
  wrap.id = "agent-modal";
  wrap.className = "fixed inset-0 z-[80] bg-neutral-950/80 backdrop-blur-sm flex items-start justify-center p-6 pt-16 overflow-auto";
  wrap.innerHTML = `
    <div class="w-[460px] max-w-[92vw] rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl p-5 space-y-4">
      <div class="flex items-center">
        <span class="text-base font-semibold text-neutral-100">${editing ? "Edit agent" : "New agent"}</span>
        <div class="flex-1"></div>
        <button id="agent-modal-close" class="text-sm text-neutral-400 hover:text-neutral-100">✕</button>
      </div>
      <label class="block text-xs text-neutral-400">Name
        <input id="am-name" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100" value="${editing ? esc(editing.name || editing.id) : ""}" placeholder="e.g. Ada — Architect" />
      </label>
      <div class="flex gap-2">
        <label class="flex-1 text-xs text-neutral-400">Brain / provider
          <select id="am-provider" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100">${providerOpts}</select>
        </label>
        <label class="flex-1 text-xs text-neutral-400">Model
          <select id="am-model-select" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100">${modelOpts}</select>
          <input id="am-model" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 font-mono" style="display:none" value="${editing && editing.model ? esc(editing.model) : ""}" placeholder="custom model id" />
        </label>
      </div>
      <label id="am-command-row" class="block text-xs text-neutral-400" style="display:none">Command template
        <input id="am-command" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 font-mono" value="${editing && editing.command ? esc(editing.command) : ""}" placeholder="claude -p --output-format text {prompt}" />
        <span class="text-[10px] text-neutral-600">Any CLI. Placeholders: {prompt} {model} {workdir} {agent} {session_id}.</span>
      </label>
      <label class="block text-xs text-neutral-400">Persona / role
        <select id="am-persona" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100">${personaOpts}</select>
      </label>
      <label class="block text-xs text-neutral-400">Capabilities (comma-separated)
        <input id="am-caps" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100" value="${editing ? esc((editing.capabilities || []).join(", ")) : ""}" placeholder="adr, data-model" />
      </label>
      <label class="block text-xs text-neutral-400">Memory key
        <input id="am-mem" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 font-mono" value="${editing && editing.memory_key ? esc(editing.memory_key) : ""}" placeholder="agent:${editing ? esc(editing.id) : "name"}" />
        <span class="text-[10px] text-neutral-600">Private memory namespace. Shared project/domain knowledge still comes from gbrain.</span>
      </label>
      <label class="block text-xs text-neutral-400">Description (optional)
        <textarea id="am-desc" rows="2" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100">${editing ? esc(editing.description || "") : ""}</textarea>
      </label>
      <div class="flex items-center gap-2 pt-1">
        <button id="am-save" class="text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-4 py-1.5 font-medium transition">${editing ? "Save" : "Create"}</button>
        ${editing ? `<button id="am-delete" class="text-sm bg-red-900/40 hover:bg-red-900/70 border border-red-900/60 text-red-300 rounded-md px-3 py-1.5 transition">Delete</button>` : ""}
        <span id="am-msg" class="text-xs text-neutral-500"></span>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeAgentModal(); });
  document.getElementById("agent-modal-close").addEventListener("click", closeAgentModal);
  // Show the command template only for the generic "command" provider.
  const provSel = document.getElementById("am-provider");
  const cmdRow = document.getElementById("am-command-row");
  const syncCmdRow = () => { cmdRow.style.display = provSel.value === "command" ? "block" : "none"; };
  // Model dropdown: scoped to the chosen provider, with a "Custom…" free-text fallback.
  // The hidden #am-model input is the source of truth saveAgentModal() reads.
  const modelSel = document.getElementById("am-model-select");
  const modelInput = document.getElementById("am-model");
  const syncModelField = () => {
    if (modelSel.value === "__custom__") {
      modelInput.style.display = "";            // reveal free-text
      if (!modelInput.value) modelInput.focus();
    } else {
      modelInput.style.display = "none";
      modelInput.value = modelSel.value;        // mirror selection into the saved field
    }
  };
  modelSel.addEventListener("change", syncModelField);
  provSel.addEventListener("change", () => {
    syncCmdRow();
    modelSel.innerHTML = _modelSelectOptions(provSel.value, "");  // re-scope models to new provider
    modelInput.value = "";
    syncModelField();
  });
  syncCmdRow();
  syncModelField();
  document.getElementById("am-save").addEventListener("click", () => saveAgentModal(editing ? editing.id : null));
  const del = document.getElementById("am-delete");
  if (del) del.addEventListener("click", () => deleteAgentFromModal(editing.id));
}

async function saveAgentModal(existingId) {
  const msg = document.getElementById("am-msg");
  const val = (id) => (document.getElementById(id) && document.getElementById(id).value) || "";
  const spec = {
    name: val("am-name").trim(),
    provider: val("am-provider") || "vertex",
    model: val("am-model").trim() || null,
    command: val("am-command").trim() || null,
    persona: val("am-persona") || null,
    capabilities: val("am-caps").split(",").map((s) => s.trim()).filter(Boolean),
    memory_key: val("am-mem").trim() || null,
    description: val("am-desc").trim(),
  };
  if (!spec.name) { if (msg) msg.textContent = "name required"; return; }
  if (msg) msg.textContent = "saving…";
  const r = existingId
    ? await window.ceo.registryUpdateAgent(existingId, spec)
    : await window.ceo.registryCreateAgent(spec);
  if (!r || !r.ok) { if (msg) msg.textContent = "failed: " + (r ? r.reason : "unknown"); return; }
  closeAgentModal();
  await loadRegistry();
  // Stay in the detail view if we were editing a selected agent; else the roster.
  if (selectedAgentId && registryState.agents.some((a) => a.id === selectedAgentId)) {
    const a = registryState.agents.find((x) => x.id === selectedAgentId);
    await renderAgentDetail(a);
  } else {
    renderRegistryPanel();
  }
}

async function deleteAgentFromModal(id) {
  if (!confirm(`Delete agent "${id}"? This also removes it from any team.`)) return;
  const r = await window.ceo.registryDeleteAgent(id);
  if (r && r.ok) { closeAgentModal(); closeAgentSurface(); await loadRegistry(); renderRegistryPanel(); }
}

async function teamSetMembers(name, members) {
  const r = await window.ceo.registrySaveTeam(name, members);
  if (r && r.ok) { await loadRegistry(); renderRegistryPanel(); }
  return r;
}

// --- Agent detail (left panel) + live terminal/logs surface (right panel) ---
let selectedAgentId = null;
let selectedAgentRoom = null; // Start with null to avoid auto-loading previous sessions
let agentSurfaceTab = "terminal";
let agentTermTimer = null;
let agentInputMode = "room"; // "room" or "terminal"

function detailRow(label, valueHtml) {
  return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
    <div class="text-[10px] uppercase tracking-wider text-neutral-600">${label}</div>
    <div class="mt-0.5 text-neutral-300 break-all">${valueHtml}</div>
  </div>`;
}

async function askCeoToRouteVisibleAgents() {
  const visible = (registryState.agents || []).filter(agentMatchesDirectoryFilters);
  await runTurn(agentDirectoryPrompt(visible));
}

async function runAgentDirectoryAction(action, agentId) {
  if (!agentId) return;
  if (action === "use") {
    if (window.StudioSessions && window.StudioSessions.startAgentSession) {
      await window.StudioSessions.startAgentSession(agentId);
    } else {
      await openAgentDetail(agentId);
      await mountSelectedAgent();
    }
    await loadRegistry();
    renderRegistryPanel();
    return;
  }
  if (action === "dm") {
    await openChannel(`dm:${agentId}`);
    return;
  }
  if (action === "detail") {
    await openAgentDetail(agentId);
  }
}

function updateAgentDirectoryFilter(key, value) {
  agentDirectoryState = { ...agentDirectoryState, [key]: value || "all" };
  renderAgentsPanel();
}

function clearAgentDirectoryFilters() {
  agentDirectoryState = { query: "", provider: "all", capability: "all", status: "all", group: "all" };
  renderAgentsPanel();
}

async function openAgentDetail(id) {
  const a = registryState.agents.find((x) => x.id === id);
  if (!a) return;
  selectedAgentId = id;
  selectedAgentRoom = null; // Clear previous room to avoid loading last session
  
  // Don't auto-mount - let user decide when to mount
  // This prevents automatically loading previous sessions
  
  await renderAgentDetail(a);
  showAgentSurface(a);
}

async function renderAgentDetail(a) {
  setPanelTitle(a.name || a.id);
  let mounted = false;
  if (a.tmux_session) {
    try { const live = await window.ceo.registryAlive(a.id); mounted = !!(live && live.alive); } catch { mounted = false; }
  }
  const brain = esc(a.provider || "vertex") + (a.model ? " · " + esc(a.model) : "");
  
  // Generate session list
  const sessionsHtml = a.tmux_session ? `
    <div class="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div class="text-[11px] uppercase tracking-wider text-neutral-600 mb-3">Sessions</div>
      <div class="space-y-2">
        <div class="flex items-center gap-3 rounded-lg border ${mounted ? "border-emerald-500/30 bg-emerald-950/20" : "border-neutral-800 bg-neutral-950/50"} p-3">
          <div class="w-2 h-2 rounded-full ${mounted ? "bg-emerald-500" : "bg-neutral-600"}"></div>
          <div class="flex-1">
            <div class="text-sm font-medium text-neutral-100">${esc(a.tmux_session)}</div>
            <div class="text-xs text-neutral-500">main window</div>
          </div>
          <div class="text-[10px] ${mounted ? "text-emerald-400" : "text-neutral-600"}">${mounted ? "● live" : "○ stopped"}</div>
        </div>
      </div>
      <div class="mt-3 text-xs text-neutral-500">
        ${mounted ? "Agent is running. Send a message below to start a new conversation." : "Click Mount to start this agent's session."}
      </div>
    </div>
  ` : `<div class="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
    <div class="text-[11px] uppercase tracking-wider text-neutral-600 mb-3">Sessions</div>
    <div class="text-xs text-neutral-600">No tmux session configured for this agent</div>
  </div>`;
  
  panelContent().innerHTML = `
    <div class="space-y-4 max-w-2xl">
      <button id="agent-back" class="text-xs text-neutral-400 hover:text-neutral-200">← Back to team</button>
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${mounted ? "bg-emerald-500" : "bg-neutral-600"}"></span>
          <span class="text-base font-semibold text-neutral-100">${esc(a.name || a.id)}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">${esc(a.provider || "vertex")}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          ${detailRow("Persona", esc(a.persona || "—"))}
          ${detailRow("Brain", brain)}
          ${detailRow("Memory key", esc(a.memory_key || "—"))}
          ${detailRow("tmux", a.tmux_session ? esc(a.tmux_session) + (mounted ? " · live" : " · stopped") : "not mounted")}
        </div>
        ${(a.capabilities || []).length ? `<div class="flex flex-wrap gap-1">${a.capabilities.map((c) => `<span class="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">${esc(c)}</span>`).join("")}</div>` : ""}
        ${a.description ? `<p class="text-xs text-neutral-400">${esc(a.description)}</p>` : ""}
        <div class="flex items-center gap-2 pt-1">
          ${mounted
            ? `<button id="agent-unmount" class="text-sm bg-red-900/40 hover:bg-red-900/70 border border-red-900/60 text-red-300 rounded-md px-3 py-1.5 transition">Unmount</button>`
            : `<button id="agent-mount" class="text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-3 py-1.5 font-medium transition">Mount</button>`}
          <button id="agent-edit" class="text-sm bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 rounded-md px-3 py-1.5 transition">Edit</button>
          <span id="agent-detail-msg" class="text-xs text-neutral-500"></span>
        </div>
        <p class="text-[11px] text-neutral-600">Click Mount to start the agent's session. Once mounted, send a message below to start a fresh conversation in the right panel.</p>
      </div>
      ${sessionsHtml}
    </div>`;
}

function showAgentSurface(a) {
  closeChannelSurface();
  const surf = document.getElementById("agent-surface");
  if (!surf) return;
  // Inline style wins over Tailwind's class ordering so the toggle is deterministic.
  surf.classList.remove("hidden");
  surf.style.display = "flex";
  const name = document.getElementById("as-name");
  const sub = document.getElementById("as-sub");
  if (name) name.textContent = a.name || a.id;
  if (sub) sub.textContent = agentSubtitle(a);
  
  // Clear previous terminal output and show clean state for new session
  const out = document.getElementById("as-output");
  const dot = document.getElementById("as-dot");
  if (out) {
    out.textContent = "Ready for new session.\n\nSend a message below to start a fresh conversation with this agent.";
  }
  if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500";
  
  setAgentSurfaceTab("terminal");
}

function closeAgentSurface() {
  if (agentTermTimer) { clearInterval(agentTermTimer); agentTermTimer = null; }
  selectedAgentId = null;
  const surf = document.getElementById("agent-surface");
  if (surf) { surf.classList.add("hidden"); surf.style.display = "none"; }
}

function setAgentSurfaceTab(tab) {
  agentSurfaceTab = tab;
  const tt = document.getElementById("as-tab-terminal");
  const tl = document.getElementById("as-tab-logs");
  const on = (b) => { b.classList.add("bg-neutral-700", "text-neutral-100"); b.classList.remove("text-neutral-400"); };
  const off = (b) => { b.classList.remove("bg-neutral-700", "text-neutral-100"); b.classList.add("text-neutral-400"); };
  if (tt && tl) { if (tab === "terminal") { on(tt); off(tl); } else { on(tl); off(tt); } }
  // The input posts to the agent's room, so keep it available on both tabs
  // (it pairs naturally with the Logs/room transcript view).
  const inputRow = document.getElementById("as-input-row");
  if (inputRow) inputRow.classList.remove("hidden");
  
  const shouldPoll = tab === "terminal" ? !!selectedAgentId : !!selectedAgentRoom;
  if (shouldPoll) {
    pollAgentSurface();
    if (agentTermTimer) clearInterval(agentTermTimer);
    agentTermTimer = setInterval(pollAgentSurface, tab === "terminal" ? 1500 : 3000);
  } else {
    // Stop room polling when no room is selected to avoid loading old sessions.
    if (agentTermTimer) clearInterval(agentTermTimer);
    agentTermTimer = null;
  }
}

async function pollAgentSurface() {
  if (!selectedAgentId) return;
  const out = document.getElementById("as-output");
  const dot = document.getElementById("as-dot");
  if (!out) return;
  if (agentSurfaceTab === "terminal") {
    let r = {};
    try { r = await window.ceo.registryTerminal(selectedAgentId); } catch { r = {}; }
    if (r && r.ok) {
      out.textContent = r.output || "(empty)";
      if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500";
    } else {
      out.textContent = `Terminal unavailable: ${r ? r.reason : "unknown"}\n\nMount the agent (left panel) to start its session.`;
      if (dot) dot.className = "w-2 h-2 rounded-full bg-neutral-600";
    }
  } else {
    if (!selectedAgentRoom) {
      out.textContent = "Send a message below to start a new conversation with this agent.\n\nThis will create a fresh session in the agent's A2A room.";
    } else {
      let r = {};
      try { r = await window.ceo.meetingRoom(selectedAgentRoom); } catch { r = {}; }
      const feed = (r && r.feed) || [];
      out.textContent = feed.length
        ? feed.map((e) => `[${e.speaker}] ${e.body}`).join("\n\n")
        : `No activity in room "${selectedAgentRoom}" yet.`;
    }
  }
  out.scrollTop = out.scrollHeight;
}

async function mountSelectedAgent() {
  const msg = document.getElementById("agent-detail-msg");
  if (msg) msg.textContent = "mounting…";
  let r = {};
  try { r = await window.ceo.registryMount(selectedAgentId, { allowPaid: true }); } catch (e) { r = { ok: false, reason: String(e) }; }
  // Don't auto-select the room - let the user start a fresh session
  // if (r && r.room) selectedAgentRoom = r.room;
  if (!r || !r.ok) { if (msg) msg.textContent = "mount failed: " + (r ? r.reason : "unknown"); return; }
  await loadRegistry();
  const a = registryState.agents.find((x) => x.id === selectedAgentId);
  if (a) { await renderAgentDetail(a); }
}

async function unmountSelectedAgent() {
  const msg = document.getElementById("agent-detail-msg");
  if (msg) msg.textContent = "unmounting…";
  try { await window.ceo.registryUnmount(selectedAgentId); } catch { /* ignore */ }
  await loadRegistry();
  const a = registryState.agents.find((x) => x.id === selectedAgentId);
  if (a) { await renderAgentDetail(a); pollAgentSurface(); }
}

async function sendAgentKeys() {
  const input = document.getElementById("as-input");
  if (!selectedAgentId || !input) return;
  const text = input.value;
  if (!text.trim()) return;
  input.value = "";
  
  if (agentInputMode === "terminal") {
    // Send directly to tmux terminal
    const a = registryState.agents.find((x) => x.id === selectedAgentId);
    const tmuxWindow = (a && a.tmux_window) || "main";
    const r = await window.ceo.registryTerminalSend(selectedAgentId, text, tmuxWindow);
    if (r && r.ok) {
      // Force a refresh of the terminal output
      setTimeout(pollAgentSurface, 200);
    }
  } else {
    // Talk to the agent by posting into its A2A room (the real channel), not by
    // typing into a watcher pane. Then show the room transcript in Logs.
    const r = await window.ceo.registryMessage(selectedAgentId, text, "CEO");
    if (r && r.room) {
      selectedAgentRoom = r.room;
      setAgentSurfaceTab("logs");
      // Start polling the new room
      if (agentTermTimer) clearInterval(agentTermTimer);
      agentTermTimer = setInterval(pollAgentSurface, 3000);
      setTimeout(pollAgentSurface, 400);
    }
  }
}

function setAgentInputMode(mode) {
  agentInputMode = mode;
  const roomBtn = document.getElementById("as-mode-room");
  const termBtn = document.getElementById("as-mode-terminal");
  const input = document.getElementById("as-input");
  
  if (mode === "room") {
    roomBtn.classList.remove("bg-neutral-800", "text-neutral-400");
    roomBtn.classList.add("bg-cyan-600/80", "text-white");
    termBtn.classList.remove("bg-cyan-600/80", "text-white");
    termBtn.classList.add("bg-neutral-800", "text-neutral-400");
    if (input) input.placeholder = "Message this agent in its room (as CEO)…";
  } else {
    termBtn.classList.remove("bg-neutral-800", "text-neutral-400");
    termBtn.classList.add("bg-cyan-600/80", "text-white");
    roomBtn.classList.remove("bg-cyan-600/80", "text-white");
    roomBtn.classList.add("bg-neutral-800", "text-neutral-400");
    if (input) input.placeholder = "Type terminal command to send to agent…";
  }
}

// Agent surface buttons live in panel2 (outside the left panelContent that the rest of
// the UI delegates on). Delegate on document so they stay live regardless of re-renders
// or attach timing — the ✕ must ALWAYS close the panel.
function wireAgentSurface() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#as-close")) { closeAgentSurface(); renderRegistryPanel(); return; }
    if (e.target.closest("#as-tab-terminal")) { setAgentSurfaceTab("terminal"); return; }
    if (e.target.closest("#as-tab-logs")) { setAgentSurfaceTab("logs"); return; }
    if (e.target.closest("#as-mode-room")) { setAgentInputMode("room"); return; }
    if (e.target.closest("#as-mode-terminal")) { setAgentInputMode("terminal"); return; }
    if (e.target.closest("#as-send")) { sendAgentKeys(); return; }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.id === "as-input") { sendAgentKeys(); return; }
    if (e.key === "Escape" && selectedAgentId) {
      const surf = document.getElementById("agent-surface");
      if (surf && !surf.classList.contains("hidden")) { closeAgentSurface(); renderRegistryPanel(); }
    }
  });
}

async function renderChannelsView() {
  setPanelTitle("Channels");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading channels…</div>';
  await loadRegistry();
  const teams = registryState.teams;
  const agents = registryState.agents;
  let meetingRooms = [];
  try {
    const opts = window.ceo.meetingOptions ? await window.ceo.meetingOptions() : null;
    meetingRooms = (opts && opts.rooms) || [];
  } catch { meetingRooms = []; }
  meetingRoomsState = meetingRooms;
  const activeKey = channelState ? channelState.key : "ceo";
  const itemCls = (key) => `channel-item w-full text-left flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${key === activeKey ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/70"}`;

  // Board team-logs — each Kanban board is a channel whose feed is the team's
  // shared work log (the autonomy runner posts milestones here) + chat.
  let boards = [];
  try { const r = await window.ceo.ceoBoards(); boards = (r && r.boards) || (Array.isArray(r) ? r : []); } catch { boards = []; }
  const boardRooms = boards.map((b) => {
    const slug = b.slug || b;
    return `<button class="${itemCls(`board:${slug}`)}" data-channel="board:${esc(slug)}">
      <span class="text-neutral-500">▤</span><span>${esc(b.name || slug)}</span>
      <span class="ml-auto text-[10px] text-neutral-600">team log</span>
    </button>`;
  }).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No boards yet.</div>';

  const ceoItem = `<button class="${itemCls("ceo")}" data-channel="ceo">
      <span class="text-red-400">★</span><span>Project CEO</span>
      <span class="ml-auto text-[10px] text-neutral-600">default</span>
    </button>`;
  const groupRooms = teams.map((t) => `
    <button class="${itemCls(`team:${t.name}`)}" data-channel="team:${esc(t.name)}">
      <span class="text-neutral-500">#</span><span>${esc(t.name)}</span>
      <span class="ml-auto text-[10px] text-neutral-600">${(t.members || []).length} agents</span>
    </button>`).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No team channels yet.</div>';
  const adHocRooms = meetingRooms
    .filter((r) => r && r.room && !r.channel)
    .slice(0, 12)
    .map((r) => {
      const key = `meeting:${r.room}`;
      return `<button class="${itemCls(key)}" data-channel="${esc(key)}">
        <span class="text-neutral-500">⧉</span><span class="min-w-0 flex-1 truncate">${esc(r.room)}</span>
        <span class="ml-auto shrink-0 text-[10px] ${r.done ? "text-emerald-500" : "text-amber-500"}">${r.done ? "done" : "running"}</span>
      </button>`;
    }).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No meeting rooms yet.</div>';
  const dms = agents.map((a) => `
    <button class="${itemCls(`dm:${a.id}`)}" data-channel="dm:${esc(a.id)}">
      <span class="text-neutral-500">◌</span><span>${esc(a.name || a.id)}</span>
      <span class="ml-auto text-[10px] text-neutral-600">${esc(a.provider || "vertex")}</span>
    </button>`).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No agents in registry.</div>';
  panelContent().innerHTML = `
    <div class="space-y-4 max-w-2xl">
      <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${ceoItem}</div>
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Team logs (boards)</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${boardRooms}</div>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Group channels</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${groupRooms}</div>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Meeting rooms</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${adHocRooms}</div>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Direct messages</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${dms}</div>
      </div>
      <div class="px-1 text-[11px] text-neutral-600">One panel, many channels. Pick the CEO, a board's team log, a team, or a DM — the right panel switches to that conversation. Boards show live work milestones as agents build.</div>
    </div>`;
}

// --- Channel surface: a live team room in the right panel ---------------------
// A "channel" is a team (group of agents) or a DM (one agent). Opening it shows
// a room where the team discusses a brief (A2A meeting), the human/CEO can post
// in, and you can add more agents to the channel.
let channelState = null; // { key, kind, name, room, members:[ids], ceoInRoom }
let channelTimer = null;

function channelRoomName(key) {
  return `chan-${String(key).replace(/[^a-zA-Z0-9._-]+/g, "-")}`.toLowerCase();
}

function channelMembers(kind, id) {
  if (kind === "team") {
    const team = (registryState.teams || []).find((t) => t.name === id);
    return (team && team.members) || [];
  }
  if (kind === "board") return []; // resolved async (live swarm) in openChannel
  return [id]; // DM
}

// For a board team-log channel, the chat participants are the agents actually
// working that board (the live swarm); fall back to the registry if idle.
async function boardChannelMembers(slug) {
  try {
    const r = await window.ceo.ceoSwarm(slug);
    const workers = (r && (r.workers || r.swarm)) || [];
    const ids = [...new Set(workers.map((w) => w.agentId || w.agent || w.id).filter(Boolean))];
    if (ids.length) return ids;
  } catch { /* ignore */ }
  return (registryState.agents || []).map((a) => a.id).slice(0, 8);
}

function agentHasTerminal(agentId) {
  const agent = (registryState.agents || []).find((a) => a.id === agentId);
  return !!(agent && (agent.tmux_session || agent.mounted));
}

async function loadBoardSwarmRows(board) {
  const rows = [];
  const seen = new Set();
  try {
    const r = window.ceo.runnerStatus ? await window.ceo.runnerStatus() : null;
    const workers = (r && r.workers) || [];
    for (const w of workers.filter((worker) => worker.board === board)) {
      const key = `runner:${w.taskId || ""}:${w.agentId || ""}:${w.pid || ""}`;
      seen.add(key);
      rows.push({
        source: "runner",
        board,
        taskId: w.taskId,
        title: w.title || w.taskId || "Worker",
        agentId: w.agentId || "",
        model: w.model || "",
        pid: w.pid,
        alive: w.alive !== false,
        branch: w.branch || "",
      });
    }
  } catch { /* runner is optional */ }
  try {
    const r = window.ceo.ceoSwarm ? await window.ceo.ceoSwarm(board) : null;
    const workers = (r && r.workers) || [];
    for (const w of workers) {
      const agentId = w.agentId || w.assignee || "";
      const key = `board:${w.id || w.taskId || ""}:${agentId}:${w.worker_pid || w.pid || ""}`;
      if (seen.has(key) || rows.some((row) => row.taskId && row.taskId === (w.id || w.taskId))) continue;
      rows.push({
        source: "board",
        board,
        taskId: w.id || w.taskId,
        title: w.title || w.id || "Running task",
        agentId,
        model: "",
        pid: w.worker_pid || w.pid,
        alive: !!w.alive,
        branch: "",
      });
    }
  } catch { /* board swarm is optional */ }
  return rows;
}

function renderChannelSwarm() {
  const host = document.getElementById("chan-swarm");
  if (!host) return;
  if (!channelState || channelState.kind !== "board") {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  host.classList.remove("hidden");
  const rows = channelState.swarmWorkers || [];
  if (!rows.length) {
    host.innerHTML = '<div class="text-[11px] text-neutral-600">No active board workers. New runner activity will appear here.</div>';
    return;
  }
  host.innerHTML = `
    <div class="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
      <span>Live swarm</span>
      <span class="rounded border border-neutral-800 px-1.5 py-0.5">${rows.length}</span>
    </div>
    <div class="flex gap-2 overflow-x-auto pb-1">
      ${rows.map((w) => {
        const canTerminal = agentHasTerminal(w.agentId);
        return `<div class="chan-swarm-card min-w-[220px] rounded-lg border border-neutral-800 bg-neutral-900/55 p-2">
          <div class="flex items-center gap-2">
            <span class="h-2 w-2 shrink-0 rounded-full ${w.alive ? "bg-emerald-500" : "bg-neutral-600"}"></span>
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-100">${esc(w.agentId || "worker")}</span>
            <span class="text-[10px] text-neutral-600">${esc(w.source)}</span>
          </div>
          <div class="mt-1 truncate text-[11px] text-neutral-400">${esc(w.title || w.taskId || "Running work")}</div>
          <div class="mt-1 flex items-center gap-2 text-[10px] text-neutral-600">
            <span>${w.pid ? `pid ${esc(w.pid)}` : "no pid"}</span>
            ${w.model ? `<span>${esc(w.model)}</span>` : ""}
          </div>
          <div class="mt-2 flex gap-1.5">
            ${canTerminal ? `<button type="button" class="chan-swarm-terminal rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800" data-agent="${esc(w.agentId)}">Agent terminal</button>` : ""}
            ${w.taskId ? `<button type="button" class="chan-swarm-task rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800" data-board="${esc(w.board)}" data-task-id="${esc(w.taskId)}" data-task-title="${esc(w.title || "")}">Task</button>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

// Switch the one right panel back to the default CEO conversation.
function switchToCeoChannel() {
  closeAgentSurface();
  closeChannelSurface();
  $("#chat-input")?.focus();
  if ($("#panel-title")?.textContent === "Channels") renderChannelsView();
}

async function openChannel(key) {
  if (!key) return;
  if (channelState) closeChannelSurface();
  await loadRegistry();
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  const name = kind === "team" ? id
    : kind === "board" ? id
    : kind === "meeting" ? id
    : (registryState.agents.find((a) => a.id === id)?.name || id);
  const meetingRoom = kind === "meeting" ? (meetingRoomsState || []).find((r) => r.room === id) : null;
  const meetingParticipants = meetingRoom
    ? (meetingRoom.participants || []).filter((p) => registryState.agents.some((a) => a.id === p))
    : [];
  const members = kind === "meeting" ? meetingParticipants
    : kind === "board" ? await boardChannelMembers(id)
    : channelMembers(kind, id);
  channelState = {
    key, kind, id, name,
    room: kind === "meeting" ? id : channelRoomName(key),
    members,
    swarmWorkers: [],
    ceoInRoom: false,
    live: false,
  };
  closeAgentSurface();
  const surf = document.getElementById("channel-surface");
  if (surf) { surf.classList.remove("hidden"); surf.style.display = "flex"; }
  const nameEl = document.getElementById("chan-name");
  if (nameEl) nameEl.textContent = name + (kind === "dm" ? " (DM)" : kind === "board" ? " · team log" : kind === "meeting" ? " · meeting" : "");
  renderChannelMembers();
  renderChannelSwarm();
  renderChannelComposerSelects();
  if (kind === "board") {
    channelState.swarmWorkers = await loadBoardSwarmRows(id);
    renderChannelSwarm();
  }
  await pollChannel();
  if (channelTimer) clearInterval(channelTimer);
  channelTimer = setInterval(pollChannel, 2500);
  // Make the channel live: start the persistent A2A room loop so agents reply
  // to anything posted here (real providers only — never the echo placeholder).
  await startChannelLoop();
}

// Start (or re-start) the live A2A room loop for the open channel.
async function startChannelLoop() {
  if (!channelState) return false;
  if (!channelState.members.length) {
    renderChannelSystemMessage("No agents are assigned to this channel yet.");
    return false;
  }
  try {
    const r = await window.ceo.roomLoopStart({
      room: channelState.room,
      members: channelState.members.join(","),
      criteria: "Shared understanding: who owns what, risks, open questions surfaced and answered, agreed next steps.",
      allowPaid: true, // real agents only — never the echo placeholder provider
      maxFollowups: 1, // bounded agent-to-agent back-and-forth
    });
    if (!r || !r.ok) {
      renderChannelSystemMessage(`Could not start live room loop: ${r ? r.reason : "unknown"}`);
      const state = document.getElementById("chan-state");
      if (state) state.textContent = "· loop failed";
      return false;
    }
    channelState.live = true;
    return true;
  } catch (e) {
    renderChannelSystemMessage(`Could not start live room loop: ${String(e && e.message ? e.message : e)}`);
    const state = document.getElementById("chan-state");
    if (state) state.textContent = "· loop failed";
    return false;
  }
}

function closeChannelSurface() {
  if (channelTimer) { clearInterval(channelTimer); channelTimer = null; }
  if (channelState) { try { window.ceo.roomLoopStop(channelState.room); } catch { /* ignore */ } }
  channelState = null;
  const surf = document.getElementById("channel-surface");
  if (surf) { surf.classList.add("hidden"); surf.style.display = "none"; }
  renderChannelSwarm();
}

function renderChannelMembers() {
  const host = document.getElementById("chan-members");
  if (!host || !channelState) return;
  const chips = channelState.members.map((id) => {
    const a = registryState.agents.find((x) => x.id === id);
    const label = (a && (a.name || a.id)) || id;
    const prov = (a && a.provider) || "?";
    return `<span class="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-200">
      <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>${esc(label)}<span class="text-neutral-600">${esc(prov)}</span></span>`;
  }).join("");
  const ceoChip = channelState.ceoInRoom
    ? `<span class="inline-flex items-center gap-1 rounded-full border border-red-700/60 bg-red-950/30 px-2 py-0.5 text-[11px] text-red-300"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>CEO</span>`
    : "";
  const empty = channelState.kind === "meeting"
    ? `<span class="text-[11px] text-neutral-600">Meeting transcript loaded from the harness room log.</span>`
    : `<span class="text-[11px] text-neutral-600">No members yet — add an agent.</span>`;
  host.innerHTML = (ceoChip + chips) || empty;
}

function renderChannelComposerSelects() {
  if (!channelState) return;
  const speaker = document.getElementById("chan-speaker");
  const to = document.getElementById("chan-to");
  if (speaker) {
    const opts = ['<option value="You">You</option>'];
    if (channelState.ceoInRoom) opts.push('<option value="CEO">CEO</option>');
    speaker.innerHTML = opts.join("");
  }
  if (to) {
    const opts = ['<option value="">→ whole team</option>'];
    for (const id of channelState.members) {
      const a = registryState.agents.find((x) => x.id === id);
      opts.push(`<option value="${esc(id)}">→ ${esc((a && (a.name || a.id)) || id)}</option>`);
    }
    to.innerHTML = opts.join("");
  }
}

function renderChannelFeed(feed) {
  const host = document.getElementById("chan-feed");
  if (!host) return;
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
  const previousTop = host.scrollTop;
  if (!feed || !feed.length) {
    host.innerHTML = `<div class="text-neutral-600 text-xs">No messages yet. Paste a brief below and hit <span class="text-cyan-400">Discuss brief →</span> to get the team talking.</div>`;
    return;
  }
  host.innerHTML = feed.map((e) => {
    const body = e.body || "";
    // Work-event milestones (posted by the autonomy runner / review gate) read as
    // a compact LOG line, not a chat bubble — this channel is the team's log.
    if (isWorkEvent(body)) {
      const glyph = body.trim().charAt(0);
      const tone = /^[✗⛔]/.test(body) ? "text-red-300" : /^[✅✓]/.test(body) ? "text-emerald-300" : "text-amber-300";
      return `<div class="flex items-start gap-2 px-1 py-0.5 font-mono text-[11px] ${tone}">
        <span>${esc(glyph)}</span>
        <span class="text-neutral-500">${esc(e.speaker || "")}</span>
        <span class="flex-1 text-neutral-300">${esc(body.trim().slice(1).trim())}</span>
      </div>`;
    }
    const human = /^(you|ceo)$/i.test(e.speaker || "");
    const tone = human ? "border-red-700/40 bg-red-950/20" : "border-neutral-800 bg-neutral-900/50";
    return `<div class="rounded-lg border ${tone} px-3 py-2">
      <div class="mb-0.5 text-[11px] font-medium ${human ? "text-red-300" : "text-cyan-300"}">${esc(e.speaker || "agent")}</div>
      <div class="text-[13px] text-neutral-200 whitespace-pre-wrap leading-relaxed">${esc(body)}</div>
    </div>`;
  }).join("");
  host.scrollTop = nearBottom ? host.scrollHeight : previousTop;
}

function renderChannelSystemMessage(message) {
  renderChannelFeed([{ speaker: "system", body: message || "Channel error." }]);
}

// A team-log work milestone starts with a status glyph emitted by the runner.
function isWorkEvent(body) {
  return /^\s*[▶✓✗✅⛔]/.test(String(body || ""));
}

async function pollChannel() {
  if (!channelState) return;
  if (channelState.kind === "board") {
    channelState.swarmWorkers = await loadBoardSwarmRows(channelState.id);
    renderChannelSwarm();
  }
  let r = {};
  try {
    r = await window.ceo.meetingRoom(channelState.room);
  } catch (e) {
    renderChannelSystemMessage(`Could not read room: ${String(e && e.message ? e.message : e)}`);
    const state = document.getElementById("chan-state");
    if (state) state.textContent = "· room error";
    return;
  }
  renderChannelFeed((r && r.feed) || []);
  const state = document.getElementById("chan-state");
  if (state) state.textContent = channelState && channelState.live
    ? "· live A2A"
    : channelState && channelState.kind === "meeting"
      ? (r && r.running ? "· meeting running" : "· meeting log")
      : (r && r.started ? "· idle" : "");
}

async function startChannelDiscussion() {
  if (!channelState) return;
  const briefEl = document.getElementById("chan-brief");
  const brief = briefEl && briefEl.value.trim();
  if (!brief) { briefEl?.focus(); return; }
  const btn = document.getElementById("chan-discuss");
  if (btn) { btn.disabled = true; btn.textContent = "Posting…"; }
  // Ensure the live A2A loop is running, then drop the brief in as a whole-team
  // message. The loop fans it out to members (each replies only if it concerns
  // their role) and writes their replies back into the room transcript.
  const loopReady = await startChannelLoop();
  const speaker = channelState.ceoInRoom ? "CEO" : "You";
  let r = {};
  try {
    const body = await withChannelContext(`Team — let's discuss this brief:\n\n${brief}`);
    r = await window.ceo.meetingPost(channelState.room, speaker, body);
  } catch (e) { r = { ok: false, reason: String(e) }; }
  if (btn) { btn.disabled = false; btn.textContent = "Discuss brief →"; }
  if (!r || !r.ok) {
    renderChannelFeed([{ speaker: "system", body: `Could not post brief: ${r ? r.reason : "unknown"}` }]);
    return;
  }
  if (briefEl) briefEl.value = "";
  if (!loopReady) renderChannelSystemMessage("Brief posted, but the live A2A room loop did not start. Restart the app if this says no handler is registered.");
  setTimeout(pollChannel, 600);
}

// Build the same context the CEO chat injects — referenced artifacts/files
// (the context tray) + a short project/domain header — so room agents share the
// CEO's situational awareness of what the human is pointing at.
async function referencedContextBlock() {
  const parts = [];
  if (currentProject) {
    parts.push(`Project: ${currentProject.name}${currentDomain && currentDomain !== "All" ? ` · domain: ${currentDomain}` : ""}`);
  }
  if (ceoContextTray.length) {
    const loaded = await Promise.all(ceoContextTray.slice(0, 4).map(readContextItem));
    parts.push("The human is referencing these:");
    for (const it of loaded) {
      parts.push(`- ${it.title}${it.path ? ` (${it.path})` : ""}:\n${String(it.text || "").slice(0, 800)}`);
    }
  }
  return parts.length ? parts.join("\n") : "";
}

// Prepend the shared context to a room message (capped, only when present).
async function withChannelContext(text) {
  const ctx = await referencedContextBlock();
  return ctx ? `${text}\n\n----- context -----\n${ctx}` : text;
}

async function sendChannelMessage() {
  if (!channelState) return;
  const input = document.getElementById("chan-input");
  const text = input && input.value.trim();
  if (!text) return;
  const send = document.getElementById("chan-send");
  const speaker = document.getElementById("chan-speaker")?.value || "You";
  const to = document.getElementById("chan-to")?.value || "";
  const addressed = to ? `@${to} ${text}` : text;
  if (send) { send.disabled = true; send.textContent = "Sending..."; }
  let r = null;
  try {
    const body = await withChannelContext(addressed);
    r = await window.ceo.meetingPost(channelState.room, speaker, body);
  } catch (e) {
    r = { ok: false, reason: String(e && e.message ? e.message : e) };
  }
  if (send) { send.disabled = false; send.textContent = "Send"; }
  if (!r || !r.ok) {
    if (input) input.value = text;
    renderChannelSystemMessage(`Could not post message: ${r ? r.reason : "unknown"}`);
    const state = document.getElementById("chan-state");
    if (state) state.textContent = "· post failed";
    return;
  }
  input.value = "";
  setTimeout(pollChannel, 200);
}

function toggleCeoInRoom() {
  if (!channelState) return;
  channelState.ceoInRoom = !!document.getElementById("chan-ceo")?.checked;
  renderChannelMembers();
  renderChannelComposerSelects();
}

async function addAgentToChannel() {
  if (!channelState) return;
  await loadRegistry();
  const candidates = (registryState.agents || []).filter((a) => !channelState.members.includes(a.id));
  if (!candidates.length) { alert("All registry agents are already in this channel."); return; }
  const pick = prompt(
    `Add an agent to #${channelState.name}.\nAvailable:\n` + candidates.map((a) => `- ${a.id} (${a.provider})`).join("\n") + "\n\nEnter agent id:",
    candidates[0].id,
  );
  if (!pick) return;
  const id = pick.trim();
  if (!candidates.some((a) => a.id === id)) { alert(`Unknown agent id: ${id}`); return; }
  const next = [...channelState.members, id];
  if (channelState.kind === "team") {
    try {
      const r = await window.ceo.registrySaveTeam(channelState.id, next);
      if (!r || !r.ok) { alert("Failed to add agent: " + (r ? r.reason : "unknown")); return; }
    } catch (e) { alert("Failed to add agent: " + String(e)); return; }
  }
  channelState.members = next;
  renderChannelMembers();
  renderChannelComposerSelects();
  // Note the change as a non-human speaker so it doesn't trigger a routing round,
  // then restart the live loop so the new member is included in the roster.
  await window.ceo.meetingPost(channelState.room, "Facilitator", `Added @${id} to the channel.`).catch(() => {});
  if (channelState.live) {
    try { await window.ceo.roomLoopStop(channelState.room); } catch { /* ignore */ }
    channelState.live = false;
    await startChannelLoop();
  }
  setTimeout(pollChannel, 200);
}

// Channel surface controls live in panel2 (outside panelContent). Delegate on
// document so they stay live across re-renders.
document.addEventListener("click", (e) => {
  if (e.target.closest("#chan-close")) { closeChannelSurface(); return; }
  if (e.target.closest("#chan-discuss")) { startChannelDiscussion(); return; }
  if (e.target.closest("#chan-send")) { sendChannelMessage(); return; }
  if (e.target.closest("#chan-add")) { addAgentToChannel(); return; }
  const swarmTerminal = e.target.closest(".chan-swarm-terminal");
  if (swarmTerminal && swarmTerminal.dataset.agent) {
    openTerminalForAgent(swarmTerminal.dataset.agent);
    return;
  }
  const swarmTask = e.target.closest(".chan-swarm-task");
  if (swarmTask && swarmTask.dataset.taskId) {
    openTaskInStudio({
      board: swarmTask.dataset.board,
      taskId: swarmTask.dataset.taskId,
      taskTitle: swarmTask.dataset.taskTitle,
      taskStatus: "running",
    });
    return;
  }
});
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "chan-ceo") toggleCeoInRoom();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.id === "chan-input") { sendChannelMessage(); return; }
  if (e.key === "Escape" && channelState) {
    const surf = document.getElementById("channel-surface");
    if (surf && !surf.classList.contains("hidden")) closeChannelSurface();
  }
});

function stopNavMeetingPoll() { if (navMeetingTimer) { clearInterval(navMeetingTimer); navMeetingTimer = null; } }

const MEETING_TEMPLATES = {
  kickoff: {
    label: "Kickoff",
    agenda: (domain) => `Kick off the ${domain} domain. Clarify ownership, initial capabilities, first artifacts, open risks, and the next Agenda Item proposals.`,
    criteria: "A concise domain plan with decisions, unresolved questions, owner recommendations, and proposal-only next Agenda Items.",
    team: "product-discovery",
  },
  handoff: {
    label: "Handoff triage",
    agenda: (domain) => `Triage the selected ${domain} handoff or domain context. Identify what is confirmed, what needs human attention, and which Agenda Items should be proposed.`,
    criteria: "Proposal-only Agenda Items with provenance, priority, routing suggestions, and human-approval flags.",
    team: "product-discovery",
  },
  requirements: {
    label: "Requirements",
    agenda: (domain) => `Turn the selected ${domain} context into implementation-ready requirements without creating Kanban work yet.`,
    criteria: "A requirements artifact with scope, non-goals, acceptance criteria, dependencies, and traceable source context.",
    team: "documentation-stewards",
  },
  planning: {
    label: "Build plan",
    agenda: (domain) => `Plan the next concrete implementation pass for the ${domain} domain. Sequence the work, identify files to change, tests to run, and risks to watch.`,
    criteria: "A practical build plan that can be handed to a coding agent after human approval.",
    team: "self-repair",
  },
  repair: {
    label: "Repair review",
    agenda: (domain) => `Review the selected ${domain} bug, gap, or failed workflow. Diagnose the likely cause and propose a repair path.`,
    criteria: "A repair brief with reproduction notes, affected surface, likely files, owner, and verification gates.",
    team: "self-repair",
  },
};

function meetingDomainName() {
  return currentDomain && currentDomain !== "All" ? currentDomain : (currentProject?.name || "Project");
}

function agentAvailability(agent) {
  if (agent?.mounted || agent?.tmux_session) return "mounted";
  return "available";
}

function mergeMeetingRoster(options = {}) {
  const optionAgents = Array.isArray(options.agents) ? options.agents : [];
  const mounted = new Set((options.mounted || []).concat(optionAgents.filter((a) => a.mounted).map((a) => a.id)));
  const registryAgents = registryState.agents || [];
  const sourceAgents = registryAgents.length ? registryAgents : optionAgents;
  const optionById = new Map(optionAgents.map((agent) => [agent.id, agent]));
  const agents = sourceAgents.map((agent) => ({
    ...optionById.get(agent.id),
    ...agent,
    mounted: mounted.has(agent.id) || !!agent.tmux_session || !!agent.mounted,
  }));
  return {
    agents,
    teams: (registryState.teams && registryState.teams.length) ? registryState.teams : (options.teams || []),
    personas: options.personas || registryState.personas || [],
    mounted: [...mounted],
  };
}

function renderMeetingTemplates() {
  return Object.entries(MEETING_TEMPLATES).map(([key, tmpl]) => `
    <button class="nav-mtg-template rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 hover:border-cyan-500/50 hover:bg-cyan-950/20"
      data-template="${esc(key)}">${esc(tmpl.label)}</button>
  `).join("");
}

function renderMeetingTeamCards(teams, agentsById) {
  if (!teams.length) return `<div class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-3 text-xs text-neutral-600">No teams in the registry.</div>`;
  return teams.map((team) => {
    const members = team.members || [];
    const mountedCount = members.filter((id) => {
      const agent = agentsById.get(id);
      return agent && (agent.mounted || agent.tmux_session);
    }).length;
    const sample = members.slice(0, 4).map((id) => agentsById.get(id)?.name || id).join(", ") || "No members";
    return `<button class="nav-mtg-team-card text-left rounded-xl border border-neutral-800 bg-neutral-950/45 p-3 hover:border-cyan-500/45 hover:bg-cyan-950/15"
      data-mtg-team="${esc(team.name)}">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">${esc(team.name)}</span>
        <span class="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">${members.length} agents</span>
      </div>
      <div class="mt-1 truncate text-[11px] text-neutral-500">${esc(sample)}</div>
      <div class="mt-2 text-[10px] uppercase tracking-wider text-neutral-600">${mountedCount} mounted now</div>
    </button>`;
  }).join("");
}

function renderMeetingAgentChecks(agents) {
  if (!agents.length) return '<div class="text-[11px] text-neutral-600">No agents in registry.</div>';
  return agents.map((a) => {
    const status = agentAvailability(a);
    const statusClass = status === "mounted" ? "bg-emerald-500" : "bg-neutral-600";
    const caps = (a.capabilities || []).slice(0, 3).join(", ");
    return `<label class="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-950/35 px-2 py-2 text-xs text-neutral-300">
      <input type="checkbox" class="nav-mtg-member mt-0.5 accent-cyan-500" value="${esc(a.id)}" />
      <span class="mt-1 h-2 w-2 shrink-0 rounded-full ${statusClass}"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-neutral-200">${esc(a.name || a.id)}</span>
        <span class="block truncate text-[10px] text-neutral-500">${esc([a.provider || "vertex", a.persona, caps].filter(Boolean).join(" / "))}</span>
      </span>
      <span class="shrink-0 text-[10px] text-neutral-600">${esc(status)}</span>
    </label>`;
  }).join("");
}

function selectMeetingTeam(teamName) {
  const select = $("#nav-mtg-team");
  if (select) select.value = teamName || "";
  const t = ((navMeetingOpts && navMeetingOpts.teams) || []).find((x) => x.name === teamName);
  const ids = new Set((t && t.members) || []);
  document.querySelectorAll(".nav-mtg-member").forEach((c) => { c.checked = ids.has(c.value); });
  document.querySelectorAll(".nav-mtg-team-card").forEach((card) => {
    const active = card.dataset.mtgTeam === teamName;
    card.classList.toggle("border-cyan-500", active);
    card.classList.toggle("bg-cyan-950/20", active);
  });
}

function applyMeetingTemplate(templateKey) {
  const tmpl = MEETING_TEMPLATES[templateKey];
  if (!tmpl) return;
  const domain = meetingDomainName();
  const agenda = $("#nav-mtg-agenda");
  const criteria = $("#nav-mtg-criteria");
  if (agenda) agenda.value = tmpl.agenda(domain);
  if (criteria) criteria.value = tmpl.criteria;
  if (tmpl.team && (navMeetingOpts?.teams || []).some((team) => team.name === tmpl.team)) selectMeetingTeam(tmpl.team);
  const msg = $("#nav-mtg-msg");
  if (msg) msg.textContent = `${tmpl.label} brief loaded`;
}

async function selectedMeetingContext() {
  if (!ceoContextTray.length) return [];
  const include = $("#nav-mtg-include-context");
  if (include && !include.checked) return [];
  const loaded = await Promise.all(ceoContextTray.slice(0, 6).map(readContextItem));
  return loaded.map((item) => ({
    kind: item.kind || "artifact",
    title: item.title || item.path || "Selected context",
    path: item.path || "",
    text: String(item.text || "").slice(0, 5000),
  }));
}

function meetingContextAgendaBlock(items) {
  if (!items.length) return "";
  return [
    "Selected domain context:",
    ...items.map((item, idx) => [
      `Context ${idx + 1}: ${item.title}`,
      `Kind: ${item.kind}`,
      `Path: ${item.path || "inline"}`,
      item.text || "(no content)",
    ].join("\n")),
  ].join("\n\n");
}

function fmtMeetingTime(value) {
  if (!value) return "unscheduled";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function meetingDateTimeLocal(value) {
  const d = value ? new Date(value) : new Date(Date.now() + 5 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderUpcomingMeetings(meetings = []) {
  const rows = meetings.filter((m) => m.status !== "started" && m.status !== "cancelled");
  if (!rows.length) return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 p-3 text-xs text-neutral-600">No upcoming meetings scheduled.</div>`;
  return rows.map((m) => `
    <div class="rounded-lg border border-neutral-800 bg-neutral-950/45 p-3">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-neutral-100">${esc(m.title || "Untitled meeting")}</div>
          <div class="mt-1 text-[11px] text-neutral-500">${esc(fmtMeetingTime(m.scheduledFor))} · ${esc(m.domain || "All")} · ${esc(m.recurrence || "none")}</div>
          <div class="mt-2 line-clamp-2 text-xs text-neutral-400">${esc(m.agenda || "")}</div>
        </div>
        <div class="flex shrink-0 gap-1">
          <button class="nav-mtg-run-scheduled rounded-md bg-cyan-600 px-2 py-1 text-[11px] text-white hover:bg-cyan-500" data-mtg-id="${esc(m.id)}">Start</button>
          <button class="nav-mtg-delete-scheduled rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" data-mtg-id="${esc(m.id)}">Delete</button>
        </div>
      </div>
    </div>`).join("");
}

function renderPastMeetings(rooms = []) {
  const rows = rooms.filter((r) => r && r.room && !r.channel).slice(0, 12);
  if (!rows.length) return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 p-3 text-xs text-neutral-600">No past meeting rooms yet.</div>`;
  return rows.map((r) => `
    <button class="nav-mtg-open-room block w-full rounded-lg border border-neutral-800 bg-neutral-950/45 p-3 text-left hover:border-cyan-500/40 hover:bg-cyan-950/10"
      data-room="${esc(r.room)}">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">${esc(r.room)}</span>
        <span class="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] ${r.done ? "text-emerald-400" : "text-amber-300"}">${r.done ? "done" : "running"}</span>
      </div>
      <div class="mt-1 text-[11px] text-neutral-500">${esc(fmtMeetingTime(r.updatedAt))} · ${Number(r.messages || 0)} messages</div>
      <div class="mt-2 truncate text-xs text-neutral-500">${esc((r.participants || r.speakers || []).slice(0, 5).join(", ") || "room transcript")}</div>
    </button>`).join("");
}

function renderStandupPanel(status = {}, runnerStatus = {}) {
  const policies = Array.isArray(status.policies) ? status.policies : [];
  const executions = Array.isArray(status.executions) ? status.executions : [];
  const domain = currentDomain || "All";
  const active = policies.find((p) => p.domain === domain) || policies[0] || null;
  const enabled = active && active.enabled !== false;
  const timeLocal = active?.timeLocal || "09:00";
  const agendaLabel = active?.agendaDomain ? `Agenda domain: ${active.agendaDomain}` : "Agenda domain selected automatically";
  const meetingId = active?.meetingId || "not scheduled";
  const automatic = !!(enabled && runnerStatus.running && runnerStatus.policy?.allowStandups !== false);
  const latest = executions
    .filter((execution) => !active || execution.policyId === active.id)
    .slice(0, 4);
  const executionRows = latest.length
    ? latest.map((execution) => {
      const pending = (execution.synthesis?.proposals || []).filter((proposal) => proposal.status === "pending").length;
      const statusTone = execution.status === "review_pending"
        ? "text-amber-300"
        : execution.status === "started"
          ? "text-cyan-300"
          : execution.status === "failed" || execution.status === "uncertain"
            ? "text-red-300"
            : "text-neutral-400";
      const standaloneProposals = !(execution.briefRefs || []).length
        ? (execution.synthesis?.proposals || []).filter((proposal) => proposal.status === "pending")
        : [];
      const proposalRows = standaloneProposals.map((proposal) => `
        <div class="rounded-md border border-neutral-800 bg-black/35 px-2.5 py-2">
          <div class="flex min-w-0 items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-[10px] uppercase text-neutral-600">${esc(proposal.type || "proposal")}</div>
              <div class="mt-0.5 text-[11px] text-neutral-300">${esc(proposal.title || proposal.body)}</div>
            </div>
            <div class="flex shrink-0 gap-1">
              <button class="standup-proposal-action rounded ${proposal.type === "blocker" ? "bg-red-700 hover:bg-red-600" : "bg-cyan-700 hover:bg-cyan-600"} px-2 py-1 text-[10px] text-white" data-action="approve" data-execution-id="${esc(execution.id)}" data-proposal-id="${esc(proposal.id)}" data-proposal-type="${esc(proposal.type)}">${esc(proposal.type === "blocker" ? "Raise escalation" : meetingProposalActionLabel(proposal.type))}</button>
              <button class="standup-proposal-action rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-action="reject" data-execution-id="${esc(execution.id)}" data-proposal-id="${esc(proposal.id)}" data-proposal-type="${esc(proposal.type)}">Reject</button>
            </div>
          </div>
        </div>
      `).join("");
      const firstBrief = (execution.briefRefs || [])[0];
      return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="h-2 w-2 shrink-0 rounded-full ${execution.status === "review_pending" ? "bg-amber-400" : execution.status === "started" ? "bg-cyan-400" : execution.status === "failed" || execution.status === "uncertain" ? "bg-red-400" : "bg-neutral-600"}"></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs text-neutral-200">${esc(execution.title || execution.meetingId || "Standup")}</div>
            <div class="mt-0.5 truncate font-mono text-[10px] text-neutral-600">${esc(execution.room || execution.scheduledFor || execution.id)}</div>
          </div>
          <span class="shrink-0 text-[10px] ${statusTone}">${pending ? `${pending} review` : esc(execution.status || "pending")}</span>
          ${firstBrief ? `<button class="standup-open-brief shrink-0 rounded border border-amber-800/70 px-1.5 py-1 text-[10px] text-amber-200 hover:bg-amber-950/30" data-board="${esc(firstBrief.board)}" data-task-id="${esc(firstBrief.taskId)}" data-title="${esc(execution.title || "Standup review")}">Review</button>` : ""}
          ${execution.room ? `<button class="nav-mtg-open-room shrink-0 rounded border border-neutral-700 px-1.5 py-1 text-[10px] text-neutral-300 hover:bg-neutral-800" data-room="${esc(execution.room)}">Open</button>` : ""}
        </div>
        ${proposalRows ? `<div class="mt-2 space-y-1.5">${proposalRows}</div>` : ""}
      </div>`;
    }).join("")
    : '<div class="text-xs text-neutral-600">No standup occurrences yet.</div>';
  return `
    <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-neutral-100">Autonomous Standup</div>
          <div class="mt-1 text-xs text-neutral-500">Daily project cadence that schedules a working room and creates proposal-only Agenda Items.</div>
        </div>
        <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${enabled ? "text-emerald-300" : "text-neutral-500"}">${enabled ? "enabled" : "not enabled"}</span>
        <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${automatic ? "text-emerald-300" : "text-neutral-500"}">${automatic ? "automatic" : "manual"}</span>
        <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${status.due ? "text-amber-300" : "text-neutral-500"}">${Number(status.due || 0)} due</span>
        <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${status.pendingReview ? "text-amber-300" : "text-neutral-500"}">${Number(status.pendingReview || 0)} review</span>
      </div>
      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[140px_minmax(0,1fr)_auto_auto]">
        <label class="block text-xs text-neutral-400">Morning time
          <input id="nav-standup-time" type="time" value="${esc(timeLocal)}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
        </label>
        <div class="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
          <div class="truncate text-xs text-neutral-300">${esc(active?.domain || domain)} · ${esc(agendaLabel)}</div>
          <div class="mt-1 truncate font-mono text-[10px] text-neutral-600">${esc(meetingId)}</div>
        </div>
        <button id="nav-standup-enable" class="self-end rounded-md bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500">Enable / Update</button>
        <button id="nav-standup-run-due" class="self-end rounded-md border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800">Start Due</button>
      </div>
      <div id="nav-standup-msg" class="mt-2 text-xs text-neutral-500"></div>
      <div class="mt-3 space-y-2">${executionRows}</div>
    </section>`;
}

async function renderMeetingsView() {
  setPanelTitle("Meetings");
  stopNavMeetingPoll();
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading session setup…</div>';
  const [meetingOptions, standupStatus, runnerStatus] = await Promise.all([
    window.ceo.meetingOptions ? safeIpc(() => window.ceo.meetingOptions(), {}) : {},
    window.ceo.standupStatus ? safeIpc(() => window.ceo.standupStatus(), {}) : {},
    window.ceo.runnerStatus ? safeIpc(() => window.ceo.runnerStatus(), {}) : {},
    loadRegistry(),
  ]);
  navMeetingOpts = mergeMeetingRoster(meetingOptions || {});
  navMeetingScheduled = (meetingOptions && meetingOptions.scheduled) || [];
  navMeetingPastRooms = (meetingOptions && meetingOptions.rooms) || [];
  const teams = navMeetingOpts.teams;
  const agents = navMeetingOpts.agents;
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const domainName = meetingDomainName();
  const teamOpts = `<option value="">— pick a team —</option>` +
    teams.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${(t.members || []).length})</option>`).join("");
  const contextRows = ceoContextTray.length
    ? ceoContextTray.map((item) => `<div class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2">
        <span class="rounded border border-cyan-500/20 bg-cyan-950/20 px-1.5 py-0.5 text-[10px] text-cyan-300">${esc(item.kind || "artifact")}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-neutral-300">${esc(item.title || item.path)}</span>
      </div>`).join("")
    : `<div class="rounded-lg border border-neutral-800 bg-neutral-950/45 px-3 py-2 text-xs text-neutral-600">No selected domain context.</div>`;
  const createOpenCls = navMeetingCreateOpen ? "" : "hidden";
  const defaultWhen = meetingDateTimeLocal();
  panelContent().innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-lg font-semibold text-neutral-100">Meetings</div>
          <div class="mt-1 text-xs text-neutral-500">Schedule working rooms, launch agent discussions, and reopen past transcripts.</div>
        </div>
        <button id="nav-mtg-toggle-create" class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500">${navMeetingCreateOpen ? "Close Create" : "Create Meeting"}</button>
      </div>
      ${renderStandupPanel(standupStatus || {}, runnerStatus || {})}
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div class="mb-3 flex items-center gap-2">
            <div class="text-sm font-semibold text-neutral-100">Upcoming Meetings</div>
            <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">${navMeetingScheduled.filter((m) => m.status !== "started" && m.status !== "cancelled").length}</span>
          </div>
          <div class="space-y-2">${renderUpcomingMeetings(navMeetingScheduled)}</div>
        </section>
        <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div class="mb-3 flex items-center gap-2">
            <div class="text-sm font-semibold text-neutral-100">Past Meetings</div>
            <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">${navMeetingPastRooms.filter((r) => r && r.room && !r.channel).length}</span>
          </div>
          <div class="space-y-2">${renderPastMeetings(navMeetingPastRooms)}</div>
        </section>
      </div>
      <div id="nav-mtg-create-panel" class="${createOpenCls} grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-neutral-100">Meeting Brief</div>
              <div class="mt-1 text-[11px] uppercase tracking-wider text-neutral-600">${esc(domainName)} domain workspace</div>
            </div>
            <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${agents.length} agents</span>
            <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] text-neutral-500">${teams.length} teams</span>
          </div>
          <div class="mb-3 flex flex-wrap gap-2">${renderMeetingTemplates()}</div>
          <label class="block text-xs text-neutral-400">Agenda
            <textarea id="nav-mtg-agenda" rows="5" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="What should this room decide, synthesize, or plan?"></textarea>
          </label>
          <label class="mt-3 block text-xs text-neutral-400">Expected outcome
            <input id="nav-mtg-criteria" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="Artifact, decision, proposal, or repair brief expected from this session" />
          </label>
          <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
            <label class="block text-xs text-neutral-400">Title
              <input id="nav-mtg-title" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="Planning room, test review, domain audit..." />
            </label>
            <label class="block text-xs text-neutral-400">Recurrence
              <select id="nav-mtg-recurrence" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500">
                <option value="none">none</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </label>
          </div>
          <label class="mt-3 block text-xs text-neutral-400">Scheduled for
            <input id="nav-mtg-when" type="datetime-local" value="${esc(defaultWhen)}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
          </label>
          <div class="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-3">
            <div class="mb-2 flex items-center gap-2">
              <div class="text-xs font-medium text-cyan-100">Selected Context</div>
              <span class="rounded border border-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">${ceoContextTray.length} items</span>
              <label class="ml-auto flex items-center gap-2 text-[11px] text-neutral-300">
                <input id="nav-mtg-include-context" type="checkbox" class="accent-cyan-500" ${ceoContextTray.length ? "checked" : "disabled"} />
                Include
              </label>
            </div>
            <div class="space-y-2">${contextRows}</div>
          </div>
          <label class="mt-3 flex items-center gap-2 text-xs text-amber-300/90">
            <input id="nav-mtg-paid" type="checkbox" class="accent-amber-500" /> Allow paid providers for this session
          </label>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button id="nav-mtg-start" class="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-cyan-500">Start Now</button>
            <button id="nav-mtg-schedule" class="rounded-md border border-cyan-600/70 px-4 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-950/30">Schedule</button>
            <span id="nav-mtg-msg" class="text-xs text-neutral-500"></span>
          </div>
        </section>
        <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div class="mb-3 flex items-center gap-2">
            <div>
              <div class="text-sm font-semibold text-neutral-100">Room Roster</div>
              <div class="mt-1 text-[11px] uppercase tracking-wider text-neutral-600">${navMeetingOpts.mounted.length} mounted agents now</div>
            </div>
            <select id="nav-mtg-team" class="ml-auto max-w-[220px] rounded-md border border-neutral-700 bg-neutral-800/70 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-cyan-500">${teamOpts}</select>
          </div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2">${renderMeetingTeamCards(teams, agentsById)}</div>
          <div class="mt-4 text-xs text-neutral-400">Participants
            <div class="mt-2 max-h-[260px] space-y-2 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/35 p-2">${renderMeetingAgentChecks(agents)}</div>
          </div>
        </section>
      </div>
      <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
        <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-neutral-500">
          <span>Live Room</span><span id="nav-mtg-room" class="font-mono text-cyan-400 normal-case">${esc(navMeetingRoom || "")}</span><span id="nav-mtg-state" class="ml-auto normal-case"></span>
        </div>
        <div id="nav-mtg-transcript" class="mt-3 max-h-[520px] overflow-auto pr-1"><div class="rounded-lg border border-neutral-800 bg-neutral-950/45 p-3 text-neutral-600">No meeting started.</div></div>
        <div id="nav-mtg-req" class="hidden mt-4 border-t border-neutral-800/60 pt-3">
          <div class="mb-1 flex items-center gap-2">
            <div class="text-[11px] uppercase tracking-wider text-emerald-400/80">Saved Result</div>
            <span id="nav-mtg-saved-path" class="font-mono text-[10px] text-neutral-600"></span>
          </div>
          <div id="nav-mtg-req-body" class="prose prose-invert prose-sm max-w-none text-neutral-200"></div>
        </div>
      </section>
    </div>`;
  if (navMeetingRoom) {
    pollNavMeeting();
    stopNavMeetingPoll();
    navMeetingTimer = setInterval(pollNavMeeting, 2500);
  }
}

async function startNavMeeting() {
  const msg = $("#nav-mtg-msg");
  const draft = await collectMeetingDraft();
  if (!draft.ok) { if (msg) msg.textContent = draft.reason; return; }
  if (msg) msg.textContent = "starting...";
  let r = {};
  try { r = await window.ceo.meetingStart(draft.info); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) { if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`; return; }
  if (msg) msg.textContent = "running - watch below";
  navMeetingRoom = r.room;
  navMeetingMeta = {
    domain: currentDomain,
    agenda: draft.agenda,
    participants: draft.team || draft.members,
    expectedOutcome: draft.criteria,
    sourceContext: draft.sourceContext,
    saved: false,
    artifactPath: "",
  };
  const lbl = $("#nav-mtg-room"); if (lbl) lbl.textContent = r.room;
  pollNavMeeting();
  stopNavMeetingPoll();
  navMeetingTimer = setInterval(pollNavMeeting, 2500);
}

async function collectMeetingDraft() {
  const agenda = ($("#nav-mtg-agenda") && $("#nav-mtg-agenda").value || "").trim();
  const criteria = ($("#nav-mtg-criteria") && $("#nav-mtg-criteria").value || "").trim();
  const title = ($("#nav-mtg-title") && $("#nav-mtg-title").value || "").trim() || agenda.split(/\n/)[0].slice(0, 80) || "Working meeting";
  const scheduledLocal = ($("#nav-mtg-when") && $("#nav-mtg-when").value || "").trim();
  const scheduledFor = scheduledLocal ? new Date(scheduledLocal).toISOString() : new Date().toISOString();
  const recurrence = ($("#nav-mtg-recurrence") && $("#nav-mtg-recurrence").value) || "none";
  const team = ($("#nav-mtg-team") && $("#nav-mtg-team").value) || "";
  const members = Array.from(document.querySelectorAll(".nav-mtg-member:checked")).map((c) => c.value).join(",");
  const allowPaid = !!($("#nav-mtg-paid") && $("#nav-mtg-paid").checked);
  if (!agenda) return { ok: false, reason: "agenda required" };
  if (!team && !members) return { ok: false, reason: "pick a team or members" };
  const sourceContext = await selectedMeetingContext();
  const contextBlock = meetingContextAgendaBlock(sourceContext);
  const meetingAgenda = contextBlock ? `${agenda}\n\n${contextBlock}` : agenda;
  const info = { room: `session-${Date.now()}`, agenda: meetingAgenda, criteria, allowPaid };
  if (team) info.team = team; else info.members = members;
  return { ok: true, title, scheduledFor, recurrence, agenda, meetingAgenda, criteria, team, members, allowPaid, sourceContext, info };
}

async function scheduleNavMeeting() {
  const msg = $("#nav-mtg-msg");
  const draft = await collectMeetingDraft();
  if (!draft.ok) { if (msg) msg.textContent = draft.reason; return; }
  const meeting = {
    title: draft.title,
    domain: currentDomain || "All",
    scheduledFor: draft.scheduledFor,
    recurrence: draft.recurrence,
    agenda: draft.meetingAgenda,
    criteria: draft.criteria,
    team: draft.team,
    members: draft.members,
    allowPaid: draft.allowPaid,
    sourceContext: draft.sourceContext,
  };
  let r = {};
  try { r = await window.ceo.meetingSchedule(meeting); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) { if (msg) msg.textContent = `schedule failed: ${r ? r.reason : "unknown"}`; return; }
  navMeetingCreateOpen = false;
  await renderMeetingsView();
}

async function startScheduledMeeting(id) {
  if (!id) return;
  let r = {};
  try { r = await window.ceo.meetingScheduleStart(id); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) { alert(`Could not start scheduled meeting: ${r ? r.reason : "unknown"}`); return; }
  navMeetingRoom = r.room;
  navMeetingMeta = null;
  await renderMeetingsView();
  pollNavMeeting();
  stopNavMeetingPoll();
  navMeetingTimer = setInterval(pollNavMeeting, 2500);
}

async function deleteScheduledMeeting(id) {
  if (!id) return;
  try { await window.ceo.meetingScheduleDelete(id); } catch { /* ignore */ }
  await renderMeetingsView();
}

async function enableProjectStandup() {
  const msg = $("#nav-standup-msg");
  const timeLocal = ($("#nav-standup-time") && $("#nav-standup-time").value) || "09:00";
  if (msg) msg.textContent = "scheduling...";
  let r = {};
  try {
    r = await window.ceo.standupConfigure({
      enabled: true,
      domain: currentDomain || "All",
      board: "ceo-studio",
      timeLocal,
    });
  } catch (e) {
    r = { ok: false, reason: String(e) };
  }
  if (!r || !r.ok) {
    if (msg) msg.textContent = `standup failed: ${r ? r.reason : "unknown"}`;
    return;
  }
  await renderMeetingsView();
}

async function runDueStandups() {
  const msg = $("#nav-standup-msg");
  if (msg) msg.textContent = "checking due standups...";
  let r = {};
  try { r = await window.ceo.standupRunDue(); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) {
    if (msg) msg.textContent = `standup failed: ${r ? r.reason : "unknown"}`;
    return;
  }
  if (msg) msg.textContent = `${r.due || 0} due standup(s) started`;
  await renderMeetingsView();
}

async function reviewStandaloneStandupProposal(button) {
  if (!button || !window.ceo.standupProposalAction) return;
  const action = button.dataset.action;
  const type = button.dataset.proposalType;
  if (action === "approve" && type === "blocker") {
    const confirmed = window.confirm("Approve this blocker and add it to Human Escalations?");
    if (!confirmed) return;
  }
  button.disabled = true;
  let result;
  try {
    result = await window.ceo.standupProposalAction({
      executionId: button.dataset.executionId,
      proposalId: button.dataset.proposalId,
      action,
      humanApproved: action === "approve",
      reviewedBy: "human",
    });
  } catch (error) {
    result = { ok: false, reason: String(error) };
  }
  if (!result || !result.ok) {
    button.disabled = false;
    alert(`Could not review standup proposal: ${result ? result.reason : "unknown"}`);
    return;
  }
  await refreshEscalations();
  await renderMeetingsView();
}

function localDateValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function currentStandupPolicy(status = {}) {
  const policies = Array.isArray(status.policies) ? status.policies : [];
  const domain = currentDomain || "All";
  return policies.find((p) => p.domain === domain) || policies[0] || null;
}

function goalResultOutput(title, result) {
  return `${title}\n${JSON.stringify(result || {}, null, 2).slice(0, 6000)}`;
}

function runnerDryRunSummary(result = {}) {
  const phases = result.phases || {};
  const count = (name) => Array.isArray(phases[name]) ? phases[name].length : (phases[name] ? 1 : 0);
  const standupPhase = phases.standups || {};
  return {
    ok: !!result.ok,
    skipped: !!result.skipped,
    reason: result.reason || "",
    dryRun: result.policy && result.policy.dryRun,
    boards: result.boards || [],
    errors: result.errors || [],
    standups: {
      skipped: standupPhase.skipped || "",
      due: Number(standupPhase.due?.due || 0),
      completed: Array.isArray(standupPhase.reconcile?.completed) ? standupPhase.reconcile.completed.length : 0,
    },
    phases: {
      unblock: count("unblock"),
      reap: count("reap"),
      research: count("research"),
      staleRunning: count("staleRunning"),
      plan: count("plan"),
      assign: count("assign"),
      execute: count("execute"),
      review: count("review"),
    },
  };
}

function renderGoalsOperatingPanel({ goals = [], autonomyRes = {}, runnerRes = {}, standupStatus = {}, board = "" } = {}) {
  const today = localDateValue();
  const dailyGoals = goals.filter((g) => g.layer === "daily" && g.status === "active");
  const todayGoals = dailyGoals.filter((g) => !g.horizonStart || g.horizonStart === today || g.horizonEnd === today);
  const autonomyPolicy = (autonomyRes && autonomyRes.policy) || {};
  const autonomyState = (autonomyRes && autonomyRes.state) || {};
  const runnerPolicy = (runnerRes && runnerRes.policy) || {};
  const standupPolicy = currentStandupPolicy(standupStatus);
  const standupEnabled = standupPolicy && standupPolicy.enabled !== false;
  const standupTime = standupPolicy?.timeLocal || "09:00";
  const standupExecutions = (standupStatus.executions || [])
    .filter((execution) => !standupPolicy || execution.policyId === standupPolicy.id)
    .slice(0, 3);
  const cadenceAutomatic = !!(runnerRes && runnerRes.running && runnerPolicy.allowStandups !== false && standupEnabled);
  const standupExecutionRows = standupExecutions.length
    ? standupExecutions.map((execution) => {
      const pending = (execution.synthesis?.proposals || []).filter((proposal) => proposal.status === "pending").length;
      return `<div class="flex min-w-0 items-center gap-2 border-t border-neutral-800/70 py-2 first:border-0">
        <span class="h-2 w-2 shrink-0 rounded-full ${execution.status === "review_pending" ? "bg-amber-400" : execution.status === "started" ? "bg-cyan-400" : "bg-neutral-600"}"></span>
        <span class="min-w-0 flex-1 truncate text-[11px] text-neutral-300">${esc(execution.title || execution.meetingId)}</span>
        <span class="shrink-0 text-[10px] ${pending ? "text-amber-300" : "text-neutral-600"}">${pending ? `${pending} review` : esc(execution.status || "")}</span>
      </div>`;
    }).join("")
    : '<div class="py-2 text-[11px] text-neutral-600">No occurrences recorded.</div>';
  const outputHtml = goalsOpState.output
    ? `<pre id="goals-op-output" class="mt-3 max-h-72 overflow-auto rounded-xl border border-neutral-800 bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/85 whitespace-pre-wrap">${esc(goalsOpState.output)}</pre>`
    : `<pre id="goals-op-output" class="hidden mt-3 max-h-72 overflow-auto rounded-xl border border-neutral-800 bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/85 whitespace-pre-wrap"></pre>`;
  return `<section class="rounded-2xl border border-cyan-700/30 bg-cyan-950/10 p-4">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-neutral-100">Daily Operating Loop</div>
        <div class="mt-1 text-xs text-neutral-500">Goal -> standup -> review -> autonomy proposal -> runner dry-run. Board: <span class="font-mono text-neutral-300">${esc(board || "unknown")}</span></div>
      </div>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${autonomyRes && autonomyRes.running ? "text-emerald-300" : "text-neutral-500"}">autonomy ${autonomyRes && autonomyRes.running ? "running" : "stopped"}</span>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${runnerRes && runnerRes.running ? "text-emerald-300" : "text-neutral-500"}">runner ${runnerRes && runnerRes.running ? "running" : "stopped"}</span>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${standupEnabled ? "text-emerald-300" : "text-neutral-500"}">standup ${standupEnabled ? "enabled" : "not enabled"}</span>
      <span class="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-0.5 text-[10px] ${cadenceAutomatic ? "text-emerald-300" : "text-neutral-500"}">cadence ${cadenceAutomatic ? "automatic" : "manual"}</span>
    </div>
    <div class="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <div class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-3">
        <div class="mb-2 flex items-center gap-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-neutral-400">Today's Goal</div>
          <span class="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">${todayGoals.length} active today</span>
        </div>
        <input id="goal-daily-title" class="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="What should the swarm make true today?" />
        <textarea id="goal-daily-outcome" rows="2" class="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="Outcome / why this matters"></textarea>
        <textarea id="goal-daily-criteria" rows="3" class="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" placeholder="Success criteria, one per line"></textarea>
        <button id="goal-daily-create" class="mt-2 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500">Create Daily Goal</button>
      </div>
      <div class="rounded-xl border border-neutral-800 bg-neutral-950/45 p-3">
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Cadence Controls</div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          ${detailRow("Autonomy mode", esc(autonomyPolicy.mode || "propose"))}
          ${detailRow("Last run", esc(autonomyState.lastRunAt ? new Date(autonomyState.lastRunAt).toLocaleString() : "never"))}
          ${detailRow("Runner interval", `${esc(runnerPolicy.intervalMinutes || 15)}m`)}
          ${detailRow("Standup", standupPolicy ? `${esc(standupPolicy.meetingId)} / ${esc(standupTime)}` : "not configured")}
          ${detailRow("Due / review", `${Number(standupStatus.due || 0)} / ${Number(standupStatus.pendingReview || 0)}`)}
          ${detailRow("Last cadence", esc(runnerRes?.state?.lastResult?.standups?.skipped || (standupExecutions[0]?.status || "never")))}
        </div>
        <label class="mt-3 block text-xs text-neutral-400">Standup time
          <input id="goals-standup-time" type="time" value="${esc(standupTime)}" class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500" />
        </label>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button id="goals-standup-configure" class="rounded-md border border-cyan-700/70 bg-cyan-950/25 px-2 py-1.5 text-xs text-cyan-100 hover:bg-cyan-900/35">Enable Standup</button>
          <button id="goals-standup-start" class="rounded-md bg-cyan-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-cyan-500">Start Standup</button>
          <button id="goals-review-daily" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Review Goals</button>
          <button id="goals-autonomy-cycle" class="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">Autonomy Cycle</button>
          <button id="goals-runner-toggle" class="col-span-2 rounded-md ${runnerRes && runnerRes.running ? "border border-red-800/70 bg-red-950/20 text-red-200 hover:bg-red-950/40" : "bg-cyan-600 text-white hover:bg-cyan-500"} px-2 py-1.5 text-xs font-medium">${runnerRes && runnerRes.running ? "Stop Runner" : "Start Runner"}</button>
          <button id="goals-runner-dry-run" class="col-span-2 rounded-md border border-amber-700/60 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-100 hover:bg-amber-900/30">Runner Dry-Run</button>
        </div>
        <div class="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3">${standupExecutionRows}</div>
      </div>
    </div>
    <div id="goals-op-msg" class="mt-3 text-xs text-neutral-500">${esc(goalsOpState.message || "")}</div>
    ${outputHtml}
  </section>`;
}

function setGoalsOpStatus(message, output = null) {
  goalsOpState = { message: message || "", output: output == null ? goalsOpState.output : String(output || "") };
  const msg = $("#goals-op-msg");
  if (msg) msg.textContent = goalsOpState.message;
  const out = $("#goals-op-output");
  if (out && output != null) {
    out.textContent = goalsOpState.output;
    out.classList.toggle("hidden", !goalsOpState.output);
  }
}

async function boardForGoalsOps() {
  return await currentBoardSlug();
}

async function createDailyGoalFromPanel() {
  const title = ($("#goal-daily-title") && $("#goal-daily-title").value || "").trim();
  const outcome = ($("#goal-daily-outcome") && $("#goal-daily-outcome").value || "").trim();
  const criteria = ($("#goal-daily-criteria") && $("#goal-daily-criteria").value || "").trim();
  if (!title) { setGoalsOpStatus("daily goal title required"); return; }
  setGoalsOpStatus("creating daily goal...");
  const today = localDateValue();
  let r = {};
  try {
    r = await window.ceo.upsertGoal({
      layer: "daily",
      title,
      outcome,
      domain: currentDomain || "All",
      status: "active",
      horizonStart: today,
      horizonEnd: today,
      successCriteria: criteria,
    });
  } catch (e) {
    r = { ok: false, reason: String(e) };
  }
  goalsOpState = {
    message: r && r.ok ? `created ${r.goal.id}` : `goal failed: ${r ? r.reason : "unknown"}`,
    output: goalResultOutput("Daily goal result", r),
  };
  await renderGoalsView();
}

async function reviewDailyGoalsFromPanel() {
  setGoalsOpStatus("reviewing daily goals...");
  const board = await boardForGoalsOps();
  let r = {};
  try { r = await window.ceo.reviewGoals({ board, layer: "daily", domain: currentDomain || "All" }); }
  catch (e) { r = { ok: false, reason: String(e) }; }
  setGoalsOpStatus(r && r.ok ? `daily review complete: ${(r.review && r.review.goalReviews || []).length} goal(s)` : `review failed: ${r ? r.reason : "unknown"}`, goalResultOutput("Daily goal review", r));
}

async function runGoalsAutonomyCycle() {
  setGoalsOpStatus("running conservative autonomy cycle...");
  const board = await boardForGoalsOps();
  let r = {};
  try { r = await window.ceo.autonomyRunCycle({ board, domain: currentDomain || "All", force: true }); }
  catch (e) { r = { ok: false, reason: String(e) }; }
  const actionCount = ((r && r.proposedActions) || []).length;
  setGoalsOpStatus(r && r.ok ? `autonomy cycle complete: ${actionCount} proposed action(s)` : `autonomy failed: ${r ? r.reason : "unknown"}`, goalResultOutput("Autonomy cycle", r));
}

async function runGoalsRunnerDryRun() {
  setGoalsOpStatus("running swarm dry-run...");
  const board = await boardForGoalsOps();
  let r = {};
  try {
    r = await window.ceo.runnerRunOnce({
      policy: {
        boards: board ? [board] : "all",
        domain: currentDomain || "All",
        dryRun: true,
        execute: true,
        maxDispatchPerCycle: 1,
      },
    });
  } catch (e) {
    r = { ok: false, reason: String(e) };
  }
  const summary = runnerDryRunSummary(r || {});
  setGoalsOpStatus(r && r.ok ? "runner dry-run complete" : `runner dry-run failed: ${r ? r.reason : "unknown"}`, goalResultOutput("Runner dry-run summary", summary));
}

async function toggleGoalsRunner() {
  if (!window.ceo.runnerStatus || !window.ceo.runnerStart || !window.ceo.runnerStop) return;
  setGoalsOpStatus("updating autonomy runner...");
  let current = {};
  try { current = await window.ceo.runnerStatus(); } catch { current = {}; }
  let result;
  try {
    result = current && current.running
      ? await window.ceo.runnerStop()
      : await window.ceo.runnerStart({ policy: { allowStandups: true } });
  } catch (error) {
    result = { ok: false, reason: String(error) };
  }
  goalsOpState = {
    message: result && result.ok
      ? `runner ${result.running ? "started" : "stopped"}`
      : `runner update failed: ${result ? result.reason : "unknown"}`,
    output: goalResultOutput("Autonomy runner", result),
  };
  await renderGoalsView();
}

async function configureGoalsStandup() {
  const timeLocal = ($("#goals-standup-time") && $("#goals-standup-time").value) || "09:00";
  const board = await boardForGoalsOps();
  setGoalsOpStatus("configuring daily standup...");
  let r = {};
  try {
    r = await window.ceo.standupConfigure({
      enabled: true,
      domain: currentDomain || "All",
      board: board || "ceo-studio",
      timeLocal,
    });
  } catch (e) {
    r = { ok: false, reason: String(e) };
  }
  goalsOpState = {
    message: r && r.ok ? `standup enabled: ${r.policy.meetingId}` : `standup failed: ${r ? r.reason : "unknown"}`,
    output: goalResultOutput("Standup configure", r),
  };
  await renderGoalsView();
}

async function startGoalsStandupNow() {
  setGoalsOpStatus("starting standup room...");
  let status = {};
  try { status = await window.ceo.standupStatus(); } catch { status = {}; }
  let policy = currentStandupPolicy(status);
  if (!policy) {
    const board = await boardForGoalsOps();
    const timeLocal = ($("#goals-standup-time") && $("#goals-standup-time").value) || "09:00";
    const configured = await window.ceo.standupConfigure({
      enabled: true,
      domain: currentDomain || "All",
      board: board || "ceo-studio",
      timeLocal,
    });
    if (!configured || !configured.ok) {
      setGoalsOpStatus(`standup failed: ${configured ? configured.reason : "unknown"}`, goalResultOutput("Standup start", configured));
      return;
    }
    policy = configured.policy;
  }
  let r = {};
  try { r = await window.ceo.meetingScheduleStart(policy.meetingId); }
  catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) {
    setGoalsOpStatus(`standup start failed: ${r ? r.reason : "unknown"}`, goalResultOutput("Standup start", r));
    return;
  }
  try {
    await window.ceo.standupConfigure({
      enabled: true,
      domain: policy.domain || currentDomain || "All",
      board: policy.board || await boardForGoalsOps() || "ceo-studio",
      timeLocal: policy.timeLocal || (($("#goals-standup-time") && $("#goals-standup-time").value) || "09:00"),
    });
  } catch { /* keep the started room even if reschedule refresh fails */ }
  navMeetingRoom = r.room;
  navMeetingMeta = null;
  goalsOpState = { message: `standup started: ${r.room}`, output: goalResultOutput("Standup start", r) };
  await openView("meetings");
}

async function renderGoalsView() {
  setPanelTitle("Goals");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading goals…</div>';
  
  if (!currentProject) {
    panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Open a project first to view goals.</div>';
    return;
  }

  let r;
  let board = "";
  let autonomyRes = {};
  let runnerRes = {};
  let standupStatus = {};
  try {
    const loaded = await Promise.all([
      window.ceo.listGoals ? safeIpc(() => window.ceo.listGoals({ domain: currentDomain }), { ok: false, reason: "goals API unavailable" }) : { ok: false, reason: "goals API unavailable" },
      currentBoardSlug(),
      window.ceo.autonomyStatus ? safeIpc(() => window.ceo.autonomyStatus(), {}) : {},
      window.ceo.runnerStatus ? safeIpc(() => window.ceo.runnerStatus(), {}) : {},
      window.ceo.standupStatus ? safeIpc(() => window.ceo.standupStatus(), {}) : {},
    ]);
    [r, board, autonomyRes, runnerRes, standupStatus] = loaded;
  } catch (e) {
    r = { ok: false, reason: String(e) };
  }

  if (!r || !r.ok) {
    panelContent().innerHTML = `<div class="text-neutral-500 text-sm">Could not load goals: ${r ? r.reason : "unknown"}</div>`;
    return;
  }

  const goals = r.goals || [];
  const byLayer = {};
  goals.forEach(g => {
    if (!byLayer[g.layer]) byLayer[g.layer] = [];
    byLayer[g.layer].push(g);
  });

  const layers = ["daily", "weekly", "monthly", "quarterly", "roadmap"];
  const layerHtml = layers.map(layer => {
    const layerGoals = byLayer[layer] || [];
    if (!layerGoals.length) return '';
    
    return `<div class="mb-6">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-sm font-semibold text-neutral-100 capitalize">${layer}</span>
        <span class="text-[11px] text-neutral-500">${layerGoals.length} goal${layerGoals.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="space-y-2">
        ${layerGoals.map(goal => `
          <div class="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-medium text-neutral-100">${esc(goal.title)}</span>
                  <span class="text-[10px] rounded-full border ${goal.status === 'active' ? 'border-emerald-500/40 text-emerald-300' : goal.status === 'done' ? 'border-neutral-600 text-neutral-400' : 'border-amber-500/30 text-amber-300'} bg-neutral-950/70 px-2 py-0.5 uppercase tracking-wider">${esc(goal.status)}</span>
                  ${goal.domain && goal.domain !== 'All' ? `<span class="text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded">${esc(goal.domain)}</span>` : ''}
                </div>
                ${goal.outcome ? `<div class="text-xs text-neutral-400 mb-2 line-clamp-2">${esc(goal.outcome)}</div>` : ''}
                ${goal.successCriteria && goal.successCriteria.length ? `
                  <div class="text-[11px] text-neutral-500">
                    <div class="mb-1">Success criteria:</div>
                    <ul class="list-disc list-inside space-y-0.5">
                      ${goal.successCriteria.slice(0, 3).map(c => `<li>${esc(c)}</li>`).join('')}
                      ${goal.successCriteria.length > 3 ? `<li class="text-neutral-600">+${goal.successCriteria.length - 3} more</li>` : ''}
                    </ul>
                  </div>
                ` : ''}
              </div>
              <div class="text-[10px] text-neutral-600 whitespace-nowrap">
                ${goal.updatedAt ? new Date(goal.updatedAt).toLocaleDateString() : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  panelContent().innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-neutral-100">Project Goals</span>
        <span class="text-[11px] text-neutral-500">${goals.length} total</span>
        ${currentDomain && currentDomain !== 'All' ? `<span class="text-[11px] text-cyan-400">Filtered by: ${esc(currentDomain)}</span>` : ''}
      </div>
      ${renderGoalsOperatingPanel({ goals, autonomyRes, runnerRes, standupStatus, board })}
      ${layerHtml || '<div class="text-neutral-500 text-sm">No goals found. Create goals using the CEO chat with the set_goal command.</div>'}
    </div>
  `;
}

async function renderTerminalView() {
  setPanelTitle("Terminal");
  const host = panelContent();
  host.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'h-full flex flex-col';
  host.appendChild(container);

  if (window.CEOPuTI) {
    window.CEOPuTI.mount(container);
    await window.CEOPuTI.refreshAgents();
    const pendingAgent = window.__ceoPendingTerminalAgent;
    if (pendingAgent && window.CEOPuTI.openAgent) {
      window.__ceoPendingTerminalAgent = null;
      await window.CEOPuTI.openAgent(pendingAgent);
    }
  } else {
    host.innerHTML = '<div class="text-neutral-500 text-sm p-4">PuTI terminal module is loading. If this persists, reload the app.</div>';
  }
}

async function openTerminalForAgent(agentId) {
  const id = String(agentId || "").trim();
  if (!id) return false;
  window.__ceoPendingTerminalAgent = id;
  await openView("terminal");
  if (window.CEOPuTI && window.CEOPuTI.openAgent) {
    await window.CEOPuTI.openAgent(id);
    return true;
  }
  return false;
}

async function renderVoiceView() {
  setPanelTitle("Voice Pilot");
  const host = panelContent();
  host.innerHTML = '';

  // Create voice panel container
  const container = document.createElement('div');
  container.id = 'voice-panel-container';
  container.className = 'h-full';
  host.appendChild(container);

  // Initialize voice panel if available
  if (window.voicePanel && window.voicePanel.init) {
    window.voicePanel.init();
  } else {
    // Fallback: show manual interface
    host.innerHTML = `
      <div class="h-full flex flex-col p-4">
        <div class="flex-1 overflow-auto space-y-3" id="voice-transcript"></div>
        <div class="flex items-center gap-3 pt-3 border-t border-neutral-800">
          <select id="voice-pilot-select" class="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm">
            <option value="ceo">CEO</option>
            <option value="ba">BA</option>
            <option value="architect">Architect</option>
            <option value="pm">PM</option>
            <option value="builder">Builder</option>
          </select>
          <button id="voice-mic-btn" class="flex-1 bg-red-600 hover:bg-red-500 text-white rounded px-4 py-2 text-sm font-medium transition">
            🎤 Hold to Speak
          </button>
          <button id="voice-stop-btn" class="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 rounded px-3 py-2 text-sm">
            ⏹
          </button>
        </div>
        <div class="text-xs text-neutral-500 pt-2">
          Web Speech API (local) → Hermes/Devin → Piper TTS (local)
        </div>
      </div>
    `;

    // Wire up fallback controls
    const micBtn = document.getElementById('voice-mic-btn');
    const stopBtn = document.getElementById('voice-stop-btn');
    const pilotSelect = document.getElementById('voice-pilot-select');
    const transcript = document.getElementById('voice-transcript');

    if (pilotSelect) {
      pilotSelect.addEventListener('change', (e) => {
        if (window.ceo && window.ceo.voiceChatSetPilot) {
          window.ceo.voiceChatSetPilot(e.target.value);
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (window.ceo && window.ceo.voiceChatInterrupt) {
          window.ceo.voiceChatInterrupt();
        }
      });
    }

    if (micBtn) {
      micBtn.addEventListener('mousedown', startVoiceInput);
      micBtn.addEventListener('mouseup', stopVoiceInput);
      micBtn.addEventListener('mouseleave', stopVoiceInput);
    }

    function startVoiceInput() {
      micBtn.classList.add('bg-red-700');
      micBtn.textContent = '🎤 Listening...';

      // Try to use Web Speech API directly as fallback
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition && !window._voiceRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (e) => {
          const text = Array.from(e.results).map(r => r[0].transcript).join('');
          if (transcript) {
            transcript.innerHTML += `<div class="text-neutral-300">You: ${text}</div>`;
          }
        };

        rec.onend = async () => {
          micBtn.classList.remove('bg-red-700');
          micBtn.textContent = '🎤 Hold to Speak';
          window._voiceRecognition = null;

          // Send to agent
          const finalText = transcript?.lastElementChild?.textContent?.replace('You: ', '') || '';
          if (finalText && window.ceo && window.ceo.voiceChat) {
            const response = await window.ceo.voiceChat(finalText);
            if (response.ok && transcript) {
              transcript.innerHTML += `<div class="text-cyan-400">${response.agentName || 'Agent'}: ${response.text}</div>`;
            }
          }
        };

        rec.start();
        window._voiceRecognition = rec;
      }
    }

    function stopVoiceInput() {
      if (window._voiceRecognition) {
        window._voiceRecognition.stop();
      }
    }
  }
}

async function openPastMeetingRoom(room) {
  if (!room) return;
  navMeetingRoom = room;
  navMeetingMeta = null;
  await renderMeetingsView();
  pollNavMeeting();
  stopNavMeetingPoll();
  navMeetingTimer = setInterval(pollNavMeeting, 2500);
}

async function pollNavMeeting() {
  if (!navMeetingRoom || !window.ceo.meetingRoom) return;
  let r = {};
  try { r = await window.ceo.meetingRoom(navMeetingRoom); } catch { return; }
  if (!r || !r.ok) return;
  const host = $("#nav-mtg-transcript");
  if (host) {
    const feed = r.feed || [];
    const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
    const previousTop = host.scrollTop;
    
    if (!feed.length) {
      host.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-neutral-500">
        <div class="text-4xl mb-2">💬</div>
        <div class="text-sm">No messages in this room yet</div>
        <div class="text-xs text-neutral-600 mt-1">Waiting for the session to begin…</div>
      </div>`;
    } else {
      host.innerHTML = `<div class="space-y-3">
        ${feed.map((it, idx) => {
          const isFac = /facilitator|orchestrator/i.test(it.speaker);
          const isSystem = /system|facilitator/i.test(it.speaker);
          const speakerColor = isFac ? "text-cyan-300" : isSystem ? "text-amber-300" : "text-emerald-300";
          const borderClass = isFac ? "border-cyan-500/20 bg-cyan-950/20" : isSystem ? "border-amber-500/20 bg-amber-950/20" : "border-neutral-800 bg-neutral-900/50";
          
          return `<div class="rounded-xl border ${borderClass} p-3 hover:border-neutral-700 transition">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-6 h-6 rounded-full ${isFac ? "bg-cyan-500/20" : isSystem ? "bg-amber-500/20" : "bg-emerald-500/20"} flex items-center justify-center">
                <span class="text-xs">${isFac ? "🎯" : isSystem ? "⚙️" : "👤"}</span>
              </div>
              <div class="text-xs font-semibold ${speakerColor}">${esc(it.speaker)}</div>
              ${it.timestamp ? `<div class="ml-auto text-[10px] text-neutral-600">${new Date(it.timestamp).toLocaleTimeString()}</div>` : ''}
            </div>
            <div class="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">${esc(it.body)}</div>
          </div>`;
        }).join("")}
      </div>`;
    }
    
    host.scrollTop = nearBottom ? host.scrollHeight : previousTop;
  }
  const state = $("#nav-mtg-state");
  if (state) state.innerHTML = r.running ? `<span class="text-amber-300">● running</span>` : `<span class="text-emerald-400">✓ complete</span>`;
  const reqWrap = $("#nav-mtg-req"), reqBody = $("#nav-mtg-req-body");
  if (reqWrap && reqBody) {
    if (r.requirements) { reqWrap.classList.remove("hidden"); reqBody.innerHTML = window.marked ? window.marked.parse(r.requirements) : esc(r.requirements); }
    else reqWrap.classList.add("hidden");
  }
  if (r.requirements && navMeetingMeta && !navMeetingMeta.saved && window.ceo.saveMeetingArtifact) {
    navMeetingMeta.saved = true;
    const saved = await window.ceo.saveMeetingArtifact({
      domain: navMeetingMeta.domain,
      room: navMeetingRoom,
      agenda: navMeetingMeta.agenda,
      participants: navMeetingMeta.participants,
      expectedOutcome: navMeetingMeta.expectedOutcome,
      requirements: r.requirements,
      sourceContext: navMeetingMeta.sourceContext || [],
    });
    if (saved && saved.ok && saved.artifact) navMeetingMeta.artifactPath = saved.artifact.path || "";
    const savedPath = $("#nav-mtg-saved-path");
    if (savedPath && navMeetingMeta.artifactPath) savedPath.textContent = navMeetingMeta.artifactPath;
    if (studioView === "domain") await renderStudioBoard(currentDomain);
  }
  if (!r.running) stopNavMeetingPoll();
}

async function openView(view) {
  const next = view || "domain";
  stopBriefRunOpsTimer();
  if (studioView === "sessions" && next !== "sessions" && window.StudioSessions && window.StudioSessions.onLeave) {
    window.StudioSessions.onLeave();
  }
  studioView = next;
  setActiveNav(studioView);
  if (studioView !== "meetings") stopNavMeetingPoll();
  if (studioView !== "agents") stopActiveAgentsTimer();
  closeAgentSurface();
  switch (studioView) {
    case "sessions":
      if (window.StudioSessions) return window.StudioSessions.openView();
      panelContent().innerHTML = '<div class="text-sm text-red-300">Sessions module failed to load. Reload the app.</div>';
      return;
    case "board": return renderBoardView();
    case "tasks": return renderTasksView();
    case "agents": return renderAgentsView();
    case "skills": return renderSkillsView();
    case "teams": return renderTeamsView();
    case "personas": return renderPersonasView();
    case "channels": return renderChannelsView();
    case "meetings": return renderMeetingsView();
    case "goals": return renderGoalsView();
    case "terminal": return renderTerminalView();
    case "voice": return renderVoiceView();
    case "domain":
    default: return renderStudioBoard(currentDomain);
  }
}

window.ceoUI = {
  appendStream, setAgentState, setVoiceStatus, renderMeter, setPanelTitle,
  hasProject: () => !!currentProject,
  getContext: () => ({
    project: currentProject ? { id: currentProject.id, name: currentProject.name, slug: currentProject.slug } : null,
    domain: currentDomain,
    selectedFile: selectedFile ? { path: selectedFile.path, preview: selectedFile.text.slice(0, 4000) } : null,
    focusedTask: focusedTask ? { ...focusedTask } : null,
    panel: {
      title: $("#panel-title") ? $("#panel-title").textContent : "",
      mode: $("#studio-mode-pill") ? $("#studio-mode-pill").textContent : "",
      focusTitle: $("#studio-focus-title") ? $("#studio-focus-title").textContent : "",
    },
  }),
  // Render arbitrary markdown into Panel 1 (used by the voice agent's tools).
  showPanel(title, markdown) {
    const md = (title ? `# ${title}\n\n` : "") + (markdown || "");
    panelContent().innerHTML = window.marked ? window.marked.parse(md) : md;
    setPanelTitle(title || "Panel");
  },
  showAgui(ui) {
    setPanelTitle(ui?.title || "Panel");
    if (window.CEOAgui && window.CEOAgui.renderUi) window.CEOAgui.renderUi(ui);
    else this.showPanel(ui?.title || "Panel", JSON.stringify(ui, null, 2));
  },
  openTaskFromDashboard: openTaskInStudio,
  openDomainWizard,
  openTaskWizard,
  async createTask(task = {}) {
    const board = task.board || task.kanbanBoard || null;
    const skills = Array.isArray(task.skills)
      ? task.skills
      : splitLines(task.skills || "");
    const body = [
      task.body || task.brief || "",
      task.acceptanceCriteria ? `\n\nAcceptance criteria:\n${task.acceptanceCriteria}` : "",
      task.context ? `\n\nContext:\n${task.context}` : "",
    ].join("").trim();
    const r = await window.ceo.ceoAddTask({
      board,
      status: task.status || "triage",
      title: task.title,
      body: [
        body,
        task.persona ? `\n\nPersona: ${task.persona}` : "",
        skills.length ? `\n\nSkills: ${skills.join(", ")}` : "",
      ].join("").trim(),
      assignee: task.assignee || null,
      persona: task.persona || null,
    });
    if (r && r.ok) await renderStudioBoard(currentDomain);
    return r;
  },
  // Reflect a domain switch the voice agent requested.
  async setDomainUI(domain) {
    const sw = $("#domain-switcher");
    if (sw && [...sw.options].some((o) => o.value === domain)) sw.value = domain;
    currentDomain = domain || "All";
    await window.ceo.setDomain(currentDomain);
    await refreshFileTree(currentDomain);
    await renderStudioBoard(currentDomain);
    window.CEOConvai?.syncContext?.(`domain → ${currentDomain}`);
  },
  // Voice agent render control: drive the left nav and the agent/team panels.
  openView: (view) => openView(view),
  openTerminal: openTerminalForAgent,
  async openChannel(key) {
    await openView("channels");
    await openChannel(key);
    return true;
  },
  async openMeetingRoom(room) {
    await openView("channels");
    await openChannel(`meeting:${room}`);
    return true;
  },
  async openAgentDetail(idOrName) {
    await loadRegistry();
    const a = registryState.agents.find((x) => x.id === idOrName || x.name === idOrName);
    if (!a) return false;
    studioView = "agents";
    setActiveNav("agents");
    await openAgentDetail(a.id);
    return true;
  },
  refreshTeam() { if (studioView === "agents" || studioView === "teams") renderRegistryPanel(); },
};

// --- wiring ---
$("#create-menu-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#create-menu").classList.toggle("hidden");
});
$("#create-project").addEventListener("click", createProject);
$("#create-domain").addEventListener("click", createDomain);
$("#create-brief")?.addEventListener("click", () => {
  closeCreateMenu();
  if (window.BriefBuilder) window.BriefBuilder.start();
  else appendStream("sys", "Brief builder not loaded.");
});
$("#create-task").addEventListener("click", () => createTask());
$("#human-escalations")?.addEventListener("click", async (e) => {
  e.stopPropagation();
  escalationPanelOpen = !escalationPanelOpen;
  await refreshEscalations();
});
$("#human-escalation-panel")?.addEventListener("click", async (e) => {
  e.stopPropagation();
  const row = e.target.closest("[data-notification-id]");
  if (!row) return;
  const id = row.dataset.notificationId;
  const notice = escalationNotifications.find((n) => n.id === id);
  if (e.target.closest(".notif-open") && notice) {
    if (notice.metadata && notice.metadata.room) {
      await openView("meetings");
      await openPastMeetingRoom(notice.metadata.room);
      return;
    }
    await openTaskInStudio({
      board: notice.board,
      taskId: notice.taskId,
      taskTitle: notice.taskTitle || notice.title,
      taskStatus: "blocked",
    });
    return;
  }
  if (e.target.closest(".notif-ack")) {
    await window.ceo.notificationsAck(id);
    await refreshEscalations();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#human-escalation-panel") && !e.target.closest("#human-escalations")) {
    escalationPanelOpen = false;
    renderEscalationPanel();
  }
  if (!e.target.closest("#create-menu") && !e.target.closest("#create-menu-toggle")) closeCreateMenu();
});
$("#project-switcher").addEventListener("change", (e) => openProject(e.target.value));
$("#domain-switcher").addEventListener("change", async (e) => {
  currentDomain = e.target.value || "All";
  await window.ceo.setDomain(currentDomain);
  await refreshFileTree(currentDomain);
  await renderStudioBoard(currentDomain);
  window.CEOConvai?.syncContext?.(`domain → ${currentDomain}`);
});
$("#file-tree-refresh").addEventListener("click", () => refreshFileTree(currentDomain));
$("#file-pane-toggle").addEventListener("click", () => setFilePaneOpen(!filePaneOpen));
$("#file-pane-close").addEventListener("click", () => setFilePaneOpen(false));
$("#panel-fullscreen").addEventListener("click", () => setPanelFullscreen(!panelFullscreen));
$("#file-tree").addEventListener("click", (e) => {
  const node = e.target.closest(".file-node");
  if (node) showFile(node.dataset.path);
});
panelContent().addEventListener("click", async (e) => {
  // Channel items
  const channel = e.target.closest(".channel-item");
  if (channel) {
    const key = channel.dataset.channel;
    if (key === "ceo") switchToCeoChannel();
    else await openChannel(key);
    return;
  }
  
  // Task cards
  const task = e.target.closest(".studio-task-card");
  if (task) {
    await openTaskInStudio({
      board: task.dataset.board,
      taskId: task.dataset.taskId,
      taskTitle: task.dataset.taskTitle,
      taskStatus: task.dataset.taskStatus,
    });
    return;
  }
  
  // Add task button
  const add = e.target.closest("#studio-add-task");
  if (add) {
    await createTask(add.dataset.board);
    return;
  }
  
  // Meeting controls
  if (e.target.closest("#nav-mtg-toggle-create")) {
    navMeetingCreateOpen = !navMeetingCreateOpen;
    await renderMeetingsView();
    return;
  }
  if (e.target.closest("#nav-mtg-start")) { startNavMeeting(); return; }
  if (e.target.closest("#nav-mtg-schedule")) { scheduleNavMeeting(); return; }
  if (e.target.closest("#nav-standup-enable")) { enableProjectStandup(); return; }
  if (e.target.closest("#nav-standup-run-due")) { runDueStandups(); return; }
  const standupProposalAction = e.target.closest(".standup-proposal-action");
  if (standupProposalAction) { reviewStandaloneStandupProposal(standupProposalAction); return; }
  const standupBrief = e.target.closest(".standup-open-brief");
  if (standupBrief) {
    await openTaskInStudio({
      board: standupBrief.dataset.board,
      taskId: standupBrief.dataset.taskId,
      taskTitle: standupBrief.dataset.title,
      taskStatus: "planning",
    });
    return;
  }
  if (e.target.closest("#goal-daily-create")) { createDailyGoalFromPanel(); return; }
  if (e.target.closest("#goals-review-daily")) { reviewDailyGoalsFromPanel(); return; }
  if (e.target.closest("#goals-autonomy-cycle")) { runGoalsAutonomyCycle(); return; }
  if (e.target.closest("#goals-runner-toggle")) { toggleGoalsRunner(); return; }
  if (e.target.closest("#goals-runner-dry-run")) { runGoalsRunnerDryRun(); return; }
  if (e.target.closest("#goals-standup-configure")) { configureGoalsStandup(); return; }
  if (e.target.closest("#goals-standup-start")) { startGoalsStandupNow(); return; }
  const scheduledStart = e.target.closest(".nav-mtg-run-scheduled");
  if (scheduledStart) { startScheduledMeeting(scheduledStart.dataset.mtgId); return; }
  const scheduledDelete = e.target.closest(".nav-mtg-delete-scheduled");
  if (scheduledDelete) { deleteScheduledMeeting(scheduledDelete.dataset.mtgId); return; }
  const pastRoom = e.target.closest(".nav-mtg-open-room");
  if (pastRoom) {
    openPastMeetingRoom(pastRoom.dataset.room);
    return;
  }
  const tmpl = e.target.closest(".nav-mtg-template");
  if (tmpl) { applyMeetingTemplate(tmpl.dataset.template); return; }
  const teamCard = e.target.closest(".nav-mtg-team-card");
  if (teamCard) { selectMeetingTeam(teamCard.dataset.mtgTeam || ""); return; }
  
  // Domain save
  const domainSave = e.target.closest("#domain-create-save");
  if (domainSave) {
    await saveDomainFromWizard();
    return;
  }
  
  // Personas view: library + editor
  if (e.target.closest("#persona-generate")) { openPersonaGenerateModal(); return; }
  if (e.target.closest("#persona-new")) { openPersonaEditor(null, { content: "" }); return; }
  if (e.target.closest("#persona-back")) { renderPersonasView(); return; }
  if (e.target.closest("#pe-save")) { savePersonaFromEditor(); return; }
  if (e.target.closest("#pe-delete")) { deletePersonaFromEditor(); return; }
	  const personaCard = e.target.closest(".persona-card");
	  if (personaCard) { openPersonaEditor(personaCard.dataset.id); return; }

	  const skillRoute = e.target.closest(".skill-route");
	  if (skillRoute) { await routeSkillFromCatalog(skillRoute.dataset.skill); return; }
	  
	  // Agents/Teams panels: roster + team management
	  if (e.target.closest("#agent-new")) { openAgentModal(null); return; }
	  if (e.target.closest("#agent-ask-ceo")) { await askCeoToRouteVisibleAgents(); return; }
	  if (e.target.closest("#agent-filters-clear")) { clearAgentDirectoryFilters(); return; }
	  if (e.target.closest("#active-agents-refresh")) { await refreshActiveAgentTerminals(); return; }
	  const activeAgentRefresh = e.target.closest(".active-agent-refresh");
	  if (activeAgentRefresh) { await refreshActiveAgentTerminal(activeAgentRefresh.dataset.agent); return; }
	  const activeAgentSend = e.target.closest(".active-agent-send");
	  if (activeAgentSend) { await sendActiveAgentTerminalInput(activeAgentSend.dataset.agent); return; }
	  const activeAgentOpen = e.target.closest(".active-agent-open");
	  if (activeAgentOpen) { await openAgentDetail(activeAgentOpen.dataset.agent); return; }
	  const agentChip = e.target.closest(".agent-filter-chip");
	  if (agentChip) { updateAgentDirectoryFilter("capability", agentChip.dataset.capability || "all"); return; }
	  const agentAction = e.target.closest(".agent-action");
	  if (agentAction) {
	    await runAgentDirectoryAction(agentAction.dataset.action, agentAction.dataset.agent);
	    return;
	  }
	  const card = e.target.closest(".team-agent-card");
	  if (card) {
	    if (window.StudioSessions && window.StudioSessions.startAgentSession) {
	      await window.StudioSessions.startAgentSession(card.dataset.agent);
	    } else {
      openAgentDetail(card.dataset.agent);
    }
    return;
  }
  // Agent detail view buttons
  if (e.target.closest("#agent-back")) { closeAgentSurface(); renderRegistryPanel(); return; }
  if (e.target.closest("#agent-edit")) { openAgentModal(selectedAgentId); return; }
  if (e.target.closest("#agent-mount")) { mountSelectedAgent(); return; }
  if (e.target.closest("#agent-unmount")) { unmountSelectedAgent(); return; }
  const remove = e.target.closest(".team-remove");
  if (remove) {
    const team = registryState.teams.find((x) => x.name === remove.dataset.team);
    const members = (team ? team.members : []).filter((m) => m !== remove.dataset.agent);
    await teamSetMembers(remove.dataset.team, members);
    return;
  }
  const delTeam = e.target.closest(".team-delete");
  if (delTeam) {
    if (!confirm(`Delete team "${delTeam.dataset.team}"?`)) return;
    const r = await window.ceo.registryDeleteTeam(delTeam.dataset.team);
    if (r && r.ok) { await loadRegistry(); renderRegistryPanel(); }
    return;
  }
  if (e.target.closest("#team-new")) {
    const name = prompt("New team name:");
    if (name && name.trim()) await teamSetMembers(name.trim(), []);
    return;
  }
  
  // Domain wizard controls
  const domainCancel = e.target.closest("#domain-create-cancel");
  if (domainCancel) {
    await renderStudioBoard(currentDomain);
    return;
  }
  const domainDraft = e.target.closest("#domain-draft-ceo");
  if (domainDraft) {
    const name = $("#domain-name")?.value.trim();
    const context = [
      "Help me define a new project domain.",
      name ? `Domain name: ${name}` : "I have not named it yet.",
      "Ask me only for missing essentials, then call define_domain with purpose, overarchingGoal, boundaries, features, kanbanBoard, relativePath, and coreAgents.",
    ].join("\n");
    await runTurn(context);
    return;
  }
  if (e.target.closest("#domain-architect-start")) {
    await startDomainArchitectInterview();
    return;
  }
  if (e.target.closest("#domain-architect-answer-save")) {
    await saveDomainArchitectAnswer();
    return;
  }
  const outlineNode = e.target.closest(".domain-architect-outline");
  if (outlineNode) {
    await focusDomainArchitectSection(outlineNode.dataset.field);
    return;
  }
  if (e.target.closest("#domain-architect-apply")) {
    applyDomainArchitectDraftToForm(domainArchitectSession);
    return;
  }
  if (e.target.closest("#domain-architect-ask")) {
    await askHermesDomainArchitect();
    return;
  }
  if (e.target.closest("#domain-architect-deep-dive")) {
    await captureDomainArchitectDeepDive();
    return;
  }
  if (e.target.closest("#domain-architect-confirm")) {
    await confirmDomainArchitectSession();
    return;
  }
  const domainHandoff = e.target.closest("#domain-create-handoff");
  if (domainHandoff) {
    await createDomainHandoffFromView();
    return;
  }
  const domainAgenda = e.target.closest("#domain-propose-agenda");
  if (domainAgenda) {
    await triageDomainHandoffFromView();
    return;
  }
  const domainMeeting = e.target.closest("#domain-first-meeting");
  if (domainMeeting) {
    await startDomainDogfoodMeeting();
    return;
  }
  const contextAdd = e.target.closest(".domain-context-add");
  if (contextAdd) {
    await addDomainContextFromButton(contextAdd);
    return;
  }
  const contextRemove = e.target.closest(".domain-context-remove");
  if (contextRemove) {
    await removeDomainContext(contextRemove.dataset.contextKey || "");
    return;
  }
  const contextClear = e.target.closest("#domain-context-clear");
  if (contextClear) {
    ceoContextTray = [];
    await renderStudioBoard(currentDomain);
    return;
  }
  const contextAsk = e.target.closest("#domain-context-ask");
  if (contextAsk) {
    await askCeoAboutContext();
    return;
  }
  
  // Task wizard controls
  const taskSave = e.target.closest("#task-new-save");
  if (taskSave) {
    await saveTaskFromWizard();
    return;
  }
  const taskCancel = e.target.closest("#task-new-cancel");
  if (taskCancel) {
    await renderStudioBoard(currentDomain);
    return;
  }
  
  // Task detail controls
  if (e.target.closest("#brief-run-save")) { await saveBriefRunDocument(); return; }
  if (e.target.closest("#brief-run-save-checklist")) { await saveBriefRunChecklist(); return; }
  if (e.target.closest("#brief-run-add-decision")) { await addBriefRunEntry("decision"); return; }
  if (e.target.closest("#brief-run-add-evidence")) { await addBriefRunEntry("evidence"); return; }
  if (e.target.closest("#brief-run-add-agenda")) { await addBriefRunOperationalEntry("agenda"); return; }
  if (e.target.closest("#brief-run-add-completion")) { await addBriefRunOperationalEntry("completion"); return; }
  if (e.target.closest("#brief-run-add-asset")) { await recordBriefRunAsset(); return; }
  if (e.target.closest("#brief-run-meeting-start")) { await runBriefRunMeetingAction("start"); return; }
  if (e.target.closest("#brief-run-meeting-schedule")) { await runBriefRunMeetingAction("schedule"); return; }
  if (e.target.closest("#brief-run-refresh-operations")) { await refreshBriefRunOperations({ reload: true }); return; }
  const proposalAction = e.target.closest(".brief-run-proposal-action");
  if (proposalAction) { await reviewBriefRunMeetingProposal(proposalAction); return; }
  const meetingSynthesize = e.target.closest(".brief-run-meeting-synthesize");
  if (meetingSynthesize) { await synthesizeBriefRunMeeting(meetingSynthesize.dataset.meetingId); return; }
  const synthesisJump = e.target.closest(".brief-run-jump-synthesis");
  if (synthesisJump) { jumpToBriefRunSynthesis(synthesisJump.dataset.synthesisId); return; }
  const briefMeetingStart = e.target.closest(".brief-run-meeting-start-scheduled");
  if (briefMeetingStart) { await runBriefRunMeetingAction("startScheduled", briefMeetingStart.dataset.meetingId); return; }
  const briefMeetingOpen = e.target.closest(".brief-run-meeting-open");
  if (briefMeetingOpen) { await openBriefRunMeeting(briefMeetingOpen.dataset.room); return; }
  const briefMeetingRefresh = e.target.closest(".brief-run-meeting-refresh");
  if (briefMeetingRefresh) { await refreshBriefRunMeeting(briefMeetingRefresh.dataset.room); return; }
  const briefAsset = e.target.closest(".brief-run-open-asset");
  if (briefAsset && briefAsset.dataset.path) { await showFile(briefAsset.dataset.path); return; }
  if (e.target.closest("#brief-run-create-session")) { await createBriefRunSession(); return; }
  if (e.target.closest("#brief-run-dry-run")) { await runBriefFocusedDryRun(); return; }
  const briefSession = e.target.closest(".brief-run-open-session");
  if (briefSession) { await openBriefRunSession(briefSession.dataset.sessionId); return; }
  const assign = e.target.closest("#task-assign-save");
  if (assign && focusedTask) {
    const select = $("#task-assignee");
    const msg = $("#task-action-msg");
    if (msg) msg.textContent = "assigning...";
    const r = await window.ceo.ceoAssignTask({
      board: focusedTask.board,
      taskId: focusedTask.taskId,
      assignee: select ? select.value : "none",
      reclaim: true,
    });
    if (msg) msg.textContent = r && r.ok ? "assigned" : `assign failed: ${r ? r.reason : "unknown"}`;
    await openTaskInStudio(focusedTask);
    return;
  }
  const actionBtn = e.target.closest(".task-action");
  if (actionBtn && focusedTask) {
    const action = actionBtn.dataset.action;
    const msg = $("#task-action-msg");
    if (msg) msg.textContent = `${action}...`;
    const reason = action === "block" ? (prompt("Block reason:") || "blocked from CEO Studio") : `CEO Studio: ${action}`;
    const r = await window.ceo.ceoTaskAction({
      board: focusedTask.board,
      taskId: focusedTask.taskId,
      action,
      reason,
    });
    if (msg) msg.textContent = r && r.ok ? `${action} done` : `${action} failed: ${r ? r.reason : "unknown"}`;
    await openTaskInStudio(focusedTask);
    return;
  }
  const dispatch = e.target.closest("#task-dispatch");
  if (dispatch && focusedTask) {
    const msg = $("#task-action-msg");
    if (msg) msg.textContent = "dispatching one worker...";
    const r = await window.ceo.ceoDispatch({ board: focusedTask.board, max: 1 });
    if (msg) msg.textContent = r && r.ok ? "dispatch pass complete" : `dispatch failed: ${r ? r.reason : "unknown"}`;
    await openTaskInStudio(focusedTask);
    return;
  }
  const logRefresh = e.target.closest("#task-log-refresh");
  if (logRefresh && focusedTask) {
    const out = $("#task-log-output");
    if (out) out.textContent = "Loading log...";
    const r = await window.ceo.ceoTaskLog({ board: focusedTask.board, taskId: focusedTask.taskId });
    if (out) {
      out.textContent = r && r.ok ? (r.out || "No worker log yet.") : `Log unavailable: ${r ? r.reason : "unknown"}`;
      out.scrollTop = out.scrollHeight;
    }
  }
});
// Studio nav rail: each item opens its workspace panel.
document.querySelectorAll("#studio-nav .nav-item").forEach((b) => {
  b.addEventListener("click", () => openView(b.dataset.view));
});
panelContent().addEventListener("change", async (e) => {
  if (e.target && e.target.id === "nav-mtg-team") {
    selectMeetingTeam(e.target.value);
    return;
  }
  if (e.target && e.target.id === "agent-filter-provider") {
    updateAgentDirectoryFilter("provider", e.target.value || "all");
    return;
  }
  if (e.target && e.target.id === "agent-filter-capability") {
    updateAgentDirectoryFilter("capability", e.target.value || "all");
    return;
  }
  if (e.target && e.target.id === "agent-filter-group") {
    updateAgentDirectoryFilter("group", e.target.value || "all");
    return;
  }
  if (e.target && e.target.id === "agent-filter-status") {
    updateAgentDirectoryFilter("status", e.target.value || "all");
    return;
  }
  if (e.target && e.target.classList && e.target.classList.contains("team-add") && e.target.value) {
    const team = registryState.teams.find((x) => x.name === e.target.dataset.team);
    const members = [...(team ? team.members : []), e.target.value];
    await teamSetMembers(e.target.dataset.team, members);
  }
});
panelContent().addEventListener("input", (e) => {
  if (e.target && e.target.id === "skill-search") {
    const value = e.target.value || "";
    skillCatalogState = { ...skillCatalogState, query: value };
    renderSkillsPanel();
    const next = document.getElementById("skill-search");
    if (next) {
      next.focus();
      next.setSelectionRange(value.length, value.length);
    }
    return;
  }
  if (e.target && e.target.id === "agent-search") {
    const value = e.target.value || "";
    agentDirectoryState = { ...agentDirectoryState, query: value };
    renderAgentsPanel();
    const next = document.getElementById("agent-search");
    if (next) {
      next.focus();
      next.setSelectionRange(value.length, value.length);
    }
  }
});
panelContent().addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("active-agent-input")) {
    e.preventDefault();
    sendActiveAgentTerminalInput(e.target.dataset.agent);
  }
});

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
$("#chat-input").addEventListener("input", () => autoResizeTextarea($("#chat-input")));
$("#chat-attach").addEventListener("click", addChatContext);
$("#chat-code").addEventListener("click", insertCodeBlock);
$("#send").addEventListener("click", send);

// Remove context pills
$("#chat-context-pills").addEventListener("click", (e) => {
  const btn = e.target.closest(".chat-context-remove");
  if (btn) removeChatContext(btn.dataset.path);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panelFullscreen) setPanelFullscreen(false);
});

// --- Dictation: 🎤 in the input bar records mic audio, ElevenLabs Scribe
// transcribes it (in main), and the text drops into the chat box for the user
// to review and Send. This is separate from live voice (which is full duplex).
let dictating = false;
let dictRecorder = null;
let dictChunks = [];
let dictStream = null;

function setDictateUI(on) {
  const b = $("#dictate");
  if (!b) return;
  b.textContent = on ? "⏹️" : "🎤";
  b.classList.toggle("bg-red-600", on);
  b.classList.toggle("border-red-500", on);
  b.classList.toggle("bg-neutral-800", !on);
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function startDictation() {
  if (dictating) return;
  try {
    dictStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setVoiceStatus(`Mic unavailable: ${e.message}`);
    return;
  }
  dictChunks = [];
  const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm")) ? "audio/webm" : "";
  dictRecorder = new MediaRecorder(dictStream, mime ? { mimeType: mime } : undefined);
  dictRecorder.ondataavailable = (e) => { if (e.data && e.data.size) dictChunks.push(e.data); };
  dictRecorder.onstop = onDictationStop;
  dictRecorder.start();
  dictating = true;
  setDictateUI(true);
  setVoiceStatus("🎤 Listening… click again to transcribe.");
}

function stopDictation() {
  if (!dictating || !dictRecorder) return;
  dictating = false;
  setDictateUI(false);
  setVoiceStatus("Transcribing…");
  try { dictRecorder.stop(); } catch { /* */ }
}

async function onDictationStop() {
  if (dictStream) { dictStream.getTracks().forEach((t) => t.stop()); dictStream = null; }
  const type = (dictRecorder && dictRecorder.mimeType) || "audio/webm";
  const blob = new Blob(dictChunks, { type });
  dictChunks = [];
  if (!blob.size) { setVoiceStatus("No audio captured."); return; }
  $("#dictate").disabled = true;
  try {
    const base64 = await blobToBase64(blob);
    const r = await window.ceo.voiceListen(base64, type);
    if (!r || !r.ok) { setVoiceStatus(`Dictation failed: ${r ? r.reason : "unknown"}`); return; }
    if (r.cost) renderMeter(r.cost);
    const input = $("#chat-input");
    const text = (r.text || "").trim();
    if (!text) { setVoiceStatus("Didn't catch that — try again."); return; }
    input.value = input.value ? `${input.value} ${text}` : text;
    input.focus();
    setVoiceStatus("");
  } catch (e) {
    setVoiceStatus(`Dictation error: ${e.message}`);
  } finally {
    $("#dictate").disabled = false;
  }
}

$("#dictate").addEventListener("click", () => (dictating ? stopDictation() : startDictation()));

// Dictation button: use Web Speech API in local mode, cloud STT otherwise.
(async () => {
  try {
    const st = await window.ceo.voiceAvailable();
    const b = $("#dictate");
    if (!b) return;
    if (st && st.mode === "local") {
      // Replace dictation with Web Speech API (local, free)
      b.disabled = false;
      b.title = "Dictate (local — Web Speech API)";
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { b.disabled = true; b.title = "Speech recognition not supported"; return; }
      b.addEventListener("click", () => {
        const rec = new SpeechRecognition();
        rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
        b.disabled = true;
        setVoiceStatus("🎙 Listening…");
        rec.onresult = (e) => {
          const text = e.results[0][0].transcript.trim();
          const input = $("#chat-input");
          if (text) input.value = input.value ? `${input.value} ${text}` : text;
          input.focus();
          setVoiceStatus("");
          b.disabled = false;
        };
        rec.onerror = (e) => { setVoiceStatus(`⚠ ${e.error}`); b.disabled = false; };
        rec.onend = () => { b.disabled = false; };
        rec.start();
      }, { once: false });
    } else if (!st || !st.available) {
      b.disabled = true; b.title = "Dictation disabled (no voice configured)";
    }
  } catch { /* voice optional */ }
})();
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
setInterval(() => { refreshEscalations().catch(() => {}); }, 15000);

(async function init() {
  setAgentState("idle");
  setActiveNav(studioView);
  wireAgentSurface();
  renderArchitectureOverview();
  await refreshProjects();
  
  // Listen for CEO-triggered terminal open requests
  if (window.ceo && window.ceo.onTerminalOpenRequest) {
    window.ceo.onTerminalOpenRequest(async ({ agentId }) => {
      console.log("[renderer] CEO requested terminal open for agent:", agentId);
      try {
        // Show the agent inspect panel
        const inspectPanel = $("#panel-inspect");
        const inspectTitle = $("#panel-inspect-title");
        const inspectOutput = $("#panel-inspect-output");
        
        if (inspectPanel && inspectTitle && inspectOutput) {
          inspectPanel.classList.remove("hidden");
          inspectTitle.textContent = `Agent terminal: ${agentId}`;
          inspectOutput.textContent = `Opening terminal for ${agentId}...`;
          
          // Actually open the terminal via IPC
          const result = await window.ceo.terminalOpen({ agentId });
          if (result && result.ok) {
            setVoiceStatus(`Opened terminal for ${agentId}`);
            inspectOutput.textContent = `Terminal opened: ${result.terminalId}\nSession: ${result.session}\nWindow: ${result.window}`;
          } else {
            setVoiceStatus(`Failed to open terminal for ${agentId}: ${result ? result.reason : 'unknown'}`);
            inspectOutput.textContent = `Failed to open terminal: ${result ? result.reason : 'unknown'}`;
          }
        } else {
          setVoiceStatus(`Terminal UI elements not found`);
        }
      } catch (e) {
        console.error("[renderer] Error opening terminal from CEO request:", e);
        setVoiceStatus(`Error opening terminal: ${e.message}`);
      }
    });
  }
})();
