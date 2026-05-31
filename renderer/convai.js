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
const hdrBtn = document.getElementById("header-voice");
const hdrLabel = document.getElementById("header-voice-label");
const hdrIcon = document.getElementById("header-voice-icon");

let conversation = null;
let active = false;
let starting = false;   // synchronous guard against double-start (rapid clicks)
let endTimer = null;
let countdownTimer = null;
let available = false;

function setLabel(text, live) {
  if (hdrLabel) hdrLabel.textContent = live ? "End" : "Voice";
  if (hdrIcon) hdrIcon.textContent = live ? "⏹️" : "🎙️";
  if (hdrBtn) {
    hdrBtn.classList.toggle("bg-red-600", !!live);
    hdrBtn.classList.toggle("border-red-500", !!live);
    hdrBtn.classList.toggle("bg-neutral-800", !live);
  }
}

async function currentBoardSlug(preferred) {
  if (preferred) return preferred;
  try {
    const r = await window.ceo.ceoBoards();
    return (r && (r.current || (r.boards && r.boards[0] && r.boards[0].slug))) || "ceo-studio";
  } catch {
    return "ceo-studio";
  }
}

function flattenTree(nodes, depth = 0, out = []) {
  for (const n of nodes || []) {
    out.push(`${"  ".repeat(depth)}${n.type === "dir" ? "/" : ""}${n.path}`);
    if (n.children) flattenTree(n.children, depth + 1, out);
    if (out.length >= 120) break;
  }
  return out;
}

// Build a rich snapshot of the live Studio state so the agent starts every turn
// already knowing WHERE we are (project/domain/file), WHO is on the team, the
// board state, and recent decisions. Sent as a non-spoken contextual update on
// connect and whenever the user changes domain/project/file — so the agent is
// never "blind" and rarely needs to ask "which project/domain are we on?".
async function buildStudioContext(reason = "") {
  const u = ui();
  const ctx = (u.getContext && u.getContext()) || {};
  const lines = ["=== CEO STUDIO LIVE CONTEXT ==="];
  if (reason) lines.push(`(update reason: ${reason})`);

  const proj = ctx.project;
  lines.push(`Project: ${proj ? `${proj.name}${proj.slug ? ` [${proj.slug}]` : ""}` : "none open"}`);
  lines.push(`Active domain: ${ctx.domain || "All"}`);
  if (ctx.selectedFile && ctx.selectedFile.path) lines.push(`Open file: ${ctx.selectedFile.path}`);

  // Team roster (agents + teams) from the registry — single source of truth.
  try {
    const reg = window.ceo.registryList ? await window.ceo.registryList() : null;
    const agents = (reg && reg.agents) || [];
    const teams = (reg && reg.teams) || [];
    if (agents.length) {
      lines.push("", `Team roster (${agents.length} agents):`);
      for (const a of agents.slice(0, 25)) {
        const brain = a.provider ? `${a.provider}${a.model ? `/${a.model}` : ""}` : "echo";
        lines.push(`- ${a.name || a.id} (${a.persona || "no persona"}, ${brain})${a.tmux_session ? " — MOUNTED/live" : ""}`);
      }
    } else {
      lines.push("", "Team roster: no agents defined yet.");
    }
    if (teams.length) {
      lines.push("Teams:");
      for (const t of teams.slice(0, 12)) lines.push(`- ${t.name}: ${(t.members || []).join(", ") || "no members"}`);
    }
  } catch { /* roster optional */ }

  // Kanban board snapshot (tickets per lane) for the active board.
  try {
    const slug = await currentBoardSlug();
    const board = slug && window.ceo.ceoBoard ? await window.ceo.ceoBoard(slug) : null;
    if (board && board.ok && board.columns) {
      lines.push("", `Board "${slug}" — tickets by lane:`);
      for (const [status, tasks] of Object.entries(board.columns)) {
        const list = (tasks || []).slice(0, 8).map((t) => `${t.id} ${t.title}${t.assignee ? ` [@${t.assignee}]` : ""}`);
        lines.push(`  ${status} (${(tasks || []).length}): ${list.join("; ") || "—"}`);
      }
    }
  } catch { /* board optional */ }

  // Recent brain memory (decisions + contradictions) for the active domain.
  try {
    const r = window.ceo.getBrainContext ? await window.ceo.getBrainContext(ctx.domain) : null;
    const bc = r && r.ok && r.context;
    if (bc) {
      const decs = (bc.recentDecisions || []).slice(0, 4);
      const cons = (bc.recentContradictions || []).slice(0, 4);
      if (decs.length) { lines.push("", "Recent decisions:"); decs.forEach((d) => lines.push(`- ${d.title}: ${d.summary || ""}`)); }
      if (cons.length) { lines.push("Open contradictions:"); cons.forEach((c) => lines.push(`- ${c.title}: ${c.summary || ""}`)); }
    }
  } catch { /* brain optional */ }

  lines.push("", "Use this context directly; only call tools to go deeper or to act.");
  return lines.join("\n");
}

