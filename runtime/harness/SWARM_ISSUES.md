# Swarm Runtime — Known Issues & Fix Plan

> **STATUS: ALL 10 ISSUES ADDRESSED (this pass).** The fixes below have been implemented and verified. Central enforcement lives in `config/cost_limits.py`; regression tests in `tests/test_cost_limits.py` (also runnable standalone). Summary of what changed:
>
> | # | Issue | Status | Where |
> |---|---|---|---|
> | 1 | Infinite-loop delegation, no dedup/cap | ✅ Fixed | `bin/harem-orchestrator` (action dedup via sha1 ids + per-cycle cap + guardrail) |
> | 2 | No enforced cost/concurrency guardrail | ✅ Fixed | `config/cost_limits.py` (enforced), wired into `launch-agent`, `harem-delegate`, `harem-orchestrator`, `herder-chat` |
> | 3 | Races on chat.log / kanban.md | ✅ Fixed | `bin/domain-room` (`append_locked` mkdir-mutex), `harem-orchestrator` (fcntl lock on kanban) |
> | 4 | Polling loop no backoff/jitter | ✅ Fixed | `bin/domain-room-watch` (jitter + exp backoff + error ceiling) |
> | 5 | Unbounded chat.log read each cycle | ✅ Fixed | `bin/harem-orchestrator` (`tail_lines` bounded read) |
> | 6 | No kill switch / heartbeat / max runtime | ✅ Fixed | `harem-orchestrator` (STOP sentinel + heartbeat + SIGTERM + `--max-runtime-hours`); CLI `cost_limits.py stop/resume` |
> | 7 | herder-chat silent paid auto-spawn | ✅ Fixed | `bin/herder-chat` (`_ensure_agent_session` consults guardrail) |
> | 8 | Reactor loop no error backoff | ✅ Fixed | `agents/reactor.py` (exp backoff + error ceiling, interruptible) |
> | 9 | No dedup of already-running delegated agents | ✅ Fixed | `bin/harem-delegate` (tmux has-session check + guardrail) |
> | 10 | Stale presence files never cleaned | ✅ Fixed | `bin/domain-room-watch` (`prune_stale_presence`, periodic) |
>
> **Verified:** guardrail logic (paid-denied / interactive-allowed / per-cycle / concurrency / hourly / kill-switch / 50-cycle credit-burn scenario all bounded); `launch-agent` non-interactively aborts a paid spawn; `append_locked` survives 500 concurrent appends with zero corruption.
>
> The original detail (kept below) describes each problem and the intended fix.

---

> **Purpose (original).** This was a self-contained work order to harden the existing swarm/orchestration runtime in this `harness/` directory. It was produced from a code-level audit triggered by a real incident: **a previous run burned all API credits.** The audit found the concrete cause.
>
> **Scope.** Read-only audit is done; this file lists what to fix. Work through it top-to-bottom (Critical → High → Medium). Each issue has a file+line reference, the problem, a concrete fix, and an acceptance test. Do not refactor beyond what's described. Reference files by relative path from the repo root (`harness/...`).

## The smoking gun (most likely cause of the credit burn)

`bin/harem-orchestrator` runs an infinite `while True` loop that, every ~30s, re-reads the last lines of `chat.log` and executes any `[ACTION] DELEGATE ...` line it finds — **with no deduplication and no cost cap**. A single delegation line that isn't cleaned up is therefore re-executed every cycle, each time `subprocess.Popen`-ing a **new separate Grok API session** (which the registry itself marks as *"AVOID - very high cost"*). Combined with the interactive credit-warning prompt being **bypassed in automated mode**, this spawns unbounded paid sessions unattended. Fix Issues #1, #2, #7 together to close this hole.

---

## CRITICAL

