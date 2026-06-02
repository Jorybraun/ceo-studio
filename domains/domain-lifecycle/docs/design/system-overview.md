# CEO Studio — High-Level System Overview

**Purpose of this document:**  
This is the single source of truth that explains **what we are building** and **how the pieces fit together**. It is intentionally kept at a high level so we don’t get lost in implementation details.

> See `domain-terminology.md` for the current definitions of all key terms used across these documents.

---

## 1. The Core Problem We Are Solving

**Documentation rot** is the central enemy.

As projects grow, documents, specs, requirements, and decisions become scattered, outdated, conflicting, or forgotten. Agents (and humans) start working against each other because they no longer share a single source of truth.

The goal of CEO Studio is to create a system where:

- Every domain has a living, trustworthy knowledge base.
- New work is automatically checked for conflicts before it is accepted.
- The system stays coherent even as complexity increases.

---

## 2. Core Concepts

### Projects
- The top-level container.
- A project owns multiple **Domains**.
- A project also owns **System Agents** that are required for the platform to function.

### Domains
- A domain is a strategic ownership area inside a project.
- It owns its own documentation, requirements, user journeys, specs, and work.
- Domains can contain sub-domains.
- When a domain is created, a structured folder + document skeleton is automatically provisioned inside the project.

### Documents
- Documents are the primary source of truth.
- Every document has a **state**: `Dirty` (draft / unverified) or `Clean` (reviewed and consistent).
- Work items attached to dirty documents should be blocked from progressing.

### Agents
Agents are scoped. There are three main levels:

| Scope          | Type                    | Description                                                                 | Editable?          | Required? |
|----------------|-------------------------|-----------------------------------------------------------------------------|--------------------|---------|
| **System**     | Critical System Agents  | Core agents required for the platform to function (CEO, Domain Architect, Agenda Agent, BA Agent, etc.) | System prompt is immutable | Yes |
| **Project**    | Project Agents          | Agents that belong to the entire project but are not critical infrastructure | Fully customizable | No  |
| **Domain**     | Domain Agents           | Agents that only exist inside one specific domain                           | Fully customizable | No  |

**Important rule:** There should be no cross-pollination. An agent should only be visible and usable within its defined scope.

---

## 3. The Domain Creation Journey (End-to-End)

1. **User triggers** “New Domain” inside a project.
2. **Domain Architect** (Critical System Agent) starts a guided interview in the right panel.
3. **Left panel (AGUI)** updates live as the definition emerges. It becomes a clickable outline.
4. **During the interview**, the Domain Architect:
   - Asks questions to define purpose, ownership, and goals.
   - Actively detects potential sub-domains, features, and agenda items.
   - Gently prevents scope creep while capturing ideas so nothing is lost.
5. **User confirms** the high-level definition is good enough.
6. **Review & Refinement phase** begins:
   - The left panel becomes a full clickable outline of the synthesized definition.
   - User can click any section to discuss/refine it in context.
   - User can trigger **Deep Dive / Recursive exploration** on any node (this may create linked child documents).
7. **Domain Architect synthesizes** the conversation (raw transcript + clean definition).
8. **Handoff** is created and sent to the **Agenda Agent**.
9. **Agenda Agent** receives the handoff and decides what should happen next (create agenda items, schedule meetings, trigger further decomposition, etc.).

---

## 4. Keeping Documents Healthy — The BA Agent

Every domain gets its own **BA Agent** (Business Analyst Agent). This is a **Critical System Agent**.

### Two-Layer Design (Very Important)

- **Immutable System Layer** (System Prompt — cannot be edited)
  - Must review every new or changed document in its domain.
  - Must detect conflicts with existing knowledge.
  - Must enforce Dirty → Clean state transitions.
  - Must block work items attached to dirty documents.
  - Runs on a mandated schedule / trigger.

- **Editable Persona Layer** (Customizable)
  - Controls review style, communication tone, and project-specific standards.
  - Can be tuned per project or domain.

The BA Agent’s job is **not** to clean up mess after the fact. Its job is to **prevent** mess from entering the trusted knowledge base in the first place.

---

## 5. Handoffs

Handoffs are first-class events.

- The **Domain Architect** creates a clean handoff package (synthesized definition + raw transcript + captured entities/agenda items) and sends it to the Agenda Agent.
- The **Agenda Agent** is responsible for triage and routing — it decides what work should be created and where it should go.
- Handoffs should be explicit, logged, and visible to the user.

---

## 6. Key Principles

- **Domains should stay focused.** If something feels too big during creation, it should probably be split.
- **Nothing is lost.** Every insight, potential subdomain, or follow-up item is captured.
- **Review is intentional.** Deep diving and recursive document creation should mostly happen *after* the initial high-level definition is stable.
- **Dirty documents are dangerous.** Work should not proceed on top of unverified documents.
- **System Agents have hard rules.** Their core behavior is non-negotiable. Only their style/persona can be customized.
- **Scoping matters.** Agents and visibility should respect Global → Project → Domain boundaries.

---

## 7. Current Open Questions / Areas to Define Next

- Exact payload structure for handoffs
- How recursive/deep-dive documents are stored and linked
- How the BA Agent actually performs conflict detection and merging
- How work items are blocked when attached to dirty documents
- How System Agents are instantiated and configured per project
- The orchestration layer that routes work between agents and queues

---

**This document is the current high-level map.**  
Everything else we build should be consistent with the concepts defined here.

---

*Last updated: June 2026*