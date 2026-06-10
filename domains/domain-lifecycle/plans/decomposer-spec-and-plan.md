# Decomposer Spec and Implementation Plan (Detailed)

**File Purpose**: This is the dedicated, authoritative spec and phased plan for the Brief Sectional Decomposer capability. It is the single place to finish spec'ing out the exact behavior, especially around producing proper **Agenda Items**, matching to the agent registry, and proposing new agents/personas when needed.

**Related Documents** (do not duplicate content here; reference them):
- `../docs/features/brief-sectional-decomposer.md` (high-level feature overview and requirements)
- `../docs/design/handoff-protocol.md`
- `../docs/personas/agenda-agent.md`
- `../docs/design/critical-system-agents.md`
- `../docs/design/domain-creation-process.md`
- `../../definition.md` (especially "Captured During Definition (Entities & Agenda Items)")
- `../captured-agenda-items.md`
- `handoff-intake-contract.md` (normalized input package for handoff-sourced decomposition)
- `runtime/harness/agents/agents.json` (the live registry)
- The broad improvement plan: `decomposition-capability-improvement.md`

**Status**: Spec in progress / Planning Phase. Slow, deliberate iteration only. Guardrails from the broad plan apply (protect raw design docs in `docs/design/`, human controls testing strategy, no premature implementation, Karpathy-style small steps, document here first).

---

## Core Requirement: Produce Proper Agenda Items

The decomposer must break a (large, complex, domain-level) brief into **Agenda Items**, not just generic child briefs or flat tasks.

### What is a (full) Agenda Item in this context?

From the design and captured examples, a proper Agenda Item includes at minimum:

