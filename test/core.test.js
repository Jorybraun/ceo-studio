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

// Isolate all studio state in a temp home BEFORE requiring core modules.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-test-"));
process.env.CEO_STUDIO_HOME = HOME;
delete process.env.CEO_MODEL_PROVIDER;

const projects = require("../main/core/projects");
const brain = require("../main/core/brain");
const { CostMeter } = require("../main/core/cost");
const { createProvider, createUtilityProvider, NullProvider, VertexGatewayProvider, gatewayUrl, gatewayModel } = require("../main/core/llm");
const { DocumentAgent } = require("../main/core/agent");
const jobs = require("../main/core/jobs");
const ticketPlanner = require("../main/core/ticket-planner");
const domainBoard = require("../main/core/domain-board");
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

let passed = 0;
function ok(name, cond) {
  if (!cond) { console.error("FAIL", name); process.exitCode = 1; }
  else { console.log("PASS", name); passed++; }
}

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
const realGetTaskResult = hermes.getTask("test-board", "t_test");
ok("real hermes.getTask accepts positional (slug, id) signature", typeof realGetTaskResult === "object" && "ok" in realGetTaskResult);
ok("real hermes.getTask fails gracefully with no board", realGetTaskResult.ok === false && realGetTaskResult.reason);

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
const architectPackage = domainArchitect.confirmationPackage(added.slug, architectSession.id);
ok("Domain Architect builds confirmed domain package", architectPackage.ok && architectPackage.domainPackage.name === "Meetings" && architectPackage.domainPackage.createHandoff === true);

// --- orchestration org structure ---
ok("orchestration normalizes blocked lane aliases", orchestrationOrg.normalizeLane("Review / Blocked") === "blocked");
ok("orchestration normalizes bug lane aliases", orchestrationOrg.normalizeLane("defects") === "bug" && orchestrationOrg.defaultLaneForKind("bug") === "bug");
const orgSummary = orchestrationOrg.summary(null, { domain: "Engineering" });
ok("orchestration summary exposes lane owners", orgSummary.ok && orgSummary.lanes.some((l) => l.lane === "blocked" && l.team === "review-guild"));
ok("orchestration summary exposes bug lane owner", orgSummary.ok && orgSummary.lanes.some((l) => l.lane === "bug" && l.team === "self-repair"));
const taskRoute = orchestrationOrg.route(null, { domain: "Engineering", kind: "child_task" });
ok("child task route defaults to execution queue", taskRoute.lane === "todo" && taskRoute.team === "execution-builders");
ok("orchestration registry has no default missing teams", orgSummary.issues.filter((x) => /missing team/i.test(x)).length === 0);

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
ok("self-repair uses dedicated persona", systemBug.persona === "self-repair-engineer");
const repairTask = selfRepair.buildRepairTask({ bugId: "t_bug", bugTitle: "AGUI bind failure" });
ok("self-repair builds linked repair task", repairTask.parentKind === "bug" && repairTask.parentId === "t_bug" && repairTask.relationship === "repairs");
ok("self-repair requires committed verified work", repairTask.persona === "self-repair-engineer" && repairTask.acceptanceCriteria.some((c) => /commit hash/i.test(c)));
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
