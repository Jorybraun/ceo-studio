# Planning Flow & Domains — How This System Actually Works

This document describes the concrete planning process in the Project CEO Harness.

> **Evolution note (June 2026):** The high-level domain model here is being refined by the detailed domain lifecycle specs now at `domains/domain-lifecycle/docs/design/` (System Overview, Domain Terminology, Agent Scoping Model, Critical System Agents, Domain Creation Process, Handoff Protocol, Recursive Document Linking) inside the Domain Lifecycle domain. Those specs introduce specialized Critical System Agents (Domain Architect for guided creation interviews with live AGUI outline, Agenda Agent for handoff triage, per-domain BA Document Guard enforcing Dirty/Clean states) and first-class handoff entities. This document describes the current implemented/prior flow; the new specs represent the target detailed operating model. Cross-reference them for creation mechanics, agent roles, and document hygiene.

## What is a "Domain"?

A **Domain** is a logical, self-contained area of the product or project that has its own:
- Strategy and priorities
- Planning and research needs
- Data models / contracts with other domains
- Long-term ownership

Domains are **not** just "folders in the code." They are units of strategic ownership. They are created and maintained through the structured process defined in `domains/DOMAIN_CREATION_PROCESS.md` and protected by the BA Document Guard (`domains/CRITICAL_SYSTEM_AGENTS.md`, persona `ba-document-guard`).

### Examples (for a project like PIPE-OS)

- `discovery` — Everything related to Role Discovery / intake interviews
- `culture-interview` — The adaptive culture / behavioral interview system
- `matching` — Repo matching, candidate-repo fit, role-fit logic
- `candidate-ingestion` — Resume processing, enrichment, profile building
- `repo-graph` — The Neo4j / living graph layer
- `challenge-system` — Code review + implementation challenges
- `compliance` — Legal, audit, disclosure, EU AI Act, etc.
- `recruiter-cockpit` — The main recruiter UI and workflows

Domains can be technical or product-oriented. The CEO Orchestrator decides the right cut.

## How Domains Are Determined

There are two main ways domains get created (see the detailed, target process in `domains/DOMAIN_CREATION_PROCESS.md` and `domains/HANDOFF_PROTOCOL.md` — the flow below is the prior/ high-level view being evolved):

### 1. Initial Project Breakdown (when starting or re-architecting)

1. You tell the CEO Orchestrator (via chat) something like:
   > "I want to properly break down this entire project so agents can own pieces of it."

2. The CEO Orchestrator (possibly delegating initial research to Hermes) does a high-level analysis of the codebase + existing docs + your chat history.

3. It proposes a set of domains + rough boundaries.

4. You review and adjust in chat or via a work package in the Kanban.

5. Once approved, domains are scaffolded using the `create-domain.sh` tool (or improved version).

**Target (per June 2026 design):** Domain creation is driven by a specialized **Domain Architect** Critical System Agent via a structured conversational interview in the right panel. The left AGUI panel live-updates a clickable hierarchical outline of the emerging definition. The process ends with an explicit handoff record to the **Agenda Agent** (not automatic deep work).

### 2. Organic Emergence (during normal operation)

While working, the CEO Orchestrator may notice that something is big/complex enough to deserve its own domain.

Example: "The way we're handling transcripts and provenance is getting complicated and touches multiple areas. We should spin up a `transcript-core` domain."

It will propose this to you before creating it.

Subsequent decomposition and refinement use the recursive deep-dive / linked child document mechanism described in `domains/RECURSIVE_DOCUMENT_LINKING.md`.

## The Planning Flow (Step by Step)

Here’s what a realistic flow looks like:

### Phase 0 — Input
Work enters the system through:
- You chatting with the CEO Orchestrator (`@ceo`)
- You commenting on existing Kanban items
- External signals (new issues, user feedback, etc. — future)
- The CEO Orchestrator itself spotting gaps while reading the brain

### Phase 1 — Triage (CEO Level)
- Everything first lands in a global **Triage** area (currently `mgmt/triage.md` at the project root, later possibly a real board).
- The CEO Orchestrator looks at it and decides:
  - Which domain(s) it primarily belongs to
  - Rough size / complexity
  - Whether it needs deep planning/research first

### Phase 2 — Delegation Decision
The CEO Orchestrator asks itself:
- "Does this need lightweight clarification, or real planning work?"
- If it needs real planning/research/design → it creates a **Delegation Request** and sends it to **Hermes** (the planning harness).

This is the key handoff:
- CEO Harness = strategy + prioritization + cross-domain view
- Hermes = does the actual deep planning, research, user journeys, alternative exploration, specs, mocks, etc.

