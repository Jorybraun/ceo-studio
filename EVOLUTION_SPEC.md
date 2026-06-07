# CEO Studio Evolution Spec

**Status:** Working codebase, targeted improvements  
**Philosophy:** Keep what works, fix what hurts, add what's missing  
**Not:** A greenfield rebuild

---

## What Works Today (Keep)

| Component | Status | Why It Stays |
|-----------|--------|--------------|
| Electron shell + IPC | ✅ Works | Stable foundation |
| Hermes CEO relay | ✅ Works | `askCeo()` via `hermes chat -q` |
| Kanban integration | ✅ Works | `hermes kanban` for tasks |
| Agent registry | ✅ Works | `agents.json` config-driven |
| Cost guardrails | ✅ Works | Kill switch, daily caps |
| AG-UI server | ✅ Works | `@ag-ui/client` connected |
| Session persistence | ✅ Works | Transcripts, context survive |
| Domain scaffolding | ✅ Works | Auto-creates structure |
| Autonomy runner | ✅ Works | Policy, decompose, assign, execute |

---

## What Hurts Today (Fix)

| Problem | Current State | Fix |
|---------|---------------|-----|
| **Voice** | 11Labs broken, needs API key | macOS `say` + Web Speech API |
| **Autonomy feel** | Runner exists but invisible | CEO-driven decomposition + visible queue |
| **Domain overwhelm** | 5 domains, scattered UI | Collapse to Modules, clean UI |
| **Agent collaboration** | Rooms/meetings too heavy | Kanban comments + work logs |
| **Annotation** | Doesn't exist | Click text → comment/item/thread |
| **Review flow** | Weak test gate | Proper PR-like approval |
| **Documentation** | Scattered | Per-module ADR + requirements |

---

## The Evolution Plan

### Phase 1: Voice Fix (Week 1)
**Goal:** Working voice without 11Labs

**Changes:**
1. Replace `main/core/voice.js` ElevenLabs path with macOS `say` command
2. Replace STT with Web Speech API in renderer (Chromium has this built-in)
3. Add Siri Shortcut integration (HTTP endpoint in main process)
4. Remove `ELEVENLABS_API_KEY` dependency entirely

**Files to touch:**
- `main/core/voice.js` - strip ElevenLabs, add `say` command
- `renderer/convai.js` - add Web Speech API STT
- `main/index.js` - add HTTP endpoint for Siri Shortcut

**Success criteria:**
- `npm test` passes
- Voice works without any API keys
- Siri Shortcut can POST to app

---

### Phase 2: Autonomy Feel (Week 1-2)
**Goal:** Make the autonomy runner feel like a real project manager

**Changes:**
1. Add **Comptroller** module (new file: `main/core/comptroller.js`)
2. Comptroller monitors Kanban board, maintains visible queue
3. CEO can decompose conversations into tasks via natural language
4. Add work logging (what each agent did, when)
5. Add audit trail (immutable event log)

**Files to touch:**
- `main/core/comptroller.js` - NEW, task queue + dispatch
- `main/core/autonomy-runner.js` - integrate with Comptroller
- `main/core/hermes.js` - CEO can create Kanban tasks
- `renderer/dashboard.js` - show queue, not just board

**Success criteria:**
- User can say "break this into tasks" → CEO creates Kanban items
- Comptroller shows queue of ready work
- Work logs persist per agent run

---

### Phase 3: Modules (Week 2)
**Goal:** Replace overwhelming domains with clean modules

**Changes:**
1. Rename `domains/` → `modules/`
2. Collapse 5 domains to 3 modules:
   - `core/` - studio, cockpit, UI
   - `autonomy/` - comptroller, runner, agents
   - `voice/` - Siri, speech, conversation
3. Each module has: `README.md`, `ADR/`, `tests/`, `requirements/`
4. Remove domain-architect complexity (too many questions)

**Files to touch:**
- Rename directories
- Update `main/core/domains.js` → `main/core/modules.js`
- Update UI to show modules, not domain cards

**Success criteria:**
- `npm run check` passes
- UI shows 3 clean modules, not 5 confusing domains
- Each module has ADR + tests

---

### Phase 4: Annotation (Week 3)
**Goal:** Click any text to comment/create

**Changes:**
1. Add annotation primitive to AG-UI component registry
2. Wrap text blocks with click handlers
3. Context menu: "Comment", "Create task", "Start thread"
4. Annotations stored in brain, linked to source

**Files to touch:**
- `renderer/agui/` - add annotation component
- `main/core/brain.js` - store annotations
- `main/preload.js` - expose annotation IPC

