# Feedback Synthesis: Rebuild Plan vs. Your Input

## The Alignment

Your feedback **confirms and sharpens** the rebuild plan. Here's the mapping:

| Rebuild Plan Says | Your Feedback | Alignment |
|-------------------|-------------|-----------|
| Core-4: sessions, tasks, agents, personas | "Sessions list is good" | ✅ Keep sessions |
| Remove rooms, meetings, domains | "Remove rooms, remove meetings" | ✅ Confirmed |
| Agent-driven UI via AG-UI | "Leverage CopilotKit" | ✅ Same protocol |
| Siri via Shortcuts (free STT/TTS) | "Get Siri into" | ✅ Confirmed |
| Mount as founding primitive | "Agents in tmux terminate when not used, restart when clicked" | ✅ Confirmed |
| Lightweight tasks (not full kanban UI) | "Standups: what done + next steps" | ✅ Confirmed |

## The Additions (Not in Original Rebuild Plan)

### 1. Annotation Feature: Click Text → Comment/Item/Thread
**New requirement:** Users can click on any block of text in the UI and:
- Add a comment
- Create a task/item from it
- Start a new thread

**Implication:** This is a UI interaction primitive the agent-driven UI needs to support. The AG-UI component vocabulary needs an "annotatable" wrapper.

### 2. Agent Workflow Rigor
**New requirements for agent execution:**

| Requirement | Why It Matters | Implementation Path |
|-------------|----------------|---------------------|
| **Queue** | Ordered work, backpressure | Comptroller maintains ready-queue |
| **Work logging** | Audit trail of what happened | Structured logs per agent run |
| **Collaboration** | Agents need to coordinate | Comments on shared context, not isolated rooms |
| **Branching + proper commit messages** | Clean git history | Worktrees + conventional commits enforced |
| **Audit trail** | Who did what when | Immutable event log |
| **PR approval / review flow** | Human oversight before merge | Review gate in Comptroller |
| **Rigorous testing protocol** | Prevent regression | `npm run check` + `npm test` as mandatory gate |
| **Requirements stored in structure** | Documentation gardening | Per-module ADRs + acceptance criteria |

### 3. Modules (Rename/Replace Domains)
**Concept shift:**
- Old: "Domains" (studio, teams, channels, meetings, domain-lifecycle) — confusing, overlapping
- New: **"Modules"** — clear, composable, code-facing

**Structure:**
```
Project/
  modules/
    core/           ← the app itself
    features/
      voice/        ← Siri integration
      autonomy/     ← Comptroller + runner
    integrations/
      hermes/       ← CEO relay
      gbrain/       ← Memory bridge
```

Each module has:
- `README.md` — what it does
- `ADR/` — architecture decisions
- `tests/` — module-level tests
- `requirements/` — acceptance criteria for features

### 4. Documentation Gardening + Testing Requirements
**Enforcement mechanism:**
- Pre-commit hook: checks for ADR updates when architecture changes
- Pre-merge gate: all changed modules must have passing tests
- Agent prompt injection: "You must update the module's ADR and tests for any architecture change"

## The Clarifications Needed

### Sessions: Keep or Remove?
**Rebuild plan:** Keeps sessions (core-4)
**Your question:** "What do you think about removing sessions?"

**Analysis:**
- Sessions = working context + history + active agent binding
- "Agents in tmux terminate when not used, restart when clicked" = session lifecycle management
- Without sessions: every interaction is stateless, no history, no resume

**Recommendation:** Keep sessions, but make them **lightweight and lazy**:
- Session list = bookmarks to agent+context
- Agent process = spawned on demand, killed on timeout
- Session data = persisted (transcript, context), process = ephemeral

### Kanban Comments for A2A
**Your concern:** "doesn't work" — agents need real collaboration
**Analysis:** You're right. Kanban comments are too slow/async for real-time coordination.

**Better model:**
- **Comptroller queue** = work assignment (async, durable)
- **Agent work logs** = progress updates (async, durable)
- **Synchronous coordination** = only when needed, via structured messages in the queue

