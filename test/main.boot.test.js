"use strict";
/**
 * Headless boot test for main/index.js: stubs the `electron` module so we can
 * load the real main process (registering IPC handlers) without a display,
 * then drive the handlers end-to-end (add project -> open -> ask -> kill).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-boot-"));
process.env.CEO_STUDIO_HOME = HOME;
// Set to empty (not delete) so .env.local loader won't override them
process.env.CEO_MODEL_PROVIDER = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
// Keep voice offline + deterministic for the headless boot test. Set empty
// (not delete) so index.js's .env.local loader won't repopulate it.
process.env.ELEVENLABS_API_KEY = "";

// --- stub electron ---
const handlers = {};
const sampleProject = fs.mkdtempSync(path.join(os.tmpdir(), "boot-proj-"));
fs.mkdirSync(path.join(sampleProject, "discovery"));
fs.writeFileSync(path.join(sampleProject, "README.md"), "# Boot\nstrategy text");

const electronStub = {
  app: { whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class { constructor() {} loadFile() {} on() {} static getAllWindows() { return [1]; } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sampleProject] }) },
  session: { defaultSession: { setPermissionRequestHandler: () => {} } },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.call(this, request, parent, isMain);
};

require("../main/index.js"); // registers handlers via the stub

let passed = 0;
const ok = (n, c) => { if (!c) { console.error("FAIL", n); process.exitCode = 1; } else { console.log("PASS", n); passed++; } };

(async () => {
  const expected = ["projects:list", "projects:add", "project:open", "domain:set",
    "domain:define", "domain:get_all", "domain:create_handoff", "domain:list_handoffs",
    "domain:create_agenda_item", "domain:propose_agenda_from_handoff", "domain:save_meeting_artifact",
    "brain:context", "cost:status", "cost:kill", "cost:resume", "agent:ask",
    "gbrain:status", "gbrain:query", "gbrain:ingest",
    "voice:available", "voice:speak", "voice:listen",
    "convai:status", "convai:start",
    "docs:list", "docs:tree", "docs:read",
    "jobs:create_ticket_pack", "jobs:get", "jobs:list", "jobs:apply_ticket_comment",
    "domain_board:create_brief", "domain_board:create_bug", "domain_board:decompose_brief",
    "domain_board:propose_brief_decomposition", "domain_board:apply_brief_decomposition",
    "domain_board:create_child_task", "domain_board:record_asset",
    "brief_runs:get", "brief_runs:update",
    "brief_runs:meeting_start", "brief_runs:meeting_schedule", "brief_runs:meeting_start_scheduled",
    "brief_runs:meeting_synthesize", "brief_runs:meeting_proposal_action",
    "provenance:graph",
    "goals:list", "goals:upsert", "goals:link_work", "goals:review",
    "autonomy:analyze_blocked",
    "autonomy:status", "autonomy:configure", "autonomy:run_cycle", "autonomy:start", "autonomy:stop",
    "notifications:list", "notifications:ack",
    "self_repair:report_bug", "self_repair:consult",
    "skills:list", "skills:route",
    "standups:status", "standups:configure", "standups:run_due", "standups:proposal_action",
    "runner:status", "runner:configure", "runner:run_once", "runner:start", "runner:stop",
    "swarm:request",
    "sessions:list", "sessions:create", "sessions:set_active"];
  ok("all IPC handlers registered", expected.every((c) => typeof handlers[c] === "function"));

  const added = await handlers["projects:add"]();
  ok("projects:add mounts the dir", !!added && !!added.id);

  const opened = await handlers["project:open"](null, added.id);
  ok("project:open returns context + provider", !!opened.context && !!opened.providerId);
  ok("offline provider note present", /NullProvider|API_KEY missing/i.test(opened.providerNote || ""));

  const status0 = await handlers["cost:status"]();
  ok("cost:status live after open", status0 && status0.maxSessionUsd > 0);

  const gbStatus = await handlers["gbrain:status"]();
  // gbrain availability is environment-dependent (a real Postgres/PGLite brain
  // may be reachable). The contract is that status() always returns a
  // well-formed result with a boolean `available` — never crashes, never lies.
  ok("gbrain:status reports a well-formed availability", gbStatus && gbStatus.ok === true && typeof gbStatus.available === "boolean");

  const reply = await handlers["agent:ask"](null, "what is the strategy?");
  ok("agent:ask returns text + cost", typeof reply.text === "string" && !!reply.cost);

  // Voice status is always a valid object — never crashes (cloud or local mode).
  const vStatus = await handlers["voice:available"]();
  ok("voice:available returns a valid status object", vStatus && typeof vStatus.available === "boolean" && "mode" in vStatus);
  // voice:speak always returns a well-formed response — never throws (ok true/false both valid).
  const vSpeak = await handlers["voice:speak"](null, "hi");
  ok("voice:speak returns a well-formed response", vSpeak && typeof vSpeak.ok === "boolean");
  const vListen = await handlers["voice:listen"](null, { audioBase64: "", mime: "audio/webm" });
  ok("voice:listen refuses gracefully without key", vListen && vListen.ok === false);

  // Live voice (Conversational AI) also degrades gracefully offline.
  const cStatus = await handlers["convai:status"]();
  ok("convai:status reports unavailable offline", cStatus && cStatus.available === false);
  const cStart = await handlers["convai:start"]();
  ok("convai:start refuses gracefully without key", cStart && cStart.ok === false);

  // Document tools (back the voice agent's client tools) work on the open project.
  const docs = await handlers["docs:list"]();
  ok("docs:list returns indexed docs", Array.isArray(docs) && docs.length >= 1);
  const tree = await handlers["docs:tree"](null, "All");
  ok("docs:tree returns a file tree", tree && tree.ok === true && Array.isArray(tree.tree));
  const readOk = await handlers["docs:read"](null, "README.md");
  ok("docs:read reads a project file", readOk && readOk.ok === true && /strategy/i.test(readOk.text));
  const escape = await handlers["docs:read"](null, "../../../etc/hosts");
  ok("docs:read blocks path traversal", escape && escape.ok === false);
  const domain = await handlers["domain:define"](null, {
    name: "Ops",
    purpose: "Operational planning",
    overarchingGoal: "Keep operations work visible and handed off.",
    boundaries: ["Operations intake", "Follow-up tracking"],
    features: ["Handoff capture", "Agenda triage"],
    kanbanBoard: "ops-board",
    createScaffold: true,
    relativePath: "domains/ops",
  });
  ok("domain:define creates a scaffolded domain", domain && domain.ok === true && fs.existsSync(path.join(sampleProject, "domains", "ops", "definition.md")));
  const handoffs = await handlers["domain:list_handoffs"](null, "Ops");
  ok("domain:list_handoffs sees creation handoff", handoffs && handoffs.ok === true && handoffs.handoffs.length >= 1);
  const proposal = await handlers["domain:propose_agenda_from_handoff"](null, { domain: "Ops" });
  ok("domain:propose_agenda_from_handoff returns proposals only", proposal && proposal.ok === true && proposal.proposals.every((p) => p.status === "proposed"));
  const agenda = await handlers["domain:create_agenda_item"](null, { domain: "Ops", item: proposal.proposals[0] });
  ok("domain:create_agenda_item persists proposal", agenda && agenda.ok === true && /proposed/i.test(agenda.agendaItem.status));
  const meeting = await handlers["domain:save_meeting_artifact"](null, {
    domain: "Ops",
    room: "ops-dogfood",
    agenda: "Plan Ops lifecycle follow-up",
    participants: ["agenda-agent"],
    expectedOutcome: "Saved artifact",
    requirements: "Meeting synthesis",
  });
  ok("domain:save_meeting_artifact writes domain agenda output", meeting && meeting.ok === true && fs.existsSync(path.join(sampleProject, meeting.artifact.path)));
  const standup = await handlers["standups:configure"](null, { domain: "Ops", board: "ceo-studio", timeLocal: "09:00" });
  ok("standups:configure schedules recurring meeting and agenda", standup && standup.ok === true && standup.meeting.recurrence === "daily" && standup.agenda.ok === true);
  const standupStatus = await handlers["standups:status"]();
  ok("standups:status exposes saved policies", standupStatus && standupStatus.ok === true && standupStatus.policies.some((p) => p.id === "standup-ops"));
  const runnerConfigured = await handlers["runner:configure"](null, { allowStandups: true, maxStandupsPerCycle: 1, execute: false });
  const runnerStatus = await handlers["runner:status"]();
  ok("runner policy exposes automatic standup cadence", runnerConfigured && runnerConfigured.ok === true
    && runnerConfigured.policy.allowStandups === true
    && runnerConfigured.policy.maxStandupsPerCycle === 1
    && runnerStatus.policy.allowStandups === true);
  await handlers["runner:configure"](null, {
    enabled: true,
    dryRun: true,
    allowStandups: false,
    execute: false,
    allowGoalReview: false,
    allowUnblocker: false,
    allowTriage: false,
    allowStaleRunningCleanup: false,
    allowDecompose: false,
    allowAssign: false,
    allowReviewGate: false,
  });
  await handlers["project:open"](null, added.id);
  const restoredRunner = await handlers["runner:status"]();
  ok("enabled runner policy resumes after project reopen", restoredRunner.running === true && restoredRunner.policy.enabled === true);
  await handlers["runner:stop"]();
  const swarm = await handlers["swarm:request"](null, "research the market");
  ok("swarm:request responds honestly (not enabled)", swarm && swarm.ok === true && swarm.enabled === false);
  const listedSkills = await handlers["skills:list"]();
  ok("skills:list returns catalog skills", listedSkills && listedSkills.ok === true && Array.isArray(listedSkills.skills) && listedSkills.skills.length >= 1);
  const routedSkills = await handlers["skills:route"](null, { skills: ["swarm-coding"], objective: "Build a brief workspace" });
  ok("skills:route returns a route preview", routedSkills && routedSkills.ok === true && Array.isArray(routedSkills.team));
  const thinBrief = await handlers["domain_board:create_brief"](null, { title: "Thin", domain: "Ops" });
  ok("domain_board:create_brief enforces template", thinBrief && thinBrief.ok === false && Array.isArray(thinBrief.missing));
  ok("domain_board:create_brief prefers mapped domain board", /Board: ops-board/.test(thinBrief.template || ""));
  const thinBug = await handlers["domain_board:create_bug"](null, { title: "Bug", domain: "Ops" });
  ok("domain_board:create_bug enforces repro fields", thinBug && thinBug.ok === false && Array.isArray(thinBug.missing));
  const invalidBriefRun = await handlers["brief_runs:get"](null, {});
  ok("brief_runs:get validates its task reference", invalidBriefRun && invalidBriefRun.ok === false && /board and taskId/.test(invalidBriefRun.reason));
  const briefRuns = require("../main/core/brief-runs");
  const bootRun = briefRuns.upsertFromBrief(added.slug, {
    board: "ceo-studio",
    title: "Boot linked session",
    goal: "Verify the first-message session path links back to its Brief Run.",
    domain: "Ops",
    currentRenderedState: "The renderer carries a pending brief reference.",
    problemMismatch: "The main process must persist that reference when the first message creates the session.",
    constraints: ["Do not create a session before text input"],
    acceptanceCriteria: ["The Brief Run records the created session id"],
    nextAction: "Create the linked session through sessions:create.",
    owner: "ceo",
    persona: "planner",
    reference: ["test/main.boot.test.js"],
  }, { board: "ceo-studio", taskId: "t_boot_brief" });
  const linkedSession = await handlers["sessions:create"](null, {
    title: "Boot linked session",
    leadAgentId: "ceo",
    briefRef: {
      board: "ceo-studio",
      taskId: "t_boot_brief",
      runId: bootRun.id,
    },
  });
  const linkedRun = briefRuns.read(added.slug, "ceo-studio", "t_boot_brief");
  ok("first-message session creation preserves its Brief Run reference", linkedSession && linkedSession.ok && linkedSession.session.briefRef.runId === bootRun.id);
  ok("first-message session creation links back into the Brief Run", linkedRun && linkedRun.linkedSessionIds.includes(linkedSession.session.id));
  const scheduledBriefMeeting = await handlers["brief_runs:meeting_schedule"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
    info: {
      title: "Boot Brief Run review",
      agenda: "Review progress and decide the next action.",
      members: "ceo",
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  ok("Brief Run meeting scheduling preserves the durable reference", scheduledBriefMeeting && scheduledBriefMeeting.ok
    && scheduledBriefMeeting.meeting.briefRef.runId === bootRun.id);
  const linkedWorkspace = await handlers["brief_runs:get"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
  });
  const linkedLead = linkedWorkspace.activeAgents.find((agent) => agent.agentId === "ceo");
  ok("Brief Run workspace aggregates linked meetings", linkedWorkspace.ok
    && linkedWorkspace.meetings.some((item) => item.id === scheduledBriefMeeting.meeting.id));
  ok("Brief Run workspace exposes linked-agent terminal state", linkedLead
    && linkedLead.terminal
    && typeof linkedLead.terminal.alive === "boolean");
  const synthesisRoom = "boot-brief-synthesis";
  const synthesisRoomDir = path.join(sampleProject, "brain", "rooms", synthesisRoom);
  fs.mkdirSync(synthesisRoomDir, { recursive: true });
  fs.writeFileSync(path.join(synthesisRoomDir, "chat.log"), `# ${synthesisRoom} Team Room\n\n[${new Date().toISOString()}] Facilitator: MEETING SYNTHESIS\n`);
  fs.writeFileSync(path.join(synthesisRoomDir, "requirements.md"), [
    "# Decisions",
    "- Decision: Keep the proposal review boundary explicit.",
    "",
    "## Blockers",
    "- Blocker: Human approval is required before execution policy changes.",
    "",
    "## Next Actions",
    "1. Surface the proposals in the Brief Run cockpit.",
  ].join("\n"));
  briefRuns.update(added.slug, "ceo-studio", "t_boot_brief", {
    meeting: {
      id: "room:boot-brief-synthesis",
      room: synthesisRoom,
      title: "Boot synthesis review",
      status: "done",
      briefRef: { board: "ceo-studio", taskId: "t_boot_brief", runId: bootRun.id },
    },
  });
  const synthesizedWorkspace = await handlers["brief_runs:get"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
  });
  const synthesis = synthesizedWorkspace.meetingSyntheses.find((item) => item.meetingId === "room:boot-brief-synthesis");
  const decision = synthesis && synthesis.proposals.find((item) => item.type === "decision");
  const blocker = synthesis && synthesis.proposals.find((item) => item.type === "blocker");
  ok("completed linked meetings automatically create pending proposals", synthesis
    && decision
    && blocker
    && synthesis.proposals.every((item) => item.status === "pending"));
  const deniedApproval = await handlers["brief_runs:meeting_proposal_action"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
    synthesisId: synthesis.id,
    proposalId: decision.id,
    action: "approve",
  });
  ok("meeting proposal approval requires an explicit human flag", deniedApproval && deniedApproval.ok === false && /explicit human approval/.test(deniedApproval.reason));
  const approvedDecision = await handlers["brief_runs:meeting_proposal_action"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
    synthesisId: synthesis.id,
    proposalId: decision.id,
    action: "approve",
    humanApproved: true,
    approvedBy: "boot-human",
  });
  const rejectedBlocker = await handlers["brief_runs:meeting_proposal_action"](null, {
    board: "ceo-studio",
    taskId: "t_boot_brief",
    synthesisId: synthesis.id,
    proposalId: blocker.id,
    action: "reject",
    approvedBy: "boot-human",
  });
  const reviewedRun = briefRuns.read(added.slug, "ceo-studio", "t_boot_brief");
  const reviewedSynthesis = reviewedRun.meetingSyntheses.find((item) => item.id === synthesis.id);
  ok("approved meeting decisions materialize into the Brief Run", approvedDecision.ok
    && reviewedRun.decisions.some((item) => item.id === decision.id));
  ok("rejected meeting proposals stay durable without materializing", rejectedBlocker.ok
    && reviewedSynthesis.proposals.some((item) => item.id === blocker.id && item.status === "rejected")
    && reviewedRun.status !== "blocked");
  const sessionsCore = require("../main/core/sessions");
  const planned = sessionsCore.setPlan(added.slug, linkedSession.session.id, {
    title: "Boot plan",
    overview: "Finish the linked Brief Run contract.",
    body: "Implement the contract, run the gates, and record the result.",
  });
  const approved = sessionsCore.approvePlan(added.slug, linkedSession.session.id);
  const completedSession = await handlers["sessions:update"](null, {
    id: linkedSession.session.id,
    patch: { phase: "done" },
  });
  const completedRun = briefRuns.read(added.slug, "ceo-studio", "t_boot_brief");
  ok("approved linked sessions may complete", planned.ok && approved.ok && completedSession.ok && completedSession.session.phase === "done");
  ok("linked session completion writes a durable Brief Run summary", completedRun.completionSummaries
    .some((item) => item.id === `session:${linkedSession.session.id}` && /Finish the linked Brief Run contract/.test(item.body)));

  await handlers["cost:kill"]();
  const killedReply = await handlers["agent:ask"](null, "again");
  ok("agent halts after kill switch", killedReply.halted === true);

  require("../main/core/agui-server").stop();
  Module._load = origLoad;
  console.log(`\n${passed} boot checks passed.`);
})();
