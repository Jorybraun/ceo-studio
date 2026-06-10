# Domain Creation Process Specification

**Version:** 0.1  
**Date:** 2026-06-01  
**Status:** Draft  
**Owner:** Domain Architect (with CEO oversight)

---

## 1. Goals

The primary goals of the Domain Creation Process are:

- Capture the **intent, scope, and ownership** of a new domain clearly before any implementation or deep work begins.
- Prevent **documentation rot** by establishing a single source of truth for each domain from day one.
- Enable **agent-driven orchestration** — a specialized persona (Domain Architect) leads a structured interview instead of relying on static forms.
- Create a **predictable, recursive structure** so that agents (documentation, planning, decomposition) always know where information belongs.
- Establish clear **separation of concerns**: Domains are containers for meaning, requirements, and knowledge — not direct controllers of UI behavior.
- Produce a clean **handoff point** so that deeper work (user journeys, specs, ADRs, meetings, decomposition) is deliberately scheduled rather than lost.

---

## 2. Desired Outcomes

When the Domain Creation Process completes successfully, the following should exist:

- A **named domain** with a clear, agreed-upon purpose.
- A high-level definition that includes:
  - What the domain owns / is responsible for
  - Overarching goal / long-term outcome
  - Key capabilities or features (initial list)
  - Known relationships to other domains (dependencies, overlaps, subdomains)
- A **live-updating + interactive left panel** (AGUI) that reflects the emerging definition in real time and allows clicking nodes/sections for focused discussion and refinement.
- A dedicated **Review & Refinement phase** where the user can inspect, discuss, and optionally deep-dive on specific parts of the definition.
- A recorded **handoff item** for the Agenda Agent.
- An explicit **next agenda item** that the CEO / Agenda Agent will address (e.g., “Schedule kickoff meeting to decompose requirements”).
- The user feels the definition is “good enough to start” and has explicitly confirmed it.

The process should feel collaborative and alive, not like filling out a rigid form.

---

## 3. Entity Relationships

### Core Entities

| Entity              | Description                                                                 | Relationship to Domain                          |
|---------------------|-----------------------------------------------------------------------------|-------------------------------------------------|
| **Domain**          | Strategic ownership area. Container for meaning, requirements, and work.   | Self-referential (can contain subdomains)      |
| **Subdomain**       | A Domain that lives inside another Domain.                                 | Child of Domain                                |
| **Feature / Capability** | A distinct piece of functionality or responsibility the domain owns.    | Belongs to exactly one Domain                  |
| **Requirement**     | A specific need, constraint, or user story tied to the domain.             | Belongs to a Domain (or Feature)               |
| **User Journey**    | End-to-end flow a user takes that touches this domain.                     | Linked to one or more Domains/Features         |
| **Persona**         | Role or character (human or agent) involved with the domain.               | Assigned to Domains, Teams, or specific work   |
| **Team**            | Group of agents/personas working on a domain or set of domains.            | Can own or be assigned to one or more Domains  |
| **Board**           | Task / work tracking space for the domain.                                 | One primary Board per Domain (can have more)   |
| **Channel**         | Communication space (chat, meeting room, etc.) scoped to the domain.       | Linked to Domain or specific work items        |
| **Meeting**         | Scheduled interaction related to the domain.                               | Linked via Agenda Agent                        |
| **Handoff**         | Explicit transfer of responsibility from one agent/persona to another.     | Created at end of Domain Creation              |
| **Agenda Item**     | Actionable next step owned by the Agenda Agent.                            | Created during/after Handoff                   |

### Key Rules

- A **Domain** is recursive: it can contain other Domains.
- Every Domain must have exactly **one primary owner persona** (initially the Domain Architect during creation).
- Features and Requirements are **scoped to one parent Domain** (they can be referenced by other domains but ownership is clear).
- The **left panel (AGUI)** reflects the current state of the Domain being defined in real time.
- Handoffs are **explicit and recorded** — they do not happen automatically.

---

## 4. The Flow (Domain Creation Process)

### Trigger
User clicks **“New Domain”** (or equivalent action in the workspace).

### Step 0: Context Check (optional but recommended)
The system may briefly show:
> “Creating a new domain inside **CEO_STUDIO** (or current parent domain). Is this correct?”

