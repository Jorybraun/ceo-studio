/**
 * Studio Sessions — session list, AGUI chat, worker strip, left-panel inspect.
 */
(function () {
  const $ = (id) => document.getElementById(String(id || "").replace(/^#/, ""));
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let activeSession = null;
  let sessionsNavActive = false;
  let selectedAgentId = "ceo";
  let selectedAgentAllowPaid = false;
  let pendingBriefSession = null;
  let registryAgents = [];
  let roomPollTimer = null;
  let inspectAgentId = null;
  let inspectWindow = "main";
  let inspectTimer = null;

  function projectReady() {
    return window.ceoUI && window.ceoUI.hasProject && window.ceoUI.hasProject();
  }

  function isChatActive() {
    return !!(activeSession && activeSession.id);
  }

  function agentName(agentId) {
    const a = registryAgents.find((x) => x.id === agentId);
    return (a && (a.name || a.id)) || agentId || "ceo";
  }

  function setComposerAgent(agentId) {
    selectedAgentId = String(agentId || "ceo").trim() || "ceo";
    const label = $("#chat-agent-label");
    if (label) label.textContent = selectedAgentId;
    const input = $("#chat-input");
    if (input) input.placeholder = `Message ${selectedAgentId}...`;
  }

  function ensurePanel1Visible() {
    const p1 = $("#panel1");
    if (p1) {
      p1.classList.remove("hidden");
      p1.classList.remove("session-panel-collapsed");
      p1.classList.add("sessions-panel-visible");
    }
  }

  function isAguiReady() {
    return !!(window.CEOAgui && window.CEOAgui.isReady && window.CEOAgui.isReady());
  }

  function setMainLayout() {
    const main = document.querySelector("main.flex-1");
    const active = isChatActive();
    if (main) main.classList.toggle("studio-session-active", sessionsNavActive && active);
    const feed = $("#session-room-feed");
    if (feed) {
      // Hide the raw room feed when AGUI is rendering the chat, because AGUI
      // already shows the conversation as rich cards. Showing both creates
      // duplicate response blocks.
      const aguiReady = isAguiReady();
      feed.classList.toggle("hidden", !active || aguiReady);
    }
    $("#chat-attach")?.classList.toggle("hidden", active);
    $("#chat-code")?.classList.toggle("hidden", active);
    $("#dictate")?.classList.toggle("hidden", active);
    if (sessionsNavActive) ensurePanel1Visible();
    else updatePanelVisibility();
  }

  function updatePanelVisibility() {
    const p1 = $("#panel1");
    const inspect = $("#panel-inspect");
    const inspectOpen = inspect && !inspect.classList.contains("hidden");
    const artifactOpen = p1 && !p1.classList.contains("session-panel-collapsed");
    if (!p1) return;
    if (sessionsNavActive) {
      ensurePanel1Visible();
      return;
    }
    if (isChatActive()) {
      p1.classList.toggle("hidden", !inspectOpen && !artifactOpen);
    } else {
      p1.classList.remove("hidden");
    }
  }

  function showArtifactPanel() {
    if (sessionsNavActive) {
      ensurePanel1Visible();
      return;
    }
    const p1 = $("#panel1");
    if (p1) p1.classList.remove("session-panel-collapsed");
    updatePanelVisibility();
  }

  function appendChat(role, text) {
    if (window.CEOAgui) {
      if (role === "user" && window.CEOAgui.appendUser) return window.CEOAgui.appendUser(text);
      if ((role === "assistant" || role === "agent") && window.CEOAgui.appendAssistant) {
        return window.CEOAgui.appendAssistant(text, activeSession?.leadAgentId || "lead");
      }
      if (window.CEOAgui.appendSys) return window.CEOAgui.appendSys(text);
    }
    const host = $("#panel2-stream");
    if (!host) return;
    const div = document.createElement("div");
    div.className = role === "user" ? "user" : role === "sys" ? "sys" : "agent";
    div.textContent = (role === "user" ? "You: " : role === "sys" ? "" : `${activeSession?.leadAgentId || "lead"}: `) + text;
    host.appendChild(div);
    host.scrollTop = host.scrollHeight;
  }

  function stripAguiBlocks(text) {
    return String(text || "")
      .replace(/```agui\b[\s\S]*?```/gi, "")
      .replace(/⚠?\s*'[^']+'\s+is a paid\/separate API session and is disabled for automated spawning[^\n]*/gi, "")
      .replace(/\[REFUSED by guardrail\][^\n]*paid\/separate API session[^\n]*/gi, "")
      .trim();
  }

  function renderTranscript() {
    const stream = $("#panel2-stream");
    if (stream) stream.innerHTML = "";
    const rows = (activeSession && activeSession.transcript) || [];
    for (const row of rows.slice(-80)) {
      const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : "sys";
      const content = role === "assistant" ? stripAguiBlocks(row.content || row.body || "") : (row.content || row.body || "");
      if (content) appendChat(role, content);
    }
  }

  async function loadRegistry() {
    try {
      const r = await window.ceo.registryList();
      registryAgents = (r && r.agents) || [];
    } catch {
      registryAgents = [];
    }
  }

  async function refreshActive() {
    const r = await window.ceo.sessionsActive();
    if (r && r.session) {
      activeSession = r.session;
      setComposerAgent(activeSession.leadAgentId || selectedAgentId);
    } else activeSession = null;
    renderAgentsStrip();
    renderWorkflowPanel();
    setMainLayout();
  }

  async function refreshRoomStatus() {
    if (!activeSession || !window.ceo.sessionsRoomStatus) return;
    const label = $("#session-live-status");
    try {
      const r = await window.ceo.sessionsRoomStatus(activeSession.id);
      const running = !!(r && r.running);
      if (label) {
        label.textContent = running ? "live room" : "saved session";
        label.className = `text-[10px] uppercase tracking-wider ${running ? "text-emerald-400" : "text-neutral-500"}`;
        label.title = "";
      }
    } catch {
      if (label) label.textContent = "room unknown";
    }
  }

  async function startLiveRoom() {
    if (!activeSession) return;
    appendChat("sys", "Starting live room loop in free/default mode...");
    const r = await window.ceo.sessionsStartRoom(activeSession.id, { allowPaid: false });
    if (r && r.ok) {
      activeSession = r.session || activeSession;
      appendChat("sys", r.already ? "Live room loop is already running." : "Live room loop started.");
      await refreshRoomStatus();
      await pollRoomTail();
      return;
    }
    appendChat("sys", `Live room failed: ${r ? r.reason : "unknown"}`);
    await refreshActive();
    await refreshRoomStatus();
  }

  async function stopLiveRoom() {
    if (!activeSession) return;
    const r = await window.ceo.sessionsStopRoom(activeSession.id);
    if (r && r.ok) {
      activeSession = r.session || activeSession;
      appendChat("sys", "Live room loop stopped.");
    } else {
      appendChat("sys", `Stop room failed: ${r ? r.reason : "unknown"}`);
    }
    await refreshRoomStatus();
    await pollRoomTail();
  }

  function _newStepId() {
    return `step-${Date.now().toString(36)}`;
  }

  function renderTaskTreeHtml(nodes, depth = 0) {
    if (!nodes || !nodes.length) return '<div class="text-neutral-600 py-1">No steps yet.</div>';
    return `<ul class="${depth ? "ml-4 mt-1 border-l border-neutral-800 pl-3" : "space-y-1"}">${nodes.map((n) => `
      <li class="text-neutral-300">
        <span class="text-[10px] uppercase text-neutral-500 mr-1">${esc(n.status || "pending")}</span>
        ${esc(n.title || n.id)}
        ${n.children && n.children.length ? renderTaskTreeHtml(n.children, depth + 1) : ""}
      </li>`).join("")}</ul>`;
  }

  function renderDecompositionItemsHtml(items, depth = 0) {
    if (!items || !items.length) {
      return '<p class="session-decomp-empty">No decomposition yet. Approve a plan and ask the lead agent to break work into steps, or add steps in the workflow bar.</p>';
    }
    return `<ul class="session-decomp-list ${depth ? "session-decomp-nested" : ""}">${items.map((item) => `
      <li class="session-decomp-item">
        <div class="session-decomp-item-head">
          <span class="session-decomp-type">${esc(item.type || "decomposition")}</span>
          <span class="session-decomp-status">${esc(item.status || "proposed")}</span>
        </div>
        <div class="session-decomp-title">${esc(item.title)}</div>
        ${item.actionItems && item.actionItems.length
          ? `<ul class="session-decomp-actions">${item.actionItems.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
          : ""}
        ${item.children && item.children.length ? renderDecompositionItemsHtml(item.children, depth + 1) : ""}
      </li>`).join("")}</ul>`;
  }

  function buildDecompositionView(session, decomposition) {
    if (decomposition && decomposition.items) return decomposition;
    const tree = session && session.taskTree;
    if (!tree || !tree.length) {
      return { title: "Decomposition", overview: "", items: [], source: "empty" };
    }
    const items = tree.map((n) => ({
      id: n.id,
      title: n.title,
      type: "decomposition",
      status: n.status || "pending",
      actionItems: [],
      children: (n.children || []).map((c) => ({
        id: c.id,
        title: c.title,
        type: "step",
        status: c.status || "pending",
        actionItems: [],
        children: [],
      })),
    }));
    return {
      title: "Decomposition",
      overview: session.planDoc && session.planDoc.overview ? session.planDoc.overview : "",
      items,
      source: "taskTree",
    };
  }

  function renderSessionDetail(session, decomposition) {
    const host = $("#session-artifact-host");
    if (!host || !session) {
      if (host) {
        host.innerHTML = "";
        host.classList.add("hidden");
      }
      return;
    }
    const decomp = buildDecompositionView(session, decomposition);
    const plan = session.planDoc;
    const team = session.plannedTeam || [];
    const workers = session.workers || [];
    const approved = session.planApprovedAt
      ? `<span class="session-detail-badge session-detail-badge-ok">Plan approved</span>`
      : plan && plan.body
        ? `<span class="session-detail-badge session-detail-badge-warn">Plan pending approval</span>`
        : `<span class="session-detail-badge">No plan</span>`;
    const loop = (session.roomLoop && session.roomLoop.status) || "stopped";

    host.classList.remove("hidden");
    host.innerHTML = `
      <section class="session-detail" aria-label="Session detail">
        <header class="session-detail-head">
          <h3 class="session-detail-title">${esc(session.title)}</h3>
          <div class="session-detail-badges">
            <span class="session-detail-phase">${esc(session.phase)}</span>
            ${approved}
          </div>
        </header>
        <dl class="session-detail-meta">
          <div><dt>Lead</dt><dd>${esc(session.leadAgentId)}</dd></div>
          <div><dt>Room</dt><dd>${esc(session.room)}</dd></div>
          <div><dt>Live loop</dt><dd>${esc(loop)}</dd></div>
          <div><dt>Workers</dt><dd>${workers.length}</dd></div>
        </dl>
        ${plan && (plan.overview || plan.body)
          ? `<div class="session-detail-block">
              <h4>Plan</h4>
              ${plan.overview ? `<p class="session-detail-overview">${esc(plan.overview)}</p>` : ""}
              ${plan.body ? `<div class="session-detail-plan-snippet prose prose-invert prose-sm max-w-none">${window.marked ? window.marked.parse(plan.body.slice(0, 1200) + (plan.body.length > 1200 ? "\n\n…" : "")) : esc(plan.body.slice(0, 400))}</div>` : ""}
              <button type="button" id="sess-plan-view-detail" class="session-detail-link">View full plan</button>
            </div>`
          : ""}
        <div class="session-detail-block session-detail-decomp">
          <div class="session-detail-block-head">
            <h4>Decomposition</h4>
            <span class="session-detail-source">${decomp.source === "empty" ? "awaiting" : esc(decomp.source)}</span>
          </div>
          ${decomp.overview ? `<p class="session-detail-overview">${esc(decomp.overview)}</p>` : ""}
          ${decomp.body
            ? `<div class="session-detail-decomp-body prose prose-invert prose-sm max-w-none">${window.marked ? window.marked.parse(decomp.body) : esc(decomp.body)}</div>`
            : renderDecompositionItemsHtml(decomp.items)}
        </div>
        ${team.length
          ? `<div class="session-detail-block">
              <h4>Planned team</h4>
              <ul class="session-detail-team">${team.map((m) => `<li><span>${esc(m.role)}</span> ${esc(m.agentId)}</li>`).join("")}</ul>
            </div>`
          : ""}
        ${workers.length
          ? `<div class="session-detail-block">
              <h4>Active workers</h4>
              <ul class="session-detail-team">${workers.map((w) => `<li>
                <span>${esc(w.role || "worker")}</span>
                <button type="button" class="session-worker-terminal" data-agent="${esc(w.agentId)}" title="Open live terminal">${esc(w.agentId)}</button>
                <em>${esc(w.status || "—")}${w.tmuxSession ? ` / ${esc(w.tmuxSession)}` : ""}</em>
              </li>`).join("")}</ul>
            </div>`
          : ""}
      </section>`;
    showArtifactPanel();
    if (window.ceoUI && window.ceoUI.setPanelTitle) {
      window.ceoUI.setPanelTitle(session.title || "Session");
    }
  }

  async function refreshSessionDetail() {
    if (!activeSession || !activeSession.id) {
      renderSessionDetail(null);
      return;
    }
    let decomposition = null;
    try {
      const r = await window.ceo.sessionsDecomposition(activeSession.id);
      if (r && r.ok) decomposition = r.decomposition;
    } catch { /* use local fallback */ }
    renderSessionDetail(activeSession, decomposition);
  }

  function renderWorkflowPanel() {
    const host = $("#session-workflow");
    if (!host) return;
    if (!activeSession) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    host.classList.remove("hidden");
    const plan = activeSession.planDoc;
    const approved = !!activeSession.planApprovedAt;
    const team = activeSession.plannedTeam || [];
    const tree = activeSession.taskTree || [];

    host.innerHTML = `
      <div class="grid gap-2 p-2 md:grid-cols-3">
        <section class="rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
          <div class="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Plan ${approved ? '<span class="text-emerald-400">✓ approved</span>' : '<span class="text-amber-400">pending</span>'}</div>
          ${plan && plan.body
            ? `<div class="text-neutral-300 line-clamp-3 mb-2">${esc((plan.overview || plan.body).slice(0, 200))}</div>`
            : '<div class="text-neutral-600 mb-2">No plan captured.</div>'}
          <div class="flex flex-wrap gap-1">
            <button type="button" id="sess-plan-capture" class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">Capture</button>
            <button type="button" id="sess-plan-view" class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700" ${plan ? "" : "disabled"}>View</button>
            <button type="button" id="sess-plan-approve" class="rounded bg-emerald-700/80 px-2 py-1 hover:bg-emerald-600 text-white" ${plan && !approved ? "" : "disabled"}>Approve</button>
            <button type="button" id="sess-plan-reject" class="rounded bg-red-900/50 px-2 py-1 hover:bg-red-900/70" ${plan && !approved ? "" : "disabled"}>Reject</button>
          </div>
        </section>
        <section class="rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
          <div class="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Team (${team.length})</div>
          <div class="max-h-16 overflow-auto text-neutral-400 mb-2">${team.length
            ? team.map((m) => `<div>[${esc(m.role)}] ${esc(m.agentId)}</div>`).join("")
            : "Add agents before launch."}</div>
          <div class="flex flex-wrap gap-1">
            <button type="button" id="sess-team-add" class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">+ Member</button>
            <button type="button" id="sess-team-launch" class="rounded bg-cyan-600 px-2 py-1 hover:bg-cyan-500 text-white" ${team.length && approved ? "" : "disabled"}>Launch team</button>
          </div>
        </section>
        <section class="rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
          <div class="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Steps (${tree.length} roots)</div>
          <div class="max-h-16 overflow-auto mb-2">${renderTaskTreeHtml(tree)}</div>
          <div class="flex flex-wrap gap-1">
            <button type="button" id="sess-tree-add" class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">+ Step</button>
            <button type="button" id="sess-tree-view" class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700" ${tree.length ? "" : "disabled"}>View tree</button>
          </div>
        </section>
      </div>`;
  }

  function renderPlanInLeftPanel() {
    const plan = activeSession && activeSession.planDoc;
    if (!plan) return;
    const body = $("#panel-content-body");
    if (!body) return;
    const approved = activeSession.planApprovedAt
      ? `<span class="text-emerald-400 text-xs">Approved ${new Date(activeSession.planApprovedAt).toLocaleString()}</span>`
      : `<span class="text-amber-400 text-xs">Awaiting approval</span>`;
    body.innerHTML = `
      <div class="space-y-3 max-w-3xl">
        <button type="button" id="sess-back-list" class="text-xs text-neutral-400 hover:text-neutral-200">← Back to session list</button>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-neutral-100">${esc(plan.title || "Plan")}</h2>
          ${approved}
        </div>
        ${plan.overview ? `<p class="text-sm text-neutral-400">${esc(plan.overview)}</p>` : ""}
        <div class="prose prose-invert prose-sm max-w-none">${window.marked ? window.marked.parse(plan.body) : esc(plan.body)}</div>
        ${!activeSession.planApprovedAt ? `
          <div class="flex gap-2 pt-2">
            <button type="button" id="sess-plan-approve-panel" class="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm">Approve plan</button>
            <button type="button" id="sess-plan-reject-panel" class="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg px-4 py-2 text-sm">Reject</button>
          </div>` : ""}
      </div>`;
    showArtifactPanel();
    if (window.ceoUI && window.ceoUI.setPanelTitle) window.ceoUI.setPanelTitle(plan.title || "Plan");
  }

  function renderTaskTreeInLeftPanel() {
    if (!activeSession) return;
    const body = $("#panel-content-body");
    if (!body) return;
    body.innerHTML = `
      <div class="space-y-3 max-w-3xl">
        <button type="button" id="sess-back-list" class="text-xs text-neutral-400 hover:text-neutral-200">← Back to session list</button>
        <h2 class="text-lg font-semibold text-neutral-100">Task tree</h2>
        ${renderTaskTreeHtml(activeSession.taskTree || [])}
      </div>`;
    showArtifactPanel();
    if (window.ceoUI && window.ceoUI.setPanelTitle) window.ceoUI.setPanelTitle("Task tree");
  }

  async function capturePlan() {
    if (!activeSession) return;
    const title = window.prompt("Plan title:", activeSession.title + " — plan");
    if (title == null) return;
    const body = window.prompt("Plan body (markdown):", "# Plan\n\n## Goals\n\n## Steps\n");
    if (body == null || !body.trim()) return;
    const overview = window.prompt("Short overview (optional):", "") || "";
    const r = await window.ceo.sessionsSetPlan(activeSession.id, { title, body, overview });
    if (r && r.ok) {
      activeSession = r.session;
      appendChat("sys", `Plan captured: ${title}`);
      await refreshSessionDetail();
      renderWorkflowPanel();
    } else {
      appendChat("sys", `Plan failed: ${r ? r.reason : "unknown"}`);
    }
  }

  async function approvePlan() {
    if (!activeSession) return;
    const r = await window.ceo.sessionsApprovePlan(activeSession.id);
    if (r && r.ok) {
      activeSession = r.session;
      appendChat("sys", `Plan approved → phase ${activeSession.phase}`);
      const phase = $("#session-phase-select");
      if (phase) phase.value = activeSession.phase;
      renderWorkflowPanel();
      renderAgentsStrip();
      await refreshSessionDetail();
    } else {
      appendChat("sys", `Approve failed: ${r ? r.reason : "unknown"}`);
    }
  }

  async function rejectPlan() {
    if (!activeSession) return;
    const reason = window.prompt("Rejection note (optional):", "") || "";
    const r = await window.ceo.sessionsRejectPlan(activeSession.id, reason);
    if (r && r.ok) {
      activeSession = r.session;
      appendChat("sys", "Plan rejected — back to plan phase");
      const phase = $("#session-phase-select");
      if (phase) phase.value = activeSession.phase;
      renderWorkflowPanel();
      await refreshSessionDetail();
    }
  }

  async function addTeamMember() {
    if (!activeSession) return;
    await loadRegistry();
    const pick = registryAgents.filter((a) => a.id !== activeSession.leadAgentId);
    const raw = window.prompt(`Agent id:\n${pick.map((a) => a.id).join(", ")}`, pick[0]?.id || "");
    if (!raw || !raw.trim()) return;
    const agentId = raw.trim().split(/\s/)[0];
    const role = window.prompt("Role:", "developer") || "developer";
    const team = [...(activeSession.plannedTeam || []), { agentId, role }];
    const r = await window.ceo.sessionsSetPlannedTeam(activeSession.id, team);
    if (r && r.ok) {
      activeSession = r.session;
      renderWorkflowPanel();
      appendChat("sys", `Team roster: ${team.map((t) => `[${t.role}] ${t.agentId}`).join(", ")}`);
    }
  }

  async function launchTeam() {
    if (!activeSession) return;
    appendChat("sys", "Launching planned team…");
    const r = await window.ceo.sessionsLaunchTeam(activeSession.id);
    if (r && r.ok) {
      activeSession = r.session;
      const phase = $("#session-phase-select");
      if (phase) phase.value = activeSession.phase;
      appendChat("sys", `Team launched (${(r.results || []).filter((x) => x.ok).length}/${(r.results || []).length} ok)`);
      renderAgentsStrip();
      renderWorkflowPanel();
      await refreshSessionDetail();
    } else {
      appendChat("sys", `Launch failed: ${r ? r.reason : "unknown"}`);
    }
  }

  async function addTaskStep() {
    if (!activeSession) return;
    const title = window.prompt("Step title:", "Step 1");
    if (!title || !title.trim()) return;
    const tree = [...(activeSession.taskTree || []), { id: _newStepId(), title: title.trim(), status: "pending", children: [] }];
    const r = await window.ceo.sessionsSetTaskTree(activeSession.id, tree);
    if (r && r.ok) {
      activeSession = r.session;
      renderWorkflowPanel();
      await refreshSessionDetail();
      appendChat("sys", `Added step: ${title}`);
    }
  }

  function renderAgentsStrip() {
    const strip = $("#session-agents-strip");
    if (!strip) return;
    if (!activeSession) {
      strip.classList.add("hidden");
      strip.innerHTML = "";
      return;
    }
    strip.classList.remove("hidden");
    const lead = activeSession.leadAgentId;
    const workers = activeSession.workers || [];
    const cards = [
      `<button type="button" class="session-agent-card shrink-0 rounded-lg border border-cyan-800/60 bg-cyan-950/40 px-3 py-2 text-left" data-agent="${esc(lead)}" data-role="lead">
        <div class="text-[10px] uppercase tracking-wider text-cyan-400/80">Lead</div>
        <div class="text-sm font-medium text-neutral-100">${esc(lead)}</div>
        <div class="text-[10px] text-neutral-500">${esc(activeSession.phase)} · terminal</div>
      </button>`,
      ...workers.map((w) => `
        <button type="button" class="session-agent-card shrink-0 rounded-lg border border-neutral-700 bg-neutral-900/70 px-3 py-2 text-left hover:border-neutral-600" data-agent="${esc(w.agentId)}" data-role="${esc(w.role || w.agentId)}">
          <div class="text-[10px] uppercase tracking-wider text-neutral-500">${esc(w.role || "worker")}</div>
          <div class="text-sm font-medium text-neutral-100">${esc(w.agentId)}</div>
          <div class="text-[10px] ${w.status === "running" ? "text-emerald-400" : w.status === "error" ? "text-red-400" : "text-neutral-500"}">${esc(w.status || "—")} · terminal</div>
        </button>`),
      `<button type="button" id="session-spawn-worker" class="shrink-0 rounded-lg border border-dashed border-neutral-600 px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">+ Worker</button>`,
    ].join("");
    strip.innerHTML = cards;
  }

  async function renderSessionList() {
    const body = $("#panel-content-body");
    if (!body) return;
    if (!projectReady()) {
      body.innerHTML = '<div class="text-sm text-neutral-500">Open a project to create sessions.</div>';
      return;
    }
    body.innerHTML = '<div class="text-sm text-neutral-500">Loading sessions…</div>';
    const [listR] = await Promise.all([
      window.ceo.sessionsList(),
      loadRegistry(),
    ]);
    if (!listR || !listR.ok) {
      body.innerHTML = `<div class="text-sm text-red-300">Could not load sessions: ${esc(listR && listR.reason ? listR.reason : "unknown")}</div>`;
      return;
    }
    const rows = listR.sessions || [];
    const providerFor = (agentId) => {
      const a = registryAgents.find((x) => x.id === agentId);
      return (a && a.provider) || "";
    };
    const fmtDate = (ts) => ts ? new Date(ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) : "unknown";

    body.innerHTML = `
      <div class="session-browser">
        <div class="session-browser-head">
          <div>
            <h2>Sessions</h2>
            <p>Saved agent conversations. Click a session to load it, or send a message to create a fresh session.</p>
          </div>
          <span>${rows.length} saved</span>
        </div>
        <div class="session-list">
          ${rows.length ? rows.map((s) => {
            const sel = activeSession && activeSession.id === s.id;
            const transcriptCount = (s.transcript || []).length;
            const workers = (s.workers || []).length;
            const loop = (s.roomLoop && s.roomLoop.status) || "stopped";
            return `
            <button type="button" class="sess-open session-row ${sel ? "active" : ""}" data-id="${esc(s.id)}">
              <div class="session-row-main">
                <span class="session-row-title">${esc(s.title)}</span>
                <span class="session-row-phase">${esc(s.phase)}</span>
              </div>
              <div class="session-row-meta">
                <span>Lead ${esc(s.leadAgentId)}${providerFor(s.leadAgentId) ? `/${esc(providerFor(s.leadAgentId))}` : ""}</span>
                <span>${esc(loop)}</span>
                <span>${transcriptCount} message${transcriptCount === 1 ? "" : "s"}</span>
                <span>${workers} worker${workers === 1 ? "" : "s"}</span>
              </div>
              <div class="session-row-foot">
                <span>${esc(s.room)}</span>
                <span>${fmtDate(s.updatedAt || s.createdAt)}</span>
              </div>
            </button>`;
          }).join("") : '<div class="session-empty">No sessions yet. Send a message in chat and the app will create one.</div>'}
        </div>
        <div id="session-artifact-host" class="session-artifact-host"></div>
      </div>`;
  }

  async function renderAgentPicker() {
    const body = $("#panel-content-body");
    if (!body) return;
    await loadRegistry();
    const roster = registryAgents.length ? registryAgents.map((a) => `
      <button class="sess-agent-pick text-left rounded-xl border ${a.id === selectedAgentId ? "border-cyan-600/70 bg-cyan-950/30" : "border-neutral-800 bg-neutral-900/60"} p-3 hover:border-cyan-500/40 transition" data-agent="${esc(a.id)}">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${a.tmux_session ? "bg-emerald-500" : "bg-neutral-600"}"></span>
          <span class="text-sm font-medium text-neutral-100 truncate">${esc(a.name || a.id)}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">${esc(a.provider || "vertex")}</span>
        </div>
        <div class="mt-1.5 text-[11px] text-neutral-500 truncate">${esc(a.persona || "no persona")} · ${esc(a.provider || "vertex")}${a.model ? ` · ${esc(a.model)}` : ""}</div>
        ${(a.capabilities || []).length ? `<div class="mt-2 flex flex-wrap gap-1">${a.capabilities.slice(0, 3).map((c) => `<span class="text-[9px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">${esc(c)}</span>`).join("")}</div>` : ""}
      </button>`).join("") : '<div class="session-empty">No registered agents found.</div>';
    body.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-neutral-100">Agents</span>
          <span class="text-[11px] text-neutral-500">${registryAgents.length} agent${registryAgents.length === 1 ? "" : "s"}</span>
          <button id="agent-new" class="ml-auto text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-md px-3 py-1 font-medium transition">+ New agent</button>
        </div>
        <div class="flex flex-col gap-3">${roster}</div>
      </div>`;
    ensurePanel1Visible();
    if (window.ceoUI && window.ceoUI.setPanelTitle) window.ceoUI.setPanelTitle("Agents");
  }

  function titleFromPrompt(prompt) {
    const text = String(prompt || "").replace(/\s+/g, " ").trim();
    if (!text) return "New agent session";
    return text.length > 54 ? `${text.slice(0, 51)}...` : text;
  }

  async function activateSession(session, { renderList = sessionsNavActive, announce = true, decomposition = null } = {}) {
    if (!session || !session.id) return;
    const activeR = await window.ceo.sessionsSetActive(session.id);
    activeSession = (activeR && activeR.session) || session;
    if (announce) {
      renderTranscript();
      appendChat("sys", `Session "${activeSession.title}" — lead ${activeSession.leadAgentId}, phase ${activeSession.phase}. Room ${activeSession.room}.`);
    }
    const input = $("#chat-input");
    if (input) input.placeholder = `Message ${activeSession.leadAgentId}…`;
    const title = $("#session-bar-title");
    if (title) title.textContent = activeSession.title;
    const phase = $("#session-phase-select");
    if (phase) phase.value = activeSession.phase;
    $("#session-bar")?.classList.remove("hidden");
    if (renderList) await renderSessionList();
    if (decomposition) renderSessionDetail(activeSession, decomposition);
    else await refreshSessionDetail();
    renderAgentsStrip();
    renderWorkflowPanel();
    setMainLayout();
    startRoomPoll();
    await refreshRoomStatus();
    if (sessionsNavActive && window.ceoUI && window.ceoUI.setPanelTitle) window.ceoUI.setPanelTitle("Sessions");
  }

  async function ensureAutoSession(prompt, { leadAgentId } = {}) {
    if (activeSession) return { ok: true, session: activeSession, created: false };
    if (!projectReady()) return { ok: false, reason: "open a project first" };
    const pending = pendingBriefSession;
    const agentId = leadAgentId || pending?.leadAgentId || selectedAgentId || "ceo";
    const r = await window.ceo.sessionsCreate({
      title: pending?.title || titleFromPrompt(prompt),
      leadAgentId: agentId,
      allowPaid: selectedAgentAllowPaid === true,
      briefRef: pending?.briefRef || null,
    });
    if (!r || !r.ok) return r || { ok: false, reason: "session create failed" };
    pendingBriefSession = null;
    await activateSession(r.session, { renderList: sessionsNavActive, announce: false });
    appendChat("sys", `Session created: ${r.session.title}`);
    return { ok: true, session: r.session, created: true };
  }

  async function openSession(id) {
    const g = await window.ceo.sessionsGet(id);
    if (!g || !g.ok) return;
    pendingBriefSession = null;
    ensurePanel1Visible();
    setComposerAgent(g.session.leadAgentId || selectedAgentId);
    await activateSession(g.session, { renderList: true, announce: true, decomposition: g.decomposition });
  }

  async function startAgentSession(agentId) {
    if (!projectReady()) {
      appendChat("sys", "Open a project first.");
      return;
    }
    await loadRegistry();
    pendingBriefSession = null;
    setComposerAgent(agentId);
    appendChat("sys", `Mounting ${agentId}...`);
    let mountResult = null;
    try {
      mountResult = await window.ceo.registryMount(agentId, { allowPaid: true });
    } catch (e) {
      mountResult = { ok: false, reason: String(e) };
    }
    selectedAgentAllowPaid = !!(mountResult && mountResult.ok);
    await loadRegistry();
    
    // Don't auto-activate existing sessions - let user choose
    // This prevents automatically loading previous sessions
    await window.ceo.sessionsSetActive(null);
    activeSession = null;
    stopRoomPoll();
    const stream = $("#panel2-stream");
    if (stream) stream.innerHTML = "";
    $("#session-bar")?.classList.add("hidden");
    renderAgentsStrip();
    renderWorkflowPanel();
    setMainLayout();
    appendChat("sys", `${agentId} selected. Send a message to create a fresh session.`);
    
    if (mountResult && mountResult.ok) {
      appendChat("sys", `${agentId} mounted in ${mountResult.session || "tmux"}.`);
    } else {
      appendChat("sys", `${agentId} selected, but mount failed: ${mountResult ? mountResult.reason : "unknown"}`);
    }
    await renderSessionList();
  }

  async function prepareBriefSession({ board, taskId, runId, title, leadAgentId } = {}) {
    const boardSlug = String(board || "").trim();
    const id = String(taskId || "").trim();
    if (!projectReady()) return { ok: false, reason: "open a project first" };
    if (!boardSlug || !id) return { ok: false, reason: "board and taskId required" };
    await window.ceo.sessionsSetActive(null);
    activeSession = null;
    pendingBriefSession = {
      title: String(title || "Brief Run").trim() || "Brief Run",
      leadAgentId: String(leadAgentId || "ceo").trim() || "ceo",
      briefRef: {
        board: boardSlug,
        taskId: id,
        runId: String(runId || `${boardSlug}:${id}`).trim(),
      },
    };
    selectedAgentAllowPaid = false;
    setComposerAgent(pendingBriefSession.leadAgentId);
    stopRoomPoll();
    stopInspect();
    $("#session-bar")?.classList.add("hidden");
    renderAgentsStrip();
    renderWorkflowPanel();
    setMainLayout();
    const stream = $("#panel2-stream");
    if (stream) stream.innerHTML = "";
    appendChat("sys", `Brief "${pendingBriefSession.title}" is ready. Send the first message to create its linked session.`);
    await renderSessionList();
    return { ok: true, pending: pendingBriefSession };
  }

  async function closeSessionChat() {
    await window.ceo.sessionsSetActive(null);
    activeSession = null;
    pendingBriefSession = null;
    stopRoomPoll();
    stopInspect();
    $("#session-bar")?.classList.add("hidden");
    $("#session-live-start")?.classList.remove("hidden");
    $("#session-live-stop")?.classList.add("hidden");
    const stream = $("#panel2-stream");
    if (stream) stream.innerHTML = "";
    renderAgentsStrip();
    setMainLayout();
    renderSessionDetail(null);
    await renderSessionList();
  }

  function startRoomPoll() {
    stopRoomPoll();
    if (!activeSession) return;
    roomPollTimer = setInterval(pollRoomTail, 5000);
    pollRoomTail();
  }

  function stopRoomPoll() {
    if (roomPollTimer) { clearInterval(roomPollTimer); roomPollTimer = null; }
  }

  async function pollRoomTail() {
    if (!activeSession) return;
    const feed = $("#session-room-feed");
    if (!feed) return;
    if (isAguiReady()) return; // AGUI renders chat; skip raw feed to avoid duplicates
    try {
      const r = await window.ceo.sessionsRoom(activeSession.room);
      const lines = (r && r.feed) || [];
      feed.textContent = lines.length
        ? lines.slice(-12).map((e) => `[${e.speaker}] ${stripAguiBlocks(e.body) || "(rendered artifact)"}`).join("\n\n")
        : "Room quiet — post from chat or spawn workers.";
      await refreshRoomStatus();
    } catch {
      feed.textContent = "(room unavailable)";
    }
  }

  async function runTurn(prompt) {
    if (!activeSession) return;
    if (window.ceoUI && window.ceoUI.setAgentState) window.ceoUI.setAgentState("thinking");
    if (window.CEOAgui) {
      const out = await window.CEOAgui.run(prompt);
      if (!out || !out.ok) appendChat("sys", `⚠ ${out ? out.reason : "AGUI unavailable"}`);
      else showArtifactPanel();
      if (window.ceoUI && window.ceoUI.setAgentState) window.ceoUI.setAgentState("idle");
      await refreshActive();
      await refreshSessionDetail();
      return;
    }
    appendChat("user", prompt);
    appendChat("sys", "AGUI not loaded — reload the app.");
    if (window.ceoUI && window.ceoUI.setAgentState) window.ceoUI.setAgentState("idle");
  }

  async function spawnWorker() {
    if (!activeSession) return;
    await loadRegistry();
    const pick = registryAgents.filter((a) => a.id !== activeSession.leadAgentId);
    const names = pick.map((a) => `${a.id} (${a.name || a.id})`).join("\n");
    const raw = window.prompt(`Agent id to spawn:\n\n${names}`, pick[0] ? pick[0].id : "");
    if (!raw || !raw.trim()) return;
    const agentId = raw.trim().split(/\s/)[0];
    const role = window.prompt("Role label (e.g. design, developer):", agentId) || agentId;
    appendChat("sys", `Spawning worker ${agentId}…`);
    const r = await window.ceo.sessionsSpawnWorker({
      sessionId: activeSession.id,
      agentId,
      role,
    });
    if (r && r.ok) {
      activeSession = r.session;
      appendChat("sys", `Worker ${agentId} — ${r.mount && r.mount.ok ? "mounted" : r.mount?.reason || "mount issue"}`);
      renderAgentsStrip();
      await refreshSessionDetail();
    } else {
      appendChat("sys", `Spawn failed: ${r ? r.reason : "unknown"}`);
    }
  }

  async function openAgentTerminal(agentId) {
    const id = String(agentId || "").trim();
    if (!id) return;
    window.__ceoPendingTerminalAgent = id;
    if (window.ceoUI && window.ceoUI.openView) {
      await window.ceoUI.openView("terminal");
      if (window.CEOPuTI && window.CEOPuTI.openAgent) await window.CEOPuTI.openAgent(id);
      return;
    }
    await openInspect(id);
  }

  async function openInspect(agentId) {
    inspectAgentId = agentId;
    inspectWindow = "main";
    const pane = $("#panel-inspect");
    const out = $("#panel-inspect-output");
    const title = $("#panel-inspect-title");
    if (!pane || !out) return;
    pane.classList.remove("hidden");
    if (title) title.textContent = `${agentId} — terminal`;
    showArtifactPanel();
    setMainLayout();
    if (inspectTimer) clearInterval(inspectTimer);
    const poll = async () => {
      if (!inspectAgentId) return;
      try {
        const r = await window.ceo.registryTerminal(inspectAgentId);
        if (r && r.ok) {
          inspectWindow = r.window || inspectWindow || "main";
          out.textContent = r.output || "(empty)";
          if (title) title.textContent = `${agentId} — terminal:${inspectWindow}`;
        } else {
          out.textContent = `Terminal: ${r ? r.reason : "unavailable"}. Mount the agent first.`;
        }
      } catch (e) {
        out.textContent = String(e);
      }
      out.scrollTop = out.scrollHeight;
    };
    await poll();
    inspectTimer = setInterval(poll, 1500);
  }

  function stopInspect() {
    if (inspectTimer) { clearInterval(inspectTimer); inspectTimer = null; }
    inspectAgentId = null;
    inspectWindow = "main";
    $("#panel-inspect")?.classList.add("hidden");
  }

  async function sendInspectLine() {
    const input = $("#panel-inspect-input");
    const out = $("#panel-inspect-output");
    if (!inspectAgentId || !input) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    const r = await window.ceo.registryTerminalSend(inspectAgentId, text, inspectWindow || "main");
    if (!r || !r.ok) {
      if (out) out.textContent += `\n\n[send failed] ${r ? r.reason : "unknown"}`;
      return;
    }
    if (out) out.textContent += `\n\n[you -> ${inspectAgentId}] ${text}`;
    setTimeout(() => {
      if (inspectAgentId) openInspect(inspectAgentId);
    }, 350);
  }

  async function onPhaseChange(phase) {
    if (!activeSession) return;
    const r = await window.ceo.sessionsUpdate(activeSession.id, { phase });
    if (r && r.ok) {
      activeSession = r.session;
      appendChat("sys", `Phase → ${phase}`);
      renderWorkflowPanel();
      renderAgentsStrip();
    } else {
      appendChat("sys", `Phase blocked: ${r ? r.reason : "unknown"}`);
      const sel = $("#session-phase-select");
      if (sel) sel.value = activeSession.phase;
    }
  }

  function wire() {
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#chat-agent")) {
        await renderAgentPicker();
        return;
      }
      const pickAgent = e.target.closest(".sess-agent-pick");
      if (pickAgent && pickAgent.dataset.agent) {
        await startAgentSession(pickAgent.dataset.agent);
        return;
      }
      const openBtn = e.target.closest(".sess-open");
      if (openBtn) {
        await openSession(openBtn.dataset.id);
        return;
      }
      const card = e.target.closest(".session-agent-card");
      if (card && card.dataset.agent) {
        await openAgentTerminal(card.dataset.agent);
        return;
      }
      const workerTerminal = e.target.closest(".session-worker-terminal");
      if (workerTerminal && workerTerminal.dataset.agent) {
        await openAgentTerminal(workerTerminal.dataset.agent);
        return;
      }
      if (e.target.closest("#session-spawn-worker")) {
        await spawnWorker();
        return;
      }
      if (e.target.closest("#session-close")) {
        await closeSessionChat();
        return;
      }
      if (e.target.closest("#session-live-start")) {
        await startLiveRoom();
        return;
      }
      if (e.target.closest("#session-live-stop")) {
        await stopLiveRoom();
        return;
      }
      if (e.target.closest("#panel-inspect-close")) {
        stopInspect();
        return;
      }
      if (e.target.closest("#panel-inspect-send")) {
        await sendInspectLine();
        return;
      }
      if (e.target.closest("#terminal-send")) {
        await sendInspectLine();
        return;
      }
      if (e.target.closest("#sess-plan-capture")) { await capturePlan(); return; }
      if (e.target.closest("#sess-plan-view") || e.target.closest("#sess-plan-view-detail")) {
        renderPlanInLeftPanel();
        return;
      }
      if (e.target.closest("#sess-plan-approve") || e.target.closest("#sess-plan-approve-panel")) { await approvePlan(); return; }
      if (e.target.closest("#sess-plan-reject") || e.target.closest("#sess-plan-reject-panel")) { await rejectPlan(); return; }
      if (e.target.closest("#sess-team-add")) { await addTeamMember(); return; }
      if (e.target.closest("#sess-team-launch")) { await launchTeam(); return; }
      if (e.target.closest("#sess-tree-add")) { await addTaskStep(); return; }
      if (e.target.closest("#sess-tree-view")) { renderTaskTreeInLeftPanel(); return; }
      if (e.target.closest("#sess-back-list")) { renderSessionList(); return; }
    });

    $("#session-phase-select")?.addEventListener("change", (e) => {
      onPhaseChange(e.target.value);
    });
    $("#panel-inspect-input")?.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await sendInspectLine();
      }
    });
    $("#terminal-input")?.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await sendInspectLine();
      }
    });
  }

  async function openView() {
    sessionsNavActive = true;
    ensurePanel1Visible();
    await refreshActive();
    stopInspect();
    await renderSessionList();

    if (activeSession) {
      $("#session-bar")?.classList.remove("hidden");
      const title = $("#session-bar-title");
      if (title) title.textContent = activeSession.title;
      const phase = $("#session-phase-select");
      if (phase) phase.value = activeSession.phase;
      renderWorkflowPanel();
      renderAgentsStrip();
      startRoomPoll();
      await refreshRoomStatus();
      await refreshSessionDetail();
    } else {
      renderSessionDetail(null);
      $("#session-bar")?.classList.add("hidden");
      $("#session-workflow")?.classList.add("hidden");
      $("#session-agents-strip")?.classList.add("hidden");
      const stream = $("#panel2-stream");
      if (stream && !stream.querySelector(".agui-msg")) {
        stream.innerHTML = '<div class="text-neutral-600 text-sm p-1">Select or create a session — chat opens on the right.</div>';
      }
    }

    if (window.ceoUI && window.ceoUI.setPanelTitle) window.ceoUI.setPanelTitle("Sessions");
    setMainLayout();
  }

  function onLeave() {
    sessionsNavActive = false;
    $("#panel1")?.classList.remove("sessions-panel-visible");
    const main = document.querySelector("main.flex-1");
    if (main) main.classList.remove("studio-session-active");
  }

  function getArtifactHost() {
    if (!sessionsNavActive) return null;
    return $("#session-artifact-host");
  }

  window.StudioSessions = {
    init: wire,
    openView,
    onLeave,
    isChatActive,
    isNavActive: () => sessionsNavActive,
    runTurn,
    ensureAutoSession,
    renderAgentPicker,
    startAgentSession,
    prepareBriefSession,
    setComposerAgent,
    refreshActive,
    refreshSessionDetail,
    getActive: () => activeSession,
    getArtifactHost,
    showArtifactPanel,
    renderSessionList,
  };

  wire();
})();