**Success criteria:**
- Click text → popup with options
- Comment appears in brain
- Can convert to Kanban task

---

### Phase 5: Review Flow (Week 3-4)
**Goal:** PR-like approval before merge

**Changes:**
1. Add review gate to Comptroller
2. Agent work creates branch (already does)
3. Human reviews diff in UI
4. Approve → merge → mark done
5. Reject → comments → back to agent

**Files to touch:**
- `main/core/comptroller.js` - review state machine
- `renderer/` - diff view, approve/reject buttons
- `main/core/autonomy-runner.js` - integrate review gate

**Success criteria:**
- Nothing reaches "done" without human approval
- Diff visible in UI
- Approval logged in audit trail

---

### Phase 6: Standup (Week 4)
**Goal:** Scheduled morning check-in

**Changes:**
1. Add cron/scheduler to main process
2. Standup conversation: "What done, what's next"
3. CEO presents deliverables
4. Human approves plan
5. Autonomy executes post-approval

**Files to touch:**
- `main/core/sessions.js` - add scheduled sessions
- `main/core/comptroller.js` - standup mode
- `renderer/` - standup UI

**Success criteria:**
- Standup happens on schedule (or manual trigger)
- CEO summarizes work
- Human can approve/reject plan
- Approved work auto-executes

---

## Files to Remove (Not Keep)

| File/Feature | Why Remove |
|--------------|------------|
| `main/core/meetings.js` | Replaced by Kanban comments + work logs |
| `main/core/session-agent.js` | Too complex, use simpler agent spawn |
| `main/core/session-capture.js` | Over-engineered |
| `runtime/harness/bin/domain-room*` | Rooms not needed |
| `runtime/harness/agents/meeting.py` | Meetings not needed |
| ElevenLabs code in `voice.js` | Replaced by `say` + Web Speech API |
| Domain architect interview flow | Too many questions, slow |

---

## Files to Add

| File | Purpose |
|------|---------|
| `main/core/comptroller.js` | Task queue, dispatch, review gate |
| `main/core/modules.js` | Replace domains.js, cleaner API |
| `main/core/audit.js` | Immutable event log |
| `modules/core/ADR/` | Architecture decisions |
| `modules/autonomy/ADR/` | Autonomy decisions |
| `modules/voice/ADR/` | Voice decisions |

---

## Minimal Viable Evolution (MVE)

If we only do ONE thing: **Phase 1 (Voice) + Phase 2 (Comptroller)**

This gives you:
- Working voice (Siri)
- Visible autonomy (queue, work logs)
- CEO-driven task creation

Everything else is polish.

---

## Testing Strategy

Every phase must:
1. Pass `npm run check`
2. Pass `npm test`
3. Have new tests for new code
4. Work offline (no API keys needed)

---

## Documentation Strategy

Every change must:
1. Update module README
2. Add ADR if architectural
3. Update AGENTS.md if behavior changes
4. Run `npm run docs:check`

---

## Decision: Start Where?

| Option | Scope | Timeline |
|--------|-------|----------|
| **A** - Voice only | Phase 1 | 2-3 days |
| **B** - MVE (Voice + Comptroller) | Phase 1+2 | 1 week |
| **C** - Full evolution | All phases | 3-4 weeks |
| **D** - Strip first | Remove meetings/rooms, then build | 3 days + build |

**Recommendation:** **B** - MVE. Gets you working voice + autonomy feel quickly.

---

## What You Get After MVE

```
┌─────────────────────────────────────────┐
│  CEO Studio                             │
│                                         │
│  Voice: Siri (works!)                   │
│  ┌─────────────────────────────────┐   │
│  │  CEO Chat                       │   │
│  │  "Break this into tasks"        │   │
│  └─────────────────────────────────┘   │
│           ↓                             │
│  ┌─────────────────────────────────┐   │
│  │  Comptroller Queue              │   │
│  │  • Task 1 (ready)               │   │
│  │  • Task 2 (running)             │   │
│  │  • Task 3 (needs review)        │   │
│  └─────────────────────────────────┘   │
│           ↓                             │
│  ┌─────────────────────────────────┐   │
│  │  Agent Work Logs                │   │
│  │  [devin-1] Implemented auth     │   │
│  │  [devin-2] Fixed tests          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  3 Modules: core / autonomy / voice     │
└─────────────────────────────────────────┘
```

---

**Next step:** Pick A, B, C, or D. I recommend B (MVE) and can start immediately.
