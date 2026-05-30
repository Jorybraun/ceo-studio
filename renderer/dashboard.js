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

  // Preferred left-to-right column order; unknown statuses are appended.
  const COL_ORDER = ["triage", "todo", "ready", "running", "blocked", "scheduled", "review", "done"];
  const COL_ACCENT = {
    running: "border-emerald-500/40", ready: "border-sky-500/40",
    blocked: "border-red-500/40", todo: "border-neutral-600",
    done: "border-neutral-700", review: "border-amber-500/40",
    scheduled: "border-violet-500/40", triage: "border-pink-500/40",
  };
  const DOT = {
    running: "bg-emerald-500", ready: "bg-sky-500", blocked: "bg-red-500",
    done: "bg-neutral-500", review: "bg-amber-500", scheduled: "bg-violet-500",
    todo: "bg-neutral-500", triage: "bg-pink-500",
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
    if (!ceo.ceoBoards) return;
    let res = {};
    try { res = await ceo.ceoBoards(); } catch { res = {}; }
    const boards = (res && res.boards) || [];
    if (!board) board = (res && res.current) || (boards[0] && boards[0].slug) || null;
    const sel = $("dash-board");
    if (sel) {
      sel.innerHTML = boards.map((b) =>
        `<option value="${esc(b.slug)}" ${b.slug === board ? "selected" : ""}>${esc(b.name || b.slug)}</option>`).join("");
    }
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
        return `<div class="rounded-lg border border-neutral-800 bg-neutral-900/70 p-2.5">
          <div class="text-[13px] text-neutral-100 leading-snug">${esc(t.title)}</div>
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
  function fillModels(provider) {
    const sel = $("config-model");
    const list = (cfg && cfg.models && cfg.models[provider]) || [];
    sel.innerHTML = list.length
      ? list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")
      : `<option value="">(type not available — pick another provider)</option>`;
    // preselect current model if same provider
    if (cfg && cfg.model && cfg.model.provider === provider && cfg.model.default) {
      sel.value = cfg.model.default;
    }
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
    // current model
    const m = cfg.model || {};
    $("config-current").textContent = `current: ${m.provider || "?"} / ${m.default || "?"}`;
    // providers
    const psel = $("config-provider");
    psel.innerHTML = (cfg.providers || []).map((p) =>
      `<option value="${esc(p)}" ${p === m.provider ? "selected" : ""}>${esc(p)}</option>`).join("")
      || `<option value="">(no providers authed)</option>`;
    fillModels(psel.value || (cfg.providers || [])[0]);
  }
  function closeConfig() { $("config-panel").classList.add("hidden"); }

  function wireConfig() {
    const btn = $("dash-config-btn"); if (btn) btn.addEventListener("click", openConfig);
    const close = $("config-close"); if (close) close.addEventListener("click", closeConfig);
    const psel = $("config-provider"); if (psel) psel.addEventListener("change", (e) => fillModels(e.target.value));
    const apply = $("config-apply");
    if (apply) apply.addEventListener("click", async () => {
      const provider = $("config-provider").value;
      const model = $("config-model").value;
      $("config-msg").textContent = "applying…";
      const r = await ceo.ceoSetModel(provider, model);
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

  function wire() {
    const toggle = $("toggle-dashboard");
    if (toggle) toggle.addEventListener("click", () => (open ? hide() : show()));
    const close = $("dash-close");
    if (close) close.addEventListener("click", hide);
    const rf = $("dash-refresh");
    if (rf) rf.addEventListener("click", refresh);
    const sel = $("dash-board");
    if (sel) sel.addEventListener("change", (e) => { board = e.target.value; refresh(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) hide(); });

    wireConfig();

    // CEO status pill polls continuously, even with the dashboard closed.
    refreshStatus();
    statusTimer = setInterval(refreshStatus, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else { wire(); }
})();
