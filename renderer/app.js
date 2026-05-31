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
  const div = document.createElement("div");
  div.className = kind;
  div.textContent = (kind === "user" ? "You: " : kind === "agent" ? "CEO: " : "") + text;
  $("#panel2-stream").appendChild(div);
  $("#panel2-stream").scrollTop = $("#panel2-stream").scrollHeight;
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

function setPanelTitle(text) {
  const title = $("#panel-title");
  if (title) title.textContent = text || "Panel";
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

function renderTaskHtml({ board, task, comments = [], assignees = [], log = "", provenance = null, goalsRes = null, autonomyRes = null }) {
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

async function openTaskInStudio({ board, taskId, taskTitle, taskStatus } = {}) {
  if (!taskId) return;
  focusedTask = { board, taskId, taskTitle, taskStatus };
  setAgentState("thinking");
  setStudioFocus(taskTitle || taskId, `${board || "board"} / ${taskStatus || "task"} / planning focus`, "Planning");
  setPanelTitle("Planning Brief");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading task context...</div>';
  try {
    if (window.ceo.ceoFocusTask) await window.ceo.ceoFocusTask({ ...focusedTask });
    const [r, assigneesRes, logRes, provenanceRes, goalsRes, autonomyRes] = await Promise.all([
      window.ceo.ceoTaskDetail ? window.ceo.ceoTaskDetail(board, taskId) : null,
      window.ceo.ceoAssignees ? safeIpc(() => window.ceo.ceoAssignees(board)) : null,
      window.ceo.ceoTaskLog ? safeIpc(() => window.ceo.ceoTaskLog({ board, taskId })) : null,
      window.ceo.provenanceGraph ? safeIpc(() => window.ceo.provenanceGraph()) : null,
      window.ceo.listGoals ? safeIpc(() => window.ceo.listGoals({ domain: currentDomain })) : null,
      window.ceo.autonomyStatus ? safeIpc(() => window.ceo.autonomyStatus()) : null,
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
      });
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
    const cols = (data && data.ok && data.columns) || {};
    const ordered = ["planning", "triage", "todo", "ready", "running", "blocked", "review", "done"]
      .filter((s) => Object.prototype.hasOwnProperty.call(cols, s))
      .concat(Object.keys(cols).filter((s) => !["planning", "triage", "todo", "ready", "running", "blocked", "review", "done"].includes(s)));
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
    const responsibilities = (domainDef?.responsibilities || []).filter(Boolean);

    panelContent().innerHTML = `<div class="space-y-5">
      <div class="rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.9),rgba(10,10,10,0.95))] p-5">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">${domain && domain !== "All" ? "Domain Planning" : "Project Planning"}</div>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">${esc(domain && domain !== "All" ? domain : currentProject.name)}</h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">${esc(domain && domain !== "All" ? domainPurpose : "Project-wide planning across all domains. Pick a domain when you want its goal, team, and task board.")}</p>
            ${domainGoal ? `<p class="mt-2 max-w-3xl text-sm leading-6 text-cyan-100/80"><span class="text-neutral-500">Goal:</span> ${esc(domainGoal)}</p>` : ""}
            ${responsibilities.length ? `<div class="mt-3 flex flex-wrap gap-2">${responsibilities.slice(0, 5).map((r) => `<span class="rounded-full border border-neutral-800 bg-black/30 px-2 py-1 text-[11px] text-neutral-300">${esc(r)}</span>`).join("")}</div>` : ""}
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
      <div class="flex gap-3 overflow-x-auto pb-2">${lanes}</div>
    </div>`;
  } catch (e) {
    window.ceoUI.showPanel("Domain", `Could not load domain board: ${e.message}`);
  }
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
  $("#provider-note").textContent = res.providerNote
    ? `model: ${res.providerId} — ${res.providerNote}`
    : `model: ${res.providerId}`;
  $("#panel2-stream").innerHTML = "";
  appendStream("sys", `Opened "${res.project.name}". Brain initialized & docs indexed.`);
  renderMeter(await window.ceo.costStatus());
  setAgentState("idle");
  window.CEOConvai?.syncContext?.(`opened project ${res.project.name}`);
}

/** One text turn: prompt -> agent -> reply in the stream. */
async function runTurn(prompt) {
  if (!prompt) return;
  appendStream("user", prompt);
  setAgentState("thinking");

  // Preferred path: the Hermes CEO over AGUI. It streams prose into the chat
  // and can render rich UI into the left panel (#panel1). The CEO owns the
  // brain/soul/kanban — no local project session required.
  if (window.CEOAgui && window.CEOAgui.isReady()) {
    const out = await window.CEOAgui.run(prompt);
    if (!out || !out.ok) {
      appendStream("sys", `⚠ CEO: ${out ? out.reason : "unreachable"}`);
      setAgentState("error");
      return;
    }
    setAgentState("idle");
    return;
  }

  // Fallback: the local Document Agent (requires an open project).
  if (!currentProject) { appendStream("sys", "Open a project first."); setAgentState("idle"); return; }
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

function closeCreateMenu() {
  const menu = $("#create-menu");
  if (menu) menu.classList.add("hidden");
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
          <span class="text-[10px] uppercase tracking-wider text-neutral-600">Responsibilities</span>
          <textarea id="domain-responsibilities" rows="4" placeholder="One per line: planning, intake, UX research, launch readiness..." class="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-cyan-500">${esc((seed.responsibilities || []).join("\n"))}</textarea>
        </label>
      </section>

      <aside class="space-y-3">
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
      <button id="domain-draft-ceo" class="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800">Ask CEO to help define</button>
      <button id="domain-create-cancel" class="rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-900">Cancel</button>
      <span id="domain-create-msg" class="text-xs text-neutral-500"></span>
    </div>
  </div>`;
}

async function saveDomainFromWizard() {
  const msg = $("#domain-create-msg");
  const name = $("#domain-name")?.value.trim();
  if (!name) { if (msg) msg.textContent = "Domain name is required."; return; }
  const purpose = $("#domain-purpose")?.value.trim() || "";
  const overarchingGoal = $("#domain-goal")?.value.trim() || "";
  const responsibilities = splitLines($("#domain-responsibilities")?.value || "");
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
    activeEpics: overarchingGoal ? [overarchingGoal] : [],
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
// teams (registry teams), channels (rooms/DMs), meetings (working session).
let studioView = "domain";
let navMeetingOpts = null;     // cached {agents, teams, personas} for the meetings view
let navMeetingRoom = null;
let navMeetingTimer = null;
const NAV_COL_ORDER = ["planning", "triage", "todo", "ready", "running", "blocked", "scheduled", "review", "done"];

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
  const ordered = NAV_COL_ORDER.filter((c) => present.includes(c)).concat(present.filter((c) => !NAV_COL_ORDER.includes(c)));
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

// --- Registry (agents + teams) — the single source of truth for the Team panel.
let registryState = { agents: [], teams: [], personas: [], providers: [] };

async function loadRegistry() {
  const [reg, per, prov] = await Promise.all([
    window.ceo.registryList ? window.ceo.registryList() : { agents: [], teams: [] },
    window.ceo.registryPersonas ? window.ceo.registryPersonas() : { personas: [] },
    window.ceo.registryProviders ? window.ceo.registryProviders() : { providers: ["echo"] },
  ]);
  registryState = {
    agents: (reg && reg.agents) || [],
    teams: (reg && reg.teams) || [],
    personas: (per && per.personas) || [],
    providers: (prov && prov.providers) || ["echo"],
  };
  return registryState;
}

function agentSubtitle(a) {
  const persona = a.persona ? esc(a.persona) : "no persona";
  const brain = esc(a.provider || "echo") + (a.model ? ` · ${esc(a.model)}` : "");
  return `${persona} · ${brain}`;
}

async function renderTeamsView() {
  setPanelTitle("Team");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading team…</div>';
  await loadRegistry();
  renderTeamPanel();
}

function renderTeamPanel() {
  const { agents, teams } = registryState;
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const roster = agents.length ? agents.map((a) => `
    <button class="team-agent-card text-left rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 hover:border-cyan-500/40 transition" data-agent="${esc(a.id)}">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${a.tmux_session ? "bg-emerald-500" : "bg-neutral-600"}"></span>
        <span class="text-sm font-medium text-neutral-100 truncate">${esc(a.name || a.id)}</span>
        <span class="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">${esc(a.provider || "echo")}</span>
      </div>
      <div class="mt-1.5 text-[11px] text-neutral-500 truncate">${agentSubtitle(a)}</div>
      ${(a.capabilities || []).length ? `<div class="mt-2 flex flex-wrap gap-1">${a.capabilities.slice(0, 3).map((c) => `<span class="text-[9px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">${esc(c)}</span>`).join("")}</div>` : ""}
    </button>`).join("") : navEmpty("No agents yet. Click “New agent” to hire one.");

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
    <div class="space-y-5">
      <div>
        <div class="mb-2 flex items-center gap-2">
          <span class="text-sm font-semibold text-neutral-100">Roster</span>
          <span class="text-[11px] text-neutral-500">${agents.length} agent${agents.length === 1 ? "" : "s"}</span>
          <button id="agent-new" class="ml-auto text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-3 py-1 font-medium transition">+ New agent</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">${roster}</div>
      </div>
      <div>
        <div class="mb-2 flex items-center gap-2">
          <span class="text-sm font-semibold text-neutral-100">Teams</span>
          <span class="text-[11px] text-neutral-500">${teams.length} team${teams.length === 1 ? "" : "s"}</span>
          <button id="team-new" class="ml-auto text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 rounded-md px-3 py-1 font-medium transition">+ New team</button>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${teamCards}</div>
      </div>
    </div>`;
}

// --- Agent create/edit modal (appended to <body> so panel re-renders don't wipe it).
function closeAgentModal() {
  const m = document.getElementById("agent-modal");
  if (m) m.remove();
}

function openAgentModal(agentId) {
  closeAgentModal();
  const editing = agentId ? registryState.agents.find((a) => a.id === agentId) : null;
  const personas = registryState.personas || [];
  const providers = registryState.providers || ["echo"];
  const personaOpts = `<option value="">— none —</option>` +
    personas.map((p) => `<option value="${esc(p.id)}" ${editing && editing.persona === p.id ? "selected" : ""}>${esc(p.name || p.id)}</option>`).join("");
  const providerOpts = providers.map((p) => `<option value="${esc(p)}" ${editing && editing.provider === p ? "selected" : ""}>${esc(p)}</option>`).join("");
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
        <label class="flex-1 text-xs text-neutral-400">Model (optional)
          <input id="am-model" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100" value="${editing && editing.model ? esc(editing.model) : ""}" placeholder="e.g. grok-build" />
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
  provSel.addEventListener("change", syncCmdRow);
  syncCmdRow();
  document.getElementById("am-save").addEventListener("click", () => saveAgentModal(editing ? editing.id : null));
  const del = document.getElementById("am-delete");
  if (del) del.addEventListener("click", () => deleteAgentFromModal(editing.id));
}

async function saveAgentModal(existingId) {
  const msg = document.getElementById("am-msg");
  const val = (id) => (document.getElementById(id) && document.getElementById(id).value) || "";
  const spec = {
    name: val("am-name").trim(),
    provider: val("am-provider") || "echo",
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
    renderTeamPanel();
  }
}

async function deleteAgentFromModal(id) {
  if (!confirm(`Delete agent "${id}"? This also removes it from any team.`)) return;
  const r = await window.ceo.registryDeleteAgent(id);
  if (r && r.ok) { closeAgentModal(); closeAgentSurface(); await loadRegistry(); renderTeamPanel(); }
}

async function teamSetMembers(name, members) {
  const r = await window.ceo.registrySaveTeam(name, members);
  if (r && r.ok) { await loadRegistry(); renderTeamPanel(); }
  return r;
}

// --- Agent detail (left panel) + live terminal/logs surface (right panel) ---
let selectedAgentId = null;
let selectedAgentRoom = "discovery";
let agentSurfaceTab = "terminal";
let agentTermTimer = null;

function detailRow(label, valueHtml) {
  return `<div class="rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
    <div class="text-[10px] uppercase tracking-wider text-neutral-600">${label}</div>
    <div class="mt-0.5 text-neutral-300 break-all">${valueHtml}</div>
  </div>`;
}

async function openAgentDetail(id) {
  const a = registryState.agents.find((x) => x.id === id);
  if (!a) return;
  selectedAgentId = id;
  await renderAgentDetail(a);
  showAgentSurface(a);
}

async function renderAgentDetail(a) {
  setPanelTitle(a.name || a.id);
  let mounted = false;
  if (a.tmux_session) {
    try { const live = await window.ceo.registryAlive(a.id); mounted = !!(live && live.alive); } catch { mounted = false; }
  }
  const brain = esc(a.provider || "echo") + (a.model ? " · " + esc(a.model) : "");
  panelContent().innerHTML = `
    <div class="space-y-4 max-w-2xl">
      <button id="agent-back" class="text-xs text-neutral-400 hover:text-neutral-200">← Back to team</button>
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${mounted ? "bg-emerald-500" : "bg-neutral-600"}"></span>
          <span class="text-base font-semibold text-neutral-100">${esc(a.name || a.id)}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">${esc(a.provider || "echo")}</span>
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
        <p class="text-[11px] text-neutral-600">Mounting starts the agent's CLI + a room watcher (its A2A presence). Watch it live in the right panel →</p>
      </div>
    </div>`;
}

function showAgentSurface(a) {
  const surf = document.getElementById("agent-surface");
  if (!surf) return;
  // Inline style wins over Tailwind's class ordering so the toggle is deterministic.
  surf.classList.remove("hidden");
  surf.style.display = "flex";
  const name = document.getElementById("as-name");
  const sub = document.getElementById("as-sub");
  if (name) name.textContent = a.name || a.id;
  if (sub) sub.textContent = agentSubtitle(a);
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
  pollAgentSurface();
  if (agentTermTimer) clearInterval(agentTermTimer);
  agentTermTimer = setInterval(pollAgentSurface, tab === "terminal" ? 1500 : 3000);
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
      out.textContent = "Send a message below to talk to this agent — it posts into the agent's A2A room and the transcript appears here.\n\nNote: agents on the \"echo\" brain only show presence; convene a meeting to get a real response.";
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
  try { r = await window.ceo.registryMount(selectedAgentId); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (r && r.room) selectedAgentRoom = r.room;
  if (!r || !r.ok) { if (msg) msg.textContent = "mount failed: " + (r ? r.reason : "unknown"); return; }
  await loadRegistry();
  const a = registryState.agents.find((x) => x.id === selectedAgentId);
  if (a) { await renderAgentDetail(a); pollAgentSurface(); }
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
  // Talk to the agent by posting into its A2A room (the real channel), not by
  // typing into a watcher pane. Then show the room transcript in Logs.
  const r = await window.ceo.registryMessage(selectedAgentId, text, "CEO");
  if (r && r.room) selectedAgentRoom = r.room;
  setAgentSurfaceTab("logs");
  setTimeout(pollAgentSurface, 400);
}

// Agent surface buttons live in panel2 (outside the left panelContent that the rest of
// the UI delegates on). Delegate on document so they stay live regardless of re-renders
// or attach timing — the ✕ must ALWAYS close the panel.
function wireAgentSurface() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#as-close")) { closeAgentSurface(); renderTeamPanel(); return; }
    if (e.target.closest("#as-tab-terminal")) { setAgentSurfaceTab("terminal"); return; }
    if (e.target.closest("#as-tab-logs")) { setAgentSurfaceTab("logs"); return; }
    if (e.target.closest("#as-send")) { sendAgentKeys(); return; }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.id === "as-input") { sendAgentKeys(); return; }
    if (e.key === "Escape" && selectedAgentId) {
      const surf = document.getElementById("agent-surface");
      if (surf && !surf.classList.contains("hidden")) { closeAgentSurface(); renderTeamPanel(); }
    }
  });
}

