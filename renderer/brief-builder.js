"use strict";
/**
 * Brief Builder — conversational brief creation in the CEO chat box.
 *
 * This is the typed-chat front door to the brief pipeline. The voice agent has
 * always had a `create_brief` tool; the text chat only ever relayed to Hermes.
 * This module closes that gap: type "create a brief ..." (or use the + menu's
 * "New brief") and it runs a short conversation —
 *
 *   describe -> CEO drafts the 7 canonical fields -> you review/refine
 *            -> confirm -> create the [Brief] card -> (optional) decompose
 *
 * It reuses the exact IPC the voice agent uses (briefIntakeDraft, createBrief,
 * proposeBriefDecomposition, applyBriefDecomposition), so creation stays gated
 * and deterministic. It hooks into app.js's runTurn() via maybeHandle().
 */
(function () {
  const FIELD_LABELS = {
    title: "Title",
    goal: "Goal",
    domain: "Domain",
    currentRenderedState: "Current state",
    problemMismatch: "Problem / mismatch",
    acceptanceCriteria: "Acceptance criteria",
    nextAction: "Next action",
    constraints: "Constraints",
    owner: "Owner",
    persona: "Persona",
    reference: "Reference",
  };
  const ORDER = [
    "title", "goal", "domain", "currentRenderedState", "problemMismatch",
    "acceptanceCriteria", "nextAction", "constraints", "owner", "persona", "reference",
  ];

  const state = {
    phase: "idle", // idle | collecting | confirm | decompose-offer | decompose-review
    transcript: "",
    draft: {},
    missing: [],
    created: null, // { board, taskId, title }
    proposal: null,
  };

  const ui = () => window.ceoUI || {};
  const sys = (m) => ui().appendStream && ui().appendStream("sys", m);
  const agent = (m) => ui().appendStream && ui().appendStream("agent", m);
  const echoUser = (m) => ui().appendStream && ui().appendStream("user", m);
  const think = (on) => ui().setAgentState && ui().setAgentState(on ? "thinking" : "idle");

  function reset() {
    state.phase = "idle";
    state.transcript = "";
    state.draft = {};
    state.missing = [];
    state.created = null;
    state.proposal = null;
  }

  function isActive() {
    return state.phase !== "idle";
  }

  function val(v) {
    return Array.isArray(v) ? v.filter(Boolean).join("\n") : String(v == null ? "" : v).trim();
  }
  function hasVal(v) {
    return Array.isArray(v) ? v.filter(Boolean).length > 0 : !!String(v == null ? "" : v).trim();
  }

  const AFFIRM = /^\s*(y|yes|yep|yeah|yup|sure|ok|okay|go|go ahead|do it|create( it)?|confirm|confirmed|approve|approved|proceed|ship it|send it|sounds good|looks good|lgtm|perfect)\b/i;
  const DENY = /^\s*(n|no|nope|nah|skip|not now|leave it|don'?t)\b/i;
  const CANCEL = /^\s*(cancel|stop|abort|never ?mind|forget it|quit)\b/i;

  function matchTrigger(t) {
    const m = t.match(/^\s*(?:\/brief|(?:create|make|draft|start|write|open|new)\s+(?:an?|the)?\s*brief)\b[:,\-]?\s*(?:to|about|for)?\s*(.*)$/is);
    if (!m) return null;
    return { seed: (m[1] || "").trim() };
  }

  function draftToMarkdown(draft, missing) {
    const miss = new Set(missing || []);
    const lines = ["# Brief draft", ""];
    for (const key of ORDER) {
      const present = hasVal(draft[key]);
      if (!present && !miss.has(key)) continue; // hide untouched optional fields
      const mark = miss.has(key) ? "needs input" : (present ? "ok" : "");
      lines.push(`### ${FIELD_LABELS[key] || key}${mark ? ` _(${mark})_` : ""}`);
      if (key === "acceptanceCriteria" || key === "constraints") {
        const items = Array.isArray(draft[key]) ? draft[key] : val(draft[key]).split(/\n/).filter(Boolean);
        lines.push(items.length ? items.map((x) => `- ${x}`).join("\n") : "_(not yet stated)_");
      } else {
        lines.push(present ? val(draft[key]) : "_(not yet stated)_");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function showDraftPanel() {
    if (ui().showPanel) ui().showPanel("Brief draft", draftToMarkdown(state.draft, state.missing));
  }

  function missingSentence(missing) {
    const labels = (missing || []).map((k) => FIELD_LABELS[k] || k);
    if (!labels.length) return "";
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  }

  async function boardSlug() {
    const ctx = ui().getContext ? ui().getContext() : {};
    try {
      const r = await window.ceo.ceoBoards();
      return (r && (r.current || (r.boards && r.boards[0] && r.boards[0].slug))) || "ceo-studio";
    } catch {
      return (ctx.project && ctx.project.slug) || "ceo-studio";
    }
  }

  function activeDomain() {
    const ctx = ui().getContext ? ui().getContext() : {};
    return ctx.domain || "All";
  }

  // --- conversation steps ----------------------------------------------------

  async function redraftFromTranscript() {
    think(true);
    let r;
    try {
      r = await window.ceo.briefIntakeDraft({ description: state.transcript, domainHint: activeDomain() });
    } catch (e) {
      r = { ok: false, reason: String((e && e.message) || e) };
    }
    think(false);
    if (!r || !r.ok) {
      // Keep what we have; let the user keep describing or cancel.
      if (r && r.draft) { state.draft = r.draft; state.missing = r.missing || []; }
      agent(`I couldn't reach the CEO to draft that (${(r && r.reason) || "unknown"}). Add a bit more detail and I'll try again, or say "cancel".`);
      return;
    }
    state.draft = r.draft || {};
    state.missing = r.missing || [];
    showDraftPanel();
    if (state.missing.length) {
      state.phase = "collecting";
      agent(`Here's the draft (left panel). I still need: ${missingSentence(state.missing)}. Add those in a sentence or two and I'll fill them in.`);
    } else {
      state.phase = "confirm";
      const title = val(state.draft.title) || "this brief";
      agent(`Draft looks complete (left panel): "${title}". Reply "create it" to put it on the board, or tell me what to change.`);
    }
  }

  async function createNow() {
    think(true);
    let r;
    try {
      r = await window.ceo.createBrief({
        ...state.draft,
        board: await boardSlug(),
        domain: val(state.draft.domain) || activeDomain(),
        requestedBy: "chat-intake",
      });
    } catch (e) {
      r = { ok: false, reason: String((e && e.message) || e) };
    }
    think(false);
    if (!r || !r.ok) {
      if (r && Array.isArray(r.missing) && r.missing.length) {
        state.missing = r.missing;
        state.phase = "collecting";
        showDraftPanel();
        agent(`Almost — still need: ${missingSentence(r.missing)}. Add those and I'll create it.`);
        return;
      }
      agent(`Couldn't create the brief: ${(r && r.reason) || "unknown"}. Tell me what to change, or say "cancel".`);
      return;
    }
    const taskId = r.task && r.task.taskId;
    state.created = { board: r.board, taskId, title: val(state.draft.title) };
    if (ui().showPanel) ui().showPanel(state.created.title || "Brief", r.body || draftToMarkdown(state.draft, []));
    sys(`Created brief on ${r.board}${taskId ? `: ${taskId}` : ""}`);
    if (!taskId) {
      agent(`Created the brief "${state.created.title}" on ${r.board}. It's on the board now.`);
      reset();
      return;
    }
    state.phase = "decompose-offer";
    agent(`Created "${state.created.title}" (${taskId}). Want me to break it into child briefs now? (yes / no)`);
  }

  async function proposeNow() {
    think(true);
    let r;
    try {
      r = await window.ceo.proposeBriefDecomposition({
        board: state.created.board,
        taskId: state.created.taskId,
        domain: val(state.draft.domain) || activeDomain(),
      });
    } catch (e) {
      r = { ok: false, reason: String((e && e.message) || e) };
    }
    think(false);
    if (!r || !r.ok) {
      agent(`Couldn't propose a decomposition: ${(r && r.reason) || "unknown"}. The brief is still on the board — you can decompose it later from the Tasks panel.`);
      reset();
      return;
    }
    state.proposal = r;
    const streams = r.proposedWorkstreams || [];
    if (ui().showPanel) {
      const md = ["# Decomposition proposal", "", r.summary || "", "",
        "## Proposed child briefs", ...streams.map((s, i) => `${i + 1}. ${s}`)].join("\n");
      ui().showPanel(`Decompose: ${state.created.title}`, md);
    }
    state.phase = "decompose-review";
    agent(`Proposed ${streams.length} child brief${streams.length === 1 ? "" : "s"} (left panel). Reply "approve" to create them all, or "no" to leave just the parent brief.`);
  }

  async function applyNow() {
    think(true);
    let r;
    try {
      r = await window.ceo.applyBriefDecomposition({ ...state.proposal, humanApproved: true });
    } catch (e) {
      r = { ok: false, reason: String((e && e.message) || e) };
    }
    think(false);
    if (!r || !r.ok) {
      agent(`Couldn't create the child briefs: ${(r && r.reason) || "unknown"}. The parent brief is still on the board.`);
    } else {
      sys(`Created ${r.createdCount} child brief(s) under ${state.created.taskId}`);
      agent(`Done — created ${r.createdCount} child brief${r.createdCount === 1 ? "" : "s"} under "${state.created.title}". Check the Tasks/Board panel to dispatch them.`);
    }
    reset();
  }

  // --- entry points ----------------------------------------------------------

  async function start(seed) {
    reset();
    state.phase = "collecting";
    const input = document.getElementById("chat-input");
    if (input) { input.placeholder = "Describe the brief — goal, current state, what done looks like…"; input.focus(); }
    const s = (seed || "").trim();
    if (s) {
      state.transcript = s;
      await redraftFromTranscript();
    } else {
      agent("Let's create a brief. In a sentence or two: what's the goal, what's true right now, and what does \"done\" look like? I'll draft the structured brief and we can refine it.");
    }
  }

  async function handleActiveTurn(text) {
    if (CANCEL.test(text)) {
      reset();
      sys("Cancelled the brief. Nothing was created.");
      return;
    }
    if (state.phase === "collecting") {
      state.transcript = state.transcript ? `${state.transcript}\n${text}` : text;
      await redraftFromTranscript();
      return;
    }
    if (state.phase === "confirm") {
      if (AFFIRM.test(text)) { await createNow(); return; }
      if (DENY.test(text)) { reset(); sys("Okay — discarded that brief draft."); return; }
      // Anything else = a refinement.
      state.transcript = `${state.transcript}\n${text}`;
      await redraftFromTranscript();
      return;
    }
    if (state.phase === "decompose-offer") {
      if (AFFIRM.test(text)) { await proposeNow(); return; }
      if (DENY.test(text)) {
        agent(`Left "${state.created.title}" as-is on the board. You can decompose it later from the Tasks panel.`);
        reset();
        return;
      }
      agent('Just let me know — "yes" to break it into child briefs, or "no" to leave it.');
      return;
    }
    if (state.phase === "decompose-review") {
      if (AFFIRM.test(text)) { await applyNow(); return; }
      if (DENY.test(text)) {
        agent(`Kept just the parent brief "${state.created.title}". You can decompose it later.`);
        reset();
        return;
      }
      agent('Reply "approve" to create the proposed child briefs, or "no" to skip.');
      return;
    }
  }

  /**
   * Called at the top of app.js runTurn(). Returns true if this module consumed
   * the turn (so the normal CEO chat path is skipped).
   */
  async function maybeHandle(prompt) {
    const text = String(prompt == null ? "" : prompt).trim();
    if (!text) return false;
    try {
      if (!isActive()) {
        const trig = matchTrigger(text);
        if (!trig) return false;
        echoUser(text);
        await start(trig.seed);
        return true;
      }
      echoUser(text);
      await handleActiveTurn(text);
      return true;
    } catch (e) {
      think(false);
      sys(`Brief builder error: ${(e && e.message) || e}`);
      reset();
      return true;
    }
  }

  window.BriefBuilder = { start, maybeHandle, isActive, cancel: reset };
})();
