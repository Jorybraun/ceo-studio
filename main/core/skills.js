"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const registry = require("./registry");

const DEFAULT_SKILLS = [
  { id: "herder-swarm-control", name: "Herder Swarm Control", description: "Control and coordinate agent swarms via herder", category: "coordination", source: "builtin" },
  { id: "herder-messaging", name: "Herder Messaging", description: "Structured messaging between agents", category: "communication", source: "builtin" },
  { id: "herder-session-management", name: "Herder Session Management", description: "Manage agent sessions and lifecycle", category: "coordination", source: "builtin" },
  { id: "kanban-management", name: "Kanban Management", description: "Manage kanban boards and tasks", category: "coordination", source: "builtin" },
  { id: "codebase-navigation", name: "Codebase Navigation", description: "Navigate and understand codebase structure", category: "analysis", source: "builtin" },
  { id: "architecture-analysis", name: "Architecture Analysis", description: "Analyze system architecture and patterns", category: "analysis", source: "builtin" },
  { id: "implementation", name: "Implementation", description: "Write and implement code", category: "development", source: "builtin" },
  { id: "planning", name: "Planning", description: "Create detailed plans and specifications", category: "planning", source: "builtin" },
  { id: "code_review", name: "Code Review", description: "Review and analyze code quality", category: "development", source: "builtin" },
  { id: "file-operations", name: "File Operations", description: "Read, write, and edit files", category: "development", source: "builtin" },
  { id: "command-execution", name: "Command Execution", description: "Execute shell commands", category: "development", source: "builtin" },
  { id: "git-operations", name: "Git Operations", description: "Git version control operations", category: "development", source: "builtin" },
];

function slug(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
  }
  return raw.split(/[,\n]/).map((s) => stripQuotes(s.trim())).filter(Boolean);
}

function stripQuotes(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "").trim();
}

function parseFrontmatter(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const end = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (end < 0) return {};
  const out = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2] || "";
    if (value === ">" || value === "|") {
      const chunks = [];
      while (i + 1 < end && /^\s+/.test(lines[i + 1])) {
        i++;
        chunks.push(lines[i].trim());
      }
      value = chunks.join(value === ">" ? " " : "\n");
    }
    out[key] = stripQuotes(value);
  }
  for (const listKey of ["tags", "related_skills", "dependencies", "platforms"]) {
    if (out[listKey]) out[listKey] = splitList(out[listKey]);
  }
  return out;
}

function inferCategory(skill) {
  const text = [skill.id, skill.name, skill.description, ...(skill.tags || [])].join(" ").toLowerCase();
  if (/swarm|orchestrat|coordination|meeting|minutes|daily-report/.test(text)) return "coordination";
  if (/research|evidence|search|paper|scientific|stock/.test(text)) return "research";
  if (/code|coding|implementation|git|command|file/.test(text)) return "development";
  if (/docx|pdf|pptx|xlsx|document|report|process-doc/.test(text)) return "documents";
  if (/content|copy|seo|campaign|ad-creative|writing|longread/.test(text)) return "content";
  if (/metric|pricing|churn|saas|legal|risk/.test(text)) return "business";
  if (/browser|download|cron|webbridge/.test(text)) return "automation";
  if (/theme|design|visual|seaborn/.test(text)) return "design";
  return skill.category || "general";
}

function capabilityTokens(skill) {
  const words = [
    skill.id,
    skill.name,
    skill.category,
    skill.description,
    ...(skill.tags || []),
    ...(skill.related_skills || []),
  ].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const aliases = [];
  const text = words.join(" ");
  if (/swarm|coordination|meeting|minutes/.test(text)) aliases.push("coordination", "synthesis", "orchestration");
  if (/research|evidence|market|competitive/.test(text)) aliases.push("research", "evidence", "uncertainty");
  if (/code|coding|implementation|git|file|command/.test(text)) aliases.push("implementation", "patches", "verification");
  if (/architect|architecture|system|interface/.test(text)) aliases.push("adr", "interfaces", "data-model");
  if (/requirement|planning|plan|brief|decomposition/.test(text)) aliases.push("requirements", "task-planning", "decomposition");
  if (/docs|document|minutes|report|handoff/.test(text)) aliases.push("documentation", "handoff-review", "docs-drift");
  if (/content|copy|seo|campaign|ad/.test(text)) aliases.push("research", "ux", "roadmap", "prioritization");
  return [...new Set(words.concat(aliases))];
}

function skillDirs(projectPath) {
  const dirs = [];
  const env = String(process.env.CEO_SKILLS_DIRS || "").trim();
  for (const part of env.split(path.delimiter)) if (part.trim()) dirs.push({ root: part.trim(), source: "env" });
  if (projectPath) dirs.push({ root: path.join(projectPath, "skills"), source: "project" });
  dirs.push({ root: path.join(__dirname, "..", "..", "runtime", "harness", "skills"), source: "harness" });
  const kimi = process.env.KIMI_SKILLS_DIR
    || path.join(os.homedir(), "Library", "Application Support", "kimi-desktop", "daimon-share", "daimon", "skills");
  dirs.push({ root: kimi, source: "kimi" });
  return dirs;
}