async function renderChannelsView() {
  setPanelTitle("Channels");
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading channels…</div>';
  await loadRegistry();
  const teams = registryState.teams;
  const agents = registryState.agents;
  const groupRooms = teams.map((t) => `
    <button class="channel-item w-full text-left flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800/70 transition" data-channel="team:${esc(t.name)}">
      <span class="text-neutral-500">#</span><span>${esc(t.name)}</span>
      <span class="ml-auto text-[10px] text-neutral-600">${(t.members || []).length} agents</span>
    </button>`).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No team channels yet.</div>';
  const dms = agents.map((a) => `
    <button class="channel-item w-full text-left flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800/70 transition" data-channel="dm:${esc(a.id)}">
      <span class="text-neutral-500">◌</span><span>${esc(a.name || a.id)}</span>
      <span class="ml-auto text-[10px] text-neutral-600">${esc(a.provider || "echo")}</span>
    </button>`).join("") || '<div class="px-3 py-2 text-xs text-neutral-600">No agents in registry.</div>';
  panelContent().innerHTML = `
    <div class="space-y-4 max-w-2xl">
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Group channels</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${groupRooms}</div>
      </div>
      <div>
        <div class="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Direct messages</div>
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-1">${dms}</div>
      </div>
      <div class="px-1 text-[11px] text-neutral-600">Channels will open a live room in the chat panel on the right. (Room wiring is the next step.)</div>
    </div>`;
}