### #1 — Infinite-loop delegation with no dedup / no spawn cap
- **File:** `bin/harem-orchestrator` (~lines 167–303; `subprocess.Popen` ~line 269; bounded list ~line 278)
- **Problem:** `while True` re-parses recent `chat.log` lines each poll; the same `[ACTION] DELEGATE` line re-spawns agents forever. The `active_delegated_agents` list is trimmed to 10 but there is no cap on total spawns and no dedup.
- **Fix:**
  - Deduplicate actions: assign/parse a stable action id and keep a persisted `processed_actions` set; skip already-processed ids. **And/or** remove/mark the action line in `chat.log` once executed (atomically — see #3).
  - Enforce a hard **max concurrent agents** and **max spawns per cycle** before any `Popen` (see #2).
  - Replace fire-and-forget `Popen` with tracked children (record pid + agent id; reap/timeout).
- **Acceptance:** A persistent `[ACTION] DELEGATE` line results in **exactly one** spawn. A test with a stuck action line over 5 simulated cycles spawns ≤1 agent.

### #2 — No programmatic cost / concurrency guardrail
- **File:** `bin/launch-agent` (~lines 104–117, interactive `read -p` confirmation); spawn paths in `bin/harem-orchestrator`, `bin/harem-delegate`.
- **Problem:** The only protection is an interactive "type yes" prompt, which is silently skipped when spawned via `subprocess.Popen` (no stdin). Registry `api_cost: "AVOID..."` is a comment, not enforced.
- **Fix:** Add an enforced config (e.g. `config/cost_limits.py`): `MAX_CONCURRENT_AGENTS`, `MAX_GROK_RESEARCH_INSTANCES=0` (disabled by default), `MAX_SPAWNS_PER_HOUR`, optional `COST_BUDGET_PER_HOUR`. Check these in **every** spawn path and refuse (log + skip) when exceeded. Add a non-interactive `--yes`/`CEO_ALLOW_PAID=1` gate so automated spawns of paid sessions are *denied by default*.
- **Acceptance:** With defaults, an automated attempt to spawn a `grok-research` session is refused and logged; spawning is blocked once `MAX_CONCURRENT_AGENTS` is reached. Unit test covers both.

### #3 — Race conditions / no locking on shared `chat.log` and `kanban.md`
- **Files:** `bin/domain-room` (append ~line 125), `bin/domain-room-watch` (offset read ~lines 146–165), `bin/harem-orchestrator` (kanban read-modify-write ~lines 253, 376, 392, 397)
- **Problem:** Multiple processes append/read/rewrite the same files with no locking. Offset tracking desyncs; kanban read-modify-write loses concurrent edits.
- **Fix:** Centralize append + read-last-N + rewrite in one helper using `fcntl.flock` (exclusive for writes). Use a `.lock` sidecar for kanban read-modify-write. Make writes atomic (write temp + `os.replace`).
- **Acceptance:** Concurrent writer test (N processes appending) loses zero lines; concurrent kanban edits don't clobber each other.

---

## HIGH

### #4 — Polling loops: no backoff, no jitter, no error ceiling
- **File:** `bin/domain-room-watch` (~lines 142–174; fixed `time.sleep(args.interval)`)
- **Fix:** Add jitter to the base interval; exponential backoff on read errors; exit after N consecutive failures. (Same pattern applies to #8.)
- **Acceptance:** With a missing/corrupt `chat.log`, the watcher backs off and exits rather than hot-looping.

### #5 — Unbounded `chat.log` read every cycle
- **File:** `bin/harem-orchestrator` (~line 253, `read_text()` of whole file each poll)
- **Fix:** Tail-read last N lines without loading the whole file; auto-compact when size exceeds a threshold (reuse the existing `domain-room compact`).
- **Acceptance:** With a large synthetic `chat.log`, per-cycle memory/time stays bounded.

### #6 — No kill switch / heartbeat / max runtime for the orchestrator
- **File:** `bin/harem-orchestrator` (~lines 167–303)
- **Fix:** Write a heartbeat file each cycle; honor a `STOP` sentinel file and `SIGTERM` for graceful shutdown; add an optional max-runtime (`SIGALRM`).
- **Acceptance:** Creating the stop sentinel halts the loop within one cycle; heartbeat staleness is externally detectable.

### #7 — `herder-chat` auto-spawns agents with no confirmation
- **File:** `bin/herder-chat` (`_ensure_agent_session`, ~lines 724–784)
- **Fix:** Do **not** auto-spawn high-cost (`grok-*`, except `grok`) agents; require explicit confirmation/flag. Route through the #2 guardrail.
- **Acceptance:** `@grok-research ...` on a non-running agent does not silently start a paid session.

---

## MEDIUM

### #8 — Reactor loop has no error backoff
- **File:** `agents/reactor.py` (~lines 70–76) — add exponential backoff like #4.

### #9 — `harem-delegate` doesn't dedupe already-running agents
- **File:** `bin/harem-delegate` (~lines 101–114) — check registry/tmux for an existing session before `Popen`.

### #10 — Stale presence files never cleaned on crash
- **File:** `bin/herder-chat` (~lines 896–902) — periodically remove presence files older than a threshold so `who` doesn't show dead agents.

---

## Suggested order & global acceptance

1. **#2 + #1 + #7** first (closes the credit-burn hole). Then **#3** (data integrity). Then **#4/#5/#6**. Then medium items.
2. Add a `config/cost_limits.py` (or equivalent) as the single source of guardrail values; everything reads from it.
3. **Global acceptance:** an end-to-end test that simulates a stuck `[ACTION] DELEGATE` line running for several cycles results in **zero** unbounded spawning and **zero** paid sessions under default config, and the stop sentinel halts the system.

## Relationship to CEO Studio

The replacement runtime is **CEO Studio** (`~/Code/AGENT/CEO_STUDIO`, see its `E2E_PLAN.md`), which builds these guardrails in from Level 0. These fixes harden the *current* harness so it's safe to run in the interim; CEO Studio should treat each issue above as a **regression test** it must never reproduce.
