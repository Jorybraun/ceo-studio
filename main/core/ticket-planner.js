"use strict";
/**
 * Deterministic ticket planning pack builder.
 *
 * The local Document Agent may later replace pieces of this with model-backed
 * synthesis, but this baseline is useful offline: it extracts what is missing,
 * gathers nearby docs/brain artifacts, and produces a reviewable AGUI panel and
 * Kanban comment.
 */
const path = require("path");
const fs = require("fs");
const brain = require("./brain");
const domains = require("./domains");

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "this", "that", "into", "from"].includes(w));
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function scoreText(haystack, needles) {
  const h = String(haystack || "").toLowerCase();
  return needles.reduce((n, w) => n + (h.includes(w) ? 1 : 0), 0);
}

function relatedArtifacts(slug, ticket, domain) {
  const needles = words(`${ticket.title} ${ticket.body} ${domain}`).slice(0, 24);
  return brain.readIndex(slug, "artifacts")
    .filter((a) => !domain || domain === "All" || !a.domain || a.domain === "All" || String(a.domain).toLowerCase() === String(domain).toLowerCase())
    .map((a) => ({ ...a, _score: scoreText(`${a.title} ${a.summary}`, needles) }))
    .filter((a) => a._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 8);
}

function findCandidateFiles(projectPath, ticket, domainDef) {
  const needles = words(`${ticket.title} ${ticket.body} ${domainDef?.name || ""}`).slice(0, 30);
  const roots = [projectPath];
  if (domainDef && domainDef.relativePath) roots.unshift(path.join(projectPath, domainDef.relativePath));
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "venv", ".worktrees"]);
  const texty = /\.(md|txt|json|yaml|yml|js|ts|jsx|tsx)$/i;
  const found = [];
  const seen = new Set();
  const walk = (dir, limitDepth = 4, depth = 0) => {
    if (found.length >= 16 || depth > limitDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= 16) break;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(full, limitDepth, depth + 1);
      } else if (e.isFile() && texty.test(e.name)) {
        const rel = path.relative(projectPath, full);
        if (seen.has(rel)) continue;
        const s = scoreText(rel, needles);
        const important = /(^|\/)(README|AGENTS|package|DOMAIN|E2E|NORTH|NEXT|SUMMARY)/i.test(rel);
        if (s > 0 || important) {
          seen.add(rel);
          found.push({ path: rel, reason: important ? "likely project context" : "matches ticket language", score: s + (important ? 2 : 0) });
        }
      }
    }
  };
  roots.filter((r, i) => r && roots.indexOf(r) === i).forEach((r) => walk(r));
  return found.sort((a, b) => b.score - a.score).slice(0, 10);
}

function inferGaps(ticket) {
  const body = String(ticket.body || "");
  const gaps = [];
  if (body.length < 500) gaps.push("Ticket body is thin; it does not yet define enough operating context for a worker.");
  if (!/acceptance criteria|exit criteria|done when|definition of done/i.test(body)) gaps.push("No explicit acceptance criteria.");
  if (!/test|verify|validation|screenshot|chrome|npm/i.test(body)) gaps.push("No validation plan or commands.");
  if (!/workspace|worktree|branch|folder|path|repo/i.test(body)) gaps.push("No workspace or path rules.");
  if (!/rollback|cleanup|revert/i.test(body)) gaps.push("No cleanup or rollback plan.");
  if (!ticket.assignee) gaps.push("No assignee/profile selected.");
  return gaps;
}

function acceptanceFor(ticket) {
  const title = String(ticket.title || "");
  const body = String(ticket.body || "");
  const dogfood = /dogfood|manages itself|self-host|self/i.test(`${title} ${body}`);
  if (dogfood) {
    return [
      "CEO_STUDIO can be opened as a mounted project from the app.",
      "A self-management domain exists with purpose, responsibilities, and a project-relative location.",
      "The left file tree can browse CEO_STUDIO docs/source without replacing the render panel.",
      "The ticket can be opened into a planning pack from voice or dashboard.",
      "The CEO/voice path can discuss the ticket with file, domain, and brain context.",
      "A focused verification command set is recorded, including at least npm run check and focused tests.",
    ];
  }
  return [
    "The desired user-visible outcome is stated in one sentence.",
    "Inputs, affected files/domains, and non-goals are listed.",
    "Acceptance criteria are concrete and independently checkable.",
    "Verification commands or manual validation steps are named.",
    "The worker handoff includes workspace/path constraints and expected artifacts.",
  ];
}

