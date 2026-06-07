
---

### What CEO Studio Actually Is

At its core, **CEO Studio** is a desktop app I’m building to solve the chaos I deal with every day while making software.

I get overwhelmed micromanaging agents. Documentation turns into a mess as the project evolves (thanks, ADHD). And planning feels completely fragmented — there’s no central place where everything stays connected.

So the big idea is to create **“Obsidian for Agents”** — a living project brain that keeps track of everything. A smart hub where you can talk to any agent, and the right persona kicks in automatically based on context. Nothing disappears into random chat windows or terminal sessions. Everything important gets captured, organized, and kept up to date.


The goal is to make planning easier no more endless typing and iterating lets create the 

### The Main Concepts in the Docs

Here’s what all those attached documents are actually describing, in plain English:

## 1. **Domains = The Core Organizing Idea**
Everything in a project is broken into **Domains** — clear, focused ownership areas (like “Agents”, “Billing”, “User Management”, etc.). 

Instead of one giant messy project, you divide things into sensible chunks. Each domain has its own documentation, requirements, features, and even its own specialized agents. This keeps context from getting lost and makes the whole thing more manageable as the project grows.

### Why a Domain is Important

A **Domain** is a strategic ownership area inside a project. It is the primary mechanism to fight **documentation rot** — the biggest problem you're solving.

By giving every major piece of the application its own clean, well-defined container, you create a single source of truth where:
- User journeys, business requirements, and specifications live
- Agents can reliably find and update documentation
- Work stays organized instead of scattered across conversations, notes, and forgotten files
- Separation of concerns becomes natural and enforceable

Domains turn chaotic knowledge into structured, agent-manageable ownership.

### Core Components of a Domain

A well-defined domain should contain:

1. **Core Definition**
   - **Name**
   - **Meaning / Purpose** — What does this domain own? Why does it exist?
   - **Overarching Goal** — Long-term desired outcome

2. **Structure & Organization**
   - **Board** (task/work tracking space)
   - **Team** (associated agents and personas)
   - **Subdomains** (if needed — recursive)

3. **Content & Knowledge**
   - Requirements
   - User Journeys
   - Features / Capabilities
   - Specifications & Technical Details
   - Designs
   - ADRs (Architecture Decision Records)
   - Meeting notes, decisions, etc.

4. **Metadata & Relationships**
   - Related domains
   - Agenda items & follow-ups
   - Handoff records

### How a Domain Should Be Planned (Creation Flow)

1. **Trigger** — User clicks “New Domain”
2. **Domain Architect Interview** — A specialized persona runs a natural, guided conversation (voice or text)
3. **Live AGUI Updates** — Left panel updates in real-time as the definition takes shape
4. **Active Intelligence** — The architect detects entities (subdomains, features, agenda items, new models) during the conversation
5. **Scope Control** — Gently prevents going too deep into sub-topics while capturing them for later
6. **Synthesis** — Produces:
   - Raw transcript
   - Clean synthesized domain definition
7. **Handoff** — Packages everything and hands off to the **Agenda Agent** (not automatic execution)

The goal of the initial creation is **not** to fully build everything, but to create a **strong, well-scoped starting point** that feels right to the user.

---

Would you like me to expand any section (especially the planning flow, components, or the role of subdomains)? Or should we refine this summary into the main document?

#### 3. **Critical System Agents**

The project should have a list of personas where personas can be created an defined, there would be core system agents, but then domain defined persons
![[Screenshot 2026-06-03 at 8.40.45 AM.png]]
These are the always-on “core team” that the whole system depends on:
- **Domain Architect** — helps you define new domains properly
- Task Architect - helps defines tasks
- **Agenda Agent** — receives the handoff and figures out what should happen next (creates agenda items, suggests meetings, etc.)
- **BA Agent (Business Analyst)** — the quality guardian. Lives inside each domain and makes sure documentation doesn’t rot. It reviews changes and marks things as “Dirty” or “Clean”
- **CEO** — you (or the high-level orchestrator)
- **Orchestrator** — routes work between agents
	...etc

Within this persona management system you can clearly define and edit personas, this probbalby needs version management, but it can be worked on in the future. I can see this becoming a critical librarry of skills and agents.

![[Screenshot 2026-06-03 at 8.41.14 AM.png]]


#### 4. **Handoffs**
When one agent finishes its job (like the Domain Architect finishing the initial definition), it doesn’t just dump everything and disappear. It creates a proper **Handoff** — a structured record with all the context, raw notes, synthesized summary, captured ideas, etc. This gets passed to the Agenda Agent so nothing falls through the cracks.

This is a big part of solving the “agents don’t know what other agents are doing” problem.

Hand offs are very important, the hand 


#### 5. **Recursive Deep Dives**
You’re not forced to define everything at once. During or after creating a domain, you can click on any part (a feature, a requirement, etc.) and “Deep Dive” — which creates a linked child document to explore that topic in more detail. This creates a clean tree structure instead of one massive overwhelming doc.

#### 6. **Dirty vs Clean Documents**
The BA Agent enforces this. New or changed docs start as “Dirty.” Nothing important should move forward on dirty docs until they’ve been reviewed and marked Clean. This is how we fight documentation rot.

---


![[Screenshot 2026-06-03 at 8.10.09 AM.png]]



### AGENTS
Agents are defined in the agent panel

Agents communicate through a2a protocal

Sessions

Every new agent conversaiton should create a session

# CONVERSATION PANEL 

The main conversaiton panel is a core coponent to this application it should resemble something like this image. 

In this component we can talk with the currenlty mounted harness+agent, the mounted agent has control over the agui, it can render diagrams, it understands the context that is visible in the which ticket it open. what project, what domain, what the other agents are doing

![[Screenshot 2026-06-03 at 9.42.26 AM.png]]

