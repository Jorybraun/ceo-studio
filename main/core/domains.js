"use strict";
/**
 * Domain lifecycle storage.
 *
 * The project folder is the human-readable source of truth:
 *   domains/<domain-slug>/definition.md
 *   domains/<domain-slug>/captured-agenda-items.md
 *   domains/<domain-slug>/handoffs/
 *   domains/<domain-slug>/{plans,requirements,agendas,docs/...}
 *
 * A compact JSON copy is kept in the per-project brain for legacy callers and
 * fast lookup. New code should pass projectPath whenever possible.
 */
const fs = require("fs");
const path = require("path");
const { brainDir, slugify } = require("./paths");
const brain = require("./brain");

const DOMAIN_DIRS = [
  "handoffs",
  "plans",
  "requirements",
  "agendas",
  "docs/features",
  "docs/personas",
  "docs/design",
];

const AGENDA_TYPES = new Set([
  "feature",
  "documentation",
  "meeting",
  "handoff-triage",
  "decomposition",
  "agent/persona proposal",
  "scoping decision",
  "bug/system repair",
]);

function domainsDir(slug) {
  return path.join(brainDir(slug), "domains");
}

function initDomains(slug) {
  const domainsPath = domainsDir(slug);
  fs.mkdirSync(domainsPath, { recursive: true });
  return domainsPath;
}

function domainSlug(nameOrSlug) {
  return slugify(nameOrSlug || "domain").replace(/^project$/, "domain");
}

