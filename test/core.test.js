"use strict";
/**
 * M0 core tests (plain node, no Electron). Run: `npm test` or
 * `node test/core.test.js`. Verifies project mount/domain-detect, the Brain
 * artifact contract, and the cost guardrail (caps + kill switch) — the L0
 * exit criteria and the non-negotiable safety layer.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Isolate all studio state in a temp home BEFORE requiring core modules.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-test-"));
process.env.CEO_STUDIO_HOME = HOME;
process.env.HERMES_HOME = path.join(HOME, "hermes");
delete process.env.CEO_MODEL_PROVIDER;

const projects = require("../main/core/projects");
const brain = require("../main/core/brain");
const { CostMeter } = require("../main/core/cost");
const { createProvider, createUtilityProvider, NullProvider, VertexGatewayProvider, gatewayUrl, gatewayModel } = require("../main/core/llm");
const { DocumentAgent } = require("../main/core/agent");
const jobs = require("../main/core/jobs");
const ticketPlanner = require("../main/core/ticket-planner");
const domainBoard = require("../main/core/domain-board");
const briefRuns = require("../main/core/brief-runs");
const meetingSynthesis = require("../main/core/meeting-synthesis");
const domainsCore = require("../main/core/domains");
const domainArchitect = require("../main/core/domain-architect");
const briefDecomposer = require("../main/core/brief-decomposer");
const hermes = require("../main/core/hermes");
const autonomy = require("../main/core/autonomy");
const provenance = require("../main/core/provenance");
const goals = require("../main/core/goals");
const goalReview = require("../main/core/goal-review");
const autonomyLoop = require("../main/core/autonomy-loop");
const selfRepair = require("../main/core/self-repair");
const orchestrationOrg = require("../main/core/orchestration-org");
const skillCatalog = require("../main/core/skills");
const standups = require("../main/core/standups");
const meetings = require("../main/core/meetings");
const ptyTerminal = require("../main/core/pty-terminal");

let passed = 0;
function ok(name, cond) {
  if (!cond) { console.error("FAIL", name); process.exitCode = 1; }
  else { console.log("PASS", name); passed++; }
}

ok("terminal bridge ignores destroyed renderer frames",
  ptyTerminal._defaults.sendToWebContents({ isDestroyed: () => true }, "terminal:data", {}) === false);
ok("terminal bridge contains disposed-frame send errors",
  ptyTerminal._defaults.sendToWebContents({
    isDestroyed: () => false,
    send: () => { throw new Error("Render frame was disposed"); },
  }, "terminal:data", {}) === false);
ok("terminal bridge sends to a live renderer frame",
  ptyTerminal._defaults.sendToWebContents({
    isDestroyed: () => false,
    send: () => {},
  }, "terminal:data", {}) === true);

// --- build a sample project to mount ---
const proj = fs.mkdtempSync(path.join(os.tmpdir(), "sample-project-"));
fs.mkdirSync(path.join(proj, "discovery"));
fs.mkdirSync(path.join(proj, "engineering"));
fs.mkdirSync(path.join(proj, "knowledge"));
fs.writeFileSync(path.join(proj, "README.md"), "# Sample\nHello world strategy.");
fs.writeFileSync(path.join(proj, "knowledge", "STRATEGY.md"), "# Strategy\nThe plan.");

// --- projects + domain detection ---
const domains = projects.detectDomains(proj).map((d) => d.name.toLowerCase());
ok("detects 'All' domain", domains.includes("all"));
ok("detects discovery domain", domains.includes("discovery"));
ok("detects engineering domain", domains.includes("engineering"));

const added = projects.addProject(proj);
ok("addProject returns slug+id", !!added.slug && !!added.id);
ok("project persisted to registry", projects.listProjects().some((p) => p.id === added.id));
ok("re-adding same path is idempotent", projects.addProject(proj).id === added.id);

// --- brain ---
brain.initBrain(added.slug);
const idx = brain.indexProjectDocs(added.slug, proj);
ok("indexes the 2 markdown docs", idx.indexed === 2);
const art = brain.writeArtifact(added.slug, { type: "contradiction", title: "doc vs code", summary: "x" });
ok("writeArtifact returns id + contract fields", !!art.id && art.type === "contradiction" && art.project === added.slug);
ok("contradiction lands in its index", brain.readIndex(added.slug, "contradictions").length === 1);
const ctx = brain.loadContext(added.slug);
ok("loadContext reports artifact count", ctx.counts.artifacts === 2);

// --- local job queue + deterministic ticket planning pack ---
const queued = jobs.create(added.slug, {
  type: "ticket_context_pack",
  domain: "engineering",
  input: { ticketId: "t_test1234" },
});
ok("jobs.create persists queued work", queued.id && jobs.get(added.slug, queued.id).status === "queued");
jobs.update(added.slug, queued.id, { status: "running" });
ok("jobs.update changes status", jobs.get(added.slug, queued.id).status === "running");
const pack = ticketPlanner.prepareTicketPack({
  slug: added.slug,
  project: added,
  domain: "engineering",
  job: queued,
  ticket: {
    id: "t_test1234",
    title: "Dogfood — CEO Studio manages itself",
    body: "Open the CEO_STUDIO folder as a project.",
    status: "todo",
    assignee: null,
  },
});
ok("ticket planner finds gaps for thin tickets", pack.gaps.length >= 3);
ok("ticket planner emits AGUI panel", pack.panel && Array.isArray(pack.panel.components));
ok("ticket planner emits Kanban comment draft", /planning pack/i.test(pack.comment));

// --- domain board intake contracts ---
const missingBrief = domainBoard.missingBriefFields({ title: "Draft", domain: "Engineering" });
ok("domain brief validation rejects thin briefs", missingBrief.includes("goal") && missingBrief.includes("acceptanceCriteria"));
const briefBody = domainBoard.briefBody({
  board: "ceo-studio",
  title: "Autonomous bug intake",
  goal: "Capture defects from voice and route them to the domain board.",
  domain: "Engineering",
  currentRenderedState: "Voice can create generic tasks.",
  problemMismatch: "Generic tasks do not enforce the canonical brief template.",
  constraints: ["No API-key CEO provider", "Use Hermes Kanban"],
  acceptanceCriteria: ["Briefs are template-shaped", "Planner can decompose the brief"],
  nextAction: "Create the domain board intake tool.",
  owner: "PM",
  persona: "planner",
});
ok("domain brief body uses canonical sections", /### Current Rendered State/.test(briefBody) && /## Planning Contract/.test(briefBody));
ok("domain brief body carries orchestration routing", /## Orchestration Routing/.test(briefBody) && /Lane: triage/.test(briefBody));
const missingBug = domainBoard.missingBugFields({ title: "Broken thing", domain: "Engineering" });
ok("bug validation requires reproduction evidence", missingBug.includes("observedBehavior") && missingBug.includes("reproductionSteps"));
const bugBody = domainBoard.bugBody({
  board: "ceo-studio",
  title: "Blocked cards are not escalated",
  domain: "Engineering",
  observedBehavior: "Cards sit in blocked without analysis.",
  expectedBehavior: "Blocked cards produce an escalation note.",
  reproductionSteps: ["Create a blocked card", "Observe no escalation record"],
  severity: "high",
});
ok("bug body records bug-lane routing", /# Bug/.test(bugBody) && /## Triage Contract/.test(bugBody) && /Lane: bug/.test(bugBody));
const childBody = domainBoard.childTaskBody({
  parentId: "t_brief",
  title: "Implement linked task creation",
  acceptanceCriteria: ["Child task records parent provenance"],
  verification: ["npm test"],
});
ok("child task body carries parent and verification", /Parent ID: t_brief/.test(childBody) && /npm test/.test(childBody));
ok("child task body carries queue routing", /Queue Role: execution_queue/.test(childBody));
const fullBriefInput = {
  board: "ceo-studio",
  title: "Persistent Brief Run contract",
  goal: "Keep brief planning state durable across autonomy cycles.",
  domain: "Engineering",
  currentRenderedState: "Briefs exist on Hermes Kanban without a durable run workspace.",
  problemMismatch: "The runner can reject dirty briefs but the operator cannot repair the run in the app.",
  constraints: ["Hermes Kanban remains the board of record", "Do not require an API-key CEO provider"],
  acceptanceCriteria: ["Brief Run persists validation state", "Linked sessions retain the brief reference"],
  nextAction: "Open the Brief Run in task detail.",
  owner: "ceo",
  persona: "planner",
  goalId: "goal-autonomy",
  reference: ["runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md"],
};
const originalAddTask = hermes.addTask;
let createdBrief;
try {
  hermes.addTask = () => ({ ok: true, taskId: "t_brief_run_contract" });
  createdBrief = domainBoard.createBrief(fullBriefInput, { projectSlug: added.slug });
} finally {
  hermes.addTask = originalAddTask;
}
ok("creating a valid brief creates its persistent Brief Run", createdBrief.ok && createdBrief.briefRunId === "ceo-studio:t_brief_run_contract");
const persistedBriefRun = briefRuns.read(added.slug, "ceo-studio", "t_brief_run_contract");
ok("new Brief Run starts clean with a validation checklist", persistedBriefRun && persistedBriefRun.validation.ok === true && persistedBriefRun.progressChecklist.some((item) => item.id === "brief-clean" && item.done));
const dirtyBriefRun = briefRuns.update(added.slug, "ceo-studio", "t_brief_run_contract", {
  brief: { problemMismatch: "" },
  eventType: "test_dirty",
});
ok("Brief Run edits revalidate required document fields", dirtyBriefRun.ok && dirtyBriefRun.run.validation.ok === false && dirtyBriefRun.run.validation.missing.includes("problemMismatch"));
const dirtyGate = briefRuns.planningGate({
  projectSlug: added.slug,
  board: "ceo-studio",
  task: { id: "t_brief_run_contract", title: "[Brief] Persistent Brief Run contract" },
});
ok("dirty Brief Run blocks planning and dispatch", dirtyGate.allowed === false && /dirty/.test(dirtyGate.reason));
const repairedBriefRun = briefRuns.update(added.slug, "ceo-studio", "t_brief_run_contract", {
  brief: { problemMismatch: fullBriefInput.problemMismatch },
  decision: { body: "Keep Hermes Kanban as the execution ledger." },
  evidenceItem: { body: "File-backed contract test passed." },
  eventType: "test_repaired",
});
ok("repairing a Brief Run reopens the planning gate", repairedBriefRun.ok && repairedBriefRun.run.validation.ok === true && briefRuns.planningGate({
  projectSlug: added.slug,
  board: "ceo-studio",
  task: { id: "t_brief_run_contract", title: "[Brief] Persistent Brief Run contract" },
}).allowed === true);
ok("Brief Run preserves decisions and evidence", repairedBriefRun.run.decisions.length === 1 && repairedBriefRun.run.evidence.length === 1);
const operationalBriefRun = briefRuns.update(added.slug, "ceo-studio", "t_brief_run_contract", {
  agendaItem: { title: "Review autonomy risks", status: "proposed" },
  completionSummary: { title: "Cockpit contract", body: "Brief Run operations persist durable summaries." },
  eventType: "test_operations",
});
ok("Brief Run persists agenda items and completion summaries", operationalBriefRun.ok
  && operationalBriefRun.run.agendaItems.some((item) => item.title === "Review autonomy risks")
  && operationalBriefRun.run.completionSummaries.some((item) => /durable summaries/.test(item.body)));
const linkedMeeting = meetings.scheduleMeeting({
  projectPath: proj,
  meeting: {
    title: "Brief Run review",
    agenda: "Review progress and next actions.",
    members: "ceo,planner",
    scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    briefRef: {
      board: "ceo-studio",
      taskId: "t_brief_run_contract",
      runId: operationalBriefRun.run.id,
    },
  },
});
const listedLinkedMeeting = meetings.listScheduled(proj).meetings.find((item) => item.id === linkedMeeting.meeting.id);
ok("scheduled meetings preserve their Brief Run reference", linkedMeeting.ok
  && listedLinkedMeeting
  && listedLinkedMeeting.briefRef.runId === operationalBriefRun.run.id);
const synthesisRequirements = [
  "# Decisions",
  "- Decision: Keep Hermes Kanban as the execution ledger.",
  "",
  "## Blockers",
  "- Blocker: Human OAuth approval is required.",
  "",
  "## Next Actions",
  "1. Add a reviewed proposal flow.",
  "",
  "## Evidence",
  "- Evidence: The live room wrote requirements.md.",
  "",
  "## Completed Work",
  "- Completed: Meeting room persistence.",
].join("\n");
const builtMeetingSynthesis = meetingSynthesis.build({
  meeting: {
    id: "meeting-contract",
    room: "meeting-contract-room",
    title: "Autonomy contract review",
    requirementsPath: "brain/rooms/meeting-contract-room/requirements.md",
  },
  requirements: synthesisRequirements,
});
const proposalTypes = new Set(builtMeetingSynthesis.synthesis.proposals.map((item) => item.type));
ok("meeting synthesis creates reviewable typed proposals", builtMeetingSynthesis.ok
  && ["decision", "agenda", "blocker", "evidence", "completion"].every((type) => proposalTypes.has(type)));
ok("meeting synthesis proposals require human attention", builtMeetingSynthesis.synthesis.proposals.every((item) => item.status === "pending" && item.humanAttention === true));
const savedMeetingSynthesis = briefRuns.upsertMeetingSynthesis(
  added.slug,
  "ceo-studio",
  "t_brief_run_contract",
  builtMeetingSynthesis.synthesis,
);
const decisionProposal = builtMeetingSynthesis.synthesis.proposals.find((item) => item.type === "decision");
const reviewedMeetingProposal = briefRuns.updateMeetingProposal(
  added.slug,
  "ceo-studio",
  "t_brief_run_contract",
  builtMeetingSynthesis.synthesis.id,
  decisionProposal.id,
  { status: "materialized", reviewedBy: "test-human" },
);
const repeatedMeetingSynthesis = briefRuns.upsertMeetingSynthesis(
  added.slug,
  "ceo-studio",
  "t_brief_run_contract",
  builtMeetingSynthesis.synthesis,
);
ok("meeting synthesis persists on the Brief Run", savedMeetingSynthesis.ok && savedMeetingSynthesis.changed === true);
ok("meeting proposal review is durable and idempotent", reviewedMeetingProposal.ok
  && repeatedMeetingSynthesis.changed === false
  && briefRuns.read(added.slug, "ceo-studio", "t_brief_run_contract").meetingSyntheses[0].proposals
    .some((item) => item.id === decisionProposal.id && item.status === "materialized"));
const revisedMeetingSynthesis = meetingSynthesis.build({
  meeting: {
    id: "meeting-contract",
    room: "meeting-contract-room",
    title: "Autonomy contract review",
    requirementsPath: "brain/rooms/meeting-contract-room/requirements.md",
  },
  requirements: `${synthesisRequirements}\n\n## Next Actions\n- Add an audit history for revised synthesis.`,
});
const revisedSavedSynthesis = briefRuns.upsertMeetingSynthesis(
  added.slug,
  "ceo-studio",
  "t_brief_run_contract",
  revisedMeetingSynthesis.synthesis,
);
ok("revised meeting synthesis preserves reviewed proposal history", revisedSavedSynthesis.changed === true
  && revisedSavedSynthesis.synthesis.sourceHistory.length === 1
  && revisedSavedSynthesis.synthesis.proposals.some((item) => item.id === decisionProposal.id && item.status === "materialized"));

// --- domain lifecycle file-backed contract ---
const missingDomain = domainsCore.validateDomainDefinition({ name: "Ops", purpose: "Own ops" });
ok("domain definition validation requires goal, boundaries, and features", missingDomain.includes("long-term goal") && missingDomain.includes("boundaries/ownership") && missingDomain.includes("initial features"));
const lifecycleDomain = domainsCore.defineDomain(added.slug, {
  name: "Domain Lifecycle",
  purpose: "Own how project domains are created, handed off, planned, discussed, decomposed, and executed.",
  overarchingGoal: "No domain work is lost or silently converted into Kanban work.",
  boundaries: ["Domain creation workflow", "Handoffs", "Agenda triage"],
  features: ["Manual domain creation", "Handoff workflow", "Meeting artifact flow"],
  relationships: ["Hermes CEO relay", "Kanban cockpit"],
  ownerPersona: "domain-architect",
  coreAgents: ["domain-architect", "agenda-agent"],
  kanbanBoard: "ceo-studio",
  createHandoff: true,
}, { projectPath: proj, createScaffold: true, createHandoff: true });
const lifecycleRoot = path.join(proj, "domains", "domain-lifecycle");
ok("domain scaffold creates required folders", domainsCore.DOMAIN_DIRS.every((d) => fs.existsSync(path.join(lifecycleRoot, d))));
ok("domain scaffold writes definition and agenda index", fs.existsSync(path.join(lifecycleRoot, "definition.md")) && fs.existsSync(path.join(lifecycleRoot, "captured-agenda-items.md")));
const fileBacked = domainsCore.getAllDomains(added.slug, { projectPath: proj }).find((d) => d.slug === "domain-lifecycle");
ok("file-backed domain ingestion reads definition.md", fileBacked && fileBacked.name === "Domain Lifecycle" && fileBacked.artifactPaths.definition.endsWith("definition.md"));
const handoff = domainsCore.createHandoffRecord({
  projectSlug: added.slug,
  projectPath: proj,
  domain: "domain-lifecycle",
  title: "Initial handoff",
  status: "pending",
  userConfirmation: true,
  sourceLinks: ["domains/domain-lifecycle/definition.md"],
  capturedEntities: ["Meeting artifact flow"],
  suggestedAgendaItems: [{ type: "meeting", title: "Plan first complete Domain Creation workflow", participants: ["domain-architect", "agenda-agent"] }],
  body: "Domain Architect created the confirmed package.",
});
ok("handoff record is persisted under domain", handoff.ok && fs.existsSync(path.join(proj, handoff.handoff.path)));
const handoffs = domainsCore.listHandoffs({ projectPath: proj, domain: "domain-lifecycle" });
ok("handoff parser exposes status and suggested agenda items", handoffs.handoffs.some((h) => h.status === "pending" && h.suggestedAgendaItems.length >= 1));
const agendaProposal = domainsCore.proposeAgendaFromHandoff({ projectSlug: added.slug, projectPath: proj, domain: "domain-lifecycle", handoffId: handoff.handoff.id });
ok("Agenda Agent proposal stays proposal-only", agendaProposal.ok && agendaProposal.proposals[0].status === "proposed" && agendaProposal.proposals[0].humanAttention === true);
const agendaItem = domainsCore.createAgendaItem({
  projectSlug: added.slug,
  projectPath: proj,
  domain: "domain-lifecycle",
  item: agendaProposal.proposals[0],
});
ok("Agenda Item serialization appends captured proposal", agendaItem.ok && /Plan first complete Domain Creation workflow/.test(fs.readFileSync(path.join(lifecycleRoot, "captured-agenda-items.md"), "utf-8")));
const meetingArtifact = domainsCore.saveMeetingArtifact({
  projectSlug: added.slug,
  projectPath: proj,
  domain: "domain-lifecycle",
  room: "domain-creation-dogfood",
  agenda: "Plan the first complete Domain Creation workflow implementation.",
  participants: ["domain-architect", "agenda-agent", "docs-steward"],
  expectedOutcome: "Implementation plan and domain-owned follow-ups.",
  requirements: "## Synthesis\nBuild the workflow end to end.",
  sourceContext: [{ kind: "handoff", title: "Initial handoff", path: handoff.handoff.path, text: "Confirmed domain creation package." }],
});
ok("meeting artifact is saved under agendas", meetingArtifact.ok && fs.existsSync(path.join(proj, meetingArtifact.artifact.path)));
ok("meeting artifact preserves selected source context", /Source Context/.test(fs.readFileSync(path.join(proj, meetingArtifact.artifact.path), "utf-8")));
const standupConfigured = standups.configure({
  projectSlug: added.slug,
  projectPath: proj,
  projectName: "PIPE",
  currentDomain: "domain-lifecycle",
  domain: "domain-lifecycle",
  board: "ceo-studio",
  timeLocal: "09:00",
});
ok("standup config schedules a recurring meeting", standupConfigured.ok && standupConfigured.meeting.recurrence === "daily" && standupConfigured.meeting.id === "standup-domain-lifecycle");
ok("standup config writes proposal-only agenda item", standupConfigured.agenda && standupConfigured.agenda.ok && standupConfigured.agenda.agendaItem.status === "proposed" && standupConfigured.agenda.agendaItem.humanAttention === true);
const standupScheduled = require("../main/core/meetings").listScheduled(proj).meetings.find((m) => m.id === standupConfigured.policy.meetingId);
ok("scheduled standup has no paid-provider permission", standupScheduled && standupScheduled.allowPaid === false && /Do not dispatch paid workers/.test(standupScheduled.agenda));
const standupStarted = require("../main/core/meetings").startScheduled({ projectPath: proj, id: standupConfigured.policy.meetingId });
const nextStandupScheduled = require("../main/core/meetings").listScheduled(proj).meetings.find((m) => m.id === standupConfigured.policy.meetingId);
ok("started recurring standup keeps stable policy meeting id", standupStarted.ok && nextStandupScheduled && nextStandupScheduled.status === "scheduled" && nextStandupScheduled.id === standupConfigured.policy.meetingId);
ok("recurring standup uses a unique occurrence room", standupStarted.ok
  && standupStarted.room !== standupConfigured.meeting.room
  && nextStandupScheduled.lastOccurrenceRoom === standupStarted.room
  && nextStandupScheduled.roomPrefix === standupConfigured.meeting.roomPrefix);
require("../main/core/meetings").updateScheduled({
  projectPath: proj,
  id: standupConfigured.policy.meetingId,
  patch: { scheduledFor: new Date(Date.now() - 60_000).toISOString() },
});
const standupDuePreview = standups.runDue({
  projectSlug: added.slug,
  projectPath: proj,
  now: new Date(),
  dryRun: true,
  limit: 1,
});
ok("due standup dry-run reports without starting", standupDuePreview.ok
  && standupDuePreview.dryRun === true
  && standupDuePreview.due === 1
  && standupDuePreview.started.length === 0);
const standupDailyGoal = goals.upsert(added.slug, {
  layer: "daily",
  title: "Complete the Brief Run contract",
  outcome: "The daily standup reviews the linked autonomous work.",
  domain: "domain-lifecycle",
  horizonStart: standups.localDateKey(),
  horizonEnd: standups.localDateKey(),
  successCriteria: ["Standup output reaches the Brief Run review surface"],
});
goals.linkWork(added.slug, {
  goalId: standupDailyGoal.goal.id,
  workKind: "brief",
  workId: "t_brief_run_contract",
  board: "ceo-studio",
  title: "Persistent Brief Run contract",
});
const fakeStandupRoom = "standup-pipe-test-occurrence";
const standupDueStarted = standups.runDue({
  projectSlug: added.slug,
  projectPath: proj,
  now: new Date(),
  services: {
    meetings: {
      ...meetings,
      startScheduled: ({ id }) => ({ ok: true, room: fakeStandupRoom, meeting: { id, room: fakeStandupRoom, status: "started" } }),
    },
  },
});
const standupExecution = standups.readExecutions(proj).executions.find((item) => item.room === fakeStandupRoom);
ok("due standup execution captures daily goals and linked Brief Runs", standupDueStarted.ok
  && standupExecution
  && standupExecution.goalIds.includes(standupDailyGoal.goal.id)
  && standupExecution.briefRefs.some((ref) => ref.taskId === "t_brief_run_contract")
  && standupExecution.allowPaid === false);
const duplicateStandupStart = standups.runDue({
  projectSlug: added.slug,
  projectPath: proj,
  now: new Date(),
  services: {
    meetings: {
      ...meetings,
      startScheduled: () => ({ ok: false, reason: "duplicate should not start" }),
    },
  },
});
ok("standup execution claim suppresses duplicate starts", duplicateStandupStart.ok && duplicateStandupStart.due === 0);
const standupRequirements = [
  "# Decisions",
  "- Decision: Keep the Brief Run review gate.",
  "",
  "## Next Actions",
  "- Add the daily standup evidence.",
].join("\n");
const reconciledStandup = standups.reconcile({
  projectSlug: added.slug,
  projectPath: proj,
  services: {
    meetings: {
      room: () => ({ ok: true, room: fakeStandupRoom, requirements: standupRequirements, running: false }),
      roomDir: () => path.join(proj, "brain", "rooms", fakeStandupRoom),
    },
  },
});
const standupBriefRun = briefRuns.read(added.slug, "ceo-studio", "t_brief_run_contract");
ok("completed standup synthesis reaches the linked Brief Run review pipeline", reconciledStandup.ok
  && reconciledStandup.completed.length === 1
  && standupBriefRun.meetingSyntheses.some((item) => item.meetingId === standupExecution.id)
  && standupBriefRun.meetings.some((item) => item.id === standupExecution.id && item.status === "done"));
const standupDecision = standups.readExecutions(proj).executions
  .find((item) => item.id === standupExecution.id)
  .synthesis.proposals.find((proposal) => proposal.type === "decision");
const unapprovedStandupDecision = standups.reviewProposal({
  projectSlug: added.slug,
  projectPath: proj,
  executionId: standupExecution.id,
  proposalId: standupDecision.id,
  action: "approve",
});
ok("standup proposal approval requires an explicit human flag", unapprovedStandupDecision.ok === false && /explicit human approval/.test(unapprovedStandupDecision.reason));
const approvedStandupDecision = standups.reviewProposal({
  projectSlug: added.slug,
  projectPath: proj,
  executionId: standupExecution.id,
  proposalId: standupDecision.id,
  action: "approve",
  humanApproved: true,
});
ok("approved standalone standup decisions persist on the occurrence", approvedStandupDecision.ok
  && approvedStandupDecision.proposal.status === "materialized"
  && standups.readExecutions(proj).executions
    .find((item) => item.id === standupExecution.id)
    .synthesis.proposals.some((proposal) => proposal.id === standupDecision.id && proposal.status === "materialized"));
const linkedStandupSynthesis = briefRuns.read(added.slug, "ceo-studio", "t_brief_run_contract")
  .meetingSyntheses.find((item) => item.meetingId === standupExecution.id);
for (const proposal of linkedStandupSynthesis.proposals.filter((item) => item.status === "pending")) {
  briefRuns.updateMeetingProposal(
    added.slug,
    "ceo-studio",
    "t_brief_run_contract",
    linkedStandupSynthesis.id,
    proposal.id,
    { status: "rejected", reviewedBy: "test" },
  );
}
const syncedStandupReview = standups.reconcile({ projectSlug: added.slug, projectPath: proj });
ok("standup occurrence completes when all linked Brief Run reviews finish", syncedStandupReview.reviewed.some((item) =>
  item.executionId === standupExecution.id && item.status === "completed" && item.pending === 0));
const standupAgain = standups.configure({
  projectSlug: added.slug,
  projectPath: proj,
  projectName: "PIPE",
  currentDomain: "domain-lifecycle",
  domain: "domain-lifecycle",
  board: "ceo-studio",
  timeLocal: "09:30",
});
ok("standup update is stable by policy id", standupAgain.ok && standups.status({ projectPath: proj }).policies.filter((p) => p.id === "standup-domain-lifecycle").length === 1);

const originalGetTask = hermes.getTask;
hermes.getTask = () => ({
  ok: true,
  task: { id: "t_domain", title: "Domain Lifecycle parent brief" },
  title: "Domain Lifecycle parent brief",
  body: domainBoard.briefBody({
    board: "ceo-studio",
    title: "Domain Lifecycle parent brief",
    goal: "Implement the full lifecycle.",
    domain: "domain-lifecycle",
    currentRenderedState: "Domain docs exist.",
    problemMismatch: "Work is not fully represented as Agenda Items.",
    constraints: ["No API-key CEO provider"],
    acceptanceCriteria: ["Agenda proposals exist"],
    nextAction: "Decompose into domain-owned proposals.",
  }),
});
const decomp = briefDecomposer.proposeSectionalBreakdown({ board: "ceo-studio", taskId: "t_domain", projectPath: proj, domainOverride: "domain-lifecycle" });
hermes.getTask = originalGetTask;
ok("decomposer primary output is Agenda Item proposals", decomp.ok && decomp.primaryOutput === "agenda_item_proposals" && decomp.agendaItemProposals.every((p) => p.humanAttention && p.provenanceLinks.length));
ok("decomposer materialization requires human approval", briefDecomposer.applySectionalDecomposition(decomp, { projectSlug: added.slug }).ok === false);

// --- brief-decomposer calls hermes.getTask with correct positional signature ---
// Integration test: verify the real getTask path is called with positional args (slug, id)
// This test does NOT stub hermes.getTask, so it exercises the actual signature
fs.mkdirSync(path.join(process.env.HERMES_HOME, "kanban", "boards", "test-board"), { recursive: true });
fs.writeFileSync(path.join(process.env.HERMES_HOME, "kanban", "boards", "test-board", "board.json"), JSON.stringify({ slug: "test-board" }));
const realGetTaskResult = hermes.getTask("test-board", "t_test");
ok("real hermes.getTask accepts positional (slug, id) signature", typeof realGetTaskResult === "object" && "ok" in realGetTaskResult);
ok("real hermes.getTask fails gracefully with no board", realGetTaskResult.ok === false && realGetTaskResult.reason);
const boardRead = hermes.getBoard("test-board");
ok("hermes board read failures are explicit, not fake empty boards", boardRead.ok === false && /database not found|read failed/i.test(boardRead.reason || ""));

// --- Domain Architect creation agent workflow ---
let architectSession = domainArchitect.start(added.slug, { name: "Meetings" });
ok("Domain Architect starts an interview session", architectSession.id && architectSession.currentField === "purpose");
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Own meeting setup, room outputs, follow-ups, and meeting artifacts.").session;
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Meetings create useful domain-owned synthesis and follow-up plans.").session;
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Does not own calendar credentials. Does not own provider funding.").session;
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Meeting agenda capture, participant roster, room transcript, synthesized output.").session;
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Domains, Teams, Agenda Agent, Hermes CEO.").session;
architectSession = domainArchitect.answer(added.slug, architectSession.id, "domain-architect, agenda-agent, docs-steward").session;
ok("Domain Architect reaches confirmation readiness", architectSession.readyToConfirm === true && architectSession.missing.length === 0);
const focusedArchitect = domainArchitect.focus(added.slug, architectSession.id, "features");
ok("Domain Architect can focus a clickable outline section", focusedArchitect.ok && focusedArchitect.session.activeFocus === "features");
architectSession = domainArchitect.answer(added.slug, architectSession.id, "Also capture saved synthesis artifacts and follow-up agenda proposals.").session;
ok("Domain Architect supports review-phase refinement", architectSession.transcript.some((turn) => turn.phase === "review" && turn.field === "features"));
const deepDive = domainArchitect.deepDive(added.slug, architectSession.id, { field: "features", note: "Explore recursive document linking after high-level definition." });
ok("Domain Architect captures deep dives as agenda candidates", deepDive.ok && deepDive.session.deepDives.length === 1 && deepDive.session.capturedEntities.some((e) => e.type === "deep-dive-agenda-candidate"));
architectSession = deepDive.session;
const architectPackage = domainArchitect.confirmationPackage(added.slug, architectSession.id);
ok("Domain Architect builds confirmed domain package", architectPackage.ok && architectPackage.domainPackage.name === "Meetings" && architectPackage.domainPackage.createHandoff === true);
ok("Domain Architect confirmation package carries raw transcript and deep dive agenda", architectPackage.domainPackage.rawTranscript.length >= 1 && architectPackage.domainPackage.agendaItems.some((item) => item.type === "decomposition"));
const architectCreatedDomain = domainsCore.defineDomain(added.slug, architectPackage.domainPackage, { projectPath: proj, createScaffold: true, createHandoff: true });
const architectHandoffs = domainsCore.listHandoffs({ projectPath: proj, domain: architectCreatedDomain.slug }).handoffs;
const architectHandoffText = fs.readFileSync(path.join(proj, architectHandoffs[0].path), "utf-8");
ok("Domain Architect handoff persists transcript and protocol fields", /## Raw Transcript/.test(architectHandoffText) && /From Agent: domain-architect/.test(architectHandoffText));

// --- orchestration org structure ---
ok("orchestration normalizes blocked lane aliases", orchestrationOrg.normalizeLane("Review / Blocked") === "blocked");
ok("orchestration normalizes bug lane aliases", orchestrationOrg.normalizeLane("defects") === "bug" && orchestrationOrg.defaultLaneForKind("bug") === "bug");
const orgSummary = orchestrationOrg.summary(null, { domain: "Engineering" });
ok("orchestration summary exposes lane owners", orgSummary.ok && orgSummary.lanes.some((l) => l.lane === "blocked" && l.team === "review-guild"));
ok("orchestration summary exposes bug lane owner", orgSummary.ok && orgSummary.lanes.some((l) => l.lane === "bug" && l.team === "self-repair"));
const taskRoute = orchestrationOrg.route(null, { domain: "Engineering", kind: "child_task" });
ok("child task route defaults to execution queue", taskRoute.lane === "todo" && taskRoute.team === "execution-builders");
ok("orchestration registry has no default missing teams", orgSummary.issues.filter((x) => /missing team/i.test(x)).length === 0);

// --- skill catalog + capability routing ---
const skillTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-proj-"));
fs.mkdirSync(path.join(skillTestDir, "skills", "swarm-coding"), { recursive: true });
fs.writeFileSync(path.join(skillTestDir, "skills", "swarm-coding", "SKILL.md"), [
  "---",
  "name: swarm-coding",
  "description: Coordinate swarm coding work with planners, coders, worktrees, integration, and verification.",
  "license: MIT",
  "---",
  "# Swarm Coding",
].join("\n"));
const catalog = skillCatalog.list(skillTestDir);
ok("skill catalog discovers project/Kimi-style SKILL.md", catalog.some((s) => s.id === "swarm-coding" && s.source === "project"));
const skillRoute = skillCatalog.route(skillTestDir, { skills: ["swarm-coding"], objective: "Build a persistent brief workspace with coding agents" });
ok("skill router maps swarm coding to registry agents", skillRoute.ok && skillRoute.team.some((a) => ["builder", "planner", "architect"].includes(a.id)));
ok("skill router returns a dispatch path", /Kanban|meeting/i.test(skillRoute.dispatchPath || ""));

// --- provenance graph contract ---
const parentEvent = provenance.recordWorkItem(added.slug, {
  kind: "brief",
  board: "ceo-studio",
  taskId: "t_brief",
  title: "Parent brief",
  domain: "engineering",
});
const relEvent = provenance.linkChild(added.slug, {
  parentId: "t_brief",
  childId: "t_child",
  title: "Child task",
  board: "ceo-studio",
});
const assetEvent = provenance.recordAsset(added.slug, {
  parentId: "t_brief",
  assetId: "asset_1",
  assetKind: "validation",
  title: "Test output",
  path: "artifacts/test-output.txt",
});
const graph = provenance.graph(added.slug, "t_brief");
ok("provenance records work item event", parentEvent && parentEvent.child && parentEvent.child.kind === "brief");
ok("provenance links child tasks to brief", relEvent && graph.children.some((c) => c.id === "t_child"));
ok("provenance links assets to brief", assetEvent && graph.assets.some((a) => a.id === "asset_1"));

// --- layered goal alignment contract ---
const weeklyGoal = goals.upsert(added.slug, {
  layer: "weekly",
  title: "Make autonomous board movement visible",
  outcome: "Blocked work and child tasks have visible provenance and escalation.",
  domain: "engineering",
  successCriteria: ["Briefs link to child work", "Blocked work produces escalation memory"],
});
ok("goals.upsert creates layered goal", weeklyGoal.ok && weeklyGoal.goal.layer === "weekly" && weeklyGoal.goal.id);
const goalLink = goals.linkWork(added.slug, {
  goalId: weeklyGoal.goal.id,
  workKind: "brief",
  workId: "t_brief",
  board: "ceo-studio",
  title: "Parent brief",
});
goals.linkWork(added.slug, {
  goalId: weeklyGoal.goal.id,
  workKind: "task",
  workId: "t_blocked",
  board: "ceo-studio",
  title: "Blocked repair",
});
ok("goals.linkWork links work and provenance", goalLink.ok && provenance.graph(added.slug, weeklyGoal.goal.id).children.some((c) => c.id === "t_brief"));
ok("goals.summary groups by layer", goals.summary(added.slug).byLayer.weekly.length >= 1);
const review = goalReview.buildReview({
  layer: "weekly",
  domain: "engineering",
  board: "ceo-studio",
  goals: [goals.get(added.slug, weeklyGoal.goal.id)],
  boardState: {
    slug: "ceo-studio",
    columns: {
      blocked: [{ id: "t_blocked", title: "Blocked repair", status: "blocked" }],
      triage: [{ id: "t_brief", title: "Parent brief", status: "triage" }],
    },
  },
});
ok("goal review summarizes board counts", review.boardCounts.blocked === 1 && review.boardCounts.triage === 1);
ok("goal review proposes next actions", review.goalReviews[0].actions.length >= 1 && /Goal Review/.test(review.markdown));
const writtenReview = goalReview.writeReview(added.slug, review);
ok("goal review writes durable artifact", writtenReview.artifact && writtenReview.artifact.type === "dream_cycle" && fs.existsSync(writtenReview.file));
const policyResult = autonomyLoop.setPolicy(added.slug, { enabled: true, intervalMinutes: 5, allowCreateWork: false, reviewLayers: ["daily"] });
ok("autonomy policy persists conservative mode", policyResult.ok && policyResult.policy.mode === "propose" && autonomyLoop.getPolicy(added.slug).intervalMinutes === 5);
ok("autonomy canRun allows enabled policy", autonomyLoop.canRun(added.slug).ok === true);
const actionSummary = autonomyLoop.summarizeActions([{ ok: true, review }]);
ok("autonomy summarizes proposed actions", actionSummary.some((a) => a.type === "analyze_blocked_work"));

// --- self-repair intake contract ---
const systemBug = selfRepair.buildSystemBug({
  source: "npm test",
  observedBehavior: "AGUI test failed to bind localhost.",
  domain: "Engineering",
});
ok("self-repair builds valid bug input", domainBoard.missingBugFields(systemBug).length === 0 && systemBug.severity === "high");
ok("self-repair uses registry agent owner + dedicated persona", systemBug.owner === "self-repair-engineer" && systemBug.persona === "self-repair-engineer");
const repairTask = selfRepair.buildRepairTask({ bugId: "t_bug", bugTitle: "AGUI bind failure" });
ok("self-repair builds linked repair task", repairTask.parentKind === "bug" && repairTask.parentId === "t_bug" && repairTask.relationship === "repairs");
ok("self-repair requires committed verified work", repairTask.owner === "self-repair-engineer" && repairTask.persona === "self-repair-engineer" && repairTask.acceptanceCriteria.some((c) => /commit hash/i.test(c)));
ok("self-repair can target the failing project workspace", selfRepair.buildRepairTask({ bugId: "t_bug", workspace: proj }).workspace === proj);
const evidenceRepairTask = selfRepair.buildRepairTask({ bugId: "t_bug", evidence: ["npm run check failed with missing script"] });
ok("self-repair carries failure evidence into repair tasks", evidenceRepairTask.evidence[0].includes("missing script") && /## Evidence/.test(domainBoard.childTaskBody(evidenceRepairTask)));
const consultMessage = selfRepair.buildConsultMessage({ request: "Fix voice repair handoff", bugId: "t_bug", repairTaskId: "t_repair" });
ok("self-repair handoff message includes ids and commit contract", consultMessage.includes("t_bug") && consultMessage.includes("t_repair") && /commit/i.test(consultMessage));

// --- blocked autonomy analysis contract ---
const blockedComment = autonomy.buildBlockedAnalysis({
  board: "ceo-studio",
  task: {
    id: "t_blocked",
    title: "Fix failing build",
    status: "blocked",
    last_failure_error: "npm test fails in renderer checks",
  },
  detail: { comments: [{ author: "worker", body: "I am stuck on the failing check." }] },
});
ok("blocked analyzer emits escalation comment", blockedComment.includes("CEO Studio Blocker Analysis") && blockedComment.includes("Escalation target: specialist"));
ok("blocked analyzer detects prior analysis", autonomy.hasRecentBlockerAnalysis({ comments: [{ author: "CEO Studio Autonomy", body: blockedComment }] }) === true);
ok("blocked analyzer routes unclear briefs to planner", autonomy.escalationTarget({ title: "Brief is ambiguous and missing acceptance criteria" }) === "planner");

// --- cost guardrail (the non-negotiable) ---
const meter = new CostMeter(added.slug, { maxSessionUsd: 0.01, maxDayUsd: 1 });
ok("can proceed initially", meter.canProceed().ok === true);
meter.recordUsage({ model: "default", tokensIn: 1000, tokensOut: 1000 }); // ~$0.018 > $0.01 cap
ok("session cap halts after breach", meter.canProceed().ok === false);
ok("status reports halted", meter.status().halted === true);

const meter2 = new CostMeter(added.slug, { maxSessionUsd: 100, maxDayUsd: 100 });
ok("kill switch blocks", (meter2.kill(), meter2.canProceed().ok === false));
ok("resume restores", (meter2.resume(), meter2.canProceed().ok === true));

// day spend persists across meter instances (same day file)
const m3 = new CostMeter(added.slug, { maxSessionUsd: 100, maxDayUsd: 100 });
ok("day spend persisted across instances", m3.status().dayUsd > 0);

// --- agent registry: dynamic providers + generic command passthrough ---
const registry = require("../main/core/registry");
const personaStore = require("../main/core/personas");
const mount = require("../main/core/mount");
const provs = registry.listProviders();
ok("listProviders includes claude", provs.includes("claude"));
ok("listProviders includes generic command", provs.includes("command"));
ok("listProviders includes vertex (Gemma)", provs.includes("vertex"));
ok("listProviders includes codex", provs.includes("codex"));
ok("listProviders includes hermes", provs.includes("hermes"));
ok("listProviders includes pi", provs.includes("pi"));
ok("listProviders hides echo (test-only scaffolding)", !provs.includes("echo"));

// --- model catalog: captured, selectable models per provider ---
const modelCatalog = require("../main/core/models");
const cat = modelCatalog.catalog(process.cwd());
ok("model catalog loads", cat.ok === true && cat.providers && typeof cat.providers === "object");
ok("catalog has vertex Gemma model",
  modelCatalog.modelsFor(process.cwd(), "vertex").some((m) => /gemma/i.test(m.id)));
ok("catalog has codex gpt-5 family",
  modelCatalog.modelsFor(process.cwd(), "codex").some((m) => /gpt-5/i.test(m.id)));
const devinModels = modelCatalog.modelsFor(process.cwd(), "devin");
ok("catalog has Devin models",
  devinModels.some((m) => m.id === "claude-sonnet-4.6") && devinModels.some((m) => m.id === "swe-1.6-fast"));
ok("Devin Sonnet pricing is captured",
  devinModels.some((m) => m.id === "claude-sonnet-4.6" && m.cost && m.cost.input_per_mtok === 3 && m.cost.output_per_mtok === 15));
ok("modelsFor unknown provider is empty", modelCatalog.modelsFor(process.cwd(), "nope").length === 0);

const regProj = fs.mkdtempSync(path.join(os.tmpdir(), "registry-proj-"));
ok("registry falls back to app harness agents", registry.read(regProj).agents.some((a) => a.id === "docs-steward"));
ok("registry includes self-repair engineer", registry.read(regProj).agents.some((a) => a.id === "self-repair-engineer"));
ok("registry persona list falls back to app harness personas", registry.listPersonas(regProj).some((p) => p.id === "docs-steward"));
ok("registry persona list includes self-repair engineer", registry.listPersonas(regProj).some((p) => p.id === "self-repair-engineer"));
ok("persona library falls back to app harness personas", personaStore.list(regProj, "All").some((p) => p.id === "docs-steward"));
// Default brain for a new agent is the real vertex (Gemma), not echo.
const defaulted = registry.createAgent(regProj, { name: "Default Brain" });
ok("new agent defaults to vertex provider", defaulted.ok && defaulted.agent.provider === "vertex");

const created = registry.createAgent(regProj, {
  name: "Claude Worker", provider: "command",
  command: "claude -p --output-format text {prompt}", persona: null,
});
ok("createAgent with command provider succeeds", created.ok === true);
const back = registry.read(regProj).agents.find((a) => a.id === created.agent.id);
ok("command template persisted + read back", back && back.command === "claude -p --output-format text {prompt}");
ok("command agent reports command provider", back && back.provider === "command");
const devinAgent = registry.createAgent(regProj, {
  id: "discover-pm",
  name: "Discover PM",
  provider: "devin",
  model: "gemini-3-flash",
  persona: "project-manager",
  memory_key: "discover:pm",
});
ok("createAgent with devin model succeeds", devinAgent.ok);
const devinPlan = mount.lookup(regProj, "discover-pm");
ok("mount lookup resolves project agents without project harness",
  devinPlan && devinPlan.id === "discover-pm" && devinPlan.provider === "devin");
ok("mount lookup carries Devin model command",
  devinPlan && devinPlan.command === "devin --model gemini-3-flash" && devinPlan.memory_key === "discover:pm");

// --- CEO is a unified, mountable agent (still Hermes/OAuth, no API key) ---
const ceoAgent = registry.read(regProj).agents.find((a) => a.id === "ceo");
ok("registry registers the ceo agent backed by Hermes", !!ceoAgent && ceoAgent.provider === "hermes");
ok("ceo agent is a default-Hermes profile session (empty profile = OAuth, no key)",
  ceoAgent && ceoAgent.launch_mode === "hermes_profile" && ceoAgent.profile === "");
// updateAgent must not strip the CEO's launch_mode/profile when the cockpit
// rewrites the agent at mount time (tmux_session caching).
const ceoProj = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-proj-"));
registry.createAgent(ceoProj, {
  id: "ceo", name: "CEO", provider: "hermes",
  launch_mode: "hermes_profile", profile: "", room: "discovery",
});
registry.updateAgent(ceoProj, "ceo", { tmux_session: "pipe-ceo", tmux_window: "main" });
const ceoAfter = registry.read(ceoProj).agents.find((a) => a.id === "ceo");
ok("mount-time update preserves CEO launch_mode + empty profile",
  ceoAfter && ceoAfter.launch_mode === "hermes_profile" && ceoAfter.profile === "" && ceoAfter.tmux_session === "pipe-ceo");

// --- Editing/deleting a SHIPPED (inherited) agent must work via copy-on-write.
// Regression: the cockpit listed shipped agents (e.g. `pm`) from the fallback
// registry, but Save/Delete only consulted the project write target and failed
// with "agent not found: pm".
const inheritProj = fs.mkdtempSync(path.join(os.tmpdir(), "registry-inherit-"));
ok("shipped agent is visible via the merged read", registry.read(inheritProj).agents.some((a) => a.id === "pm"));
ok("shipped agent is absent from the empty write target", !fs.existsSync(registry.writePath(inheritProj)));
const editShipped = registry.updateAgent(inheritProj, "pm", { description: "edited in cockpit", capabilities: "roadmap, planning" });
ok("updateAgent materializes a shipped agent (copy-on-write)", editShipped.ok === true);
const pmEdited = registry.read(inheritProj).agents.find((a) => a.id === "pm");
ok("edited shipped agent persists the change", pmEdited && pmEdited.description === "edited in cockpit");
ok("edited shipped agent preserves its shipped brain/persona", pmEdited && pmEdited.provider === "devin" && pmEdited.persona === "pm");
const overrideFile = JSON.parse(fs.readFileSync(registry.writePath(inheritProj), "utf8"));
ok("editing a shipped agent writes a project-level override", (overrideFile.agents || []).some((a) => a.id === "pm"));
// Deleting a shipped agent can't touch the shipped file; it writes a disabled tombstone.
const delShipped = registry.deleteAgent(inheritProj, "pm");
ok("deleteAgent tombstones a shipped agent instead of erroring", delShipped.ok === true && delShipped.disabled === true);
const pmTomb = registry.read(inheritProj).agents.find((a) => a.id === "pm");
ok("deleted shipped agent is disabled (hidden from the default directory)", pmTomb && pmTomb.enabled === false);
// A genuinely unknown agent must still fail honestly.
ok("updateAgent on an unknown agent still fails", registry.updateAgent(inheritProj, "no-such-agent", {}).ok === false);
ok("deleteAgent on an unknown agent still fails", registry.deleteAgent(inheritProj, "no-such-agent").ok === false);

// The harness registry must resolve the CEO as a launchable hermes_profile
// session whose command is the default Hermes (no -p flag = the OAuth CEO).
const ceoPlan = mount.lookup(regProj, "ceo");
ok("mount lookup resolves the CEO as a launchable Hermes-profile agent",
  ceoPlan && ceoPlan.id === "ceo" && ceoPlan.launch_mode === "hermes_profile" && ceoPlan.launchable === true);
ok("CEO launch command is the default Hermes (no API key, OAuth)",
  ceoPlan && ceoPlan.command === "hermes" && ceoPlan.profile === "");
// The cockpit chat routes through the CEO Hermes relay (askCeo), not a keyed model.
ok("hermes module exposes the unified CEO chat relay askCeo", typeof hermes.askCeo === "function");
{
  let starts = 0;
  let statusReads = 0;
  const result = hermes.ensureUp({
    status: () => {
      statusReads += 1;
      return statusReads === 1
        ? { ok: true, installed: true, up: false, starting: false }
        : { ok: true, installed: true, up: false, starting: true };
    },
    start: () => { starts += 1; return { ok: true, pid: 42 }; },
    sleep: () => {},
  });
  ok("Hermes startup launches once and returns as soon as startup is observed",
    starts === 1 && statusReads === 2 && result.starting === true);
}
{
  let starts = 0;
  const result = hermes.ensureUp({
    status: () => ({ ok: true, installed: true, up: false, starting: true }),
    start: () => { starts += 1; return { ok: true }; },
    sleep: () => {},
  });
  ok("Hermes startup does not launch a duplicate gateway while one is starting",
    starts === 0 && result.starting === true);
}
{
  const boardDir = path.join(process.env.HERMES_HOME, "kanban", "boards", "direct-comment-test");
  const db = path.join(boardDir, "kanban.db");
  fs.mkdirSync(boardDir, { recursive: true });
  execFileSync("sqlite3", [db, [
    "CREATE TABLE tasks (id TEXT PRIMARY KEY);",
    "CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);",
    "CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL);",
    "INSERT INTO tasks (id) VALUES ('t_direct_comment');",
  ].join("\n")]);
  const addedComment = hermes.addComment({
    board: "direct-comment-test",
    taskId: "t_direct_comment",
    author: "autonomy-runner/test",
    body: "durable lifecycle evidence",
  });
  const rows = JSON.parse(execFileSync("sqlite3", ["-json", db,
    "SELECT c.author,c.body,e.kind FROM task_comments c JOIN task_events e ON e.task_id=c.task_id WHERE c.task_id='t_direct_comment';"
  ], { encoding: "utf8" }));
  ok("Hermes lifecycle comments use the direct transactional board path",
    addedComment.ok && rows.length === 1 && rows[0].body === "durable lifecycle evidence" && rows[0].kind === "commented");
}
{
  const boardDir = path.join(process.env.HERMES_HOME, "kanban", "boards", "direct-assignment-test");
  const db = path.join(boardDir, "kanban.db");
  fs.mkdirSync(boardDir, { recursive: true });
  execFileSync("sqlite3", [db, [
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, assignee TEXT, claim_lock TEXT, claim_expires INTEGER, worker_pid INTEGER, current_run_id INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_failure_error TEXT);",
    "CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL);",
    "CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, status TEXT NOT NULL, claim_lock TEXT, claim_expires INTEGER, worker_pid INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT, summary TEXT, metadata TEXT, error TEXT);",
    "INSERT INTO tasks (id,status,assignee,consecutive_failures,last_failure_error) VALUES ('t_direct_assignment','ready','architect',3,'old failure');",
    "INSERT INTO task_runs (task_id,status,claim_lock,started_at) VALUES ('t_direct_reclaim','running','remote-host:99',100);",
    "INSERT INTO tasks (id,status,assignee,claim_lock,current_run_id,consecutive_failures,last_failure_error) VALUES ('t_direct_reclaim','running','architect','remote-host:99',last_insert_rowid(),2,'stuck');",
  ].join("\n")]);
  const assigned = hermes.assignTask({
    board: "direct-assignment-test",
    taskId: "t_direct_assignment",
    assignee: "Builder",
  });
  const rows = JSON.parse(execFileSync("sqlite3", ["-json", db,
    "SELECT t.assignee,t.consecutive_failures,t.last_failure_error,e.kind,e.payload FROM tasks t JOIN task_events e ON e.task_id=t.id WHERE t.id='t_direct_assignment';"
  ], { encoding: "utf8" }));
  ok("Hermes assignment uses the direct transactional board path",
    assigned.ok
      && rows.length === 1
      && rows[0].assignee === "builder"
      && rows[0].consecutive_failures === 0
      && rows[0].last_failure_error == null
      && rows[0].kind === "assigned"
      && JSON.parse(rows[0].payload).assignee === "builder");
  const reclaimed = hermes.assignTask({
    board: "direct-assignment-test",
    taskId: "t_direct_reclaim",
    assignee: "Builder",
    reclaim: true,
    reason: "worker exceeded bounded run",
  });
  const reclaimRows = JSON.parse(execFileSync("sqlite3", ["-json", db, [
    "SELECT t.status,t.assignee,t.claim_lock,t.current_run_id,r.status AS run_status,r.outcome,r.ended_at,",
    "(SELECT group_concat(kind, ',') FROM task_events WHERE task_id=t.id ORDER BY id) AS event_kinds",
    "FROM tasks t JOIN task_runs r ON r.task_id=t.id WHERE t.id='t_direct_reclaim';",
  ].join(" ")], { encoding: "utf8" }));
  ok("Hermes reclaim assignment closes the active run and records lifecycle events",
    reclaimed.ok
      && reclaimed.reclaimed === true
      && reclaimRows.length === 1
      && reclaimRows[0].status === "ready"
      && reclaimRows[0].assignee === "builder"
      && reclaimRows[0].claim_lock == null
      && reclaimRows[0].current_run_id == null
      && reclaimRows[0].run_status === "reclaimed"
      && reclaimRows[0].outcome === "reclaimed"
      && reclaimRows[0].ended_at != null
      && reclaimRows[0].event_kinds === "reclaimed,assigned");
}

// --- provider (offline default) + agent cost-gating ---
const { provider } = createProvider({});
ok("default provider is NullProvider (offline)", provider instanceof NullProvider);

// --- Gemma via Cloudflare AI Gateway (the proven PIPE path) ---
ok("gatewayUrl strips /google-vertex-ai and adds /compat",
  gatewayUrl("https://gw/v1/acct/name/google-vertex-ai") === "https://gw/v1/acct/name/compat/chat/completions");
ok("gatewayModel prefixes google-vertex-ai/",
  gatewayModel("google/gemma-4-26b-a4b-it-maas") === "google-vertex-ai/google/gemma-4-26b-a4b-it-maas");
ok("gatewayModel leaves already-prefixed models alone",
  gatewayModel("google-vertex-ai/foo") === "google-vertex-ai/foo");
const utilGw = createUtilityProvider({ CF_AI_GATEWAY_URL: "https://gw/x/google-vertex-ai", CF_API_TOKEN: "cfut_test" });
ok("createUtilityProvider prefers gateway when CF_* set", utilGw.provider instanceof VertexGatewayProvider);
ok("createUtilityProvider gateway default model is Gemma", utilGw.provider.model === "google/gemma-4-26b-a4b-it-maas");
const utilNull = createUtilityProvider({});
ok("createUtilityProvider is NullProvider when unconfigured", utilNull.provider instanceof NullProvider);

// --- live A2A room loop lifecycle (validation only; no agent is spawned) ---
const sessions = require("../main/core/sessions");
const REPO_ROOT = path.resolve(__dirname, "..");
const rlNoMembers = meetings.startRoomLoop({ projectPath: REPO_ROOT, room: "test-room" });
ok("room loop requires members or a team", rlNoMembers.ok === false && /members or a team/.test(rlNoMembers.reason));
ok("room loop requires a room name", meetings.startRoomLoop({ projectPath: REPO_ROOT, members: "a,b" }).ok === false);
ok("room loop reports not running for an unopened room", meetings.roomLoopStatus({ room: "test-room" }).running === false);
ok("stop room loop on an unopened room is a no-op", meetings.stopRoomLoop({ room: "test-room" }).stopped === false);

// --- studio sessions persistence ---
sessions.bindProject(added.slug, added.path);
const sessCreated = sessions.create(added.slug, { title: "Test build", leadAgentId: "ceo" });
ok("studio session create", sessCreated.ok && sessCreated.session.id && sessCreated.session.room.startsWith("sess-"));
ok("studio session live room is manual by default", sessCreated.session.roomLoop.status === "stopped" && sessCreated.session.allowPaid === false);
const paidSess = sessions.create(added.slug, { title: "Paid explicit", leadAgentId: "ba", allowPaid: true });
ok("studio session can record explicit paid-agent opt-in", paidSess.ok && paidSess.session.allowPaid === true);
const linkedSess = sessions.create(added.slug, {
  title: "Brief-linked build",
  leadAgentId: "ceo",
  briefRef: {
    board: "ceo-studio",
    taskId: "t_brief_run_contract",
    runId: "ceo-studio:t_brief_run_contract",
  },
});
ok("studio session persists its Brief Run reference", linkedSess.ok && linkedSess.session.briefRef.runId === "ceo-studio:t_brief_run_contract");
ok("Brief Run can recover all linked studio sessions", sessions.forBrief(added.slug, "ceo-studio", "t_brief_run_contract").some((item) => item.id === linkedSess.session.id));
const sessListed = sessions.list(added.slug);
ok("studio session list includes new session", sessListed.sessions.some((s) => s.id === sessCreated.session.id));
sessions.setActive(sessCreated.session.id);
ok("studio session set active", sessions.getActiveId() === sessCreated.session.id);
const sessUpdated = sessions.update(added.slug, sessCreated.session.id, { phase: "plan" });
ok("studio session update phase", sessUpdated.ok && sessUpdated.session.phase === "plan");
const paidUpdate = sessions.update(added.slug, sessCreated.session.id, { allowPaid: true });
ok("studio session update can record explicit paid opt-in", paidUpdate.ok && paidUpdate.session.allowPaid === true);
const withPlan = sessions.setPlan(added.slug, sessCreated.session.id, { title: "P", body: "## Steps\n1. A" });
ok("studio session set plan", withPlan.ok && withPlan.session.planDoc.body.includes("Steps"));
const approved = sessions.approvePlan(added.slug, sessCreated.session.id);
ok("studio session approve plan", approved.ok && approved.session.planApprovedAt);
const execGate = sessions.update(added.slug, sessCreated.session.id, { phase: "execute" });
ok("studio session execute after approve", execGate.ok && execGate.session.phase === "execute");
const teamSet = sessions.setPlannedTeam(added.slug, sessCreated.session.id, [{ agentId: "ceo", role: "x" }]);
ok("studio session planned team excludes lead duplicate", teamSet.ok && teamSet.session.plannedTeam.length === 0);
sessions.setPlannedTeam(added.slug, sessCreated.session.id, [{ agentId: "docs-steward", role: "design" }]);
ok("studio session task tree", sessions.setTaskTree(added.slug, sessCreated.session.id, [{ id: "s1", title: "A", status: "pending", children: [] }]).ok);
const treeDecomp = sessions.getDecompositionSummary(sessions.get(added.slug, sessCreated.session.id).session);
ok("studio session decomposition from task tree", treeDecomp.items.length === 1 && treeDecomp.items[0].title === "A");
const decompSet = sessions.setDecomposition(added.slug, sessCreated.session.id, {
  title: "Build breakdown",
  items: [{ title: "Wire UI", type: "decomposition", status: "proposed", actionItems: ["Add panel"] }],
});
ok("studio session set decomposition doc", decompSet.ok && decompSet.decomposition.items[0].title === "Wire UI");
const decompGet = sessions.get(added.slug, sessCreated.session.id);
ok("studio session get includes decomposition summary", decompGet.decomposition.items[0].type === "decomposition");
const sessionCapture = require("../main/core/session-capture");
const fromJson = sessionCapture.extractDecompositionFromAgui(
  { title: "Breakdown", components: [] },
  { decomposition: { items: [{ title: "Ship UI", type: "decomposition", status: "proposed" }] } },
);
ok("session capture reads decomposition JSON", fromJson && fromJson.items.length === 1);
const fromList = sessionCapture.extractDecompositionFromAgui({
  title: "Decomposition",
  components: [{ type: "list", props: { items: ["Auth flow | decomposition | proposed", "API layer | step | pending"] } }],
}, null);
ok("session capture reads decomposition list", fromList && fromList.items.length === 2);
const cap = sessionCapture.captureFromAgentReply(added.slug, sessCreated.session.id, {
  ui: { title: "Decomposition", components: [{ type: "list", props: { items: ["One | decomposition | proposed", "Two | step | proposed"] } }] },
  raw: null,
  phase: "decompose",
});
ok("session capture persists decomposition from agui", cap.ok && cap.decomposition && cap.decomposition.ok);
const roomStatus = sessions.roomLoopStatus(added.slug, sessCreated.session.id);
ok("studio session room loop reports stopped until explicitly started", roomStatus.ok && roomStatus.running === false);
const transcript = sessions.appendTranscript(added.slug, sessCreated.session.id, { role: "assistant", content: "Saved reply" });
ok("studio session transcript persists", transcript.ok && transcript.session.transcript.some((m) => m.content === "Saved reply"));

(async () => {
  const killMeter = new CostMeter(added.slug, { maxSessionUsd: 100, maxDayUsd: 100 });
  killMeter.kill();
  const agent = new DocumentAgent({ slug: added.slug, project: added, provider, cost: killMeter });
  const halted = await agent.ask("hello");
  ok("agent refuses to call model when killed", halted.halted === true && /guardrail/i.test(halted.text));

  const liveMeter = new CostMeter(added.slug, { maxSessionUsd: 100, maxDayUsd: 100 });
  const agent2 = new DocumentAgent({ slug: added.slug, project: added, provider, cost: liveMeter });
  const reply = await agent2.ask("summarize the strategy");
  ok("agent returns text via NullProvider", typeof reply.text === "string" && reply.text.length > 0);
  ok("offline call costs $0", liveMeter.status().sessionUsd === 0);

  console.log(`\n${passed} checks passed.`);
})();