### Phase 3 — Work Inside Hermes
- Hermes receives the delegation as a high-level task.
- Its own Kanban swarm / planning agents go to work (this is where the heavy lifting happens).
- Hermes produces artifacts (research docs, proposed designs, trade-off analyses, etc.).

### Phase 4 — Return & Synthesis
- Results come back to the CEO Harness.
- The CEO Orchestrator reviews them for strategic alignment ("Does this actually serve the overall direction I know the founder wants?").
- It may ask for refinements or send follow-up delegations.
- Eventually it prepares a clean **Work Package** for human review.

### Phase 5 — Human Review (Kanban)
- The package appears in the global Kanban (and is linked from the relevant domain's board).
- You Approve / Deny / Comment.
- If you want to steer more deeply, you jump into chat.

### Phase 6 — Execution Handoff (if approved)
- Once approved, the work can be broken into executable tasks.
- Coding work gets delegated to Overstory (or whatever coding harness you're using).
- Planning work that is now "ready to build" may trigger more Hermes activity or move into implementation tracking.

## Does Each Domain Have Its Own Board?

**Yes — and this is important.**

Every domain has its own lightweight board at:

```
context/[domain]-team/mgmt/kanban.md
```

This is the **domain-level view**.

It contains:
- Work that is specific to that domain
- Items that have been delegated to Hermes for that domain
- Local priorities and progress

There is also a **global Kanban** (at the CEO Harness level) that shows cross-domain and strategic items.

The CEO Orchestrator is responsible for making sure the global picture and the domain pictures stay consistent.

## How Progress Is Visualized

Current (early) state:
- Markdown Kanban files per domain + global
- Triage logs
- Conversation history in the brain

Future / ideal state:
- The CEO Harness can read Hermes' Kanban (or specific items) so you get visibility without leaving the system.
- A simple dashboard (web UI) that shows:
  - Global strategic Kanban
  - Per-domain boards
  - Outstanding delegations and their status
  - Recent chat activity + decisions
- The brain (GBrain) can answer questions like "What's the current status of the discovery domain?" or "What big decisions were made last month?"

## Agent Scoping & Critical System Agents

The refined model (see `domains/AGENT_SCOPING_MODEL.md` and `domains/CRITICAL_SYSTEM_AGENTS.md`) defines three scoping levels for agents:

- **System (Critical)**: Mandatory platform infrastructure with immutable core behavior (system prompt) + editable persona layer. Includes CEO (Hermes), **Domain Architect**, **Agenda Agent**, **BA Document Guard** (per-domain doc quality + Dirty/Clean enforcement), Orchestrator.
- **Project**: Visible across a project's domains.
- **Domain**: Only visible/usable inside one specific domain.

No cross-pollination: agents respect their scope.

The **BA Document Guard** (persona: `ba-document-guard`) is the primary defense against documentation rot: every document change triggers review; dirty docs block attached work items.

## How Communication Works

There are several layers:

1. **Human ↔ CEO Orchestrator**
   - Primary: Chat (natural language, high bandwidth)
   - Secondary: Comments on Kanban items

2. **CEO Orchestrator ↔ Domain Teams**
   - Mostly through structured delegation requests and returned artifacts.
   - Domain teams (lightweight) inside the CEO Harness act as coordinators.

3. **CEO Orchestrator ↔ External Harnesses (Hermes, Overstory, etc.)**
   - Formal delegation requests (see `integrations/hermes/`)
   - Results come back as documents + status

4. **Between Agents (inside Hermes, for example)**
   - Happens inside the delegated harness (Hermes has its own communication).
   - Important conversations and decisions are expected to be summarized back to the brain.

5. **Persistent Memory**
   - Almost everything meaningful (chat, delegations, decisions, research) eventually flows into the brain (GBrain).
   - This is what lets the CEO Orchestrator "remember" context over months and reason like a CEO who has been with the company a long time.

## Example Walkthrough: "Raw Transcript First"

1. You chat with `@ceo` about wanting discovery to be transcript-first.
2. CEO logs it, thinks about it, and decides this is foundational for the `discovery` domain.
3. It creates a delegation request to Hermes: "Research and design a transcript-first approach for discovery interviews..."
4. Hermes planning swarm does research, explores options, produces specs + mocks.
5. Results return to CEO Harness.
6. CEO reviews for global impact (how does this affect matching? culture? compliance?).
7. A clean work package appears in both the global Kanban and the `discovery` domain's kanban.
8. You review it. You can approve, or jump back into chat with more nuance.
9. Once approved, implementation work can be sent to Overstory, etc.

This is the intended rhythm.

---

This document will evolve as we build the actual delegation protocols and tools. The goal is to make the flow feel natural and visible while giving the agents real agency inside their areas of responsibility.