let lastContextSig = "";
// Send the live snapshot to the running agent (best-effort, non-spoken).
async function pushContext(reason = "") {
  if (!active || !conversation || typeof conversation.sendContextualUpdate !== "function") return;
  let text;
  try { text = await buildStudioContext(reason); } catch { return; }
  // De-dupe identical snapshots (change events can fire in bursts); always send
  // on session start so the first turn is fully informed.
  const sig = text.replace(/\(update reason:.*\)\n/, "");
  if (sig === lastContextSig && !String(reason).includes("start")) return;
  lastContextSig = sig;
  try { await conversation.sendContextualUpdate(text); } catch { /* best-effort */ }
}

// Client tools the live agent can invoke mid-conversation. Names MUST match
// the tool definitions in main/core/convai.js (TOOLS). Each returns a STRING
// that ElevenLabs appends to the agent's context (expects_response: true).
const clientTools = {
  async get_current_context() {
    const ctx = ui().getContext?.() || {};
    return JSON.stringify(ctx, null, 2);
  },
  async list_domains() {
    const r = await window.ceo.getAllDomains();
    if (!r || !r.ok) return `Could not list domains: ${r ? r.reason : "unknown"}`;
    const domains = r.domains || [];
    if (!domains.length) return "No domains are configured yet.";
    return domains.map((d) => {
      const loc = d.relativePath ? ` (${d.relativePath})` : "";
      return `- ${d.name}${loc}: ${d.purpose || "no purpose set"}`;
    }).join("\n");
  },
  async list_project_files({ domain } = {}) {
    const r = await window.ceo.docsTree(domain);
    if (!r || !r.ok) return `Could not list files: ${r ? r.reason : "unknown"}`;
    return `Files for ${r.domain || "project"} rooted at ${r.root || "."}${r.truncated ? " (truncated)" : ""}:\n` +
      flattenTree(r.tree).join("\n");
  },
  async read_project_file({ path } = {}) {
    if (!path) return "No path provided.";
    const r = await window.ceo.docsRead(path);
    if (!r || !r.ok) return `Could not read ${path}: ${r ? r.reason : "unknown"}`;
    ui().showPanel?.(path, r.text);
    ui().appendStream?.("sys", `Showing ${path}`);
    return `Displayed ${path}. Contents:\n\n${r.text.slice(0, 9000)}`;
  },
  async render_panel({ title, components } = {}) {
    const normalized = (Array.isArray(components) ? components : [])
      .filter((c) => c && typeof c === "object" && c.type)
      .map((c) => c.props ? c : ({ type: c.type, props: Object.fromEntries(Object.entries(c).filter(([k]) => k !== "type")) }));
    const panel = { title: title || "", components: normalized };
    ui().showAgui?.(panel);
    return `Rendered panel${panel.title ? `: ${panel.title}` : ""}.`;
  },
  async list_tickets({ board } = {}) {
    const slug = await currentBoardSlug(board);
    const r = await window.ceo.ceoBoard(slug);
    if (!r || !r.ok) return `Could not load board ${slug}: ${r ? r.reason : "unknown"}`;
    const lines = [];
    for (const [status, tasks] of Object.entries(r.columns || {})) {
      lines.push(`${status}:`);
      for (const t of tasks.slice(0, 20)) lines.push(`- ${t.id} [${t.assignee || "unassigned"}] ${t.title}`);
    }
    return lines.join("\n") || `Board ${slug} has no tickets.`;
  },
  async show_ticket({ id, board } = {}) {
    if (!id) return "No ticket id provided.";
    const slug = await currentBoardSlug(board);
    const r = await window.ceo.ceoTaskDetail(slug, id);
    if (!r || !r.ok) return `Could not load ticket ${id}: ${r ? r.reason : "unknown"}`;
    const task = r.task || {};
    const comments = (r.comments || []).map((c) => `- ${c.author || "comment"}: ${c.body || ""}`).join("\n");
    const md = [
      `Status: ${task.status || "unknown"}`,
      `Assignee: ${task.assignee || "unassigned"}`,
      "",
      task.body || "(no description)",
      comments ? `\n## Comments\n\n${comments}` : "",
    ].join("\n");
    ui().showPanel?.(`${task.id || id}: ${task.title || "Ticket"}`, md);
    ui().appendStream?.("sys", `Showing ticket ${id}`);
    return `Displayed ticket ${id}: ${task.title || ""}\n\n${md.slice(0, 9000)}`;
  },
  async prepare_ticket_context({ ticketId, board, domain, instructions } = {}) {
    if (!ticketId) return "No ticket id provided.";
    const slug = await currentBoardSlug(board);
    const r = await window.ceo.jobCreateTicketPack({
      board: slug,
      ticketId,
      domain: domain || ui().getContext?.().domain,
      instructions,
    });
    if (!r || !r.ok) return `Could not queue ticket planning pack: ${r ? r.reason : "unknown"}`;
    const jobId = r.job.id;
    ui().appendStream?.("sys", `Queued planning pack ${jobId} for ${ticketId}`);
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const got = await window.ceo.jobGet(jobId);
      const job = got && got.job;
      if (job && job.status === "done") {
        if (job.output && job.output.panel) ui().showAgui?.(job.output.panel);
        return `${job.output.summary}\n\nJob: ${jobId}\n\nGaps:\n${(job.output.gaps || []).map((g) => `- ${g}`).join("\n")}\n\nSuggested acceptance criteria:\n${(job.output.acceptanceCriteria || []).map((a) => `- ${a}`).join("\n")}\n\nAsk me to apply this as a ticket comment if you want it saved to Kanban.`;
      }
      if (job && job.status === "failed") return `Planning pack ${jobId} failed: ${job.error || "unknown error"}`;
    }
    return `Planning pack queued as ${jobId}. It is still running; ask me to check job ${jobId}.`;
  },
  async get_agent_job({ jobId } = {}) {
    if (!jobId) return "No job id provided.";
    const r = await window.ceo.jobGet(jobId);
    if (!r || !r.ok) return `Could not get job ${jobId}: ${r ? r.reason : "unknown"}`;
    const job = r.job;
    if (job.status === "done" && job.output && job.output.panel) ui().showAgui?.(job.output.panel);
    return `Job ${job.id}: ${job.status}${job.error ? ` (${job.error})` : ""}` +
      (job.output ? `\n${job.output.summary || ""}` : "");
  },
  async apply_ticket_comment({ jobId } = {}) {
    if (!jobId) return "No job id provided.";
    const r = await window.ceo.jobApplyTicketComment(jobId);
    if (!r || !r.ok) return `Could not apply ticket comment: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `Applied planning pack ${jobId} as a Kanban comment`);
    return `Applied planning pack ${jobId} as a Kanban comment.`;
  },
  async gbrain_status() {
    const r = await window.ceo.gbrainStatus();
    if (!r || !r.ok) return `Could not check GBrain: ${r ? r.reason : "unknown"}`;
    if (!r.available) return `GBrain is not available: ${r.reason || "not reachable"}`;
    return `GBrain is available at ${r.url || "configured endpoint"}.`;
  },
  async gbrain_query({ query, domain } = {}) {
    if (!query) return "No GBrain query provided.";
    const r = await window.ceo.gbrainQuery(query, { domain: domain || ui().getContext?.().domain });
    if (!r || !r.ok) return `GBrain query failed: ${r ? r.reason : "unknown"}. I can still use the local project brain.`;
    const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2);
    ui().appendStream?.("sys", `GBrain query: ${query.slice(0, 80)}`);
    return `GBrain result from ${r.endpoint || "endpoint"}:\n${text.slice(0, 9000)}`;
  },
  async gbrain_ingest({ title, content, domain } = {}) {
    if (!title || !content) return "Title and content are required for GBrain ingest.";
    const local = await window.ceo.addToBrain(title, content, "insight");
    const r = await window.ceo.gbrainIngest({
      title,
      content,
      domain: domain || ui().getContext?.().domain,
      metadata: { source: "voice-agent", localBrainArtifactId: local && local.id },
    });
    if (!r || !r.ok) return `Saved locally${local && local.id ? ` as ${local.id}` : ""}, but GBrain ingest failed: ${r ? r.reason : "unknown"}`;
    return `Saved locally${local && local.id ? ` as ${local.id}` : ""} and ingested into GBrain via ${r.endpoint || "endpoint"}.`;
  },
  async tell_ceo({ briefing } = {}) {
    const msg = (briefing || "").trim();
    if (!msg) return "No briefing provided.";
    ui().appendStream?.("sys", "Voice handoff → CEO...");
    let r;
    try { r = await window.ceo.askCeo(msg); }
    catch (e) { return `The CEO is unreachable right now (${e && e.message ? e.message : "error"}).`; }
    if (!r || !r.ok) return `The CEO couldn't respond: ${r ? r.reason : "unknown error"}`;
    ui().appendStream?.("agent", r.reply);
    return r.reply;
  },
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
  // --- Team communication: talk to the agent team (registry + A2A meetings) ---
  async list_agents() {
    const reg = await window.ceo.registryList();
    const agents = (reg && reg.agents) || [];
    const teams = (reg && reg.teams) || [];
    if (!agents.length) return "No agents are defined yet. Ask me to create one or use the Team panel.";
    const roster = agents.map((a) => {
      const brain = a.provider ? `${a.provider}${a.model ? `/${a.model}` : ""}` : "echo";
      return `- ${a.name || a.id} (id: ${a.id}; ${a.persona || "no persona"}; ${brain})${a.tmux_session ? " — MOUNTED/live" : " — not mounted"}`;
    }).join("\n");
    const teamLines = teams.length
      ? "\n\nTeams:\n" + teams.map((t) => `- ${t.name}: ${(t.members || []).join(", ") || "no members"}`).join("\n")
      : "";
    return `Team roster (${agents.length}):\n${roster}${teamLines}`;
  },
  async message_agent({ agent, message } = {}) {
    if (!agent || !message) return "Provide both agent (id or name) and message.";
    const reg = await window.ceo.registryList();
    const a = ((reg && reg.agents) || []).find((x) => x.id === agent || x.name === agent);
    if (!a) return `No agent "${agent}" in the registry. Call list_agents to see who's available.`;
    if (!a.tmux_session) return `${a.name || a.id} is not mounted, so it has no live session to receive messages. Mount it from the Team panel first.`;
    const r = await window.ceo.registryTerminalSend(a.id, message);
    ui().appendStream?.("sys", `→ ${a.name || a.id}: ${message.slice(0, 80)}`);
    if (!r || !r.ok) return `Could not deliver to ${a.name || a.id}: ${r ? r.reason : "unknown"}`;
    return `Delivered to ${a.name || a.id}'s live session. Watch its terminal/room for the response.`;
  },
  async start_meeting({ room, agenda, criteria, members, team } = {}) {
    if (!agenda) return "An agenda is required to convene the team.";
    if (!team && !members) return "Specify a team name or comma-separated agent ids (members). Call list_agents to see options.";
    const r = await window.ceo.meetingStart({
      room: room || `meeting-${Date.now()}`,
      agenda,
      criteria: criteria || "",
      members: Array.isArray(members) ? members.join(",") : members,
      team,
    });
    if (!r || !r.ok) return `Could not start the meeting: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `🪑 Meeting "${r.room}": ${agenda.slice(0, 80)}`);
    return `Convened the team in room "${r.room}" on: ${agenda}. It runs in the background — call read_room with room "${r.room}" to follow the discussion and collect the resulting requirements.`;
  },
  async read_room({ room } = {}) {
    if (!room) return "Provide the room name returned by start_meeting.";
    const r = await window.ceo.meetingRoom(room);
    if (!r || !r.ok) return `Could not read room "${room}": ${r ? r.reason : "unknown"}`;
    const feed = (r.feed || []).slice(-20).map((e) => `[${e.speaker}] ${e.body}`).join("\n\n");
    const reqs = r.requirements ? `\n\n--- Requirements ---\n${r.requirements.slice(0, 4000)}` : "";
    return `Room "${room}" (${r.running ? "in progress" : "complete"}):\n\n${feed || "No messages yet."}${reqs}`;
  },
  // --- Render / navigation control: drive the Studio UI directly ---
  async open_view({ view } = {}) {
    const allowed = ["domain", "board", "tasks", "teams", "channels", "meetings"];
    const v = String(view || "").toLowerCase();
    if (!allowed.includes(v)) return `Unknown view "${view}". Choose one of: ${allowed.join(", ")}.`;
    await ui().openView?.(v);
    ui().appendStream?.("sys", `🧭 Opened ${v} view`);
    return `Opened the ${v} view.`;
  },
  async open_agent_detail({ agent } = {}) {
    if (!agent) return "Provide the agent id or name.";
    const ok = await ui().openAgentDetail?.(agent);
    if (ok === false) return `No agent "${agent}". Call list_agents first.`;
    ui().appendStream?.("sys", `👤 Opened agent ${agent}`);
    return `Opened ${agent}'s detail (left) and its live terminal/logs surface (right).`;
  },
  async mount_agent({ agent } = {}) {
    if (!agent) return "Provide the agent id or name.";
    const reg = await window.ceo.registryList();
    const a = ((reg && reg.agents) || []).find((x) => x.id === agent || x.name === agent);
    if (!a) return `No agent "${agent}".`;
    const r = await window.ceo.registryMount(a.id);
    if (!r || !r.ok) return `Could not mount ${a.name || a.id}: ${r ? r.reason : "unknown"}`;
    ui().refreshTeam?.();
    ui().appendStream?.("sys", `▶ Mounted ${a.name || a.id}`);
    return `Mounted ${a.name || a.id}; its live session is starting${r.room ? ` (room "${r.room}")` : ""}.`;
  },
  async unmount_agent({ agent } = {}) {
    if (!agent) return "Provide the agent id or name.";
    const reg = await window.ceo.registryList();
    const a = ((reg && reg.agents) || []).find((x) => x.id === agent || x.name === agent);
    if (!a) return `No agent "${agent}".`;
    const r = await window.ceo.registryUnmount(a.id);
    if (!r || !r.ok) return `Could not unmount ${a.name || a.id}: ${r ? r.reason : "unknown"}`;
    ui().refreshTeam?.();
    ui().appendStream?.("sys", `⏹ Unmounted ${a.name || a.id}`);
    return `Unmounted ${a.name || a.id}.`;
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
  async define_domain({
    name,
    purpose,
    overarchingGoal,
    responsibilities,
    coreAgents,
    kanbanBoard,
    relativePath,
    createScaffold = true,
  } = {}) {
    if (!name || !purpose) return "Domain name and purpose are required.";
    ui().appendStream?.("sys", `📋 Defining domain: ${name}`);
    const cleanName = String(name).trim();
    const respList = Array.isArray(responsibilities)
      ? responsibilities
      : String(responsibilities || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const agentList = Array.isArray(coreAgents)
      ? coreAgents
      : String(coreAgents || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const r = await window.ceo.defineDomain({
      name: cleanName,
      purpose,
      overarchingGoal: overarchingGoal || "",
      currentState: overarchingGoal || "",
      priorities: overarchingGoal ? [overarchingGoal] : [],
      activeEpics: overarchingGoal ? [overarchingGoal] : [],
      responsibilities: respList,
      coreAgents: agentList,
      kanbanBoard: kanbanBoard || null,
      createScaffold: !!createScaffold,
      relativePath: relativePath || `domains/${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    });
    if (!r || !r.ok) return `Failed to define domain: ${r ? r.reason : "unknown"}`;
    await ui().setDomainUI?.(r.definition.name);
    ui().showPanel?.(r.definition.name, [
      `Purpose: ${r.definition.purpose || "not set"}`,
      "",
      `Goal: ${r.definition.overarchingGoal || "not set"}`,
      "",
      `Board: ${r.definition.kanbanBoard || "not mapped"}`,
      "",
      `Team: ${(r.definition.coreAgents || []).join(", ") || "not assigned"}`,
      "",
      "Use the task board below as the navigation surface for planning.",
    ].join("\n"));
    ui().appendStream?.("sys", `✅ Domain defined: ${name}`);
    return `Domain "${r.definition.name}" defined. Purpose: ${purpose}. Goal: ${r.definition.overarchingGoal || "not set"}. Team: ${(r.definition.coreAgents || []).join(", ") || "not assigned"}.`;
  },
  async open_domain_wizard({
    name,
    purpose,
    overarchingGoal,
    responsibilities,
    coreAgents,
    kanbanBoard,
    relativePath,
  } = {}) {
    const respList = Array.isArray(responsibilities)
      ? responsibilities
      : String(responsibilities || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const agentList = Array.isArray(coreAgents)
      ? coreAgents
      : String(coreAgents || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    await ui().openDomainWizard?.({ name, purpose, overarchingGoal, responsibilities: respList, coreAgents: agentList, kanbanBoard, relativePath });
    return "Opened the domain creation form with the available draft fields. Ask the user to review it and press Create domain, or gather missing details first.";
  },
  async open_task_wizard({ board, title, body, status, assignee, persona, skills } = {}) {
    const skillList = Array.isArray(skills)
      ? skills
      : String(skills || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    await ui().openTaskWizard?.(board || null, { title, body, status, assignee, persona, skills: skillList });
    return "Opened the task creation form with the draft routing, persona, and skills. Ask the user to review it and press Create task unless they explicitly asked you to create it directly.";
  },
  async create_task({ board, title, body, status, assignee, persona, skills } = {}) {
    if (!title) return "Task title is required.";
    const skillList = Array.isArray(skills)
      ? skills
      : String(skills || "").split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const r = await ui().createTask?.({ board, title, body, status, assignee, persona, skills: skillList });
    if (!r || !r.ok) return `Failed to create task: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `✅ Task created: ${title}`);
    return `Created task "${title}"${assignee ? ` assigned to ${assignee}` : ""}${persona ? ` with persona ${persona}` : ""}.`;
  },
  async create_brief({
    board,
    title,
    goal,
    domain,
    currentRenderedState,
    problemMismatch,
    constraints,
    acceptanceCriteria,
    nextAction,
    owner,
    persona,
    reference,
  } = {}) {
    const slug = await currentBoardSlug(board);
    const activeDomain = domain || ui().getContext?.().domain || "All";
    const r = await window.ceo.createBrief({
      board: slug,
      title,
      goal,
      domain: activeDomain,
      currentRenderedState,
      problemMismatch,
      constraints,
      acceptanceCriteria,
      nextAction,
      owner,
      persona,
      reference,
      requestedBy: "voice-agent",
    });
    if (!r || !r.ok) {
      if (r && r.template) ui().showPanel?.("Brief draft needs missing fields", r.template);
      return `Brief was not created: ${r ? r.reason : "unknown"}.`;
    }
    ui().showPanel?.(title || "Brief", r.body);
    ui().appendStream?.("sys", `Created brief on ${r.board}${r.task && r.task.taskId ? `: ${r.task.taskId}` : ""}`);
    return `Created brief "${title}" on ${r.board}${r.task && r.task.taskId ? ` as ${r.task.taskId}` : ""}.`;
  },
  async create_bug({
    board,
    title,
    domain,
    observedBehavior,
    expectedBehavior,
    reproductionSteps,
    severity,
    impact,
    evidence,
    acceptanceCriteria,
    owner,
    persona,
  } = {}) {
    const slug = await currentBoardSlug(board);
    const activeDomain = domain || ui().getContext?.().domain || "All";
    const r = await window.ceo.createBug({
      board: slug,
      title,
      domain: activeDomain,
      observedBehavior,
      expectedBehavior,
      reproductionSteps,
      severity,
      impact,
      evidence,
      acceptanceCriteria,
      owner,
      persona,
      requestedBy: "voice-agent",
    });
    if (!r || !r.ok) {
      if (r && r.template) ui().showPanel?.("Bug draft needs missing fields", r.template);
      return `Bug was not created: ${r ? r.reason : "unknown"}.`;
    }
    ui().showPanel?.(title || "Bug", r.body);
    ui().appendStream?.("sys", `Created bug on ${r.board}${r.task && r.task.taskId ? `: ${r.task.taskId}` : ""}`);
    return `Created bug "${title}" on ${r.board}${r.task && r.task.taskId ? ` as ${r.task.taskId}` : ""}.`;
  },
  async decompose_brief({ board, taskId } = {}) {
    if (!taskId) return "No brief task id provided.";
    const slug = await currentBoardSlug(board);
    const r = await window.ceo.decomposeBrief({ board: slug, taskId });
    if (!r || !r.ok) return `Could not decompose brief ${taskId}: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `Requested decomposition for ${taskId}`);
    return `Requested Hermes decomposition for brief ${taskId}.`;
  },
  async create_child_task({
    board,
    domain,
    parentKind = "brief",
    parentId,
    title,
    outcome,
    acceptanceCriteria,
    verification,
    workspace,
    owner,
    persona,
    status,
  } = {}) {
    if (!parentId || !title) return "Parent id and title are required.";
    const slug = await currentBoardSlug(board);
    const r = await window.ceo.createChildTask({
      board: slug,
      domain: domain || ui().getContext?.().domain,
      parentKind,
      parentId,
      title,
      outcome,
      acceptanceCriteria,
      verification,
      workspace,
      owner,
      persona,
      status,
      requestedBy: "voice-agent",
    });
    if (!r || !r.ok) return `Could not create child task: ${r ? r.reason : "unknown"}`;
    ui().showPanel?.(title, r.body);
    ui().appendStream?.("sys", `Created linked child task${r.task && r.task.taskId ? ` ${r.task.taskId}` : ""} for ${parentId}`);
    return `Created child task "${title}" linked to ${parentKind} ${parentId}${r.task && r.task.taskId ? ` as ${r.task.taskId}` : ""}.`;
  },
  async record_brief_asset({ parentKind = "brief", parentId, assetKind, assetId, title, path, summary } = {}) {
    if (!parentId) return "Parent id is required.";
    const r = await window.ceo.recordBriefAsset({
      parentKind,
      parentId,
      assetKind,
      assetId,
      title,
      path,
      summary,
      requestedBy: "voice-agent",
    });
    if (!r || !r.ok) return `Could not record asset provenance: ${r ? r.reason : "unknown"}`;
    ui().appendStream?.("sys", `Recorded asset provenance for ${parentId}`);
    return `Recorded asset "${title || path || assetId}" under ${parentKind} ${parentId}.`;
  },
  async show_provenance({ parentId } = {}) {
    if (!parentId) return "Parent id is required.";
    const r = await window.ceo.provenanceGraph(parentId);
    if (!r || !r.ok) return `Could not read provenance: ${r ? r.reason : "unknown"}`;
    const children = (r.children || []).map((c) => `- ${c.kind}:${c.id}${c.title ? ` — ${c.title}` : ""}`).join("\n") || "- none";
    const assets = (r.assets || []).map((a) => `- ${a.kind}:${a.id}${a.path ? ` (${a.path})` : ""}${a.title ? ` — ${a.title}` : ""}`).join("\n") || "- none";
    const md = [`# Provenance: ${parentId}`, "", "## Child Work", children, "", "## Assets", assets].join("\n");
    ui().showPanel?.(`Provenance: ${parentId}`, md);
    return md;
  },
  async analyze_blocked_work({ board, domain, dryRun = false, limit } = {}) {
    const slug = board || await currentBoardSlug();
    const r = await window.ceo.analyzeBlocked({
      board: slug,
      domain: domain || ui().getContext?.().domain,
      dryRun: !!dryRun,
      limit,
    });
    if (!r || !r.ok) return `Could not analyze blocked work: ${r ? r.reason : "unknown"}`;
    const lines = (r.results || []).slice(0, 8).map((item) => {
      if (item.skipped) return `- ${item.taskId}: skipped (${item.reason})`;
      return `- ${item.taskId}: ${item.escalationTarget} escalation, comment ${item.comment}${item.brainArtifactId ? `, memory ${item.brainArtifactId}` : ""}`;
    });
    ui().appendStream?.("sys", `Blocked analysis: ${r.analyzed} analyzed, ${r.skipped} skipped`);
    return [
      `Blocked analysis for ${r.board}: ${r.blocked} blocked, ${r.analyzed} analyzed, ${r.skipped} skipped${r.dryRun ? " (dry run)" : ""}.`,
      lines.join("\n"),
    ].filter(Boolean).join("\n");
  },
  async list_personas() {
    const r = await window.ceo.listPersonas();
    if (!r || !r.ok) return `Could not list personas: ${r ? r.reason : "unknown"}`;
    const personas = r.personas || [];
    return personas.map((p) => `- ${p.id}: ${p.name || p.id}${p.description ? ` — ${p.description}` : ""}`).join("\n") || "No personas registered.";
  },
  async list_skills() {
    const r = await window.ceo.listSkills();
    if (!r || !r.ok) return `Could not list skills: ${r ? r.reason : "unknown"}`;
    const skills = r.skills || [];
    return skills.map((s) => `- ${s.id}: ${s.name || s.id}${s.category ? ` (${s.category})` : ""}${s.description ? ` — ${s.description}` : ""}`).join("\n") || "No skills registered.";
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
    setLabel("Voice", false);
    starting = false;
    return;
  }

  // Get a connection token from main (key stays server-side). Also gives the cap.
  const res = await window.ceo.convaiStart();
  if (!res || !res.ok) {
    ui().setVoiceStatus?.(`Live voice error: ${res ? res.reason : "unknown"}`);
    setLabel("Voice", false);
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
        // Brief the agent on the live Studio state before the first real turn.
        lastContextSig = "";
        pushContext("session start");
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
    setLabel("Voice", false);
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
  setLabel("Voice", false);
  ui().setAgentState?.("idle");
  if (reason !== undefined) ui().setVoiceStatus?.(reason ? `Live voice ended (${reason}).` : "");
}

function toggle() { if (active) stop("ended by user"); else start(); }

// Expose to app.js (kill switch / cost guardrail call stop(); UI change hooks
// call syncContext() so the live agent always knows the current project/domain).
window.CEOConvai = {
  toggle, stop, isActive: () => active,
  syncContext: (reason) => pushContext(reason || "ui change"),
};

if (hdrBtn) hdrBtn.addEventListener("click", toggle);

// Probe availability; disable the controls if no key is configured.
(async () => {
  try {
    const st = await window.ceo.convaiStatus();
    available = !!(st && st.available);
    if (!available) {
      if (hdrBtn) hdrBtn.disabled = true;
      ui().setVoiceStatus?.(st && st.note ? st.note : "Live voice disabled (no ELEVENLABS_API_KEY).");
    }
  } catch { /* live voice optional */ }
})();
