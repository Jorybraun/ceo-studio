# Domain Terminology

This document serves as the single source of truth for all key terms used in the CEO Studio system.

---

## Core Concepts

### Domain
A strategic ownership area inside a project. It represents a clear boundary of responsibility and owns all related documentation, requirements, user journeys, specs, and agents that belong to that area.

### Subdomain
A smaller, more focused domain nested inside a parent domain. Used when a part of a domain becomes large or complex enough to warrant its own dedicated ownership and documentation structure.

### Project
The top-level container. A project contains multiple domains and has its own set of agents and configuration.

---

## Agent Types & Scoping

### System Agent (Critical System Agent)
A core, mandatory agent that is required for the platform to function. These agents are part of the system itself (e.g. CEO, Domain Architect, Agenda Agent, BA Agent). They cannot be deleted by the user.

### Project Agent
An agent that belongs to an entire project but is not a mandatory system agent. It is available across the project.

### Domain Agent
An agent that belongs to and operates within a specific domain. It is only visible and active when working inside that domain.

### Custom Agent
Any agent created by the user. These live inside projects or domains and are optional.

---

## Key Personas / Agents

### Domain Architect
The specialized agent responsible for running the interactive interview process when a new domain is created. It gathers requirements, detects entities and subdomains, maintains live UI updates, and produces a clean handoff.

### Agenda Agent
The agent that receives handoffs when a domain (or other work item) is created. Its job is to analyze the brief and create the initial set of **Agenda Items** — the "what" needs to happen next. It does light triage and spotting of complexity, but does not perform deep decomposition or execution.

### BA Agent (Business Analyst)
The agent that lives inside each domain and acts as the guardian of document quality. It is responsible for reviewing new/changed documents, managing Dirty vs Clean state, detecting conflicts, and preventing documentation rot.

---

## Work Items & States

### Handoff
The formal transfer of a completed piece of work (usually a newly defined domain) from one agent to another, along with all relevant context and artifacts.

### Agenda Item
A high-level piece of work generated from a handoff or review process. It represents something that needs further attention, discussion, planning, or decomposition. Agenda Items are the primary output of the Agenda Agent. They are the "what", not the "how".

### Task
A more concrete, actionable unit of work. Tasks are typically created from Agenda Items once they have been clarified and refined. Tasks can be assigned, prioritized, tracked, and completed.

### Dirty State
A document (or domain definition) that has been created or modified but has **not yet** been reviewed and approved by the BA Agent. Work items attached to dirty documents should be blocked from progressing.

### Clean State
A document (or domain definition) that has been reviewed by the BA Agent and confirmed to be consistent with the rest of the domain’s knowledge base. Only clean documents are considered trustworthy sources of truth.

---

## Process Concepts

### Domain Creation Process
The full flow of creating a new domain: triggered by the user → Domain Architect runs an interactive interview → live updates to the left panel → review & refinement phase (including deep dive capability) → clean handoff to the Agenda Agent.

### Review & Refinement Phase
The phase after the initial interview where the user can click on parts of the domain definition in the left panel to discuss, edit, or go deeper (recursive exploration) with the agent.

### Recursive Document Linking / Deep Dive
The ability, during the review phase, to click on a section of a domain definition and create a linked child document to explore that topic in more depth. This supports recursive decomposition without losing context.

---

*This document should be updated whenever new terms are introduced or existing definitions are clarified.*