# Domain Operations & Planning Meetings

**Purpose**: Define how individual domains (like the Discovery domain) operate day-to-day inside the CEO Harness, with a strong emphasis on research-driven reasoning and structured human involvement through planning meetings.

## Core Philosophy for a Domain

Each domain is treated as a semi-autonomous unit with its own:

- Research mandate
- Context gathering responsibility
- Planning Team / Agent Team
- Ongoing work and proposals

The expectation is **intellectual, research-based reasoning** — not just executing tasks, but deeply understanding the problem space, gathering rich context, and forming thoughtful views on the domain.

## Discovery Domain Example

**Domain Goal**: The Discovery Agent conducts exploratory interviews to deeply understand the role an organization is hiring for.

This is not a lightweight intake form. The domain is responsible for:

- Gathering maximum relevant context about the role, team, company, success criteria, constraints, culture, technical environment, etc.
- Understanding the *actual* problems the hiring manager is trying to solve.
- Building a rich, nuanced picture that downstream domains (culture, matching, challenges, etc.) can rely on.

### How the Discovery Domain Operates

**1. Continuous / Triggered Research Phase**
- When a new role discovery engagement starts, the Discovery domain’s Agent Team (or dedicated subagents) begins deep research and context gathering.
- This can include:
  - Reviewing any existing materials the client has provided.
  - Preparing intelligent, exploratory interview guides (not rigid scripts).
  - Using research subagents to pull relevant market/role context when appropriate.
  - Capturing and structuring insights from every interview turn (raw transcripts remain primary).
- The domain maintains a living body of knowledge specific to that engagement (stored in the brain with proper scoping).

**2. Scheduled Planning / Review Meetings (Human + Domain)**

The user can schedule review or planning sessions for any domain on an as-needed basis.

Key points:
- Scheduling is flexible and per-domain. Some domains may need weekly reviews during active periods; others may only need ad-hoc reviews when the CEO Orchestrator or the user flags something important.
- The CEO Orchestrator can help propose and manage these review times (e.g., "The Discovery domain has completed its first round of research — would you like to schedule a review meeting this week?").
- These meetings are conducted through the rich chat interface.
- In these sessions the user can:
  - Review what the domain has researched and found so far.
  - See research summaries, key insights, and any Mermaid diagrams the domain has created to represent its current understanding.
  - Discuss how the domain currently sees its direction, challenges, and opportunities.
  - Give direct feedback and steering.
  - Plan next steps or adjust the domain’s focus.

This turns the relationship with each domain into a collaborative, research-driven partnership rather than a black-box that only delivers final outputs.

These meetings are **not** just status updates. They are working sessions where the human and the domain’s agents reason together about the domain.

**3. Output from the Domain**
- The Discovery domain produces proposals, interview guides, insight summaries, and eventually structured outputs (when ready).
- These are surfaced through the normal Kanban flow for human review and approval.
- Raw transcripts and rich context remain available for deeper inspection.

## Why This Model

- It keeps the human (the real decision maker) closely involved in shaping how each domain thinks and operates.
- It forces the domain agents to do real intellectual work and be able to articulate their reasoning.
- It creates regular checkpoints where the user can inject judgment before too much work goes in the wrong direction.
- It leverages the rich chat + document/diagram rendering capabilities so these planning meetings are actually productive working sessions.

## How This Fits the Broader Architecture

- The **CEO Orchestrator** can help schedule and prepare for these planning meetings.
- The **Planning Team** (PM, BA, Architect, etc.) can participate in or facilitate domain planning meetings.
- Research subagents (especially cheaper ones) do a lot of the heavy context gathering inside the domain.
- All artifacts (research notes, diagrams, interview frameworks) are stored in the domain’s section of the artifacts or brain, and can be brought up during chat.

## Example Flow for Discovery Domain

1. New role discovery request comes in.
2. Discovery domain’s Agent Team begins research + prepares for interviews.
3. The user (or CEO Orchestrator) can **schedule a review/planning meeting** whenever it feels necessary (after initial research, after several interviews, when stuck, etc.).
4. In the scheduled chat session:
   - Discovery agents present key findings and research.
   - They can bring up Mermaid diagrams representing the current domain model or interview approach.
   - User reviews, challenges, adds direction, and plans next steps.
5. Domain continues its work with fresh guidance.
6. Future review sessions can be scheduled on an as-needed basis (no rigid cadence required).
7. When the domain has a solid proposal or deliverable ready for broader review, it surfaces through the main Kanban.

This gives the user lightweight but powerful control: domains do deep autonomous research work, but the human can insert themselves for high-signal steering sessions whenever it adds value.

## Next Steps (for this pattern)

- Define how to represent a domain’s Agent Team and its standing charter.
- Create templates for domain planning meetings (what the domain should prepare and bring).
- Build the ability for the CEO Orchestrator to help schedule and agenda these meetings.
- Make it easy to bring up a domain’s current research artifacts and diagrams during the planning meeting in chat.

This model moves the Discovery domain (and others) away from “black box that eventually produces an RCD” toward a collaborative, research-heavy, intellectually rigorous unit that the human regularly engages with through structured planning conversations.