## The Revised Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CEO Studio (Electron + AG-UI + CopilotKit patterns)       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Surface    │  │  Terminal   │  │  Chat/Voice         │ │
│  │  (AG-UI)    │  │  (xterm.js) │  │  (Siri Shortcuts)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         └──────────────────┼────────────────────┘            │
│                            │                               │
│                   ┌────────┴────────┐                      │
│                   │  Session        │ ← lightweight        │
│                   │  (context+history)│   durable state      │
│                   └────────┬────────┘                      │
│                            │                               │
│  ┌─────────────────────────┼─────────────────────────┐     │
│  │                         ▼                         │     │
│  │  ┌─────────────────────────────────────────────┐  │     │
│  │  │  Comptroller (new)                         │  │     │
│  │  │  • Queue management                         │  │     │
│  │  │  • Agent dispatch                           │  │     │
│  │  │  • Work logging                             │  │     │
│  │  │  • Review gate                              │  │     │
│  │  │  • Audit trail                              │  │     │
│  │  └─────────────────────────────────────────────┘  │     │
│  │                         │                         │     │
│  │         ┌───────────────┼───────────────┐         │     │
│  │         ▼               ▼               ▼         │     │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────────┐  │     │
│  │  │ CEO     │    │ Planner │    │ Devin       │  │     │
│  │  │ (Hermes)│    │ (Hermes)│    │ (swe-1.6)   │  │     │
│  │  └─────────┘    └─────────┘    └─────────────┘  │     │
│  │                                                 │     │
│  └─────────────────────────────────────────────────┘     │
│                            │                              │
│  ┌─────────────────────────┼─────────────────────────┐   │
│  │  Modules (was Domains)  │                         │   │
│  │  • core/                │                         │   │
│  │  • voice/               │                         │   │
│  │  • autonomy/            │                         │   │
│  │  Each: README + ADR + tests + requirements/      │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## The Implementation Path

### Phase 0: Foundation (Strip + Rename)
1. Remove rooms, meetings, complex domains
2. Rename "domains" → "modules" in structure
3. Add module scaffold (README + ADR + tests + requirements/)

### Phase 1: Comptroller (Core New Work)
1. Design Comptroller state machine
2. Queue + work logging
3. Agent dispatch (Devin spawning)
4. Review gate (PR-like approval flow)
5. Audit trail (immutable event log)

### Phase 2: Agent-Driven UI (AG-UI + CopilotKit patterns)
1. Component registry (layout, text, form, list, card, code, terminal-embed, mount-tile, action)
2. Render loop: agent emits → parse → mount
3. Bidirectional events: user click → agent input
4. Annotation primitive: click text → comment/item/thread

### Phase 3: Voice (Siri Shortcuts)
1. Async relay endpoint (job id + poll/stream)
2. Shortcut: Dictate → POST → Speak
3. LAN-stable port + auth

### Phase 4: Standup Workflow
1. Scheduled/cron trigger
2. Conversation: "what done, what's next"
3. Deliverables: designs, specs
4. Approval: human sign-off
5. Autonomous execution post-approval

## Open Questions

1. **Stack:** A (Electron/web, recommended), B (native Swift), or B-lite (A + Swift companion)?
2. **CopilotKit integration:** Use their React components or just the AG-UI protocol?
3. **Session persistence:** SQLite (current), JSON files, or gbrain?
4. **Annotation scope:** All text blocks or opt-in per component?
5. **Review gate:** UI button or voice "approved"?

## Decision Points

| Decision | Options | Impact |
|----------|---------|--------|
| Stack | A / B / B-lite | Development velocity, Siri depth |
| CopilotKit depth | Protocol only / Full SDK | Component reuse, bundle size |
| Module enforcement | Soft / Hard (pre-commit) | Doc gardening discipline |
| Agent visibility | Logs only / Terminal peek / Full tmux | UX complexity |

## Next Action

**Option A:** Decide stack + create Kanban brief → dispatch to builder
**Option B:** Create Kanban brief with open decisions → assign to Domain Architect to research
**Option C:** Start Phase 0 (stripping) immediately while deciding others

**Recommendation:** Option A — decide stack now, then brief. The feedback has clarified the vision; we don't need more research, we need execution.