- **ID / Title**: Clear, actionable name (e.g., "Wire Domain Architect as a usable flow")
- **Parent Reference**: Link/ID to the source brief/handoff (the "brief" the user mentioned)
- **Description / Context**: Summary of why this item exists, pulled from the brief sections and/or domain design docs. Include relevant excerpts or links.
- **Action Items / Work Breakdown**: Concrete next steps (the "action items ... etc etc"). These can be sub-items, suggested tasks, or further decomposition points. Not full specs (that's for specialists), but enough to be actionable.
- **Suggested Routing / Matching**:
  - Match to existing agents/personas from the registry (`runtime/harness/agents/agents.json` and related persona files).
  - Use capabilities, name, description to find best fit.
  - Examples: route "BA Document Guard hooks" to something involving `ba-document-guard` or `self-repair` team; "live AGUI outline" might need a new UI/planner persona.
- **If no good match**: Explicitly propose creating a new persona (e.g., draft a `docs/personas/new-thing.md` or update an existing one) **and/or** a registry entry (id, provider, capabilities, description). The proposal must reference the architecture (Agenda Agent does light triage only; deeper work goes to specialists).
- **Priority / Sequencing**: Suggested order or dependencies.
- **Human Attention Flag**: Whether this needs immediate human review/decision (per Agenda Agent responsibilities).
- **Metadata / Provenance**: Links to relevant design docs (`docs/design/`), captured entities, raw artifacts from the handoff. Use existing provenance mechanisms.
- **Type/Category**: E.g., Subdomain discovery, Feature implementation, Meeting/scheduling, Agent wiring, Documentation/stewardship, etc. (to help routing).

The output of the decomposer (when used by Agenda Agent or human) should be a list of such structured Agenda Items, ready to be:
- Turned into kanban briefs/tasks (via `createBrief` or similar, but only after human approval).
- Added to `captured-agenda-items.md` style lists.
- Used to create handoff payloads or swarm graphs.
- Routed to the correct agent/team/room.

**Key Architecture Alignment** (must match design docs; update this spec if docs change):
- Agenda Agent performs **light** triage and creates Agenda Items. It does **not** do deep decomposition or write detailed specs (hand off to specialists).
- The decomposer is a **tool** the Agenda Agent (or human/CEO) uses to do the "light decomposition" part well, while staying in the "router and organizer" role.
- Full Agenda Items must carry enough context (the brief + action items + docs) so nothing is lost and routing is accurate.
- Human-in-the-loop: Proposals are for review; nothing auto-creates work on boards without approval.
- Match to **existing** agents/personas where possible. Only propose new ones when the registry + current personas have no reasonable fit (e.g., no current agent handles "live AGUI outline component" well).
- Everything must be queryable via provenance/brain and reference the parent brief/handoff.

The current `brief-decomposer.js` (and the high-level feature doc) talks primarily in terms of generating "child briefs". This needs to evolve so the primary output is **structured Agenda Items** (which *may then lead to* child briefs, tasks, or swarm plans as the "what" gets turned into "how").

---

## Detailed Functional Spec for the Decomposer

### Inputs
- A normalized decomposition input from either a valid brief or a handoff.
  - Brief source: taskId + board, or the full body + metadata.
  - Handoff source: the normalized package defined in `handoff-intake-contract.md`.
- Access to the project (for `projectPath` to load domain docs if the brief specifies a domain).
- The live agent registry (`runtime/harness/agents/agents.json` and associated personas in `runtime/harness/personas/` and domain-specific ones).
- Relevant design material from the target domain's `docs/design/` and `docs/personas/` (loaded read-only).

### Processing Steps (the "units" to implement iteratively)
1. **Parse & Structure the Brief**:
   - Extract sections using `briefBody` structure (Goal, Current Rendered State, Problem/Mismatch, Constraints, Acceptance Criteria, Next Action, etc.).
   - Pull domain, title, parent references, goal links, raw artifacts.

2. **Load Context**:
   - Domain-specific design docs (if domain declared).
   - Captured entities/agenda items from handoff/definition.
   - Current agent registry snapshot (for matching).

3. **Identify Logical Sections / Workstreams**:
   - From brief sections + design docs + captured items.
   - Group into coherent "Agenda Item" candidates (not one giant brief, but multiple focused items).
   - For Domain Lifecycle motivating case: map to things like AGUI outline, Domain Architect wiring, Handoff persistence, BA Guard, scoping, etc.

4. **For Each Candidate, Build a Full Agenda Item**:
   - Title + description (with context from brief + docs).
   - Action items / next steps (light breakdown only).
   - Parent brief/handoff reference.
   - Suggested routing: Query registry for best match by capabilities, name, description. Rank matches.
   - If no strong match: Generate a "Create New Persona/Agent Proposal":
     - Draft persona file content (or delta to existing).
     - Suggested registry entry (id, provider, capabilities, description, team if appropriate).
     - Justification tied back to architecture ("No current agent handles X; this would be a specialist for Y").
   - Flags: human review needed? Priority? Dependencies on other agenda items.
   - Links to supporting docs/specs (read-only references to `docs/design/` etc.).

5. **Produce Reviewable Output**:
   - Structured list of Agenda Items (JSON + human-readable markdown).
   - AGUI-style panel (reusing/enhancing ticket-planner patterns) for the planning view.
   - Summary of registry matches and any "create new" proposals.
   - Full provenance-ready data (parent brief, assets = design docs referenced, etc.).

6. **Human-in-the-Loop Gate** (mandatory):
   - Present proposals for review.
   - Allow edit/refine before materialization.
   - Only after approval: turn selected Agenda Items into actual kanban work (lightweight briefs/tasks that reference the rich Agenda Item docs) or update captured lists.

7. **Materialization & Routing** (after approval):
   - Create kanban items via existing `createBrief` / child task mechanisms, but keep them lightweight (reference the detailed Agenda Item document).
   - Record provenance links.
   - Suggest routing/assignment based on the matched agent/persona.
   - Update handoff/captured-agenda-items style artifacts if appropriate.

8. **Feedback Loop** (for iteration on the decomposer itself):
   - Capture outcomes (what routed well, what needed new persona, what was bad decomposition).
   - Feed into improving the decomposer logic, prompts, and the Agenda Agent persona.

**Support for Output Modes** (from high-level spec):
- Can lead to multiple child briefs (one per Agenda Item or grouped).
- Can produce swarm graph definitions (for parallel specialist work on different Agenda Items).
- Always prioritize Agenda Items as the primary structured output.

### Matching Logic to Agents/Personas (Critical)
- Load the registry.
- For each Agenda Item, score against existing entries using:
  - Capability overlap.
  - Name/description similarity (fuzzy or LLM-assisted).
  - Domain scoping (System/Project/Domain agents).
- Best match: include in the Agenda Item as "suggested_assignee" / "suggested_persona" + explanation.
- No good match (below threshold): include a "proposed_new" block with draft persona + registry snippet.
- The decomposer itself should **not** auto-create registry entries or persona files (that's for human or a docs-steward / architect process after review). It proposes only.

### Non-Functional / Constraints
- Must respect Domain Lifecycle architecture: light triage by Agenda Agent; deep work handed off; human visible; nothing lost; reference design docs.
- Produce auditable output (provenance events for every Agenda Item proposed/materialized, linking to parent brief and source docs).
- Usable by Agenda Agent (as a tool it can call), human/CEO via UI/voice, and other planners.
- In controlled environment: always proposal-first; human approval before board changes; agents working on the decomposer itself must follow the new agent protocol (worktrees, dry-run, human review of diffs, reference this plan and domain AGENTS.md).
- Do not bypass `missingBriefFields` or other intake contracts when materializing.

---

## Phase 0 Inventory: Current Code vs. This Spec

This is a spec-only inventory. It documents the current implementation surface before behavior changes.

### Existing implementation anchors
- `main/core/brief-decomposer.js`
  - `extractBriefSections(body)` parses `###` sections from canonical brief bodies.
  - `loadDomainDesignDocs(projectPath, domainSlug)` loads markdown from `domains/<slug>/docs/design/` read-only.
  - `proposeSectionalBreakdown(...)` loads a kanban task, detects the domain, creates a list of workstream names, and returns `childBriefDrafts` plus a simple AGUI-style panel.
  - `applySectionalDecomposition(proposal, ...)` currently creates real briefs from `childBriefDrafts`.
- `main/core/domain-board.js`
  - Exports `briefBody`, `missingBriefFields`, `createBrief`, `createChildTask`, `recordAsset`, `decomposeBrief`, and the decomposer proposal/apply functions.
  - `briefBody` is the canonical materialized brief template; generated child work must continue to satisfy this intake contract when materialization is explicitly approved.
- `main/index.js` and `main/preload.js`
  - Expose `domain_board:propose_brief_decomposition` and `domain_board:apply_brief_decomposition` to the renderer/voice/client tool layer.
- `main/core/convai.js`
  - Registers `propose_brief_decomposition` and `apply_brief_decomposition` as client tools.
  - Tool descriptions still speak mainly in child-brief terms and need to be updated when the Agenda Item proposal shape is implemented.
- `runtime/harness/agents/agents.json`
  - Already has `domain-architect`, `agenda-agent`, and `ba-document-guard` registry entries with capabilities that can seed matching.
- `runtime/harness/personas/general/agenda-agent.md`
  - Already describes the Agenda Agent as a triage/router that creates Agenda Items and avoids deep technical decomposition.
- `domains/domain-lifecycle/captured-agenda-items.md`
  - Provides the first known Domain Lifecycle agenda-item seed list.

### Confirmed gaps
- Primary output is still `childBriefDrafts`, not structured `agendaItems`.
- Workstreams are mostly hard-coded for Domain Lifecycle and do not yet read captured agenda items or handoff files.
- No registry matching exists yet. There is no capability overlap scoring, similarity scoring, match ranking, or threshold.
- No "proposed new persona/agent" block exists for unmatched agenda items.
- No agenda-item markdown serialization exists for captured lists, review panels, or rich anchor documents.
- The apply path can create real briefs from the old proposal shape. Under this plan, apply must remain explicitly approval-only and should eventually materialize selected Agenda Items as lightweight anchors that reference the richer Agenda Item record.
- Provenance output is implied but not yet agenda-item-specific. The proposal includes `designDocsUsed`, but not per-item source links or parent/handoff references.

### Spec-safe implication
The next implementation should evolve the existing entry point instead of adding a parallel system: keep `propose_brief_decomposition` callable, but make the proposal contain `agendaItems` as the primary field and `childBriefDrafts`/materialization payloads as downstream optional fields.

---

## Draft Agenda Item Data Model

The first implementation should use a small, explicit object shape. This is not final schema validation yet; it is the target structure for Phase 1 output.

```json
{
  "id": "agenda-domain-lifecycle-agui-outline",
  "title": "Implement live interactive AGUI outline component",
  "type": "feature_implementation",
  "category": "Domain creation UX",
  "priority": "high",
  "sequence": 10,
  "parent": {
    "kind": "brief",
    "id": "TASK-123",
    "board": "domain-lifecycle",
    "title": "Implement Domain Lifecycle core"
  },
  "description": "A concise summary of why this item exists and what part of the parent brief/handoff it preserves.",
  "context": {
    "domain": "domain-lifecycle",
    "sourceSections": ["Goal", "Problem / Mismatch"],
    "sourceArtifacts": [
      {
        "path": "domains/domain-lifecycle/captured-agenda-items.md",
        "summary": "Captured agenda item from domain definition."
      }
    ],
    "supportingDocs": [
      "domains/domain-lifecycle/docs/design/domain-creation-process.md"
    ]
  },
  "actionItems": [
    "Define the outline state shape and update contract.",
    "Identify where AGUI blocks enter the existing renderer flow.",
    "Hand off detailed UI implementation to an appropriate specialist."
  ],
  "routing": {
    "suggestedAssignee": null,
    "suggestedPersona": null,
    "matches": [
      {
        "id": "agenda-agent",
        "score": 0.42,
        "reason": "Can triage and route, but should not own detailed UI implementation."
      }
    ],
    "proposedNew": {
      "needed": true,
      "reason": "No current agent is a strong owner for AGUI outline component implementation.",
      "draftAgent": {
        "id": "agui-outline-specialist",
        "name": "AGUI Outline Specialist",
        "provider": "hermes",
        "persona": "agui-outline-specialist",
        "capabilities": ["agui-ui", "outline-state", "renderer-integration"]
      },
      "draftPersonaPath": "domains/domain-lifecycle/plans/proposed-personas/agui-outline-specialist.md"
    }
  },
  "humanAttention": {
    "required": true,
    "reason": "New specialist/persona proposal requires human review."
  },
  "dependencies": [],
  "materialization": {
    "allowed": false,
    "suggestedBoard": "domain-lifecycle",
    "suggestedBriefTitle": "[domain-lifecycle] Implement live interactive AGUI outline component"
  }
}
```

### Field notes
- `id` should be deterministic enough for diffing proposals, but not treated as a permanent database ID until materialized.
- `type` and `category` are lightweight routing aids. Avoid overbuilding taxonomy in Phase 1.
- `actionItems` are light triage steps, not detailed implementation specs.
- `routing.matches` may include weak matches; `proposedNew.needed` is true only when all matches are below the chosen threshold.
- `materialization.allowed` defaults to false in proposal output. A later human approval flow can flip this or pass selected items into a separate materializer.

### Markdown serialization target
When shown to humans or added to captured lists, an Agenda Item should serialize roughly as:

```markdown
## Agenda Item: Implement live interactive AGUI outline component

- ID: agenda-domain-lifecycle-agui-outline
- Type: feature_implementation
- Priority: high
- Parent: brief TASK-123 on domain-lifecycle
- Human Attention: required - New specialist/persona proposal requires human review.

### Context
Concise description and source links.

### Action Items
- Define the outline state shape and update contract.
- Identify where AGUI blocks enter the existing renderer flow.
- Hand off detailed UI implementation to an appropriate specialist.

### Suggested Routing
- Best existing match: agenda-agent (weak) - Can triage and route, but should not own detailed UI implementation.
- Proposed new agent: agui-outline-specialist - No current agent is a strong owner for AGUI outline component implementation.

### Provenance
- Parent brief: TASK-123
- Supporting docs:
  - domains/domain-lifecycle/docs/design/domain-creation-process.md
  - domains/domain-lifecycle/captured-agenda-items.md
```

---

## Smallest Safe Phase 1 Units

These are implementation-sized units, but they should not start until the human signs off that Phase 0 is complete.

1. Add pure helpers in `main/core/brief-decomposer.js`:
   - `normalizeHandoffInput({ projectPath, domainSlug, handoffPath })`
   - `loadCapturedAgendaItems(projectPath, domainSlug)`
   - `buildAgendaItemCandidates({ parent, sections, designDocs, capturedItems })`
   - `serializeAgendaItemMarkdown(item)`

2. Add a proposal shape while preserving the existing call surface:
   - Keep `proposeSectionalBreakdown(...)`.
   - Add `agendaItems` as the primary output field.
   - Keep `childBriefDrafts` only as compatibility/downstream preview data for now.
   - Update the panel text from "child plans" to "Agenda Items".

3. Add minimal registry matching:
   - Load `runtime/harness/agents/agents.json`.
   - Score by simple token/capability overlap only.
   - Include ranked `routing.matches`.
   - Mark `proposedNew.needed` when no match clears the agreed threshold.

4. Harden the apply path:
   - Refuse to materialize unless the proposal has an explicit human approval marker.
   - Materialize selected agenda items only, not the whole proposal by default.
   - Continue using `createBrief` / `missingBriefFields` for any real brief creation.

5. Update tool descriptions and docs:
   - Rename descriptions to emphasize Agenda Item proposals.
   - Keep raw design docs untouched.
   - Run the docs/check command required by root `AGENTS.md` after doc or behavior changes.

---

## Implementation Plan (Piece by Piece, Controlled, Iterative)

We will **not yolo**. Follow the Karpathy-style loop from the broad plan: tiny scope → build/propose → test (human-controlled) → review/learn → update this spec/plan → next tiny step.

All work on the decomposer must:
- Reference and not destroy raw design docs.
- Keep testing strategy definition/execution under direct human control (agents can propose analysis only).
- Use the agent registry for any automated help (e.g., a "decomposition-analyst" persona on grok provider).
- Produce reviewable artifacts in `plans/` or `docs/features/`.
- Follow new agent protocol for any harness/kanban/dispatch work.

### Phase 0: Finish Spec (Current / Next)
- [This file] Complete the detailed spec above (user + discussion).
- Align the high-level `brief-sectional-decomposer.md` to emphasize "primary output = structured Agenda Items" (with child briefs/swarms as possible downstream).
- Inventory current code (`main/core/brief-decomposer.js`, integrations in domain-board/convai/etc.) vs. this spec.
- Decide on data model for "Agenda Item" object (JSON schema + markdown serialization for kanban bodies/captured lists).
- Update this plan with exact units to implement first.

**Guardrail**: No code changes that implement behavior yet. Pure spec work.

### Phase 1: Minimal Viable Proposal Engine (Tiny Scope)
- Scope: For a single hard-coded Domain Lifecycle-style brief (using the captured agenda items in this domain), produce a list of Agenda Items that correctly:
  - Reference the parent.
  - Match to existing agents (e.g. domain-architect, ba-document-guard, agenda-agent itself, self-repair, etc.).
  - Propose 1-2 new personas/agents where needed (e.g., something for AGUI live outline).
- Enhance `proposeSectionalBreakdown` (or a new `proposeAgendaItems` function) to output the full Agenda Item structure.
- Keep `apply...` as proposal-only for now (no auto materialization).
- Output: Structured data + nice markdown + simple panel.
- Test: Manual, using synthetic or the real captured items from this domain. Human reviews every output against the spec.
- Use an agent from the registry (e.g., the grok-powered agenda-agent or a new analyst) in a supervised way to help draft parts of the logic or review proposals (but human writes the actual code changes).

**Success for this phase**: One end-to-end proposal that a human would actually use as a starting point for Agenda Items. Document learnings here.

### Phase 2: Registry Matching + New Persona Proposals
- Make the matching logic real (load registry, score, propose new).
- Define the format for "proposed new persona + registry entry".
- Integrate with existing `loadDomainDesignDocs` and brief parsing.
- Add tests (unit level, human-defined cases).
- Human implements core; agent can generate test cases or analyze mismatches.

### Phase 3: Human Review UX + Integration
- Wire into the existing planning view / convai tools (proposal mode only).
- Add "Approve selected Agenda Items" flow that creates lightweight kanban anchors + rich docs in the domain's `plans/` or `docs/`.
- Update provenance.
- Still no auto-routing or deep execution.

### Phase 4: Controlled Agent Loop for Iteration
- Set up a small "decomposition-improvement" team in the registry (if not present).
- Human creates narrow tasks using proper protocol (worktree, dry-run, reference this plan).
- Agents help with: analyzing runs, proposing persona tweaks, generating more test briefs from design docs, drafting updates to this spec.
- Human reviews everything before incorporating.
- Only after several cycles: consider giving the (improved) Agenda Agent direct access to call the decomposer as a tool.

### Phase 5+: Materialization, Routing, Dogfood, Hardening
- Add safe materialization (after human approval in the flow).
- Better routing suggestions using teams.
- Dogfood on Domain Lifecycle work (human creates the seed brief first).
- Define and (human) execute testing strategy.
- Only then: broader use, UI polish, etc.

**No phase advances without human sign-off and update to this document + the feature spec.**

---

## Open Questions / Things to Spec Further (Talk & Update)

- Exact JSON schema for an Agenda Item object.
- How "create new persona" proposals are stored/acted on (e.g., draft file in `plans/proposed-personas/`, then docs-steward or human promotes).
- Integration points with existing handoff payload and captured-agenda-items format.
- Whether the decomposer should also output "suggested meetings" or other non-kanban Agenda Items.
- Thresholds for "good enough match" vs. propose new.
- Error handling, fallbacks when registry is incomplete.

We need to finish spec'ing these out here before moving to implementation phases.

**Recommendation**: Plan it more (this file + discussion). Do not yolo. Update the high-level feature doc and broad plan to point here as the detailed source. Use the next tiny step to align on the Agenda Item data model + one example output for a real captured item from this domain.

This keeps us in controlled, slow, high-quality mode while making the decomposer actually produce what the architecture requires: good Agenda Items that route correctly (or create the missing agents/personas).

---

**Next Action (after user review)**: 
- Discuss and edit this file until the spec feels complete for the Agenda Item output format and matching logic.
- Then pick the absolute smallest slice of Phase 1 to prototype (analysis only, no full code yet if we want to stay ultra-slow).
