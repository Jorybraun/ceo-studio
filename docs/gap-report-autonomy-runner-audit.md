# Autonomy Runner Documentation Gap Report

**Audit Date:** 2026-06-03  
**Auditor:** docs-steward (Devin swe-1.6)  
**Task:** t_79587691  
**Scope:** Compare NORTH_STAR.md, E2E_PLAN.md, and AUTONOMY_RUNNER_PLAN.md against main/core/autonomy-runner.js implementation

---

## Executive Summary

The autonomy-runner implementation has significantly outpaced its planning documentation. The code implements a sophisticated 7-phase autonomous cycle with L3 (Swarm Orchestration) capabilities, while the planning docs describe a simpler 4-step cycle and position the system at L1-L2. Critical gaps exist in:

1. **AUTONOMY_RUNNER_PLAN.md**: Describes outdated dispatch mechanism and incomplete cycle phases
2. **E2E_PLAN.md**: Capability ladder positioning is outdated; cost guardrail implementation is incomplete
3. **NORTH_STAR.md**: Minor updates needed to reflect accelerated implementation

---

## Gap 1: AUTONOMY_RUNNER_PLAN.md vs Implementation

### 1.1 Cycle Phase Mismatch

**Plan Document (lines 90-106):**
Describes a simple 4-step cycle:
1. `hermes.ensureUp()`
2. `autonomyLoop.runCycle(...)` (goal reviews + blocked analysis)
3. `hermes.dispatch({ board, max, dryRun })`
4. Persist run record

**Actual Implementation (autonomy-runner.js lines 369-645):**
Implements a 7-phase cycle:
1. Gateway up (`deps.hermes.ensureUp()`)
2. Goal review + blocked analysis (delegated to `autonomyLoop.runCycle`)
3. **PLAN** — decompose planning-lane briefs via `hermes.taskAction({ action: "decompose" })`
4. **ASSIGN** — route unassigned work via `orchestration-org.route()`
5. **EXECUTE** — spawn real Devin workers directly (not via Hermes dispatcher)
6. **REVIEW** — strong test gate (verify commands + merge)
7. **Swarm roster publishing** — write live worker state to `swarm.json`

**Impact:** The plan document is materially incomplete. It omits the PLAN, ASSIGN, and REVIEW phases, which are core to the system's operation.

**Recommendation:** Rewrite the "One cycle" section (lines 90-106) to reflect the actual 7-phase implementation.

---

### 1.2 Dispatch Mechanism Outdated

**Plan Document (line 97):**
```
hermes.dispatch({ board, max, dryRun })
```

**Actual Implementation:**
- PLAN phase: `deps.hermes.taskAction({ board, taskId: t.id, action: "decompose" })` (line 467)
- EXECUTE phase: Direct `deps.spawnWorker()` calls to Devin CLI (line 521)
- No use of `hermes.dispatch` command

**Rationale in Code (lines 19-24):**
The implementation correctly chose direct Devin CLI execution because "Hermes spawns workers as `hermes -p <profile>` agents and has no Devin model provider, so a Hermes worker cannot run swe-1.6."

**Impact:** The plan document describes a dispatch mechanism that was never implemented and would not work.

**Recommendation:** Remove references to `hermes.dispatch` and document the actual `taskAction` + `spawnWorker` approach with the rationale.

---

### 1.3 Command Surface Status

**Plan Document (lines 36-41):**
Lists as "Invalid today":
- `hermes start-autonomy`
- `hermes use recursive-planning-harness`
- `hermes kanban dispatch --board ceo-studio --max 3 --autonomous`

**Actual Implementation:**
- `scripts/start-autonomy.js` exists and is fully functional
- npm scripts: `autonomy:dry-run`, `autonomy:once`, `autonomy:start` (package.json lines 15-17)
- In-app IPC surface: `runner:status|configure|run_once|start|stop` (mentioned in plan line 19)

**Impact:** The plan's "Current Reality" section is outdated.

**Recommendation:** Update the "Current Reality" section to reflect that the CLI and IPC surfaces are now IMPLEMENTED.

---

### 1.4 Team-Log Channels Implementation

**Plan Document (lines 175-183):**
Mentions team-log channels conceptually but lacks implementation details.

**Actual Implementation:**
- `defaultPostWork()` function (lines 254-258) calls `meetings.post()`
- Milestone events: ▶ started, ✓ finished, ✗ error, ✅ Done, ⛔ blocked
- Posted via `logWork()` helper (lines 276-278)
- Best-effort, side-effect-only (failures never break cycles)

**Impact:** The feature is implemented but not well-documented in the plan.

**Recommendation:** Expand the team-log section with implementation details and the actual event types.

---

### 1.5 Missing Safety Features in Plan

**Actual Implementation (not mentioned in plan):**
- Per-project lock to prevent overlapping cycles (lines 333-341)
- Self-repair on infrastructure errors (lines 619-628)
- Worker reaping with log tail analysis (lines 418-448)
- Git worktree isolation per task (lines 164-175)
- Fast-forward-only merge gate (lines 232-242)

**Impact:** The plan understates the safety and isolation features.

**Recommendation:** Add a "Safety & Isolation" section documenting these features.

---

## Gap 2: E2E_PLAN.md vs Implementation

### 2.1 Capability Ladder Positioning

**E2E_PLAN.md (lines 45-53):**
Describes a ladder:
- L0: Foundation (no autonomy)
- L1: Document Agent (single agent, doc edits)
- L2: CEO Manager (single strategic agent, work packages)
- L3: Swarm Orchestration (delegation, subagents, external harnesses)
- L4: Self-improvement

