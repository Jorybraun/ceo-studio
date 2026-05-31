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

function renderTaskHtml({ board, task, comments = [], assignees = [], log = "" }) {
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
    const [r, assigneesRes, logRes] = await Promise.all([
      window.ceo.ceoTaskDetail ? window.ceo.ceoTaskDetail(board, taskId) : null,
      window.ceo.ceoAssignees ? window.ceo.ceoAssignees(board) : null,
      window.ceo.ceoTaskLog ? window.ceo.ceoTaskLog({ board, taskId }) : null,
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
  },
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
  await refreshProjects();
})();