function stopNavMeetingPoll() { if (navMeetingTimer) { clearInterval(navMeetingTimer); navMeetingTimer = null; } }

async function renderMeetingsView() {
  setPanelTitle("Meetings");
  stopNavMeetingPoll();
  panelContent().innerHTML = '<div class="text-neutral-500 text-sm">Loading session setup…</div>';
  await loadRegistry();
  navMeetingOpts = { agents: registryState.agents, teams: registryState.teams };
  const teams = navMeetingOpts.teams;
  const agents = navMeetingOpts.agents;
  const teamOpts = `<option value="">— pick a team —</option>` +
    teams.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${(t.members || []).length})</option>`).join("");
  const agentChecks = agents.map((a) => `
    <label class="flex items-center gap-2 text-xs text-neutral-300">
      <input type="checkbox" class="nav-mtg-member accent-cyan-500" value="${esc(a.id)}" />
      <span class="text-neutral-200">${esc(a.name || a.id)}</span>
      <span class="text-[10px] text-neutral-500">${esc(a.provider || "echo")}${a.persona ? " · " + esc(a.persona) : ""}</span>
    </label>`).join("") || '<div class="text-[11px] text-neutral-600">No agents in registry.</div>';
  panelContent().innerHTML = `
    <div class="space-y-4 max-w-3xl">
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div class="text-sm font-semibold text-neutral-100">Working session</div>
        <p class="text-[12px] leading-5 text-neutral-500">A meeting is a group room: a team works an agenda toward a goal and produces a written result. Pick a team (or members), give it a goal, and start.</p>
        <label class="block text-xs text-neutral-400">Goal / agenda
          <textarea id="nav-mtg-agenda" rows="2" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" placeholder="What should the team work out?"></textarea>
        </label>
        <label class="block text-xs text-neutral-400">Good outcome (optional)
          <input id="nav-mtg-criteria" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" placeholder="What a good result looks like" />
        </label>
        <label class="block text-xs text-neutral-400">Team
          <select id="nav-mtg-team" class="mt-1 w-full bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/50">${teamOpts}</select>
        </label>
        <div class="text-xs text-neutral-400">Or pick members
          <div class="mt-1 max-h-[160px] overflow-auto rounded-md border border-neutral-800 bg-neutral-950/40 p-2 space-y-1">${agentChecks}</div>
        </div>
        <label class="flex items-center gap-2 text-xs text-amber-300/90">
          <input id="nav-mtg-paid" type="checkbox" class="accent-amber-500" /> Use real agents (devin/grok) — costs credits
        </label>
        <div class="flex items-center gap-2">
          <button id="nav-mtg-start" class="text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-4 py-1.5 font-medium transition">Start session</button>
          <span id="nav-mtg-msg" class="text-xs text-neutral-500"></span>
        </div>
      </div>
      <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
        <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-neutral-500">
          <span>Transcript</span><span id="nav-mtg-room" class="font-mono text-neutral-400 normal-case"></span><span id="nav-mtg-state" class="ml-auto normal-case"></span>
        </div>
        <div id="nav-mtg-transcript" class="mt-2 space-y-2 text-sm"><div class="text-neutral-600">No session yet.</div></div>
        <div id="nav-mtg-req" class="hidden mt-3 border-t border-neutral-800/60 pt-3">
          <div class="text-[11px] uppercase tracking-wider text-emerald-400/80 mb-1">Result</div>
          <div id="nav-mtg-req-body" class="prose prose-invert prose-sm max-w-none text-neutral-200"></div>
        </div>
      </div>
    </div>`;
}

async function startNavMeeting() {
  const msg = $("#nav-mtg-msg");
  const agenda = ($("#nav-mtg-agenda") && $("#nav-mtg-agenda").value || "").trim();
  const criteria = ($("#nav-mtg-criteria") && $("#nav-mtg-criteria").value || "").trim();
  const team = ($("#nav-mtg-team") && $("#nav-mtg-team").value) || "";
  const members = Array.from(document.querySelectorAll(".nav-mtg-member:checked")).map((c) => c.value).join(",");
  const allowPaid = !!($("#nav-mtg-paid") && $("#nav-mtg-paid").checked);
  if (!agenda) { if (msg) msg.textContent = "goal required"; return; }
  if (!team && !members) { if (msg) msg.textContent = "pick a team or members"; return; }
  if (msg) msg.textContent = "starting…";
  const info = { room: `session-${Date.now()}`, agenda, criteria, allowPaid };
  if (team) info.team = team; else info.members = members;
  let r = {};
  try { r = await window.ceo.meetingStart(info); } catch (e) { r = { ok: false, reason: String(e) }; }
  if (!r || !r.ok) { if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`; return; }
  if (msg) msg.textContent = "running — watch below";
  navMeetingRoom = r.room;
  const lbl = $("#nav-mtg-room"); if (lbl) lbl.textContent = r.room;
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
    host.innerHTML = feed.length ? feed.map((it) => {
      const isFac = /facilitator|orchestrator/i.test(it.speaker);
      return `<div class="rounded-lg border ${isFac ? "border-cyan-500/30 bg-cyan-950/10" : "border-neutral-800 bg-neutral-900/50"} p-2.5">
        <div class="text-[11px] font-medium ${isFac ? "text-cyan-300" : "text-neutral-300"}">${esc(it.speaker)}</div>
        <div class="mt-1 whitespace-pre-wrap text-[12px] text-neutral-300">${esc(it.body)}</div>
      </div>`;
    }).join("") : `<div class="text-neutral-600">Waiting for the session to begin…</div>`;
  }
  const state = $("#nav-mtg-state");
  if (state) state.innerHTML = r.running ? `<span class="text-amber-300">● running</span>` : `<span class="text-emerald-400">✓ complete</span>`;
  const reqWrap = $("#nav-mtg-req"), reqBody = $("#nav-mtg-req-body");
  if (reqWrap && reqBody) {
    if (r.requirements) { reqWrap.classList.remove("hidden"); reqBody.innerHTML = window.marked ? window.marked.parse(r.requirements) : esc(r.requirements); }
    else reqWrap.classList.add("hidden");
  }
  if (!r.running) stopNavMeetingPoll();
}