This helps with recursive/domain-within-domain situations.

### Step 1: Activate Domain Architect Persona
- Right panel switches to (or starts) a conversation with the **Domain Architect**.
- The persona introduces itself with a short, natural greeting:
  > “Hi, I’m the Domain Architect. I’ll help you define this new domain clearly so we don’t lose track of what it owns. Let’s start simple.”

### Step 2: Live Interview (Core Loop)
The Domain Architect conducts an open-ended interview. The left panel updates **live** after every meaningful answer.

**Typical question progression** (agent adapts based on answers):

1. **Name**  
   “What would you like to call this domain?”

2. **Purpose / Ownership**  
   “What does this domain own or control? What is it responsible for?”

3. **Overarching Goal**  
   “What’s the long-term outcome or success state this domain should help achieve?”

4. **Scope & Boundaries**  
   “What should **not** be part of this domain? Are there any obvious overlaps with existing domains?”

5. **Key Capabilities / Features** (initial)  
   “What are the main things this domain needs to be able to do?”

6. **Relationships**  
   “Does this domain depend on, or is it depended on by, any other domains we already have?”

7. **Subdomains** (if relevant)  
   “Do you already see any natural subdomains inside this one?”

The agent continues asking clarifying or deepening questions until the user explicitly says something like:
- “This feels good”
- “I’m happy with this for now”
- “Let’s move forward”

Only then does the process proceed.

**Live Update Rule:** Every time the user gives a substantive answer, the left panel (AGUI) immediately reflects it (domain name, description, goal, initial feature list, etc.).

**Interactive Left Panel (Clickable Outline):**
- As the definition builds, the left panel renders a structured, hierarchical outline (nodes/blocks for purpose, goal, features, relationships, captured subdomains, etc.).
- The user can **click any node or block** at any time.
- Clicking a node sends that specific context to the Domain Architect.
- The user can then have a focused discussion about *just that section* — review it, correct it, ask questions, or refine it — without losing the overall conversation thread.
- This makes review and refinement possible **during** the interview itself, not only after.

### Step 3: Confirmation & Summary
Once the user signals readiness:

Domain Architect produces a clean summary:
> “Here’s what I understand so far:  
> - Name: …  
> - Owns: …  
> - Goal: …  
> - Key capabilities: …  
> - Relationships: …  
> 
> Does this capture it correctly? Anything you want to adjust before we lock the initial definition?”

User confirms or iterates.

### Step 3.5: Review & Refinement Phase (Interactive + Recursive)
After the initial interview feels complete, the user enters an explicit **Review & Refinement** mode:

- The left panel shows the full synthesized domain definition as a clickable, hierarchical outline.
- User can click any section/node to give the Domain Architect focused context.
- They can then discuss, edit, or refine that specific part in detail.
- **Deep Dive / Recursive Exploration**: From any node, the user can trigger a "Deep Dive" or "Inspect" action. This allows going deeper on that topic (e.g., expanding a feature into detailed requirements, or exploring a potential subdomain).
  - Deep dives can optionally create **child documents** or spawn follow-up agenda items.
  - Recursive deep dives are encouraged **after** the high-level definition is stable, not during the initial interview (to avoid scope creep).
- The goal of this phase is to let the user manually review and iteratively improve the definition before handing off.

This phase ends when the user explicitly says they are satisfied with the current level of definition.

### Step 4: Create Domain Record
Once confirmed, the system:
- Persists the domain with the six core fields (name, meaning/purpose, overarching goal, initial features, relationships, owner persona).
- Marks the domain as “Defined (Initial)” status.
- Creates the basic folder/structure for documentation, requirements, user journeys, etc.

### Step 5: Handoff (Explicit, Not Automatic)
The Domain Architect does **not** immediately transfer control.

Instead, it creates a **Handoff item** and surfaces it clearly:

> “Initial domain definition complete.  
> I’m handing this off to the **Agenda Agent** so we can decide what happens next (meetings, deeper decomposition, user journey mapping, etc.).  
> 
> Next agenda item: Agenda Agent to review the new **Agents** domain and propose a kickoff plan.”

This handoff is recorded as a visible, actionable item. The CEO (or user) can decide when to engage the Agenda Agent on it.

