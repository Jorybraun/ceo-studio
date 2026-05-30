# Architecture Paths — Current Major Tracks

This document maps the main conceptual paths / workstreams in the Project CEO Harness architecture.

Use this as a map when asking "what path is this in?"

## 1. Subagent Model
**Core doc:** `SUBAGENT-MODEL.md`

Focus:
- CEO Harness directly spawning and managing lightweight subagents (especially cheap models like Kimi for research swarms).
- Active Think Tank mode (subagents do research and return **proposals**, not just raw data).
- High observability into what subagents are actually doing.
- Human remains the primary decision maker.

Current status: Well defined. Recently reinforced with the user's preference for subagents (vs only external harnesses) and high visibility.

## 2. Domain Operations & Planning Meetings
**Core doc:** `DOMAIN_OPERATIONS_AND_PLANNING_MEETINGS.md`

Focus:
- How individual domains (e.g. Discovery, Culture, Matching) actually operate day-to-day.
- Deep research + context gathering inside a domain.
- Scheduled review/planning meetings between the human and a domain's Agent Team.
- Flexible scheduling per domain ("if necessary").

Current status: Well defined. Matches the user's desire to be able to schedule review times for domains and have rich working sessions with them.

## 3. Self-Improvement & Dream Cycles
**Core docs:** 
- `SELF_IMPROVEMENT_AND_DREAM_CYCLES.md`
- `SELF_IMPROVEMENT_CODE_EVOLUTION.md`
- `SELF_EVOLUTION_VIA_ISSUES.md`

Focus:
- The harness getting better over time with minimal human effort.
- Memory/knowledge improvement (brain enrichment, synthesis, pattern detection).
- Code & system evolution (the harness improving its own skills, logic, and eventually its own code).
- Early-stage model: Self-changes tracked primarily via GitHub Issues in the harness's own repo, with auto-merge and no mandatory human approval for now.

Current status: Well defined. User has been pushing this direction strongly ("it needs to be self improving" and "not just memory but code").

## 4. Own Repo + Self Pull Requests
**Core doc:** `OWN_REPO_AND_SELF_PR.md`

Focus:
- The CEO Harness lives in its own dedicated repository.
- It can generate changes and open PRs against itself.
- This is the long-term safe mechanism for code-level self-improvement.

Current status: Defined as a foundational decision. User recently confirmed this direction.

## 5. Delegation Model (Subagents vs External Harnesses)
**Core doc:** `DELEGATION-MODEL.md`

Focus:
- When the CEO Orchestrator should use cheap subagents it directly manages vs. delegate bigger work to mature external systems (Hermes for planning, Overstory for coding, etc.).

Current status: Defined but can be expanded as we get more concrete on the Planning Team.

## 6. Planning Flow & Domains
**Core doc:** `PLANNING-FLOW-AND-DOMAINS.md`

Focus:
- Overall planning flow (Triage → CEO decides path → subagents or delegation → proposals → human review via Kanban).
- How domains are created and what they mean.

Current status: Solid high-level view.

## 7. Planning Team + Expert Skill Library (Current Active Path)
**Core docs:**
- `Planning-Team.md` (in planning folder)
- `EXPERT_SKILL_LIBRARY.md` (in skills folder)

**This is the path we are currently on.**

Focus:
- Building the specialized Planning Team (PM, BA, Architect, Design/UX, Research, Meta-Skill, etc.).
- Creating and curating a high-quality expert skill & persona library.
- Finding and adapting the best existing skills/personas (Garry Tan's gstack, GBrain, Anthropic official skills, etc.).
- Starting to stand up real personas for research, architecture, design/UX, skill creation, etc.

Current status: Just beginning execution. We have started creating initial skills in `harness/skills/planning-team/`.

## 8. Herder-Native Agent Orchestration
**Core docs:**
- `TMUX_AGENT_ORCHESTRATION_RESEARCH_AND_DECISION.md`
- `../HERDER_MIGRATION_PLAN.md`
- `../AGENT_ORCHESTRATION_PLAN.md`
- `../CHAT_ORCHESTRATOR_EXECUTION_PLAN.md`
- `../HERDER_ORCHESTRATOR_FLOW.md`

Focus:
- Replace dashboard+tmux-only assumptions with a herder-native control loop.
- Keep domain rooms as the human-visible bus while structured events/herder_mail carry machine control.
- Make the agent registry canonical and introduce a herder-agent-manager for lifecycle activation, assignment, heartbeat, failure, and completion state.
- Treat tmux only as a visibility/TTY adapter for tools that require an interactive terminal.

Current status: Decision accepted; implementation work is split across the agent-harness Kanban tasks for registry wiring, structured events, herder-agent-manager, real Chat Orchestrator brain, dashboard lifecycle state, and end-to-end validation.

---

## Other Supporting Tracks

- **Multi-Project Support** (`MULTI-PROJECT.md`)
- **Portability & External Nature** (`PORTABILITY.md`)
- **YC / Garry Tan Lessons** (`YC_AI_PLAYBOOK_LESSONS.md`)
- **Decision Authority** (human as primary decision maker) — spread across DESIGN.md and multiple docs

## Current Focus (as of latest conversation)

We are actively working in **Path 7: Planning Team + Expert Skill Library**.

The user wants to:
- Build personas for Design, UX, Research, Skills, Meta, etc.
- Curate a high-quality expert skill library by finding and adapting the best existing ones.
- Start with the Planning Team before going deep into full self-fixing/code evolution.

This work sits at the intersection of:
- Subagent Model (the Planning Team will largely be made of subagents)
- Domain Operations (Planning Teams live inside domains)
- Future Self-Improvement (skills should get better over time via dream cycles)

---

Would you like me to keep this `00-ARCHITECTURE_PATHS.md` as the living map and keep it updated as we add new paths? Or would you prefer a different format (e.g., a visual roadmap, Kanban-style tracks, etc.)?