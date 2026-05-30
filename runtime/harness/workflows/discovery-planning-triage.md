# Workflow: discovery-planning-triage

**For**: Items in the **Triage** column of a discovery-domain Kanban when the stage-map binds them to `team: discovery-planning`.

**Goal**: Take a raw idea / transcript / requirement from initial intake all the way to a complete, reviewed, approved asset package that can safely move to Ready for Execution. No card leaves Triage without the full package + explicit approval.

## Mandated Phases (in order)

1. **Intake & Context Load**
   - Read the raw source (transcript, brief, human description).
   - Read the domain `AGENTS.md` (non-negotiable law) and `docs/domain-overview.md`.
   - Read any linked existing docs/requirements.
   - Confirm the raw transcript (or equivalent primary artifact) is captured and immutable.

2. **Sizing + Rationale**
   - Assign Size (Small / Medium / Large / Epic).
   - Write a short rationale. Large items get more ceremony; small ones can be lighter but still follow the gates.

3. **Dependency / Blast Radius Scan**
   - Query all relevant living docs.
   - Identify cross-domain impact (especially anything that touches existing behavior).
   - Note any other Kanban items or domains that must be coordinated with.

4. **Size-Appropriate Planning Depth + Full Asset Production**
   Minimum required assets for any Triage item (the "full package"):
   - Clear problem / opportunity statement (in the language of the raw input)
   - Recommended approach + rationale + tradeoffs considered
   - User journeys / key flows (BA owned)
   - Technical spec / data model / ADRs as needed (Architect owned)
   - Living HTML mock-ups for every user-facing surface (Design Planning owned)
   - Explicit test / QA coverage plan and quality criteria (QA Planning owned)
   - Cross-domain impact analysis + contracts
   - Updated Kanban notes + links to all artifacts in the domain room

5. **Cross-Domain Awareness Check**
   - Explicit handoff / notification to any affected domains.
   - Confirmation (in chat or Kanban comment) that they have seen the impact.

6. **QA Planning Agent Review**
   - Mandatory on any item that could affect existing behavior or data.
   - QA sign-off comment or annotation is required before the card can be proposed for Ready.

7. **Review Loop (until solid)**
   - Present the full package in the domain room + on the Kanban.
   - Human (and/or higher orchestrator) annotates, requests changes, or approves.
   - Team revises and resubmits.
   - Repeat until the package meets the Board Rules in `kanban.md`.

8. **Final Approval + Move to Ready**
   - Only the Orchestrator (or explicit human approval) may mark a card as approved and move it from Triage to Ready.
   - The move itself must be accompanied by a clear Kanban note + room post referencing the approved package.

## Non-Negotiable Gates (Board Rules Enforcement)

Nothing moves from Triage to Ready without **all** of the following:
- Full asset package (see phase 4)
- Explicit review + annotation in chat or directly on the Kanban
- QA Planning Agent sign-off on any impact to existing behavior
- Final approval marker (by the domain Orchestrator or human)

## Artifacts & Visibility

- All major outputs are posted (or linked via `reference-for-chat`) into the active domain room.
- The Kanban is updated incrementally as assets are produced.
- The raw transcript / primary source is always referenced and never destroyed by synthesis.

## Anti-Patterns (Forbidden)

- Skipping any required asset because "it's small".
- Over-synthesizing the raw input into generic profiles before the transcript is safely stored and queryable.
- Moving a card to Ready on the strength of a verbal "looks good" without the documented package.
- Assuming downstream consumers without explicit contracts.

## Success Criteria for This Workflow

When the card reaches Ready, a future builder (human or agent) can pick it up with zero context loss, implement against the assets, and have clear acceptance criteria + test guidance — all traceable back to the original raw input.

## References (must be loaded)

- Domain law: `context/discovery-team/AGENTS.md`
- Domain orchestrator contract: `context/discovery-team/team-harness/orchestrator.md`
- Current Kanban + Board Rules: `context/discovery-team/mgmt/kanban.md`
- Active stage binding: `context/discovery-team/mgmt/stage-map.md`
- The specific raw requirement / transcript for the current card