function suggestedSubtasks(ticket) {
  const dogfood = /dogfood|manages itself|self-host|self/i.test(`${ticket.title || ""} ${ticket.body || ""}`);
  if (dogfood) {
    return [
      "Define the CEO Studio self-management domain and scaffold its domain notes.",
      "Mount CEO_STUDIO as a project and confirm domain/file-tree behavior.",
      "Create or enrich the self-dogfood Kanban workflow with acceptance criteria.",
      "Run focused validation and capture results in the ticket comment thread.",
      "Review the resulting cockpit workflow: ticket -> context pack -> plan -> CEO handoff.",
    ];
  }
  return [
    "Enrich the ticket body with scope, context, acceptance criteria, and validation.",
    "Identify the files/docs a worker must read first.",
    "Decide assignee/profile and workspace mode.",
    "Record a comment handoff before dispatching work.",
  ];
}

function buildComment({ job, ticket, domain, gaps, acceptance, subtasks, files, artifacts }) {
  return [
    `## CEO Studio planning pack (${job.id})`,
    "",
    `Ticket: ${ticket.id} — ${ticket.title}`,
    `Domain: ${domain || "All"}`,
    "",
    "### What this ticket is really asking",
    ticket.body || "(No body provided.)",
    "",
    "### Gaps to resolve",
    ...gaps.map((g) => `- ${g}`),
    "",
    "### Suggested acceptance criteria",
    ...acceptance.map((a) => `- [ ] ${a}`),
    "",
    "### Suggested subtasks",
    ...subtasks.map((s) => `- ${s}`),
    "",
    "### Context to read first",
    ...files.slice(0, 8).map((f) => `- ${f.path} — ${f.reason}`),
    ...artifacts.slice(0, 5).map((a) => `- brain:${a.id} — ${a.title}`),
  ].join("\n");
}

function buildPanel({ ticket, domain, gaps, acceptance, subtasks, files, artifacts, comment }) {
  return {
    title: `Planning Pack: ${ticket.id}`,
    components: [
      { type: "heading", props: { text: ticket.title || ticket.id, level: 2 } },
      { type: "callout", props: { variant: gaps.length ? "warn" : "success", text: gaps.length ? `${gaps.length} planning gap(s) found before dispatch.` : "Ticket has a workable planning shape." } },
      { type: "table", props: { headers: ["Field", "Value"], rows: [
        ["Ticket", ticket.id],
        ["Status", ticket.status || ""],
        ["Assignee", ticket.assignee || "unassigned"],
        ["Domain", domain || "All"],
      ] } },
      { type: "heading", props: { text: "Gaps", level: 3 } },
      { type: "list", props: { items: gaps.length ? gaps : ["No major structural gaps detected."] } },
      { type: "heading", props: { text: "Acceptance Criteria", level: 3 } },
      { type: "list", props: { items: acceptance } },
      { type: "heading", props: { text: "Suggested Subtasks", level: 3 } },
      { type: "list", props: { items: subtasks, ordered: true } },
      { type: "heading", props: { text: "Context To Read", level: 3 } },
      { type: "list", props: { items: [
        ...files.slice(0, 8).map((f) => `${f.path} — ${f.reason}`),
        ...artifacts.slice(0, 5).map((a) => `brain:${a.id} — ${a.title}`),
      ] } },
      { type: "heading", props: { text: "Kanban Comment Draft", level: 3 } },
      { type: "code", props: { language: "markdown", content: comment } },
    ],
  };
}

function prepareTicketPack({ slug, project, ticket, domain = "All", job }) {
  const domainDef = domain && domain !== "All" ? domains.getDomain(slug, domain) : null;
  const gaps = inferGaps(ticket);
  const acceptance = acceptanceFor(ticket);
  const subtasks = suggestedSubtasks(ticket);
  const artifacts = relatedArtifacts(slug, ticket, domain);
  const files = findCandidateFiles(project.path, ticket, domainDef);
  const comment = buildComment({ job, ticket, domain, gaps, acceptance, subtasks, files, artifacts });
  const panel = buildPanel({ ticket, domain, gaps, acceptance, subtasks, files, artifacts, comment });
  const artifact = brain.writeArtifact(slug, {
    type: "agent_output",
    title: `Ticket planning pack: ${ticket.id} ${ticket.title || ""}`.slice(0, 120),
    domain,
    summary: `Planning pack for ${ticket.id}: ${gaps.length} gap(s), ${acceptance.length} acceptance criteria, ${subtasks.length} suggested subtasks.`,
    source: { system: "document-agent", path: null, actor: "voice-queue" },
  });
  return {
    summary: `Prepared planning pack for ${ticket.id}: ${gaps.length} gap(s), ${acceptance.length} acceptance criteria, ${subtasks.length} suggested subtasks.`,
    ticket: { id: ticket.id, title: ticket.title, status: ticket.status, assignee: ticket.assignee || null },
    domain,
    gaps,
    acceptanceCriteria: acceptance,
    suggestedSubtasks: subtasks,
    contextFiles: files,
    relatedArtifacts: artifacts.map((a) => ({ id: a.id, title: a.title, summary: a.summary })),
    brainArtifactId: artifact.id,
    comment,
    panel,
  };
}

module.exports = { prepareTicketPack, inferGaps, acceptanceFor, suggestedSubtasks };