function scanRoot(root, source) {
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "SKILL.md");
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const meta = parseFrontmatter(text);
      const id = slug(meta.name || entry.name);
      if (!id) continue;
      const skill = {
        id,
        name: meta.name || entry.name,
        description: meta.description || "",
        category: meta.category || meta.type || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        related_skills: Array.isArray(meta.related_skills) ? meta.related_skills : [],
        license: meta.license || "",
        path: file,
        source,
      };
      skill.category = inferCategory(skill);
      skill.capabilities = capabilityTokens(skill).slice(0, 28);
      found.push(skill);
    } catch {
      // Ignore malformed third-party skills; the catalog must stay available.
    }
  }
  return found;
}

function list(projectPath) {
  const merged = new Map();
  for (const skill of DEFAULT_SKILLS) {
    const s = { ...skill, capabilities: capabilityTokens(skill).slice(0, 28) };
    merged.set(s.id, s);
  }
  for (const dir of skillDirs(projectPath)) {
    for (const skill of scanRoot(dir.root, dir.source)) {
      if (!merged.has(skill.id)) merged.set(skill.id, skill);
    }
  }
  return [...merged.values()].sort((a, b) => {
    const bySource = String(a.source).localeCompare(String(b.source));
    return bySource || String(a.id).localeCompare(String(b.id));
  });
}

function agentScore(agent, tokens) {
  const hay = [
    agent.id,
    agent.name,
    agent.provider,
    agent.model,
    agent.persona,
    agent.description,
    ...(agent.capabilities || []),
  ].join(" ").toLowerCase();
  let score = 0;
  const reasons = [];
  for (const token of tokens) {
    if (!token || token.length < 3) continue;
    if (hay.includes(token)) {
      score++;
      if (reasons.length < 6) reasons.push(token);
    }
  }
  if (agent.enabled === false) score -= 100;
  return { score, reasons };
}

function preferredAgentBoost(agent, selectedSkills) {
  const id = String(agent.id || "").toLowerCase();
  const text = selectedSkills.map((skill) => `${skill.id} ${skill.name} ${skill.category} ${skill.description}`).join(" ").toLowerCase();
  let boost = 0;
  const reasons = [];
  const add = (amount, reason) => { boost += amount; if (reasons.length < 4) reasons.push(reason); };
  if (/swarm-coding|coding|implementation|code/.test(text)) {
    if (id === "builder") add(12, "coding lead");
    if (id === "architect") add(8, "architecture/integration");
    if (id === "planner") add(7, "task slicing");
    if (id === "docs-steward") add(4, "docs gate");
    if (id === "self-repair-engineer") add(3, "repair/verification");
  }
  if (/deep-research|research|evidence/.test(text)) {
    if (id === "researcher") add(12, "research lead");
    if (id === "planner") add(5, "synthesis planning");
    if (id === "ba") add(4, "requirements framing");
  }
  if (/minutes|daily-report|process-doc|report|document|docx|pdf|pptx/.test(text)) {
    if (id === "docs-steward") add(10, "documentation lead");
    if (id === "facilitator") add(6, "meeting synthesis");
    if (id === "pm") add(5, "action follow-up");
  }
  if (/campaign|content|copy|seo|ad-creative|growth/.test(text)) {
    if (id === "researcher") add(7, "content research");
    if (id === "designer") add(6, "creative/UX");
    if (id === "pm") add(5, "campaign planning");
  }
  return { boost, reasons };
}

function route(projectPath, { skills = [], objective = "", domain = "All" } = {}) {
  const catalog = list(projectPath);
  const requestedIds = (Array.isArray(skills) ? skills : String(skills || "").split(/[,\n]/))
    .map((s) => slug(s))
    .filter(Boolean);
  const requested = requestedIds.length
    ? catalog.filter((skill) => requestedIds.includes(skill.id))
    : catalog.filter((skill) => String(objective || "").toLowerCase().includes(skill.id));
  const selected = requested.length ? requested : [];
  const tokens = [...new Set(selected.flatMap((skill) => skill.capabilities || []).concat(
    String(objective || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  ))];
  const reg = registry.read(projectPath);
  const agents = (reg.agents || []).map((agent) => {
    const scored = agentScore(agent, tokens);
    const preferred = preferredAgentBoost(agent, selected);
    return { ...agent, score: scored.score + preferred.boost, matchReasons: [...preferred.reasons, ...scored.reasons] };
  }).filter((agent) => agent.score > 0 && agent.enabled !== false)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const lead = agents[0] || null;
  const team = agents.slice(0, 6).map((agent) => ({
    id: agent.id,
    name: agent.name || agent.id,
    provider: agent.provider || "unknown",
    persona: agent.persona || null,
    capabilities: agent.capabilities || [],
    score: agent.score,
    reasons: agent.matchReasons,
  }));
  const gaps = [];
  for (const skill of selected) {
    const any = team.some((agent) => (skill.capabilities || []).some((token) =>
      [agent.id, agent.name, agent.persona, ...(agent.capabilities || [])].join(" ").toLowerCase().includes(token)
    ));
    if (!any) gaps.push(`No strong registry match for skill: ${skill.id}`);
  }
  return {
    ok: true,
    domain,
    objective,
    requestedSkills: selected,
    leadAgent: lead ? lead.id : "",
    team,
    gaps,
    dispatchPath: selected.some((s) => /swarm|coding|implementation|code/.test(`${s.id} ${s.category}`))
      ? "Create a Hermes Kanban brief, decompose it, then let the autonomy runner dispatch Devin worktrees."
      : "Start a meeting/channel with the matched agents, compile decisions into board work, then dispatch only approved execution tasks.",
  };
}

module.exports = { list, route, parseFrontmatter, inferCategory, capabilityTokens };
