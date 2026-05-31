"use strict";
/*
 * CEO Dashboard — a live cockpit view of the Hermes CEO daemon:
 *   - Kanban board (tasks by status) for the selected board
 *   - Swarm (active workers, with liveness)
 *   - Room (the swarm's live activity feed: task events + comments)
 *   - CEO status pill (is the Hermes gateway up)
 *
 * All data comes from the main process via window.ceo.* (Hermes bridge),
 * which reads the durable SQLite boards directly — so this works even when
 * Hermes' LLM provider is out of credits.
 */
(function () {
  const ceo = window.ceo || {};
  const $ = (id) => document.getElementById(id);

  let board = null;           // current board slug
  let open = false;
  let refreshTimer = null;
  let statusTimer = null;
  let currentTab = "kanban";  // current tab: kanban, agents, config
  let agents = [];            // cached agent list
  let agentFilter = "all";    // current agent filter
  let selectedAgentId = null;

  // Preferred left-to-right column order; unknown statuses are appended.
  const COL_ORDER = ["planning", "triage", "todo", "ready", "running", "blocked", "scheduled", "review", "done"];
  const COL_ACCENT = {
    running: "border-emerald-500/40", ready: "border-sky-500/40",
    blocked: "border-red-500/40", todo: "border-neutral-600",
    done: "border-neutral-700", review: "border-amber-500/40",
    scheduled: "border-violet-500/40", triage: "border-pink-500/40",
    planning: "border-cyan-500/40",
  };
  const DOT = {
    running: "bg-emerald-500", ready: "bg-sky-500", blocked: "bg-red-500",
    done: "bg-neutral-500", review: "bg-amber-500", scheduled: "bg-violet-500",
    todo: "bg-neutral-500", triage: "bg-pink-500", planning: "bg-cyan-500",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function ago(sec) {
    if (!sec) return "";
    const d = Math.max(0, Math.floor(Date.now() / 1000 - sec));
    if (d < 60) return d + "s";
    if (d < 3600) return Math.floor(d / 60) + "m";
    if (d < 86400) return Math.floor(d / 3600) + "h";
    return Math.floor(d / 86400) + "d";
  }

  // --- CEO status pill (runs always, not just when dashboard is open) ---
  async function refreshStatus() {
    if (!ceo.ceoStatus) return;
    let s = {};
    try { s = await ceo.ceoStatus(); } catch { s = {}; }
    const up = s && s.up;
    const label = !s || !s.installed ? "CEO n/a" : up ? "CEO online" : "CEO offline";
    const dotCls = !s || !s.installed ? "bg-neutral-600" : up ? "bg-emerald-500" : "bg-red-500";
    const setPill = (dotId, labelId) => {
      const dot = $(dotId), lab = $(labelId);
      if (dot) dot.className = "w-2 h-2 rounded-full " + dotCls + (up ? " shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]" : "");
      if (lab) lab.textContent = label;
    };
    setPill("ceo-dot", "ceo-label");
    setPill("dash-ceo-dot", "dash-ceo-label");
  }

  // --- Board selector ---
  async function loadBoards() {
    if (!ceo.ceoBoardsForDomain) return;
    
    // Get current domain from the global app state if available
    const domainSwitcher = document.getElementById("domain-switcher");
    const currentDomain = domainSwitcher ? domainSwitcher.value : "All";
    
    let res = {};
    try { res = await ceo.ceoBoardsForDomain(currentDomain); } catch { res = {}; }
    const boards = (res && res.boards) || [];
    if (!board || !boards.some((b) => b.slug === board)) {
      board = (boards[0] && boards[0].slug) || (res && res.current) || null;
    }
    const sel = $("dash-board");
    if (sel) {
      sel.innerHTML = boards.map((b) =>
        `<option value="${esc(b.slug)}" ${b.slug === board ? "selected" : ""}>${esc(b.name || b.slug)}</option>`).join("");
    }
    
    // Update domain context display
    const ctxEl = $("dash-domain-context");
    if (ctxEl) {
      if (currentDomain === "All") {
        ctxEl.textContent = "All domains";
      } else {
        const boardCount = boards.length;
        ctxEl.textContent = `${currentDomain} (${boardCount} board${boardCount !== 1 ? 's' : ''})`;
      }
    }
  }

  // --- Agent Registry ---
  async function loadAgents() {
    if (!ceo.listAgents) return;
    let res = {};
    try { res = await ceo.listAgents(); } catch { res = {}; }
    agents = (res && res.agents) || [];
    
    // Also load personas and skills for display
    let personasRes = {}, skillsRes = {};
    try { personasRes = await ceo.listPersonas(); } catch { personasRes = {}; }
    try { skillsRes = await ceo.listSkills(); } catch { skillsRes = {}; }
    
    const personas = (personasRes && personasRes.personas) || [];
    const skills = (skillsRes && skillsRes.skills) || [];
    
    renderAgents(personas, skills);
  }

  function getStatusColor(status) {
    switch (status) {
      case "online": return "bg-emerald-500";
      case "available": return "bg-sky-500";
      case "external": return "bg-amber-500";
      case "offline": return "bg-red-500";
      default: return "bg-neutral-500";
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case "online": return `<span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">Online</span>`;
      case "available": return `<span class="text-[10px] bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded">Available</span>`;
      case "external": return `<span class="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">External</span>`;
      case "offline": return `<span class="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Offline</span>`;
      default: return `<span class="text-[10px] bg-neutral-500/20 text-neutral-400 px-1.5 py-0.5 rounded">${esc(status)}</span>`;
    }
  }

  function getTypeBadge(type) {
    switch (type) {
      case "hermes": return `<span class="text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded">Hermes</span>`;
      case "devin": return `<span class="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Devin</span>`;
      case "harness": return `<span class="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">Harness</span>`;
      default: return `<span class="text-[10px] bg-neutral-500/20 text-neutral-400 px-1.5 py-0.5 rounded">${esc(type)}</span>`;
    }
  }

  function renderAgentSession(agent, personas = []) {
    if (!agent) {
      return `<div class="mb-4 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 text-sm text-neutral-500">
        Pick an agent to inspect its profile, runtime, and terminal.
      </div>`;
    }
    const terminal = agent.terminal || {};
    const target = terminal.session ? `${terminal.session}:${terminal.window || "main"}` : "not bound";
    const alive = terminal.alive ? "live" : terminal.available ? "stopped" : "no terminal";
    const currentPersona = (agent.personas || [])[0] || "";
    const personaOptions = personas.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === currentPersona ? "selected" : ""}>${esc(p.name || p.id)}</option>`).join("");
    return `<div class="mb-4 overflow-hidden rounded-2xl border border-cyan-500/25 bg-[linear-gradient(135deg,rgba(8,47,73,0.32),rgba(10,10,10,0.92))]">
      <div class="flex flex-wrap items-center gap-3 border-b border-neutral-800/80 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-neutral-100">${esc(agent.display_name)}</div>
          <div class="mt-0.5 truncate text-xs text-neutral-500">${esc(agent.role || agent.mission || "")}</div>
        </div>
        <span class="rounded-full border border-neutral-700 bg-neutral-900/80 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">${esc(agent.type)}</span>
        <span class="rounded-full border ${terminal.alive ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/30 text-amber-300"} bg-neutral-950/70 px-2 py-0.5 text-[10px] uppercase tracking-wider">${alive}</span>
        <button id="agent-terminal-refresh" class="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800">Refresh terminal</button>
      </div>
      <div class="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div class="space-y-2 text-xs">
          <div class="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-600">Runtime</div>
            <div class="mt-2 font-mono text-neutral-300">${esc(target)}</div>
            <div class="mt-1 text-neutral-600">${esc(agent.launch_mode || "")}${agent.profile ? ` / ${esc(agent.profile)}` : ""}</div>
          </div>
          <div class="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
            <div class="text-[10px] uppercase tracking-wider text-neutral-600">Persona</div>
            <select id="agent-persona-select" ${agent.type !== "harness" ? "disabled" : ""} class="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100">
              ${personaOptions || `<option value="">No personas found</option>`}
            </select>
            <div class="mt-2 flex gap-2">
              <button id="agent-persona-save" ${agent.type !== "harness" ? "disabled" : ""} class="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">Save</button>
              <button id="agent-persona-new" ${agent.type !== "harness" ? "disabled" : ""} class="flex-1 rounded-md border border-cyan-700/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-40">New persona</button>
            </div>
            <div id="agent-persona-msg" class="mt-2 min-h-4 text-[10px] text-neutral-500">${agent.type === "harness" ? "Saved personas update the harness registry." : "This agent is not registry-editable yet."}</div>
          </div>
        </div>
        <div class="min-w-0">
          <pre id="agent-terminal-output" class="h-[360px] overflow-auto rounded-xl border border-neutral-800 bg-black/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/85">${terminal.available ? "Loading terminal..." : "This agent is not backed by a tmux session yet."}</pre>
          <div class="mt-2 flex gap-2">
            <input id="agent-terminal-input" class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/60" placeholder="Send text to this agent terminal..." />
            <button id="agent-terminal-send" class="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500">Send</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function refreshSelectedAgentTerminal() {
    const output = $("agent-terminal-output");
    if (!output || !selectedAgentId || !ceo.agentTerminalSnapshot) return;
    const r = await ceo.agentTerminalSnapshot(selectedAgentId);
    output.textContent = r && r.ok ? (r.output || "(empty)") : `Terminal unavailable: ${r ? r.reason : "unknown"}`;
    output.scrollTop = output.scrollHeight;
  }

  async function sendSelectedAgentTerminal() {
    const input = $("agent-terminal-input");
    if (!input || !selectedAgentId || !ceo.agentTerminalSend) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    const r = await ceo.agentTerminalSend(selectedAgentId, text);
    if (!r || !r.ok) {
      const output = $("agent-terminal-output");
      if (output) output.textContent += `\n\n[send failed] ${r ? r.reason : "unknown"}`;
      return;
    }
    setTimeout(refreshSelectedAgentTerminal, 300);
  }

  async function saveSelectedAgentPersona() {
    const select = $("agent-persona-select");
    const msg = $("agent-persona-msg");
    if (!select || !selectedAgentId || !ceo.agentSetPersona) return;
    if (msg) msg.textContent = "saving...";
    const r = await ceo.agentSetPersona(selectedAgentId, select.value);
    if (!r || !r.ok) {
      if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`;
      return;
    }
    if (msg) msg.textContent = "saved";
    await loadAgents();
  }

  async function createPersonaForSelectedAgent() {
    const name = prompt("New persona name:");
    if (!name || !name.trim()) return;
    const brief = prompt("Persona mission / operating brief:", "") || "";
    const msg = $("agent-persona-msg");
    if (msg) msg.textContent = "creating persona...";
    const r = ceo.createPersona ? await ceo.createPersona({ name: name.trim(), brief }) : null;
    if (!r || !r.ok) {
      if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`;
      return;
    }
    if (selectedAgentId && ceo.agentSetPersona) await ceo.agentSetPersona(selectedAgentId, r.persona.id);
    if (msg) msg.textContent = `created ${r.persona.id}`;
    await loadAgents();
  }

  function renderAgents(personas = [], skills = []) {
    const host = $("dash-agents");
    if (!host) return;
    
    // Filter agents based on current filter
    const filteredAgents = agentFilter === "all" 
      ? agents 
      : agents.filter(a => a.type === agentFilter);
    
    // Update count
    const countEl = $("agents-count");
    if (countEl) {
      const onlineCount = agents.filter(a => a.status === "online" || a.status === "available").length;
      countEl.textContent = `${agents.length} agents • ${onlineCount} online`;
    }
    
    if (!filteredAgents.length) {
      host.innerHTML = `<div class="text-neutral-600 text-sm p-4">No agents found for this filter.</div>`;
      return;
    }
    
    // Create persona and skill lookup maps
    const personaMap = new Map(personas.map(p => [p.id, p]));
    const skillMap = new Map(skills.map(s => [s.id, s]));
    if (!selectedAgentId || !filteredAgents.some((a) => a.id === selectedAgentId)) {
      selectedAgentId = filteredAgents[0]?.id || null;
    }
    const selectedAgent = filteredAgents.find((a) => a.id === selectedAgentId) || null;
    
    host.innerHTML = `${renderAgentSession(selectedAgent, personas)}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${filteredAgents.map(agent => {
        const statusColor = getStatusColor(agent.status);
        const selected = agent.id === selectedAgentId;
        
        // Get persona names
        const personaNames = (agent.personas || []).map(pId => {
          const persona = personaMap.get(pId);
          return persona ? persona.name : pId;
        });
        
        // Get skill names
        const skillNames = (agent.skills || []).map(sId => {
          const skill = skillMap.get(sId);
          return skill ? skill.name : sId;
        });
        
        return `<div class="agent-card cursor-pointer rounded-xl border ${selected ? "border-cyan-500/60 bg-cyan-950/20" : "border-neutral-800 bg-neutral-900/50"} p-4 hover:border-cyan-500/40 transition" data-agent-id="${esc(agent.id)}">
          <div class="flex items-start gap-3">
            <div class="w-3 h-3 rounded-full ${statusColor} mt-1"></div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-medium text-neutral-100">${esc(agent.display_name)}</span>
                ${getTypeBadge(agent.type)}
              </div>
              <div class="text-xs text-neutral-400 mb-2">${esc(agent.role)}</div>
              <div class="flex items-center gap-2 mb-3">
                ${getStatusBadge(agent.status)}
                ${agent.room ? `<span class="text-[10px] text-neutral-500">🏠 ${esc(agent.room)}</span>` : ""}
              </div>
              <div class="text-[11px] text-neutral-500 mb-3 line-clamp-2">${esc(agent.mission)}</div>
              
              <!-- Personas -->
              ${personaNames.length > 0 ? `
                <div class="mb-3">
                  <div class="text-[9px] text-neutral-600 mb-1">Personas:</div>
                  <div class="flex flex-wrap gap-1">
                    ${personaNames.slice(0, 2).map(name => 
                      `<span class="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">${esc(name)}</span>`
                    ).join("")}
                    ${personaNames.length > 2 ? `<span class="text-[9px] text-neutral-600">+${personaNames.length - 2}</span>` : ""}
                  </div>
                </div>
              ` : ""}
              
              <!-- Skills -->
              ${skillNames.length > 0 ? `
                <div class="mb-3">
                  <div class="text-[9px] text-neutral-600 mb-1">Skills:</div>
                  <div class="flex flex-wrap gap-1">
                    ${skillNames.slice(0, 3).map(name => 
                      `<span class="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded">${esc(name)}</span>`
                    ).join("")}
                    ${skillNames.length > 3 ? `<span class="text-[9px] text-neutral-600">+${skillNames.length - 3}</span>` : ""}
                  </div>
                </div>
              ` : ""}
              
              <!-- Capabilities -->
              <div class="flex flex-wrap gap-1 mb-3">
                ${(agent.capabilities || []).slice(0, 3).map(cap => 
                  `<span class="text-[9px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">${esc(cap)}</span>`
                ).join("")}
                ${(agent.capabilities || []).length > 3 ? `<span class="text-[9px] text-neutral-600">+${agent.capabilities.length - 3}</span>` : ""}
              </div>
              
              ${agent.api_cost ? `<div class="text-[9px] text-neutral-600 mb-3">💰 ${esc(agent.api_cost)}</div>` : ""}
              <div class="flex gap-2">
                <button class="agent-inspect flex-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded px-2 py-1 transition" data-agent-id="${esc(agent.id)}">Inspect</button>
                ${agent.enabled ? `<button class="flex-1 text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded px-2 py-1 transition">Active</button>` : `<button class="flex-1 text-[10px] bg-neutral-800 text-neutral-500 rounded px-2 py-1">Disabled</button>`}
              </div>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
    setTimeout(refreshSelectedAgentTerminal, 0);
  }

  function selectAgent(agentId) {
    selectedAgentId = agentId;
    renderAgents();
  }

  function switchTab(tabName) {
    currentTab = tabName;
    
    // Update tab button styles
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.classList.remove("bg-neutral-700", "text-neutral-100");
      btn.classList.add("text-neutral-400");
    });
    const activeBtn = $(`tab-${tabName}`);
    if (activeBtn) {
      activeBtn.classList.add("bg-neutral-700", "text-neutral-100");
      activeBtn.classList.remove("text-neutral-400");
    }
    
    // Show/hide sections
    ["section-kanban", "section-agents", "section-config", "section-meetings"].forEach((s) => {
      const el = $(s); if (el) el.classList.add("hidden");
    });
    const sec = $(`section-${tabName}`); if (sec) sec.classList.remove("hidden");
    
    // Show/hide control bars
    $("kanban-controls").classList.add("hidden");
    $("agents-controls").classList.add("hidden");
    if (tabName === "kanban") $("kanban-controls").classList.remove("hidden");
    if (tabName === "agents") $("agents-controls").classList.remove("hidden");
    
    // Load data for the tab
    if (tabName === "agents") loadAgents();
    if (tabName === "meetings") loadMeetings(); else stopMeetingPoll();
  }

  // --- Meetings tab ---
  let meetingOpts = null;       // {agents, teams, personas}
  let meetingPollTimer = null;
  let activeMeetingRoom = null;

  function stopMeetingPoll() {
    if (meetingPollTimer) { clearInterval(meetingPollTimer); meetingPollTimer = null; }
  }

  async function loadMeetings() {
    if (!ceo.meetingOptions) return;
    if (!meetingOpts) {
      try { meetingOpts = await ceo.meetingOptions(); } catch { meetingOpts = { agents: [], teams: [] }; }
    }
    const teamSel = $("mtg-team");
    if (teamSel) {
      teamSel.innerHTML = `<option value="">— none (pick members) —</option>` +
        (meetingOpts.teams || []).map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${(t.members || []).length})</option>`).join("");
    }
    renderMeetingMembers();
  }

  function renderMeetingMembers(selectedIds) {
    const host = $("mtg-members");
    if (!host) return;
    const agents = (meetingOpts && meetingOpts.agents) || [];
    if (!agents.length) {
      host.innerHTML = `<div class="text-[11px] text-neutral-600">No agents in registry (agents.json).</div>`;
      return;
    }
    const sel = new Set(selectedIds || []);
    host.innerHTML = agents.map((a) => `
      <label class="flex items-center gap-2 text-xs text-neutral-300">
        <input type="checkbox" class="mtg-member accent-cyan-500" value="${esc(a.id)}" ${sel.has(a.id) ? "checked" : ""} />
        <span class="font-medium text-neutral-200">${esc(a.id)}</span>
        <span class="text-[10px] text-neutral-500">${esc(a.provider || "echo")}${a.persona ? " · " + esc(a.persona) : ""}</span>
      </label>`).join("");
  }

  function selectedMemberIds() {
    return Array.from(document.querySelectorAll(".mtg-member:checked")).map((c) => c.value);
  }

  async function startMeeting() {
    const msg = $("mtg-msg");
    const room = ($("mtg-room") && $("mtg-room").value || "").trim();
    const agenda = ($("mtg-agenda") && $("mtg-agenda").value || "").trim();
    const criteria = ($("mtg-criteria") && $("mtg-criteria").value || "").trim();
    const team = ($("mtg-team") && $("mtg-team").value) || "";
    const members = selectedMemberIds().join(",");
    const allowPaid = !!($("mtg-paid") && $("mtg-paid").checked);
    if (!agenda) { if (msg) msg.textContent = "agenda required"; return; }
    if (!team && !members) { if (msg) msg.textContent = "pick a team or members"; return; }
    if (msg) msg.textContent = "starting…";
    const info = { room: room || `meeting-${Date.now()}`, agenda, criteria, allowPaid };
    if (team) info.team = team; else info.members = members;
    let r = {};
    try { r = await ceo.meetingStart(info); } catch (e) { r = { ok: false, reason: String(e) }; }
    if (!r || !r.ok) { if (msg) msg.textContent = `failed: ${r ? r.reason : "unknown"}`; return; }
    if (msg) msg.textContent = "running — watch the transcript →";
    activeMeetingRoom = r.room;
    const lbl = $("mtg-room-label"); if (lbl) lbl.textContent = r.room;
    pollMeetingRoom();
    stopMeetingPoll();
    meetingPollTimer = setInterval(pollMeetingRoom, 2500);
  }

  async function pollMeetingRoom() {
    if (!activeMeetingRoom || !ceo.meetingRoom) return;
    let r = {};
    try { r = await ceo.meetingRoom(activeMeetingRoom); } catch { return; }
    if (!r || !r.ok) return;
    const host = $("mtg-transcript");
    if (host) {
      const feed = r.feed || [];
      host.innerHTML = feed.length ? feed.map((e) => {
        const isFac = /facilitator|orchestrator/i.test(e.speaker);
        return `<div class="rounded-lg border ${isFac ? "border-cyan-500/30 bg-cyan-950/10" : "border-neutral-800 bg-neutral-900/50"} p-2.5">
          <div class="text-[11px] font-medium ${isFac ? "text-cyan-300" : "text-neutral-300"}">${esc(e.speaker)}</div>
          <div class="mt-1 whitespace-pre-wrap text-[12px] text-neutral-300">${esc(e.body)}</div>
        </div>`;
      }).join("") : `<div class="text-neutral-600">Waiting for the meeting to begin…</div>`;
    }
    const state = $("mtg-state");
    if (state) {
      state.innerHTML = r.running
        ? `<span class="text-amber-300">● running</span>`
        : `<span class="text-emerald-400">✓ complete</span>`;
    }
    const reqWrap = $("mtg-requirements"), reqBody = $("mtg-requirements-body");
    if (reqWrap && reqBody) {
      if (r.requirements) {
        reqWrap.classList.remove("hidden");
        reqBody.innerHTML = window.marked ? window.marked.parse(r.requirements) : esc(r.requirements);
      } else {
        reqWrap.classList.add("hidden");
      }
    }
    if (!r.running) stopMeetingPoll();
  }

  // --- Renderers ---
  function renderKanban(data) {
    const host = $("dash-kanban");
    if (!host) return;
    if (!data || !data.ok) { host.innerHTML = `<div class="text-neutral-600 text-sm p-4">No board data.</div>`; return; }
    const cols = data.columns || {};
    const present = Object.keys(cols);
    const ordered = COL_ORDER.filter((c) => present.includes(c)).concat(present.filter((c) => !COL_ORDER.includes(c)));
    if (!ordered.length) { host.innerHTML = `<div class="text-neutral-600 text-sm p-4">Board is empty.</div>`; return; }
    host.innerHTML = ordered.map((status) => {
      const tasks = cols[status] || [];
      const cards = tasks.map((t) => {
        const alive = status === "running" && t.workerAlive;
        const fail = t.last_failure_error
          ? `<div class="mt-1 text-[10px] text-red-400/80 truncate" title="${esc(t.last_failure_error)}">⚠ ${esc(t.last_failure_error)}</div>` : "";
        const prio = t.priority ? `<span class="text-[10px] text-neutral-500">P${t.priority}</span>` : "";
        const brief = t.body ? `<div class="mt-1.5 text-[11px] text-neutral-400 line-clamp-2">${esc(t.body)}</div>` : "";
        return `<div class="task-card rounded-lg border border-neutral-800 bg-neutral-900/70 p-2.5 cursor-pointer hover:border-neutral-700 hover:bg-neutral-900/90 transition" data-task-id="${esc(t.id)}" data-task-title="${esc(t.title)}" data-task-status="${esc(status)}">
          <div class="text-[13px] text-neutral-100 leading-snug">${esc(t.title)}</div>
          ${brief}
          <div class="mt-1.5 flex items-center gap-2 text-[10px] text-neutral-500">
            ${alive ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>` : ""}
            <span>${esc(t.assignee || "—")}</span>${prio}
            <span class="ml-auto text-neutral-700">${esc(t.id)}</span>
          </div>${fail}
        </div>`;
      }).join("") || `<div class="text-[11px] text-neutral-700 px-1 py-2">empty</div>`;
      return `<div class="w-[260px] shrink-0 flex flex-col rounded-xl border ${COL_ACCENT[status] || "border-neutral-800"} bg-neutral-900/30 max-h-full">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-neutral-800/70">
          <span class="w-2 h-2 rounded-full ${DOT[status] || "bg-neutral-500"}"></span>
          <span class="text-xs font-medium text-neutral-200 uppercase tracking-wide">${esc(status)}</span>
          <span class="ml-auto text-[11px] text-neutral-500">${tasks.length}</span>
          ${status === "planning" ? `<button class="add-task-btn ml-2 text-[10px] bg-cyan-600/90 hover:bg-cyan-600 text-white rounded px-2 py-0.5 transition" data-status="${esc(status)}">+ Add</button>` : ""}
        </div>
        <div class="overflow-auto p-2 space-y-2">${cards}</div>
      </div>`;
    }).join("");
  }

  function renderSwarm(data) {
    const host = $("dash-swarm");
    if (!host) return;
    const workers = (data && data.workers) || [];
    if (!workers.length) { host.innerHTML = `<div class="text-neutral-600 text-xs">No active workers.</div>`; return; }
    host.innerHTML = workers.map((w) => `
      <div class="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${w.alive ? "bg-emerald-500 animate-pulse" : "bg-neutral-600"}"></span>
          <span class="text-[12px] text-neutral-200 truncate flex-1">${esc(w.title)}</span>
          <span class="text-[10px] text-neutral-600">${esc(w.assignee || "")}</span>
        </div>
        <div class="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
          <span>${w.alive ? "pid " + esc(w.worker_pid) : "no worker"}</span>
          <span class="ml-auto">${w.started_at ? "up " + ago(w.started_at) : ""}</span>
        </div>
      </div>`).join("");
  }

  function roomLine(it) {
    const t = new Date((it.created_at || 0) * 1000);
    const hh = t.toTimeString().slice(0, 8);
    const task = it.task_title ? esc(String(it.task_title).slice(0, 36)) : esc(it.task_id || "");
    if (it.type === "comment") {
      return `<div class="leading-snug"><span class="text-neutral-600">${hh}</span>
        <span class="text-sky-400">💬 ${esc(it.author)}</span>
        <span class="text-neutral-500">${task}</span>
        <div class="text-neutral-400 pl-10 truncate">${esc(String(it.body || "").slice(0, 120))}</div></div>`;
    }
    const kind = String(it.kind || "");
    const bad = /fail|gave_up|violation|error|crash|timeout|block/i.test(kind);
    const good = /complete|done|spawn|claim|promote|start/i.test(kind);
    const color = bad ? "text-red-400" : good ? "text-emerald-400" : "text-neutral-300";
    return `<div class="leading-snug"><span class="text-neutral-600">${hh}</span>
      <span class="${color}">▸ ${esc(kind)}</span>
      <span class="text-neutral-500">${task}</span></div>`;
  }

  function renderRoom(data) {
    const host = $("dash-room");
    if (!host) return;
    const feed = (data && data.feed) || [];
    if (!feed.length) { host.innerHTML = `<div class="text-neutral-600 text-xs">Room is quiet.</div>`; return; }
    host.innerHTML = feed.map(roomLine).join("");
  }

  function renderStats(data) {
    const host = $("dash-stats");
    if (!host) return;
    const by = (data && data.byStatus) || [];
    host.innerHTML = by.map((r) =>
      `<span class="mr-3"><span class="text-neutral-200">${esc(r.n)}</span> ${esc(r.status)}</span>`).join("");
  }

  // --- Refresh cycle ---
  async function refresh() {
    if (!board || !open) return;
    try {
      const [b, sw, room, stats] = await Promise.all([
        ceo.ceoBoard ? ceo.ceoBoard(board) : null,
        ceo.ceoSwarm ? ceo.ceoSwarm(board) : null,
        ceo.ceoRoom ? ceo.ceoRoom(board, 50) : null,
        ceo.ceoStats ? ceo.ceoStats(board) : null,
      ]);
      renderKanban(b);
      renderSwarm(sw);
      renderRoom(room);
      renderStats(stats);
      const u = $("dash-updated");
      if (u) u.textContent = "updated " + new Date().toTimeString().slice(0, 8);
    } catch (e) { /* keep last good render */ }
  }

  function show() {
    open = true;
    $("dashboard").classList.remove("hidden");
    loadBoards().then(refresh);
    refreshStatus();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 4000);
  }
  function hide() {
    open = false;
    $("dashboard").classList.add("hidden");
    clearInterval(refreshTimer);
  }

  // --- Config panel ---
  let cfg = null;
  function selectedProfileConfig(profileId) {
    return ((cfg && cfg.profiles) || []).find((p) => p.id === profileId) || {};
  }
  function fillModels(provider) {
    const sel = $("config-model");
    const list = (cfg && cfg.models && cfg.models[provider]) || [];
    sel.innerHTML = list.length
      ? list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")
      : `<option value="">(type not available — pick another provider)</option>`;
    const listEl = $("config-model-list");
    if (listEl) {
      const profileId = $("config-profile") ? $("config-profile").value : (cfg && cfg.activeProfile) || "";
      const profileCfg = selectedProfileConfig(profileId);
      const label = profileCfg.name || profileId || "Default Hermes CEO";
      listEl.textContent = list.length
        ? `${label} can use: ${list.join(", ")}`
        : `${label} has no available model list for ${provider || "this provider"}.`;
    }
    const profileId = $("config-profile") ? $("config-profile").value : (cfg && cfg.activeProfile) || "";
    const profileCfg = selectedProfileConfig(profileId);
    const model = profileCfg.model || cfg.model || {};
    if (model.provider === provider && model.default) {
      sel.value = model.default;
    }
  }
  function fillProfilePersonality(profileId) {
    const profileCfg = selectedProfileConfig(profileId);
    const personalitySel = $("config-personality");
    if (personalitySel) {
      const personalities = profileCfg.personalities || cfg.personalities || [];
      const current = profileCfg.personality || cfg.personality || "";
      personalitySel.innerHTML = personalities.map((p) =>
        `<option value="${esc(p)}" ${p === current ? "selected" : ""}>${esc(p)}</option>`).join("")
        || `<option value="">No personas found</option>`;
    }
    const model = profileCfg.model || cfg.model || {};
    const psel = $("config-provider");
    if (psel && model.provider) psel.value = model.provider;
    if (psel) fillModels(psel.value || model.provider || (cfg.providers || [])[0]);
    $("config-current").textContent = `current: ${model.provider || "?"} / ${model.default || "?"}`;
  }
  async function openConfig() {
    $("config-panel").classList.remove("hidden");
    $("config-msg").textContent = "loading…";
    try { cfg = await ceo.ceoConfig(); } catch { cfg = null; }
    if (!cfg || !cfg.ok) { $("config-msg").textContent = "Couldn't load config."; return; }
    $("config-msg").textContent = "";
    // CEO daemon status
    const up = cfg.ceo && cfg.ceo.up;
    $("config-ceo-dot").className = "w-2.5 h-2.5 rounded-full " + (up ? "bg-emerald-500" : "bg-red-500");
    $("config-ceo-label").textContent = up ? "CEO online" : "CEO offline";
    $("config-platforms").textContent = cfg.ceo && cfg.ceo.platforms
      ? Object.entries(cfg.ceo.platforms).map(([k, v]) => `${k}:${v}`).join("  ") : "";
    const activeProfile = cfg.activeProfile || "";
    const profileSel = $("config-profile");
    if (profileSel) {
      profileSel.innerHTML = (cfg.profiles || []).map((p) =>
        `<option value="${esc(p.id)}" ${p.id === activeProfile ? "selected" : ""}>${esc(p.name || p.id || "Default Hermes CEO")}</option>`).join("")
        || `<option value="">Default Hermes CEO</option>`;
    }
    const profileCurrent = $("config-profile-current");
    if (profileCurrent) profileCurrent.textContent = `active: ${activeProfile || "default Hermes CEO"}`;
    const profileMsg = $("config-profile-msg");
    if (profileMsg) profileMsg.textContent = "";
    // current model
    const m = cfg.model || {};
    $("config-current").textContent = `current: ${m.provider || "?"} / ${m.default || "?"}`;
    // providers
    const psel = $("config-provider");
    psel.innerHTML = (cfg.providers || []).map((p) =>
      `<option value="${esc(p)}" ${p === m.provider ? "selected" : ""}>${esc(p)}</option>`).join("")
      || `<option value="">(no providers authed)</option>`;
    fillProfilePersonality(activeProfile);
  }
  function closeConfig() { $("config-panel").classList.add("hidden"); }

  function wireConfig() {
    const close = $("config-close"); if (close) close.addEventListener("click", closeConfig);
    const psel = $("config-provider"); if (psel) psel.addEventListener("change", (e) => fillModels(e.target.value));
    const profileSel = $("config-profile"); if (profileSel) profileSel.addEventListener("change", (e) => fillProfilePersonality(e.target.value));
    const profileApply = $("config-profile-apply");
    if (profileApply) profileApply.addEventListener("click", async () => {
      const profile = $("config-profile").value;
      const provider = $("config-provider").value;
      const model = $("config-model").value;
      const personality = $("config-personality") ? $("config-personality").value : "";
      $("config-profile-msg").textContent = "saving CEO...";
      const modelRes = provider ? await ceo.ceoSetModel(provider, model, profile) : { ok: true };
      const personaRes = personality && ceo.ceoSetPersonality ? await ceo.ceoSetPersonality(personality, profile) : { ok: true };
      const r = await ceo.ceoSetProfile(profile);
      if (r && r.ok && modelRes && modelRes.ok && personaRes && personaRes.ok) {
        $("config-profile-msg").textContent = "active";
        $("config-profile-current").textContent = `active: ${r.activeProfile || "default Hermes CEO"}`;
        await openConfig();
        refreshStatus();
      } else {
        $("config-profile-msg").textContent = "failed: " + ((modelRes && modelRes.reason) || (personaRes && personaRes.reason) || (r && r.reason) || "unknown");
      }
    });
    const apply = $("config-apply");
    if (apply) apply.addEventListener("click", async () => {
      const provider = $("config-provider").value;
      const model = $("config-model").value;
      const profile = $("config-profile") ? $("config-profile").value : "";
      $("config-msg").textContent = "applying…";
      const r = await ceo.ceoSetModel(provider, model, profile);
      if (r && r.ok) {
        $("config-msg").textContent = "✓ saved";
        $("config-current").textContent = `current: ${r.model.provider} / ${r.model.default}`;
        refreshStatus();
      } else { $("config-msg").textContent = "✗ " + ((r && r.reason) || "failed"); }
    });
    const start = $("config-gw-start");
    if (start) start.addEventListener("click", async () => {
      $("config-msg").textContent = "starting CEO…";
      await ceo.ceoGatewayStart();
      setTimeout(() => { openConfig(); refreshStatus(); }, 2500);
    });
    const stop = $("config-gw-stop");
    if (stop) stop.addEventListener("click", async () => {
      $("config-msg").textContent = "stopping CEO…";
      await ceo.ceoGatewayStop();
      setTimeout(() => { openConfig(); refreshStatus(); }, 1500);
    });
  }

  // Add line-clamp CSS utility
  const style = document.createElement("style");
  style.textContent = `
    .line-clamp-2 {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `;
  document.head.appendChild(style);

  // --- Task planning conversation (right rail) ---
  let planTask = null;     // { taskId, taskTitle, taskStatus }
  let planBusy = false;

  function planLine(kind, text) {
    const host = $("dash-plan-stream");
    if (!host) return null;
    const div = document.createElement("div");
    div.className =
      kind === "user" ? "text-neutral-200" :
      kind === "ceo" ? "text-cyan-200 whitespace-pre-wrap" :
      "text-neutral-500 italic";
    const who = kind === "user" ? "You: " : kind === "ceo" ? "CEO: " : "";
    div.textContent = who + text;
    host.appendChild(div);
    host.scrollTop = host.scrollHeight;
    return div;
  }

  async function selectTask(t) {
    planTask = t;
    if (ceo.ceoFocusTask) ceo.ceoFocusTask({ ...t, board });
    if (window.ceoUI && window.ceoUI.openTaskFromDashboard) {
      hide();
      await window.ceoUI.openTaskFromDashboard({ ...t, board });
    }
  }

  function clearTask() {
    planTask = null;
    if (ceo.ceoFocusTask) ceo.ceoFocusTask(null);
    const lbl = $("dash-plan-task"); if (lbl) lbl.textContent = "";
    const clear = $("dash-plan-clear"); if (clear) clear.classList.add("hidden");
    const ctx = $("dash-plan-context"); if (ctx) { ctx.classList.add("hidden"); ctx.textContent = ""; }
    const host = $("dash-plan-stream");
    if (host) host.innerHTML = `<div class="text-neutral-600">Click a task in a lane to plan it with the CEO — or just type below.</div>`;
    document.querySelectorAll(".task-card").forEach((c) => c.classList.remove("ring-2", "ring-cyan-500"));
  }

  async function sendPlan() {
    const input = $("dash-plan-input");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg || planBusy) return;
    input.value = "";
    planBusy = true;
    planLine("user", msg);
    const thinking = planLine("sys", "CEO is thinking…");
    try {
      const r = await ceo.askCeo(msg);
      if (thinking) thinking.remove();
      if (!r || !r.ok) planLine("sys", `⚠ ${r ? r.reason : "CEO unreachable"}`);
      else planLine("ceo", r.reply);
    } catch (e) {
      if (thinking) thinking.remove();
      planLine("sys", `⚠ ${e && e.message ? e.message : "error"}`);
    } finally {
      planBusy = false;
    }
  }

  function wirePlanner() {
    const send = $("dash-plan-send");
    if (send) send.addEventListener("click", sendPlan);
    const input = $("dash-plan-input");
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendPlan(); });
    const clear = $("dash-plan-clear");
    if (clear) clear.addEventListener("click", clearTask);
  }

  function wire() {
    const toggle = $("toggle-dashboard");
    if (toggle) toggle.addEventListener("click", () => (open ? hide() : show()));
    const close = $("dash-close");
    if (close) close.addEventListener("click", hide);
    const rf = $("dash-refresh");
    if (rf) rf.addEventListener("click", refresh);
    const sel = $("dash-board");
    if (sel) sel.addEventListener("change", (e) => { board = e.target.value; refresh(); });
    
    // Tab switching
    const tabKanban = $("tab-kanban");
    const tabAgents = $("tab-agents");
    const tabConfig = $("tab-config");
    const tabMeetings = $("tab-meetings");
    if (tabKanban) tabKanban.addEventListener("click", () => switchTab("kanban"));
    if (tabAgents) tabAgents.addEventListener("click", () => switchTab("agents"));
    if (tabMeetings) tabMeetings.addEventListener("click", () => switchTab("meetings"));
    if (tabConfig) tabConfig.addEventListener("click", () => {
      switchTab("config");
      openConfig();
    });

    // Meetings wiring
    const mtgStart = $("mtg-start");
    if (mtgStart) mtgStart.addEventListener("click", startMeeting);
    const mtgTeam = $("mtg-team");
    if (mtgTeam) mtgTeam.addEventListener("change", (e) => {
      const t = (meetingOpts && meetingOpts.teams || []).find((x) => x.name === e.target.value);
      renderMeetingMembers(t ? t.members : []);
    });
    
    // Agent filter
    const agentFilterSel = $("agent-filter");
    if (agentFilterSel) {
      agentFilterSel.addEventListener("change", (e) => {
        agentFilter = e.target.value;
        renderAgents();
      });
    }
    
    // Reload boards when domain changes
    const domainSwitcher = document.getElementById("domain-switcher");
    if (domainSwitcher) {
      domainSwitcher.addEventListener("change", () => {
        loadBoards().then(refresh);
      });
    }
    
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) hide(); });

    wireConfig();

    // CEO status pill polls continuously, even with the dashboard closed.
    refreshStatus();
    statusTimer = setInterval(refreshStatus, 10000);

    // Task click handler - select it for planning in the right rail.
    document.addEventListener("click", (e) => {
      const taskCard = e.target.closest(".task-card");
      if (taskCard) {
        selectTask({
          taskId: taskCard.dataset.taskId,
          taskTitle: taskCard.dataset.taskTitle,
          taskStatus: taskCard.dataset.taskStatus,
        });
        document.querySelectorAll(".task-card").forEach((c) => c.classList.remove("ring-2", "ring-cyan-500"));
        taskCard.classList.add("ring-2", "ring-cyan-500");
      }

      // Add task button handler
      const addBtn = e.target.closest(".add-task-btn");
      if (addBtn) {
        const status = addBtn.dataset.status;
        const taskTitle = prompt("Enter task title:");
        if (taskTitle && taskTitle.trim()) {
          // Get additional task details
          const taskBrief = prompt("Enter task brief (description):", "");
          const taskAssignee = prompt("Enter assignee (leave empty for unassigned):", "");
          const taskPersona = prompt("Enter persona (leave empty for no specific persona):", "");
          
          if (ceo.ceoAddTask) {
            ceo.ceoAddTask({ 
              board, 
              status: status || "planning", 
              title: taskTitle.trim(),
              body: taskBrief || null,
              assignee: taskAssignee || null,
              persona: taskPersona || null
            });
            setTimeout(refresh, 500);
          }
        }
      }

      const agentCard = e.target.closest(".agent-card");
      if (agentCard) {
        selectAgent(agentCard.dataset.agentId);
      }

      const terminalRefresh = e.target.closest("#agent-terminal-refresh");
      if (terminalRefresh) refreshSelectedAgentTerminal();

      const terminalSend = e.target.closest("#agent-terminal-send");
      if (terminalSend) sendSelectedAgentTerminal();

      const personaSave = e.target.closest("#agent-persona-save");
      if (personaSave) saveSelectedAgentPersona();

      const personaNew = e.target.closest("#agent-persona-new");
      if (personaNew) createPersonaForSelectedAgent();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target && e.target.id === "agent-terminal-input") sendSelectedAgentTerminal();
    });

    wirePlanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else { wire(); }
})();
