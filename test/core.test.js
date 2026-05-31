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
const { createProvider, NullProvider } = require("../main/core/llm");
const { DocumentAgent } = require("../main/core/agent");
const jobs = require("../main/core/jobs");
const ticketPlanner = require("../main/core/ticket-planner");

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

// --- provider (offline default) + agent cost-gating ---
const { provider } = createProvider({});
ok("default provider is NullProvider (offline)", provider instanceof NullProvider);

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
