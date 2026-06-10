"use strict";
/**
 * Sectional Brief Decomposer
 *
 * Takes a canonical brief (as stored on Hermes Kanban) and proposes a breakdown
 * into logical sections + multiple high-quality child plans (child briefs or
 * swarm definitions).
 *
 * Designed to be:
 * - Structure-aware (uses the sections from briefBody)
 * - Domain-aware (loads design docs from domains/<slug>/docs/design/ when present)
 * - Provenance-rich (returns data that callers can feed into recordAsset / linkWork)
 * - Human-reviewable (returns an AGUI-style panel + draft bodies)
 *
 * This is the implementation of the feature tracked in:
 * domains/domain-lifecycle/docs/features/brief-sectional-decomposer.md
 */

const fs = require("fs");
const path = require("path");
const ticketPlanner = require("./ticket-planner");
const hermes = require("./hermes");

function domainBoard() {
  return require("./domain-board");
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function list(v) {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  return String(v == null ? "" : v)
    .split(/\r?\n|,/)
    .map(text)
    .filter(Boolean);
}

/**
 * Load design docs for a domain if they exist under the project.
 * Returns an array of { path, content } for the most relevant files.
 */
function loadDomainDesignDocs(projectPath, domainSlug) {
  if (!projectPath || !domainSlug || domainSlug === "All") return [];
  const designDir = path.join(projectPath, "domains", domainSlug, "docs", "design");
  try {
    const files = fs.readdirSync(designDir).filter(f => f.endsWith(".md"));
    return files.map(f => {
      const full = path.join(designDir, f);
      return {
        path: `domains/${domainSlug}/docs/design/${f}`,
        content: fs.readFileSync(full, "utf8").slice(0, 8000), // reasonable context window
      };
    });
  } catch {
    return [];
  }
}

/**
 * Very lightweight section extractor from a brief body.
 * Relies on the known structure produced by domainBoard.briefBody.
 */
function extractBriefSections(body = "") {
  const sections = {};
  const sectionRegex = /###\s+([^\n]+)\n([\s\S]*?)(?=\n###|\n## |$)/g;
  let match;
  while ((match = sectionRegex.exec(body)) !== null) {
    const title = text(match[1]);
    const content = text(match[2]);
    if (title) sections[title] = content;
  }
  // Also pull top-level Goal if present in the older style
  const goalMatch = /###\s*Goal\n-\s*(.+)/i.exec(body);
  if (goalMatch && !sections.Goal) sections.Goal = text(goalMatch[1]);

  return sections;
}

/**
 * Propose a sectional breakdown for a brief.
 * Returns a rich proposal object suitable for UI review + later materialization.
 */
function proposeSectionalBreakdown({ board, taskId, projectPath, projectSlug, domainOverride }, opts = {}) {
  if (!text(taskId)) {
    return { ok: false, reason: "taskId is required" };
  }

  const task = hermes.getTask ? hermes.getTask(board || "ceo-studio", taskId) : null;
  if (!task || !task.ok) {
    return { ok: false, reason: `Could not load task ${taskId}` };
  }

  const body = task.body || task.task?.body || "";
  const title = task.title || task.task?.title || taskId;
  const currentDomain = text(domainOverride) || (body.match(/Domain:\s*([^\n]+)/i) || [])[1] || "All";

  const sections = extractBriefSections(body);
  const designDocs = loadDomainDesignDocs(projectPath, currentDomain);

  // Base workstreams from the brief's own sections + known Domain Lifecycle key capabilities
  const baseWorkstreams = Object.keys(sections).length > 0
    ? Object.keys(sections)
    : ["Goal", "Problem / Mismatch", "Acceptance Criteria", "Next Action"];

  // For the Domain Lifecycle motivating case, enrich with the known capabilities
  const isDomainLifecycle = /domain.?lifecycle|domain architect|ba document guard|handoff protocol/i.test(`${title} ${body}`);
  const workstreams = isDomainLifecycle
    ? [
        "Live interactive AGUI outline component",
        "Domain Architect persona + interview flow",
        "First-class Handoff records + persistence",
        "Per-domain BA Document Guard (Dirty/Clean)",
        "Agent scoping enforcement",
        "Integration with brain, kanban, provenance",
        "Documentation & stewardship hooks",
      ]
    : baseWorkstreams;

  // Build draft child briefs for each workstream
  const childBriefDrafts = workstreams.map((ws, idx) => {
    const childTitle = `[${currentDomain}] ${ws}`;
    const draft = {
      board: board || "ceo-studio",
      title: childTitle,
      goal: `Deliver the "${ws}" capability as part of the parent brief: ${title}`,
      domain: currentDomain,
      currentRenderedState: sections["Current Rendered State"] || sections["Current State"] || "Parent brief accepted; decomposition in progress.",
      problemMismatch: `This specific workstream is not yet broken out with clear acceptance criteria and owner.`,
      acceptanceCriteria: [
        `${ws} has a clear definition and owner`,
        "Work is linked back to the parent brief via provenance",
        "Implementation plan (or further decomposition) exists",
      ],
      nextAction: `Review this child brief and either refine or dispatch to the appropriate persona/team.`,
      constraints: list(sections.Constraints || "Follow existing Domain Lifecycle design docs and AGENTS.md rules."),
      owner: "TBD (Agenda Agent / specialist)",
      persona: "planner",
      source: "sectional-decomposer",
      parentBriefId: taskId,
    };
    return {
      title: childTitle,
      draftInput: draft,
      draftBody: domainBoard().briefBody(draft),
    };
  });

  const agendaItemProposals = workstreams.map((ws, idx) => ({
    id: `decomp-${String(idx + 1).padStart(2, "0")}-${ws.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)}`,
    title: `[${currentDomain}] ${ws}`,
    type: isDomainLifecycle && /persona|agent/i.test(ws) ? "agent/persona proposal" : "decomposition",
    status: "proposed",
    priority: idx < 3 ? "high" : "normal",
    parentRef: taskId,
    context: sections["Current Rendered State"] || sections["Current State"] || `Parent brief: ${title}`,
    actionItems: [
      `Confirm scope and owner for ${ws}`,
      "Write or update the domain-owned artifact before dispatch",
      "Only materialize Kanban work after human approval",
    ],
    routing: {
      board: board || "ceo-studio",
      lane: "triage",
      persona: /docs|steward/i.test(ws) ? "docs-steward" : /agent|persona/i.test(ws) ? "domain-architect" : "planner",
    },
    proposedNewAgent: /BA Document Guard|Agenda Agent|Domain Architect/i.test(ws)
      ? { needed: true, reason: `${ws} may need a dedicated persona or registry entry.` }
      : { needed: false },
    humanAttention: true,
    provenanceLinks: [
      `kanban:${board || "ceo-studio"}/${taskId}`,
      ...designDocs.map((d) => d.path),
    ],
  }));

  // Simple AGUI-style proposal panel (reuses the spirit of ticket-planner)
  const panel = {
    title: `Sectional Decomposition Proposal: ${taskId}`,
    components: [
      { type: "heading", props: { text: `Decompose: ${title}`, level: 2 } },
      { type: "callout", props: { variant: "info", text: `Proposed ${workstreams.length} child plans for domain "${currentDomain}". Review before creating.` } },
      { type: "list", props: { items: workstreams, ordered: true } },
      { type: "heading", props: { text: "Design Context Used", level: 3 } },
      { type: "list", props: { items: designDocs.length ? designDocs.map(d => d.path) : ["No domain design docs found — used brief sections only."] } },
    ],
  };

  return {
    ok: true,
    primaryOutput: "agenda_item_proposals",
    requiresHumanApproval: true,
    parent: { id: taskId, title, board: board || "ceo-studio", domain: currentDomain },
    proposedWorkstreams: workstreams,
    agendaItemProposals,
    childBriefDrafts,
    designDocsUsed: designDocs.map(d => d.path),
    panel,
    summary: `Generated ${agendaItemProposals.length} Agenda Item proposals from ${Object.keys(sections).length || "brief sections"}. Child briefs are drafts only until approved.`,
  };
}

/**
 * Materialize an approved decomposition proposal.
 * Creates real child briefs via domainBoard.createBrief and records provenance links.
 */
function applySectionalDecomposition(proposal, { projectSlug } = {}) {
  if (!proposal || !proposal.ok || !Array.isArray(proposal.childBriefDrafts)) {
    return { ok: false, reason: "Invalid proposal object" };
  }
  if (proposal.requiresHumanApproval && !(proposal.humanApproved || proposal.approved)) {
    return { ok: false, reason: "Human approval required before Kanban materialization" };
  }

  const created = [];
  for (const draft of proposal.childBriefDrafts) {
    const input = draft.draftInput || draft;
    const res = domainBoard().createBrief(input, { projectSlug });
    if (res && res.ok) {
      created.push({
        taskId: res.task && res.task.taskId,
        title: input.title,
      });
    }
  }

  return {
    ok: true,
    createdCount: created.length,
    created,
    parentId: proposal.parent && proposal.parent.id,
  };
}

module.exports = {
  proposeSectionalBreakdown,
  applySectionalDecomposition,
  extractBriefSections,   // exported for testing
  loadDomainDesignDocs,   // exported for testing
};