function displayNameFromSlug(s) {
  return String(s || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Domain";
}

function projectDomainsRoot(projectPath) {
  return projectPath ? path.join(projectPath, "domains") : null;
}

function safeProjectRelative(projectPath, relPath) {
  if (!projectPath || !relPath) return null;
  const root = path.resolve(projectPath);
  const resolved = path.resolve(root, String(relPath));
  if (resolved === root || resolved.startsWith(root + path.sep)) return { root, resolved };
  return null;
}

function domainPath(projectPath, slugOrName) {
  if (!projectPath) return null;
  return path.join(projectPath, "domains", domainSlug(slugOrName));
}

function relFromProject(projectPath, fullPath) {
  return projectPath && fullPath ? path.relative(projectPath, fullPath) : null;
}

function listify(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value == null ? "" : value)
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeAgendaType(type) {
  const clean = String(type || "").trim().toLowerCase();
  return AGENDA_TYPES.has(clean) ? clean : "feature";
}

function validateDomainDefinition(def = {}) {
  const missing = [];
  if (!String(def.name || "").trim()) missing.push("name");
  if (!String(def.purpose || "").trim()) missing.push("purpose");
  if (!String(def.overarchingGoal || def.goal || "").trim()) missing.push("long-term goal");
  if (!listify(def.boundaries || def.responsibilities).length) missing.push("boundaries/ownership");
  if (!listify(def.features || def.initialFeatures || def.activeEpics).length) missing.push("initial features");
  return missing;
}

function normalizeDomainDefinition(domainDef = {}, { projectPath = null, existing = null } = {}) {
  const name = String(domainDef.name || existing?.name || "").trim();
  const slug = domainSlug(domainDef.slug || existing?.slug || name);
  const relPath = domainDef.relativePath || existing?.relativePath || path.join("domains", slug);
  const sourcePath = domainDef.sourcePath || (projectPath ? path.join(projectPath, relPath) : existing?.sourcePath || null);
  const now = new Date().toISOString();
  const boundaries = listify(domainDef.boundaries || domainDef.responsibilities || existing?.boundaries || existing?.responsibilities);
  const features = listify(domainDef.features || domainDef.initialFeatures || domainDef.activeEpics || existing?.features || existing?.activeEpics);
  const relationships = listify(domainDef.relationships || domainDef.interfaces || existing?.relationships || existing?.interfaces);
  const ownerPersona = String(domainDef.ownerPersona || domainDef.owner || existing?.ownerPersona || "").trim();

  return {
    slug,
    name,
    purpose: String(domainDef.purpose || existing?.purpose || "").trim(),
    goal: String(domainDef.goal || domainDef.overarchingGoal || existing?.goal || existing?.overarchingGoal || domainDef.currentState || "").trim(),
    overarchingGoal: String(domainDef.overarchingGoal || domainDef.goal || existing?.overarchingGoal || existing?.goal || domainDef.currentState || "").trim(),
    boundaries,
    responsibilities: boundaries,
    features,
    activeEpics: features,
    relationships,
    interfaces: relationships,
    ownerPersona,
    status: domainDef.status || existing?.status || "defined",
    createdAt: domainDef.createdAt || existing?.createdAt || now,
    updatedAt: now,
    currentState: String(domainDef.currentState || existing?.currentState || "").trim(),
    priorities: listify(domainDef.priorities || existing?.priorities),
    coreAgents: listify(domainDef.coreAgents || existing?.coreAgents),
    learnedInsights: Array.isArray(domainDef.learnedInsights) ? domainDef.learnedInsights : (existing?.learnedInsights || []),
    sourcePath,
    sourceType: domainDef.sourceType || existing?.sourceType || (projectPath ? "domain-folder" : "manual"),
    relativePath: relPath,
    kanbanBoard: domainDef.kanbanBoard || existing?.kanbanBoard || null,
    artifactPaths: artifactPathsFor(relPath),
  };
}

function artifactPathsFor(relativePath) {
  const base = relativePath || null;
  if (!base) return {};
  return {
    definition: path.join(base, "definition.md"),
    capturedAgendaItems: path.join(base, "captured-agenda-items.md"),
    handoffs: path.join(base, "handoffs"),
    plans: path.join(base, "plans"),
    requirements: path.join(base, "requirements"),
    agendas: path.join(base, "agendas"),
    featureDocs: path.join(base, "docs", "features"),
    personaDocs: path.join(base, "docs", "personas"),
    designDocs: path.join(base, "docs", "design"),
  };
}

function bullets(items, fallback = "- TBD") {
  const list = listify(items);
  return list.length ? list.map((item) => `- ${item}`).join("\n") : fallback;
}

function definitionMarkdown(def) {
  return `# Domain: ${def.name}

**Slug**: ${def.slug}
**Status**: ${def.status}
**Owner Persona**: ${def.ownerPersona || "TBD"}
**Created**: ${def.createdAt}
**Updated**: ${def.updatedAt}
**Kanban Board**: ${def.kanbanBoard || "project default / none"}

## Purpose / Ownership
${def.purpose || "TBD"}

## Overarching Goal / Long-term Outcome
${def.overarchingGoal || def.goal || "TBD"}

## Boundaries / Ownership
${bullets(def.boundaries || def.responsibilities)}

## Key Capabilities / Initial Features
${bullets(def.features || def.activeEpics)}

## Relationships
${bullets(def.relationships || def.interfaces, "- None captured yet")}

## Domain Team / Core Agents
${bullets(def.coreAgents, "- No domain-specific agents assigned yet")}

## Artifact Contract
- Definition: \`definition.md\`
- Captured agenda items: \`captured-agenda-items.md\`
- Handoffs: \`handoffs/\`
- Plans: \`plans/\`
- Requirements: \`requirements/\`
- Agendas and meeting outputs: \`agendas/\`
- Feature specs: \`docs/features/\`
- Persona docs: \`docs/personas/\`
- Design docs: \`docs/design/\`
`;
}

function agendaMarkdown(def, agendaItems = []) {
  const items = (Array.isArray(agendaItems) ? agendaItems : []).map(normalizeAgendaItem);
  return `# Captured Agenda Items - ${def.name}

Agenda Items are proposals until a human approves materialization into Kanban or agent dispatch.

${items.length ? items.map(agendaItemMarkdown).join("\n") : "## Inbox\n\n- [ ] No agenda items captured yet.\n"}
`;
}

function normalizeAgendaItem(item = {}) {
  const now = new Date().toISOString();
  const title = String(item.title || item.name || "Untitled Agenda Item").trim();
  return {
    id: item.id || `agenda-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${domainSlug(title).slice(0, 24)}`,
    title,
    type: normalizeAgendaType(item.type),
    status: item.status || "proposed",
    priority: item.priority || "normal",
    source: item.source || null,
    parentRef: item.parentRef || item.parent || null,
    routing: item.routing || null,
    humanAttention: item.humanAttention !== false,
    expectedOutcome: item.expectedOutcome || item.outcome || "",
    participants: listify(item.participants),
    outputArtifact: item.outputArtifact || "",
    body: String(item.body || item.description || "").trim(),
    provenance: Array.isArray(item.provenance) ? item.provenance : listify(item.provenance),
    createdAt: item.createdAt || now,
  };
}

function agendaItemMarkdown(item) {
  const participants = item.participants.length ? `\nParticipants: ${item.participants.join(", ")}` : "";
  const provenance = item.provenance.length ? `\nProvenance: ${item.provenance.join(", ")}` : "";
  return `## [${item.status}] ${item.title}

- ID: ${item.id}
- Type: ${item.type}
- Priority: ${item.priority}
- Human approval required: ${item.humanAttention ? "yes" : "no"}
- Source: ${item.source || "manual"}
- Parent: ${item.parentRef || "none"}${participants}
- Expected outcome: ${item.expectedOutcome || "TBD"}
- Output artifact: ${item.outputArtifact || "TBD"}${provenance}

${item.body || "_No details captured yet._"}
`;
}

function parseListSection(content, heading) {
  const re = new RegExp(`##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const match = String(content || "").match(re);
  if (!match) return [];
  return match[1].split(/\r?\n/).map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean);
}

function parseTextSection(content, heading) {
  const re = new RegExp(`##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const match = String(content || "").match(re);
  return match ? match[1].trim() : "";
}

function parseDefinitionMarkdown(filePath, fallbackSlug) {
  const content = fs.readFileSync(filePath, "utf-8");
  const title = (content.match(/^#\s+Domain:\s*(.+)$/m) || [])[1] || displayNameFromSlug(fallbackSlug);
  const meta = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return normalizeDomainDefinition({
    slug: meta.slug || fallbackSlug,
    name: title.trim(),
    purpose: parseTextSection(content, "Purpose / Ownership") || parseTextSection(content, "Purpose"),
    overarchingGoal: parseTextSection(content, "Overarching Goal / Long-term Outcome") || parseTextSection(content, "Overarching Goal"),
    boundaries: parseListSection(content, "Boundaries / Ownership").concat(parseListSection(content, "Responsibilities")),
    features: parseListSection(content, "Key Capabilities / Initial Features").concat(parseListSection(content, "Initial Features")),
    relationships: parseListSection(content, "Relationships"),
    coreAgents: parseListSection(content, "Domain Team / Core Agents"),
    ownerPersona: meta["owner persona"] || "",
    status: meta.status || "defined",
    createdAt: meta.created || undefined,
    kanbanBoard: meta["kanban board"] && !/none|default/i.test(meta["kanban board"]) ? meta["kanban board"] : null,
  });
}

function parseAgendaItems(content) {
  const out = [];
  const headingRe = /^##\s+(?:\[(.*?)\]\s+)?(.+)$/gm;
  let match;
  const ranges = [];
  while ((match = headingRe.exec(String(content || ""))) !== null) {
    ranges.push({ status: match[1] || "proposed", title: match[2].trim(), start: match.index, bodyStart: headingRe.lastIndex });
  }
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const body = content.slice(r.bodyStart, i + 1 < ranges.length ? ranges[i + 1].start : content.length).trim();
    if (/^Inbox$/i.test(r.title)) {
      for (const line of body.split(/\r?\n/)) {
        const m = line.match(/^-\s+\[[ x-]\]\s+(.+)$/i);
        if (m && !/No agenda items/i.test(m[1])) out.push(normalizeAgendaItem({ title: m[1], status: "proposed", type: "feature" }));
      }
      continue;
    }
    const item = { title: r.title, status: r.status, body };
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^-\s+([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const value = m[2].trim();
      if (key === "id") item.id = value;
      if (key === "type") item.type = value;
      if (key === "priority") item.priority = value;
      if (key === "source") item.source = value;
      if (key === "parent") item.parentRef = value;
      if (key === "human approval required") item.humanAttention = /^yes/i.test(value);
      if (key === "expected outcome") item.expectedOutcome = value;
      if (key === "output artifact") item.outputArtifact = value;
      if (key === "participants") item.participants = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (key === "provenance") item.provenance = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    out.push(normalizeAgendaItem(item));
  }
  return out;
}

function ensureDomainScaffold(projectPath, def, agendaItems = []) {
  if (!projectPath) return null;
  const safe = safeProjectRelative(projectPath, def.relativePath);
  if (!safe) throw new Error("Domain path is outside the project");
  fs.mkdirSync(safe.resolved, { recursive: true });
  for (const dir of DOMAIN_DIRS) fs.mkdirSync(path.join(safe.resolved, dir), { recursive: true });
  const definitionPath = path.join(safe.resolved, "definition.md");
  fs.writeFileSync(definitionPath, definitionMarkdown(def), "utf-8");
  const agendaPath = path.join(safe.resolved, "captured-agenda-items.md");
  if (!fs.existsSync(agendaPath) || agendaItems.length) fs.writeFileSync(agendaPath, agendaMarkdown(def, agendaItems), "utf-8");
  const indexPath = path.join(safe.resolved, "index.md");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, `# ${def.name}\n\n- [Definition](definition.md)\n- [Captured Agenda Items](captured-agenda-items.md)\n- [Handoffs](handoffs/)\n- [Plans](plans/)\n- [Requirements](requirements/)\n- [Agendas / Meetings](agendas/)\n- [Feature Docs](docs/features/)\n- [Persona Docs](docs/personas/)\n- [Design Docs](docs/design/)\n`, "utf-8");
  }
  const agentsPath = path.join(safe.resolved, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, `# ${def.name} Domain Rules\n\n**Purpose**: ${def.purpose}\n\n**Overarching Goal**: ${def.overarchingGoal}\n\n## Boundaries\n\n${bullets(def.boundaries)}\n\n## Agents\n\n${bullets(def.coreAgents, "- TBD")}\n`, "utf-8");
  }
  return safe.resolved;
}

function writeBrainIndex(slug, def) {
  initDomains(slug);
  const file = path.join(domainsDir(slug), `${def.slug}.json`);
  fs.writeFileSync(file, JSON.stringify(def, null, 2), "utf-8");
  return def;
}

function readBrainDomain(slug, nameOrSlug) {
  const domainsPath = domainsDir(slug);
  const candidates = [domainSlug(nameOrSlug), String(nameOrSlug || "")].filter(Boolean);
  for (const candidate of candidates) {
    const file = path.join(domainsPath, `${candidate}.json`);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch { /* ignore */ }
  }
  try {
    const files = fs.readdirSync(domainsPath).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(domainsPath, f), "utf-8"));
      if (String(parsed.name || "").toLowerCase() === String(nameOrSlug || "").toLowerCase()) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function listMarkdownFiles(root, projectPath) {
  try {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => {
        const full = path.join(root, f);
        const text = fs.readFileSync(full, "utf-8");
        const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f;
        return { name: f, title, path: relFromProject(projectPath, full), fullPath: full };
      });
  } catch {
    return [];
  }
}

function listArtifacts(projectPath, def) {
  if (!projectPath || !def?.relativePath) return { handoffs: [], plans: [], requirements: [], agendas: [], featureDocs: [], personaDocs: [], designDocs: [] };
  const root = path.join(projectPath, def.relativePath);
  return {
    handoffs: listHandoffs({ projectPath, domain: def.slug }).handoffs || [],
    plans: listMarkdownFiles(path.join(root, "plans"), projectPath),
    requirements: listMarkdownFiles(path.join(root, "requirements"), projectPath),
    agendas: listMarkdownFiles(path.join(root, "agendas"), projectPath),
    featureDocs: listMarkdownFiles(path.join(root, "docs", "features"), projectPath),
    personaDocs: listMarkdownFiles(path.join(root, "docs", "personas"), projectPath),
    designDocs: listMarkdownFiles(path.join(root, "docs", "design"), projectPath),
  };
}

function hydrateDomain(slug, def, { projectPath = null } = {}) {
  if (!def) return null;
  const normalized = normalizeDomainDefinition(def, { projectPath, existing: def });
  const agendaPath = projectPath && normalized.relativePath ? path.join(projectPath, normalized.relativePath, "captured-agenda-items.md") : null;
  let agendaItems = [];
  try {
    if (agendaPath && fs.existsSync(agendaPath)) agendaItems = parseAgendaItems(fs.readFileSync(agendaPath, "utf-8"));
  } catch { /* ignore */ }
  return {
    ...normalized,
    agendaItems,
    artifacts: listArtifacts(projectPath, normalized),
  };
}

function defineDomain(slug, domainDef, { projectPath = null, createScaffold = true, createHandoff = false } = {}) {
  const existing = readBrainDomain(slug, domainDef.slug || domainDef.name);
  const definition = normalizeDomainDefinition(domainDef, { projectPath, existing });
  const missing = validateDomainDefinition(definition);
  if (missing.length) {
    const err = new Error(`Missing required domain fields: ${missing.join(", ")}`);
    err.missing = missing;
    throw err;
  }
  const agendaItems = Array.isArray(domainDef.agendaItems)
    ? domainDef.agendaItems.map((item) => typeof item === "string" ? normalizeAgendaItem({ title: item, source: "domain-creation" }) : normalizeAgendaItem({ ...item, source: item.source || "domain-creation" }))
    : listify(domainDef.agendaItems).map((title) => normalizeAgendaItem({ title, source: "domain-creation" }));
  if (createScaffold && projectPath) ensureDomainScaffold(projectPath, definition, agendaItems);
  writeBrainIndex(slug, definition);
  brain.writeArtifact(slug, {
    type: "artifact",
    title: `Domain definition: ${definition.name}`,
    domain: definition.name,
    summary: definition.purpose,
    source: { system: "domain-lifecycle", path: definition.artifactPaths.definition, actor: definition.ownerPersona || null },
  });
  if (createHandoff && projectPath) {
    createHandoffRecord({
      projectSlug: slug,
      projectPath,
      domain: definition.slug,
      title: `${definition.name} creation handoff`,
      status: "pending",
      userConfirmation: !!domainDef.userConfirmed,
      capturedEntities: definition.features,
      suggestedAgendaItems: agendaItems.length ? agendaItems : definition.features.map((f) => normalizeAgendaItem({ title: f, source: "domain-creation", type: "feature" })),
      sourceLinks: [definition.artifactPaths.definition, definition.artifactPaths.capturedAgendaItems],
      body: "Created from the confirmed domain package. Agenda Agent should triage these proposals before any Kanban materialization.",
    });
  }
  return hydrateDomain(slug, definition, { projectPath });
}

function getDomain(slug, domainName, { projectPath = null } = {}) {
  let def = null;
  const dSlug = domainSlug(domainName);
  const filePath = projectPath ? path.join(projectPath, "domains", dSlug, "definition.md") : null;
  try {
    if (filePath && fs.existsSync(filePath)) {
      def = parseDefinitionMarkdown(filePath, dSlug);
      def.relativePath = path.join("domains", dSlug);
      def.sourcePath = path.join(projectPath, def.relativePath);
      def.sourceType = "domain-folder";
    }
  } catch { /* fall through to brain */ }
  if (!def) def = readBrainDomain(slug, domainName);
  return hydrateDomain(slug, def, { projectPath });
}

function getAllDomains(slug, { projectPath = null } = {}) {
  const bySlug = new Map();
  if (projectPath) {
    const root = projectDomainsRoot(projectPath);
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const defPath = path.join(root, entry.name, "definition.md");
        if (!fs.existsSync(defPath)) continue;
        const def = parseDefinitionMarkdown(defPath, entry.name);
        def.relativePath = path.join("domains", entry.name);
        def.sourcePath = path.join(projectPath, def.relativePath);
        def.sourceType = "domain-folder";
        bySlug.set(def.slug, hydrateDomain(slug, def, { projectPath }));
        writeBrainIndex(slug, def);
      }
    } catch { /* ignore */ }
  }
  try {
    const files = fs.readdirSync(domainsDir(slug)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(domainsDir(slug), file), "utf-8"));
      if (!bySlug.has(parsed.slug || domainSlug(parsed.name))) {
        bySlug.set(parsed.slug || domainSlug(parsed.name), hydrateDomain(slug, parsed, { projectPath }));
      }
    }
  } catch { /* ignore */ }
  return [...bySlug.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function addInsight(slug, domainName, insight) {
  const domain = getDomain(slug, domainName) || normalizeDomainDefinition({
    name: domainName,
    purpose: `Auto-detected domain: ${domainName}`,
    overarchingGoal: "Capture and refine this domain once enough context exists.",
    boundaries: ["TBD"],
    features: ["TBD"],
  });
  domain.learnedInsights = domain.learnedInsights || [];
  domain.learnedInsights.push({ insight, timestamp: new Date().toISOString(), source: "agent_learning" });
  domain.updatedAt = new Date().toISOString();
  writeBrainIndex(slug, domain);
}

function updateDomainState(slug, domainName, updates) {
  const domain = getDomain(slug, domainName);
  if (!domain) return null;
  const updated = normalizeDomainDefinition({ ...domain, ...updates }, { existing: domain });
  return writeBrainIndex(slug, updated);
}

function getDomainDescription(slug, domainName) {
  const domain = getDomain(slug, domainName);
  if (!domain) return `Domain "${domainName}" - no context available yet. Ask the user to define this domain's purpose and responsibilities.`;
  let description = `Domain "${domain.name}" (${domain.slug}): ${domain.purpose}`;
  if (domain.relativePath) description += `\nLocation: ${domain.relativePath}`;
  if (domain.overarchingGoal) description += `\nOverarching goal: ${domain.overarchingGoal}`;
  if ((domain.boundaries || []).length) description += `\nBoundaries: ${domain.boundaries.slice(0, 4).join(", ")}`;
  if ((domain.features || []).length) description += `\nCapabilities: ${domain.features.slice(0, 4).join(", ")}`;
  if ((domain.coreAgents || []).length) description += `\nCore agents: ${domain.coreAgents.join(", ")}`;
  if ((domain.agendaItems || []).length) description += `\nOpen agenda proposals: ${domain.agendaItems.slice(0, 4).map((i) => i.title).join("; ")}`;
  return description;
}

function detectDomainsFromProject(projectPath) {
  const detectedDomains = [];
  const root = projectDomainsRoot(projectPath);
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const defPath = path.join(root, entry.name, "definition.md");
      if (fs.existsSync(defPath)) {
        detectedDomains.push({ name: entry.name, path: path.join(root, entry.name), source: "domain-folder" });
      }
    }
  } catch { /* ignore */ }

  const contextPath = path.join(projectPath, "harness", "context");
  try {
    for (const folder of fs.readdirSync(contextPath)) {
      if (folder.endsWith("-team")) detectedDomains.push({ name: folder.replace("-team", ""), path: path.join(contextPath, folder), source: "harness-context" });
    }
  } catch { /* ignore */ }

  const teamsPath = path.join(projectPath, "harness", "teams");
  try {
    for (const team of fs.readdirSync(teamsPath)) {
      const teamPath = path.join(teamsPath, team);
      if (fs.statSync(teamPath).isDirectory() && fs.existsSync(path.join(teamPath, "definition.md"))) {
        detectedDomains.push({ name: team.split("-")[0], path: teamPath, source: "harness-teams", teamName: team });
      }
    }
  } catch { /* ignore */ }

  const skipFolders = new Set(["node_modules", ".git", "harness", "dist", "build", "test", "tests", "runtime", "docker", "personas", "teams", "workflows", "bin", "lib", "src", "config", "integrations", "skills", "architecture", "agents", "prompts", "docs", "examples", "templates", "mgmt", "domains"]);
  try {
    for (const folder of fs.readdirSync(projectPath)) {
      if (skipFolders.has(folder) || folder.startsWith(".")) continue;
      const folderPath = path.join(projectPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;
      const hasDomainFiles = fs.existsSync(path.join(folderPath, "AGENTS.md")) || fs.existsSync(path.join(folderPath, "README.md")) || fs.existsSync(path.join(folderPath, "package.json"));
      if (hasDomainFiles) detectedDomains.push({ name: folder, path: folderPath, source: "direct-folder" });
    }
  } catch { /* ignore */ }

  const seen = new Set();
  return detectedDomains.filter((d) => {
    const key = domainSlug(d.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAgentsMD(agentsPath) {
  try {
    const content = fs.readFileSync(agentsPath, "utf-8");
    const purpose = (content.match(/\*\*Purpose\*\*:\s*(.+?)(?:\n|$)/) || [])[1] || "";
    return { purpose: purpose.trim(), responsibilities: parseListSection(content, "Responsibilities").concat(parseListSection(content, "Boundaries")) };
  } catch {
    return { purpose: "", responsibilities: [] };
  }
}

function parseDomainOverview(overviewPath) {
  try {
    const content = fs.readFileSync(overviewPath, "utf-8");
    return {
      purpose: (content.match(/\*\*Purpose\*\*:\s*(.+?)(?:\n|$)/) || [])[1] || "",
      currentState: parseTextSection(content, "Current State").slice(0, 300),
      priorities: parseListSection(content, "Active Epics"),
    };
  } catch {
    return { purpose: "", currentState: "", priorities: [] };
  }
}

function parseTeamDefinition(definitionPath) {
  try {
    const content = fs.readFileSync(definitionPath, "utf-8");
    return {
      purpose: parseTextSection(content, "Charter").slice(0, 300),
      responsibilities: parseListSection(content, "Core Roles"),
      priorities: parseListSection(content, "Non-Negotiables"),
    };
  } catch {
    return { purpose: "", responsibilities: [], priorities: [] };
  }
}

function detectDomainBoard(domainName, availableBoards) {
  const d = domainSlug(domainName);
  const boards = availableBoards || [];
  return boards.find((b) => b === d || b === `${d}-board` || b === `${d}_kanban` || b === `board-${d}`) || null;
}

function ingestDomainsFromProject(slug, projectPath, availableBoards = []) {
  const detectedDomains = detectDomainsFromProject(projectPath);
  const ingested = [];
  for (const detected of detectedDomains) {
    let parsed = {};
    if (detected.source === "domain-folder") {
      const def = getDomain(slug, detected.name, { projectPath });
      if (def) {
        ingested.push({ name: def.name, slug: def.slug, source: detected.source, path: detected.path, relativePath: def.relativePath, purpose: def.purpose, hasContext: true });
        continue;
      }
    }
    if (detected.source === "harness-teams") parsed = parseTeamDefinition(path.join(detected.path, "definition.md"));
    else parsed = parseAgentsMD(path.join(detected.path, "AGENTS.md"));
    const relativePath = relFromProject(projectPath, detected.path);
    const existing = readBrainDomain(slug, detected.name);
    const definition = normalizeDomainDefinition({
      name: displayNameFromSlug(detected.name),
      slug: domainSlug(detected.name),
      purpose: parsed.purpose || `Domain ${detected.name} - detected from project structure`,
      overarchingGoal: existing?.overarchingGoal || parsed.currentState || "Define this detected domain's long-running outcome.",
      boundaries: parsed.responsibilities.length ? parsed.responsibilities : ["Detected domain; ownership needs confirmation"],
      features: parsed.priorities.length ? parsed.priorities : ["Confirm and refine this detected domain"],
      priorities: parsed.priorities,
      relativePath,
      sourcePath: detected.path,
      sourceType: detected.source,
      kanbanBoard: existing?.kanbanBoard || detectDomainBoard(detected.name, availableBoards) || (availableBoards.includes(slug) ? slug : null),
      coreAgents: existing?.coreAgents || [],
      learnedInsights: existing?.learnedInsights || [],
      createdAt: existing?.createdAt,
    }, { projectPath, existing });
    writeBrainIndex(slug, definition);
    ingested.push({ name: definition.name, slug: definition.slug, source: detected.source, path: detected.path, relativePath, purpose: definition.purpose, hasContext: true });
  }
  return ingested;
}

function handoffMarkdown(handoff) {
  return `# Handoff: ${handoff.title}

- ID: ${handoff.id}
- Domain: ${handoff.domain}
- Status: ${handoff.status}
- Created: ${handoff.createdAt}
- User confirmation: ${handoff.userConfirmation ? "yes" : "no"}

## Summary
${handoff.body || "No summary captured."}

## Source Links
${bullets(handoff.sourceLinks, "- None")}

## Captured Entities
${bullets(handoff.capturedEntities, "- None")}

## Suggested Agenda Items
${handoff.suggestedAgendaItems.length ? handoff.suggestedAgendaItems.map((item) => `- [ ] (${item.type}) ${item.title}`).join("\n") : "- None"}
`;
}

function parseHandoff(filePath, projectPath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const title = (text.match(/^#\s+Handoff:\s*(.+)$/m) || [])[1] || path.basename(filePath, ".md");
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const suggested = [];
  const suggestedText = parseTextSection(text, "Suggested Agenda Items");
  for (const line of suggestedText.split(/\r?\n/)) {
    const m = line.match(/^-\s+\[[ x-]\]\s+\(([^)]+)\)\s+(.+)$/i);
    if (m) suggested.push(normalizeAgendaItem({ type: m[1], title: m[2], source: meta.id || "handoff" }));
  }
  return {
    id: meta.id || path.basename(filePath, ".md"),
    title,
    domain: meta.domain,
    status: meta.status || "pending",
    createdAt: meta.created,
    userConfirmation: /^yes/i.test(meta["user confirmation"] || ""),
    path: relFromProject(projectPath, filePath),
    sourceLinks: parseListSection(text, "Source Links"),
    capturedEntities: parseListSection(text, "Captured Entities"),
    suggestedAgendaItems: suggested,
    body: parseTextSection(text, "Summary"),
  };
}

function createHandoffRecord({ projectSlug, projectPath, domain, title, status = "pending", userConfirmation = false, sourceLinks = [], capturedEntities = [], suggestedAgendaItems = [], body = "" }) {
  const def = getDomain(projectSlug, domain, { projectPath });
  if (!def) return { ok: false, reason: "Domain not found" };
  const dir = path.join(projectPath, def.relativePath, "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const id = `${now.slice(0, 10).replace(/-/g, "")}-${domainSlug(title || "handoff").slice(0, 40)}`;
  const handoff = {
    id,
    title: title || `${def.name} handoff`,
    domain: def.slug,
    status,
    createdAt: now,
    userConfirmation,
    sourceLinks: listify(sourceLinks),
    capturedEntities: listify(capturedEntities),
    suggestedAgendaItems: (suggestedAgendaItems || []).map(normalizeAgendaItem),
    body,
  };
  const file = path.join(dir, `${id}.md`);
  fs.writeFileSync(file, handoffMarkdown(handoff), "utf-8");
  brain.writeArtifact(projectSlug, {
    type: "artifact",
    title: `Domain handoff: ${handoff.title}`,
    domain: def.name,
    summary: body || `Handoff ${handoff.status}`,
    source: { system: "domain-lifecycle", path: relFromProject(projectPath, file), actor: "domain-architect" },
  });
  return { ok: true, handoff: { ...handoff, path: relFromProject(projectPath, file) } };
}

function listHandoffs({ projectPath, domain }) {
  if (!projectPath || !domain) return { ok: false, reason: "projectPath and domain required", handoffs: [] };
  const dir = path.join(projectPath, "domains", domainSlug(domain), "handoffs");
  try {
    const handoffs = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => parseHandoff(path.join(dir, f), projectPath));
    return { ok: true, handoffs };
  } catch {
    return { ok: true, handoffs: [] };
  }
}

function createAgendaItem({ projectSlug, projectPath, domain, item }) {
  const def = getDomain(projectSlug, domain, { projectPath });
  if (!def) return { ok: false, reason: "Domain not found" };
  const agendaPath = path.join(projectPath, def.relativePath, "captured-agenda-items.md");
  const agendaItem = normalizeAgendaItem(item);
  fs.appendFileSync(agendaPath, `\n${agendaItemMarkdown(agendaItem)}`, "utf-8");
  brain.writeArtifact(projectSlug, {
    type: "proposal",
    title: `Agenda Item: ${agendaItem.title}`,
    domain: def.name,
    summary: agendaItem.body || agendaItem.expectedOutcome,
    source: { system: "agenda-agent", path: relFromProject(projectPath, agendaPath), actor: "agenda-agent" },
  });
  return { ok: true, agendaItem };
}

function proposeAgendaFromHandoff({ projectSlug, projectPath, domain, handoffId }) {
  const handoffs = listHandoffs({ projectPath, domain }).handoffs || [];
  const handoff = handoffs.find((h) => h.id === handoffId || h.path?.endsWith(`${handoffId}.md`)) || handoffs[0];
  if (!handoff) return { ok: false, reason: "Handoff not found" };
  const proposals = (handoff.suggestedAgendaItems.length ? handoff.suggestedAgendaItems : handoff.capturedEntities.map((e) => normalizeAgendaItem({ title: e, type: "feature", source: handoff.id })))
    .map((item) => normalizeAgendaItem({ ...item, source: handoff.id, parentRef: handoff.id, status: "proposed", humanAttention: true }));
  return {
    ok: true,
    handoff,
    proposals,
    note: "Agenda Agent proposals only; human approval is required before Kanban task creation or agent dispatch.",
  };
}

function saveMeetingArtifact({ projectSlug, projectPath, domain, room, agenda, participants, expectedOutcome, requirements, sourceHandoff, sourceContext }) {
  const def = getDomain(projectSlug, domain, { projectPath });
  if (!def) return { ok: false, reason: "Domain not found" };
  const dir = path.join(projectPath, def.relativePath, "agendas");
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const safeRoom = domainSlug(room || `meeting-${now}`);
  const file = path.join(dir, `${now.slice(0, 10)}-${safeRoom}.md`);
  const rel = relFromProject(projectPath, file);
  const contextItems = Array.isArray(sourceContext) ? sourceContext : [];
  const contextBlock = contextItems.length
    ? `\n## Source Context\n${contextItems.map((item, idx) => [
      `### ${idx + 1}. ${item.title || item.path || "Context"}`,
      `- Kind: ${item.kind || "artifact"}`,
      `- Path: ${item.path || "inline"}`,
      "",
      item.text ? String(item.text).trim() : "_No inline context captured._",
    ].join("\n")).join("\n\n")}\n`
    : "";
  fs.writeFileSync(file, `# Meeting: ${agenda || safeRoom}

- Room: ${room || safeRoom}
- Domain: ${def.slug}
- Participants: ${listify(participants).join(", ") || "TBD"}
- Expected outcome: ${expectedOutcome || "TBD"}
- Source handoff: ${sourceHandoff || "none"}
- Created: ${now}
${contextItems.length ? `- Source context items: ${contextItems.length}` : "- Source context items: 0"}
${contextBlock}

## Output
${requirements || "_Meeting output has not been synthesized yet._"}
`, "utf-8");
  createAgendaItem({
    projectSlug,
    projectPath,
    domain: def.slug,
    item: {
      title: agenda || `Meeting ${safeRoom}`,
      type: "meeting",
      source: sourceHandoff || "meeting",
      participants,
      expectedOutcome,
      outputArtifact: rel,
      body: "Meeting/follow-up session captured as domain-owned work.",
    },
  });
  return { ok: true, artifact: { path: rel, title: agenda || safeRoom } };
}

module.exports = {
  DOMAIN_DIRS,
  AGENDA_TYPES: [...AGENDA_TYPES],
  domainsDir,
  initDomains,
  domainSlug,
  domainPath,
  validateDomainDefinition,
  normalizeDomainDefinition,
  ensureDomainScaffold,
  defineDomain,
  getDomain,
  getAllDomains,
  addInsight,
  updateDomainState,
  getDomainDescription,
  detectDomainsFromProject,
  parseAgentsMD,
  parseDomainOverview,
  parseTeamDefinition,
  ingestDomainsFromProject,
  detectDomainBoard,
  parseAgendaItems,
  normalizeAgendaItem,
  createHandoffRecord,
  listHandoffs,
  createAgendaItem,
  proposeAgendaFromHandoff,
  saveMeetingArtifact,
};
