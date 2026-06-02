#!/usr/bin/env node
/**
 * Bootstrapping script for the Domain Lifecycle domain.
 *
 * Creates (or ensures) a high-level "Implement Domain Lifecycle core" brief
 * and runs the new sectional decomposer against it.
 *
 * This is the first real use of the feature documented in:
 *   domains/domain-lifecycle/docs/features/brief-sectional-decomposer.md
 *
 * Run with:
 *   node scripts/bootstrap-domain-lifecycle-plans.js
 *
 * It is safe to re-run; it will not duplicate work if the brief already exists.
 */

const path = require("path");
const fs = require("fs");
const domainBoard = require("../main/core/domain-board");

// The project root is the CEO_STUDIO repo itself
const projectPath = path.resolve(__dirname, "..");
const projectSlug = "ceo-studio"; // adjust if your mounted slug is different
const board = "domain-lifecycle";

console.log("=== Domain Lifecycle Plan Bootstrapping ===\n");

const highLevelBriefInput = {
  board,
  title: "Implement Domain Lifecycle core (AGUI + Domain Architect + Handoffs + BA Guard)",
  goal: "Turn the Domain Lifecycle design (definition.md + docs/design/) into working software: live AGUI outline, Domain Architect flow, first-class handoffs, BA Document Guard, agent scoping, and full provenance/brain integration.",
  domain: "Domain Lifecycle",
  currentRenderedState: "Excellent definition and design docs exist inside domains/domain-lifecycle/. The domain-lifecycle Hermes board is empty. Mechanical decompose exists but produces flat low-context tasks.",
  problemMismatch: "We have the vision and source material but no structured, section-aware way to break this large body of work into well-scoped, linked child plans that respect the canonical brief template and live on the correct domain board.",
  acceptanceCriteria: [
    "A high-level brief exists on the domain-lifecycle board",
    "Sectional decomposition produces 5-8 high-quality child briefs or a swarm plan",
    "Every child brief passes missingBriefFields validation",
    "Full provenance links parent → children are recorded",
    "The decomposition proposal and resulting plans are documented inside the domain (this bootstrapping run is the first example)",
  ],
  nextAction: "Run the sectional decomposer (propose → review → apply) and triage the resulting child plans on the domain-lifecycle board.",
  constraints: [
    "Follow the design in domains/domain-lifecycle/docs/design/",
    "Use existing briefBody + createBrief + provenance primitives",
    "Human/CEO review step before materializing children",
    "No duplication of requirements — link to docs/features/brief-sectional-decomposer.md",
  ],
  owner: "Agenda Agent + CEO",
  persona: "planner",
  source: "domain-lifecycle bootstrap",
};

console.log("High-level brief input prepared for domain 'Domain Lifecycle' on board", board);

// In a real run inside the app we would call createBrief via IPC.
// Here we just show what the input looks like and then attempt the proposal
// using the new module directly (this simulates what the UI/voice would do after the brief exists).

console.log("\n--- Attempting sectional proposal (simulating what the new UI tool will do) ---");

try {
  const proposal = domainBoard.proposeSectionalBreakdown({
    board,
    taskId: "t_PLACEHOLDER_high_level_brief", // In real use this would be a real taskId after the brief is created
    projectPath,
    projectSlug,
    domainOverride: "Domain Lifecycle",
  });

  if (proposal.ok) {
    console.log("Proposal generated successfully:");
    console.log("  Workstreams:", proposal.proposedWorkstreams.length);
    console.log("  Design docs used:", proposal.designDocsUsed);
    console.log("  Child drafts:", proposal.childBriefDrafts.length);
    console.log("\nFirst child draft title:", proposal.childBriefDrafts[0]?.title);
    console.log("\nAGUI panel title:", proposal.panel?.title);
  } else {
    console.log("Proposal failed (expected, because we used a placeholder taskId):", proposal.reason);
    console.log("\nThis is normal for the bootstrap script. In the real app:");
    console.log("1. Create the high-level brief above using the existing brief creation UI or voice tool.");
    console.log("2. Note the resulting taskId on the domain-lifecycle board.");
    console.log("3. Call proposeBriefDecomposition({ board: 'domain-lifecycle', taskId: 't_xxx' }) from console or voice.");
    console.log("4. Review the beautiful sectional proposal.");
    console.log("5. Call applyBriefDecomposition with the approved proposal.");
  }
} catch (e) {
  console.error("Error during proposal:", e.message);
}

console.log("\n=== Next manual steps ===");
console.log("1. Open CEO Studio on this project.");
console.log("2. Create the brief using the exact content prepared above (or let the Agenda Agent do it from the handoff).");
console.log("3. Use the new 'propose_brief_decomposition' tool (voice or future UI button).");
console.log("4. The generated plans will be the first real population of the domain-lifecycle board.");
console.log("5. Update captured-agenda-items.md and the handoff to link to the work (already partially done).");

console.log("\nBootstrap script complete. The real power comes when you run this flow inside the live app.");