async function openView(view) {
  studioView = view || "domain";
  setActiveNav(studioView);
  if (studioView !== "meetings") stopNavMeetingPoll();
  closeAgentSurface();
  switch (studioView) {
    case "board": return renderBoardView();
    case "tasks": return renderTasksView();
    case "teams": return renderTeamsView();
    case "channels": return renderChannelsView();
    case "meetings": return renderMeetingsView();
    case "domain":
    default: return renderStudioBoard(currentDomain);
  }
}

window.ceoUI = {
  appendStream, setAgentState, setVoiceStatus, renderMeter,
  hasProject: () => !!currentProject,
  getContext: () => ({
    project: currentProject ? { id: currentProject.id, name: currentProject.name, slug: currentProject.slug } : null,
    domain: currentDomain,
    selectedFile: selectedFile ? { path: selectedFile.path, preview: selectedFile.text.slice(0, 4000) } : null,
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
  // Voice agent render control: drive the left nav and the Team panel.
  openView: (view) => openView(view),
  async openAgentDetail(idOrName) {
    await loadRegistry();
    const a = registryState.agents.find((x) => x.id === idOrName || x.name === idOrName);
    if (!a) return false;
    studioView = "teams";
    setActiveNav("teams");
    await openAgentDetail(a.id);
    return true;
  },
  refreshTeam() { if (studioView === "teams") renderTeamPanel(); },
};

// --- wiring ---
$("#create-menu-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#create-menu").classList.toggle("hidden");
});
$("#create-project").addEventListener("click", createProject);
$("#create-domain").addEventListener("click", createDomain);
$("#create-task").addEventListener("click", () => createTask());
document.addEventListener("click", (e) => {
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
  const add = e.target.closest("#studio-add-task");
  if (add) {
    await createTask(add.dataset.board);
    return;
  }
  const domainSave = e.target.closest("#domain-create-save");
  if (domainSave) {
    await saveDomainFromWizard();
    return;
  }
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
      "Ask me only for missing essentials, then call define_domain with purpose, overarchingGoal, responsibilities, kanbanBoard, relativePath, and coreAgents.",
    ].join("\n");
    await runTurn(context);
    return;
  }
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
// Meetings + Team panel controls (delegated, since panels re-render on open).
panelContent().addEventListener("click", async (e) => {
  if (e.target.closest("#nav-mtg-start")) { startNavMeeting(); return; }
  // Team panel: roster + team management
  if (e.target.closest("#agent-new")) { openAgentModal(null); return; }
  const card = e.target.closest(".team-agent-card");
  if (card) { openAgentDetail(card.dataset.agent); return; }
  // Agent detail view buttons
  if (e.target.closest("#agent-back")) { closeAgentSurface(); renderTeamPanel(); return; }
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
    if (r && r.ok) { await loadRegistry(); renderTeamPanel(); }
    return;
  }
  if (e.target.closest("#team-new")) {
    const name = prompt("New team name:");
    if (name && name.trim()) await teamSetMembers(name.trim(), []);
    return;
  }
});
panelContent().addEventListener("change", async (e) => {
  if (e.target && e.target.id === "nav-mtg-team") {
    const t = ((navMeetingOpts && navMeetingOpts.teams) || []).find((x) => x.name === e.target.value);
    const ids = new Set((t && t.members) || []);
    document.querySelectorAll(".nav-mtg-member").forEach((c) => { c.checked = ids.has(c.value); });
    return;
  }
  if (e.target && e.target.classList && e.target.classList.contains("team-add") && e.target.value) {
    const team = registryState.teams.find((x) => x.name === e.target.dataset.team);
    const members = [...(team ? team.members : []), e.target.value];
    await teamSetMembers(e.target.dataset.team, members);
  }
});

$("#send").addEventListener("click", send);
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
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

// Disable dictation if voice (ElevenLabs key) isn't configured.
(async () => {
  try {
    const st = await window.ceo.voiceAvailable();
    if (!st || !st.available) {
      const b = $("#dictate");
      if (b) { b.disabled = true; b.title = "Dictation disabled (no ELEVENLABS_API_KEY)"; }
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

(async function init() {
  setAgentState("idle");
  setActiveNav(studioView);
  wireAgentSurface();
  renderArchitectureOverview();
  await refreshProjects();
})();
