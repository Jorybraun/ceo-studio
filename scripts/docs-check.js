"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

const checks = [];

function check(name, condition) {
  checks.push({ name, ok: !!condition });
}

function includes(file, needle) {
  return read(file).includes(needle);
}

const agents = read("AGENTS.md");
const readme = read("README.md");
const e2e = read("runtime/harness/architecture/DOMAIN_BOARD_AUTONOMY_E2E.md");
const autonomyRunner = read("runtime/harness/architecture/AUTONOMY_RUNNER_PLAN.md");
const docsPolicy = read("runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md");
const dogfoodSkill = read("runtime/harness/skills/dogfood/SKILL.md");
const agentsJson = JSON.parse(read("runtime/harness/agents/agents.json"));
const domainLifecycleIndex = "domains/domain-lifecycle/docs/design/system-overview.md";

check("AGENTS states Hermes CEO rule", /The CEO Is Hermes/i.test(agents) && /There Is No API Key/i.test(agents));
check("AGENTS preserves no API-key CEO warning", /OPENAI_API_KEY/.test(agents) && /ANTHROPIC_API_KEY/.test(agents));
check("AGENTS includes mandatory documentation handoff", /Documentation Handoff \(Mandatory\)/.test(agents));
check("README points to current autonomy doc", readme.includes("DOMAIN_BOARD_AUTONOMY_E2E.md"));
check("README points to autonomy runner plan", readme.includes("AUTONOMY_RUNNER_PLAN.md"));
check("README points to docs stewardship policy", readme.includes("DOCS_STEWARDSHIP_AND_HANDOFF.md"));
check("README documents Electron CDP smoke test", readme.includes("npm run smoke:electron"));
check("README documents self-QA loop", readme.includes("npm run qa:self"));
check("Autonomy doc mentions orchestration org", /orchestration-org/.test(e2e));
check("Autonomy doc mentions bug lane", /`bug` lane/.test(e2e) && /self-repair/.test(e2e));
check("Autonomy doc mentions docs stewardship", /docs-steward|documentation/i.test(e2e));
check("Autonomy doc mentions self-repair engineer handoff", /self-repair-engineer/.test(e2e) && /ask_self_repair/.test(e2e));
check("Autonomy runner plan distinguishes current vs planned commands", /Invalid today/i.test(autonomyRunner) && /hermes gateway start/.test(autonomyRunner));
check("Docs policy documents docs-steward", /docs-steward/.test(docsPolicy) && /npm run docs:check/.test(docsPolicy));
check("docs-steward skill exists", exists("runtime/harness/skills/docs-steward/SKILL.md"));
check("docs-steward persona exists", exists("runtime/harness/personas/general/docs-steward.md"));
check("self-repair skill exists", exists("runtime/harness/skills/self-repair/SKILL.md"));
check("self-repair persona exists", exists("runtime/harness/personas/general/self-repair-engineer.md"));
check("dogfood skill uses Chrome MCP/CDP", /Chrome DevTools MCP|Electron CDP/.test(dogfoodSkill) && !/browser_navigate/.test(dogfoodSkill));
check("dogfood skill references exist", exists("runtime/harness/skills/dogfood/references/issue-taxonomy.md") && exists("runtime/harness/skills/dogfood/templates/dogfood-report-template.md"));
check("self-QA CDP runner exists", exists("scripts/self-qa-cdp.js") && includes("package.json", "qa:self"));
check("agents.json registers docs-steward", (agentsJson.agents || []).some((a) => a.id === "docs-steward"));
check("agents.json registers documentation-stewards team", !!(agentsJson.teams || {})["documentation-stewards"]);
check("agents.json registers self-repair engineer", (agentsJson.agents || []).some((a) => {
  return a.id === "self-repair-engineer"
    && ["codex", "devin"].includes(a.provider)
    && a.persona === "self-repair-engineer";
}));
check("agents.json registers self-repair team", !!(agentsJson.teams || {})["self-repair"]);
check("package check runs docs:check", includes("package.json", "npm run docs:check"));
check("Domain lifecycle design docs exist (from June 2026 discussion)", exists(domainLifecycleIndex) && exists("domains/domain-lifecycle/docs/design/domain-creation-process.md") && exists("domains/domain-lifecycle/docs/personas/domain-architect.md"));
check("Domain lifecycle tracks meeting and calendar capability", exists("domains/domain-lifecycle/docs/features/meeting-follow-up-sessions.md") && exists("domains/domain-lifecycle/agendas/README.md") && exists("domains/domain-lifecycle/requirements/README.md"));
check("New critical personas registered in agents.json (design placeholders)", (agentsJson.agents || []).some((a) => a.id === "domain-architect") && (agentsJson.agents || []).some((a) => a.id === "agenda-agent") && (agentsJson.agents || []).some((a) => a.id === "ba-document-guard"));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} documentation check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} documentation checks passed.`);