States: "We are starting at M0 → M1. Everything past M1 is gated on the Document Agent earning trust."

**Actual Implementation:**
The autonomy-runner already implements L3 capabilities:
- Real Devin workers with A2A coordination via Kanban comments
- Git worktree isolation per task
- Swarm roster publishing to `swarm.json`
- Multi-board support
- Per-agent routing via orchestration-org
- Strong review/test gate

**Impact:** The plan's positioning is outdated. The system has leapfrogged L1-L2 and is operating at L3.

**Recommendation:** Add a note acknowledging that the autonomy-runner has accelerated to L3 capabilities, and consider whether the ladder needs reframing or if this represents a successful "fast track" implementation.

---

### 2.2 Cost Guardrail Gap

**E2E_PLAN.md (lines 76-86, 217-222):**
Emphasizes "hard cost controls" as non-negotiable:
- Hard caps: `$X / session`, `$Y / day`
- Live meter: tokens + $ per session
- Per-call accounting: `{model, tokens_in, tokens_out, usd, duration}`
- "No agent can spawn another agent without a budget allocation"

**Actual Implementation:**
The autonomy-runner has:
- Worker headcount caps (`maxConcurrentWorkers`, `maxDispatchPerCycle`)
- Worker timeout (`workerTimeoutMinutes`)
- Per-task isolation (worktrees)
- **BUT NO explicit $/token tracking or spend limits**
- No per-call accounting to `sessions/`
- No live $ meter in the runner

**Impact:** This is a significant gap vs the plan's "hard cost controls" requirement. The implementation has resource caps (workers, time) but not spend caps.

**Recommendation:** 
1. Document this gap explicitly in E2E_PLAN.md
2. Consider whether worker caps + timeouts are an acceptable interim solution
3. Plan for $/token tracking integration (possibly via Devin CLI output parsing or provider integration)

---

### 2.3 Verification Gate Alignment

**E2E_PLAN.md (line 113):**
"Exit criteria (trust test): ... (d) stays under $5/session."

**Actual Implementation:**
The review gate (lines 556-613) correctly implements:
- Verification commands: `npm run check` and `npm test` (line 67)
- Nothing reaches Done without passing verification
- Failures block tasks and file self-repair bugs
- Fast-forward-only merge on success

**Impact:** Good alignment. The verification gate is correctly implemented.

**Recommendation:** No change needed. This is a strength.

---

## Gap 3: NORTH_STAR.md vs Implementation

### 3.1 Philosophy Alignment

**NORTH_STAR.md Principles (lines 36-43):**
1. Human is the primary decision maker
2. Cost is guarded by hardware, not hope
3. Reversibility over permission for docs
4. Agnostic & multi-project
5. Record first, synthesize later
6. Observability is mandatory

**Actual Implementation:**
1. ✅ Human decision authority: Review gate requires human/orchestrator intervention on merge conflicts or failures
2. ⚠️ Cost guarded: Worker caps exist, but $ tracking is missing (see Gap 2.2)
3. ✅ Reversibility: Git worktree isolation + commits on branches
4. ✅ Agnostic/multi-project: Per-project brain, per-board policies
5. ⚠️ Record first, synthesize later: Run records persist, but GBrain synthesis is not yet integrated
6. ✅ Observability: Run records, worker logs, Kanban comments, team-log events

**Impact:** Good philosophical alignment with two gaps: cost tracking and GBrain synthesis.

**Recommendation:** Minor update to acknowledge that swarm orchestration (L3) is already implemented and that GBrain synthesis is still pending.

---

## Recommended Doc Updates

### Priority 1: AUTONOMY_RUNNER_PLAN.md

1. **Update "One cycle" section (lines 90-106)** to reflect the 7-phase implementation:
   - Add PLAN phase (decompose planning-lane briefs)
   - Add ASSIGN phase (route via orchestration-org)
   - Add REVIEW phase (test gate + merge)
   - Add swarm roster publishing

2. **Remove outdated dispatch mechanism** (line 97):
   - Remove `hermes.dispatch({ board, max, dryRun })`
   - Document actual `taskAction` + `spawnWorker` approach
   - Add rationale: Hermes has no Devin provider

3. **Update "Current Reality" section (lines 36-41)**:
   - Mark CLI scripts as IMPLEMENTED
   - Update command surface status

4. **Expand team-log section (lines 175-183)**:
   - Add implementation details
   - Document milestone event types

5. **Add "Safety & Isolation" section**:
   - Per-project lock
   - Self-repair on infrastructure errors
   - Git worktree isolation
   - Fast-forward-only merge gate

### Priority 2: E2E_PLAN.md

1. **Add capability ladder note**:
   - Acknowledge autonomy-runner has accelerated to L3
   - Consider reframing ladder or documenting fast-track

2. **Document cost guardrail gap**:
   - Explicitly note missing $/token tracking
   - Document interim solution (worker caps + timeouts)
   - Plan for future integration

### Priority 3: NORTH_STAR.md

1. **Minor update**:
   - Acknowledge L3 (Swarm Orchestration) is implemented
   - Note GBrain synthesis is pending

---

## Conclusion

The autonomy-runner implementation is sophisticated and well-engineered, but its planning documentation has not kept pace. The system operates at L3 (Swarm Orchestration) while the docs position it at L1-L2. The most critical gap is the missing cost guardrail implementation ($/token tracking), which is a non-negotiable requirement per E2E_PLAN.md.

The recommended updates will bring the documentation in line with the implementation, ensuring future work is based on accurate architectural understanding.