### Step 6: Post-Handoff
- Domain now exists in the workspace.
- User can continue working in it or switch contexts.
- The Agenda Agent has a pending item to schedule or propose next actions.
- Deeper work (user journeys, specs, ADRs, designs, task breakdown, meetings) is deliberately planned rather than started immediately.

---

## 5. Responsible Personas & Skills

### Domain Architect (Primary during creation)
**Core Skills:**
- Expert requirement gathering & stakeholder interviewing
- Breaking vague ideas into clear, scoped definitions
- Identifying boundaries and separation of concerns
- Mapping relationships between domains
- Keeping the live left-panel definition coherent

**Goal during this process:** Produce a high-quality initial definition + clean handoff.

### Agenda Agent (Receives the handoff)
**Role after creation:**
- Review newly created domains
- Propose and schedule meetings
- Decide order of deeper work (decomposition, user journeys, specs, etc.)
- Create agenda items and track follow-through

---

## 6. Principles & Guardrails

### Core Principles

- **No hard-coded wizards.** The interview is conversational and adaptive. The Domain Architect drives the flow through natural dialogue.
- **Live feedback.** The left panel (AGUI) is the single source of truth during definition and updates in real time.
- **User controls the pace.** The process only advances when the user explicitly signals they are ready (e.g. “this feels good”, “let’s move forward”).
- **Review & Deep Dive happen intentionally.** After the initial interview, users can review any part of the definition by clicking it. Deep/recursive exploration on specific topics (potentially creating child documents) is supported but should primarily occur **after** the high-level definition is stable, to avoid derailing the initial creation flow.
- **Handoff is intentional.** We always create a recorded handoff item + next agenda item. Control is never auto-transferred.
- **Recursive by design.** The same process can (and should) be used later to define subdomains.
- **Documentation-first mindset.** The goal is to give future agents and humans a clear, structured place to put information so it doesn’t rot.

### Interview Conduct Principles

- **Detect entities and subdomains actively.** While interviewing, the Domain Architect should listen for new entities, data models, features, or potential subdomains mentioned by the user. During **refinement / synthesis** (at the end of the interview or in a dedicated pass), the agent should explicitly extract first-class entities such as:
  - Subdomains
  - Features / Capabilities
  - Requirements
  - **Agenda Items** (e.g. “we should follow up on this”, “schedule a meeting about X”, “create a subdomain for Y”)
  - New concepts or data models

  **Example:** If the user says “viewing agent details might need its own subdomain” or “we should schedule a follow-up on workflows”, the agent should recognize **Agenda Item** and **Subdomain** as distinct entities and capture them cleanly instead of letting them disappear into the conversation.

- **Prevent scope creep gently.** If the user starts going deep into something that clearly belongs in a separate subdomain (e.g. “Agent Details”), the agent should:
  1. Acknowledge the idea so the user feels heard.
  2. Capture it cleanly (so nothing is lost).
  3. Politely redirect the conversation back to the current domain.
  4. Create a follow-up agenda item to explore that subdomain later.
- **Capture raw + synthesized output.** At the end of the interview, produce both:
  - A **raw** version (full conversation / transcript)
  - A **synthesized** clean domain definition
- **Keep domains focused.** A domain should represent one clear area of ownership. If it starts feeling too broad or complicated during the interview, the Domain Architect should flag this and suggest splitting it.
- **Nothing is lost.** Any insight, entity, or future subdomain mentioned during the interview must be captured and attached to the handoff so it can be revisited intentionally.

---

## 7. Open Questions / Next Agenda Items (for later recursive dive)

- Exact schema / data model for a Domain entity (fields, status, relationships)
- How the AGUI (left panel) technically receives live updates during the interview
- Detailed behavior of the Agenda Agent when it receives a handoff
- How to handle “non-visual / internal” domains vs user-experience-heavy domains
- When and how to trigger deeper processes (user journey mapping, spec writing, ADR creation, meeting scheduling)
- Relationship between Domains and Boards / Tasks
- Versioning or evolution of domain definitions over time

---

**End of initial specification.**

This document captures the high-level flow, entities, goals, outcomes, and handoff philosophy discussed. We can now do a recursive dive into any section (especially the handoff mechanics, the live AGUI update mechanism, or the Agenda Agent’s responsibilities). 

Ready when you are.