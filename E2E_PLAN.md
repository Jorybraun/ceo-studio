# CEO Studio — End-to-End Plan

> Read `NORTH_STAR.md` first. This document is the concrete, sequenced build plan.
> CEO Studio is the **agnostic runtime + UI + guardrail layer** that realizes the `harness/` vision, built as a capability ladder (L0 → L4).

---

## 0. Orientation

### The thesis
The `harness/` already contains the strategy (CEO orchestrator, domains, brain, delegation, dream cycles, gstack/GBrain). CEO Studio supplies what's missing: a **real agent runtime**, a **human interface**, and **hard cost guardrails**. We build the smallest valuable thing first (a Document Agent), prove it on trust and cost, then climb toward domain swarms.

### Cross-cutting pillars (present at every level)
1. **Context & Memory (the Brain)** — how the agent knows the project without re-explanation. *Primary design focus.*
2. **Tools** — the concrete capabilities the agent can invoke (read, scan, diff, edit, commit, delegate).
3. **Cost Guardrails** — hard caps, live meter, kill switch, budget-gated spawning.
4. **Agnostic / Multi-project / Multi-domain** — mounts any repo, discovers domains, per-project memory.
5. **Human decision authority** — review/approval surface (Kanban-style) for anything strategic.
6. **Observability** — every action, token, and file change is inspectable.

### Tech baseline
- **Shell:** Electron (agnostic desktop app, native file access, no server).
- **Runtime:** Node.js + TypeScript in the main process; agent loop here.
- **UI:** renderer process — project/domain switchers, red presence circle, two agent-controlled panels, visual libs (marked / mermaid / highlight.js) via CDN, Tailwind.
- **CEO model path:** conversational CEO chat goes through Hermes (`main/core/hermes.js` -> `hermes chat -q`) using the funded `openai-codex` provider via OAuth. Do not wire raw OpenAI/Anthropic API keys as the CEO.
- **Utility model path:** optional document-agent/utility providers may use `main/core/llm.js`, but that path is separate from the conversational CEO.
- **Memory:** local brain folder per project (harness brain contract); GBrain optional at L3+.
- **Git:** every autonomous doc edit is a commit on a working branch.

---

## 1. The Brain (Context & Memory) — designed once, used everywhere

This is the spine. It is the reason the agent doesn't need re-explanation, and it is reused unchanged from the harness contract.

### Per-project layout
```
~/.ceo-studio/<project-slug>/brain/
  index/
    artifacts.jsonl        # documents & their summaries
    decisions.jsonl        # approved/rejected items + rationale
    open_questions.jsonl   # unresolved strategic questions
    contradictions.jsonl   # detected doc/code/plan conflicts
    entities.jsonl         # domains, files, people, systems
    dream_cycles.jsonl     # synthesis pass outputs (L2+)
  current_strategy.md      # synthesized "what is true now"
  founder_judgment.md      # patterns in what the human accepts/rejects (L2+)
  conversations/           # raw chat transcripts (record-first)
  sessions/                # per-session cost + action logs
```

### Artifact contract (from harness `BRAIN_AND_GBRAIN_ROADMAP.md`)
```yaml
id: stable-or-generated-id
type: chat|decision|proposal|artifact|agent_output|dream_cycle|contradiction
title: human-readable title
created_at: ISO-8601
source: { system, path, actor }
project: <slug>
domain: <optional domain slug>
summary: short derived summary (never the only record)
provenance: { raw_refs: [...], related_artifacts: [...] }
status: draft|active|superseded|accepted|rejected
```

### How the agent loads context (every session)
1. Resolve current **project + domain**.
2. Read `current_strategy.md` + relevant `index/*.jsonl` (deterministic, cheap — no full-repo scan).
3. Pull only the artifacts relevant to the request (by domain + entity).
4. Keep raw transcripts appended to `conversations/`; synthesis is derived later.

**Principle:** record first, synthesize later. The index makes context-gathering deterministic and cheap (also keeps cost down).

---

## 2. Cost Guardrails — enforced from L0

Directly answers the credit-burn incident; fills the harness's acknowledged "Current Gap."

- **Hard caps:** `$X / session`, `$Y / day` (defaults $5 / $20). On breach → agent halts, UI shows it, requires explicit human resume.
- **Live meter:** tokens + $ per session shown next to the red circle at all times.
- **Kill switch:** one control stops all agent activity immediately.
- **Budget-gated spawning (L3):** an agent may only spawn another agent if it is *allocated* budget from the session pool. No allocation → no spawn. No recursion without budget.
- **Cost-aware routing (L3):** cheap models (Kimi) for breadth; strong model only for synthesis/final proposals.
- **Per-action accounting:** every model call logged to `sessions/` with model, tokens, $, duration.

---

## 3. Level-by-level plan

Each level lists: **Goal · Agent capabilities · Tools · Context/Memory · Guardrails · UI · Exit criteria.**

### L0 — Foundation (agnostic shell + brain + cost meter)
- **Goal:** A running Electron app that can mount any project, discover its domains, initialize a brain, and display the cost meter. No autonomy.
- **Agent capabilities:** none yet (plumbing only).
- **Tools:** `openProject(folder)`, `detectDomains(path)`, `readFile`, `listFiles`, brain read/write helpers.
- **Context/Memory:** create per-project brain skeleton; index existing docs into `artifacts.jsonl`.
- **Guardrails:** cost meter + hard-cap config + kill switch wired (even with no agent, the harness exists).
- **UI:** project switcher, domain switcher, red circle (idle), two empty panels, meter.
- **Exit criteria:** Open two different projects (e.g. CEO_STUDIO and PIPE-OS); domains auto-detected; brain folders created; meter visible.

### L1 — Document Agent (the wedge) ⭐
- **Goal:** A single agent that keeps a project's documentation coherent, **editing docs autonomously** with every change as a reviewable git commit.
- **Agent capabilities:**
  - Load project+domain context from the brain.
  - **Detect contradictions/drift** across docs, code references, and plans (files referenced that don't exist; conflicting claims; stale assumptions).
  - **Edit docs autonomously** on a branch; commit each change with a clear message; record a `decision`/`artifact` to the brain.
  - Explain its reasoning in the chat panel; show diffs in the other panel.
- **Tools:** `readFile`, `listFiles`, `grepRepo`, `writeFile`, `gitCommit`, `gitBranch`, `brainWrite`, contradiction-scan. (Skills from `harness/skills` / gstack inform *how* it analyzes.)
- **Context/Memory:** reads brain index; writes contradictions to `contradictions.jsonl`, edits to `artifacts.jsonl`.
- **Guardrails:** hard cost cap; **git branch = undo**; no spawning; no network beyond model API.
- **UI:** Panel A = file/diff view (editable, "commit" button); Panel B = 2-way chat stream; red circle pulses while working.
- **Exit criteria (trust test):** On PIPE-OS, the agent (a) loads context with zero re-explanation, (b) surfaces real contradictions in `knowledge/`, (c) makes a correct doc fix as a clean commit, (d) stays under $5/session. If yes → trust established; proceed.

### L2 — CEO Manager (single strategic agent across domains)
- **Goal:** One agent that reasons across *all* domains, produces **work packages**, runs the human review loop, and runs the first **dream cycle**.
- **Agent capabilities:**
  - Cross-domain situational awareness (reads strategy + open questions + recent decisions).
  - Produce **work packages** (scoped, with acceptance criteria) instead of just edits.
  - Run a **dream cycle**: summarize what changed, founder-judgment patterns, contradictions, stale plans, suggested priorities → write to brain + propose tasks.
  - Maintain `current_strategy.md` and `founder_judgment.md`.
- **Tools:** all L1 tools + `createWorkPackage`, `kanbanWrite`, `dreamCycleRun`, `brainSynthesize`.
- **Context/Memory:** full brain index; dream-cycle outputs to `dream_cycles.jsonl`.
- **Guardrails:** dream cycles run on a schedule/manual trigger with their *own* budget; still single agent (no swarm).
- **UI:** Kanban-style review panel (approve/deny/comment); domain switcher drives focus; dream-cycle report view.
- **Exit criteria:** Produces a useful weekly dream-cycle report on PIPE-OS; generates ≥1 work package the human approves; strategy doc stays current automatically.

### L3 — Swarm Orchestration (delegation, per domain)
- **Goal:** The CEO Manager delegates work — cheap subagent think-tanks for breadth, external harnesses for depth — under hard budgets.
- **Agent capabilities:**
  - **Path A — Subagent think-tank:** spawn cheap (Kimi) subagents for parallel research; they return *proposals*, not raw data; high observability.
  - **Path B — External harnesses:** structured handoff to **Hermes** (planning/research swarms) and **Overstory** (code), then ingest results.
  - Per-domain swarms; activation via a structured `ACTIVATE_AGENT` protocol (from harness `AGENT_ORCHESTRATION_PLAN.md`).
  - Leverage **gstack/GBrain** skills and synthesis.
- **Tools:** all L2 tools + `spawnSubagent(budget)`, `delegateToHermes`, `delegateToOverstory`, `gbrainQuery`, `gbrainIngest`.
- **Context/Memory:** GBrain (optional) as synthesis/query backend; subagent outputs become brain-ingest artifacts.
- **Guardrails (critical):** **budget-gated spawning** — a subagent runs only with an allocated slice of the session pool; concurrent-agent cap; cost-aware model routing; global kill switch halts the whole swarm. This is the exact failure mode of the credit burn, now hardware-enforced.
- **UI:** swarm view (live subagents, their model, token spend, status); per-domain panels; proposals flow into the Kanban review loop.
- **Exit criteria:** On one domain (e.g. Discovery), CEO dispatches a 3-subagent think-tank that returns approved proposals, total spend stays within an explicit budget, and the kill switch demonstrably stops everything.

### L4 — Self-improvement
- **Goal:** The system compounds: dream cycles enrich the brain and refine skills/prompts; optionally CEO Studio proposes PRs against its own repo.
- **Agent capabilities:** detect weak skills/prompts and propose improvements; optional self-PR with human review (mirrors harness `OWN_REPO_AND_SELF_PR.md`).
- **Guardrails:** self-changes are PRs (human-reviewed), never silent; budgeted.
- **Exit criteria:** A dream cycle produces a concrete, accepted improvement to a skill or the strategy doc without human prompting.

---

## 4. Sequencing & milestones

| Milestone | Level | Outcome | Gate to proceed |
|---|---|---|---|
| M0 | L0 | App mounts any project, brain + meter live | Two projects open cleanly |
| M1 | L1 | Document Agent edits docs via commits, finds real contradictions | Trust + cost test passes |
| M2 | L2 | CEO Manager: work packages + first dream cycle + Kanban review | Human approves a generated work package |
| M3 | L3 | Budget-gated subagent think-tank on one domain | Kill switch + budget proven under load |
| M4 | L4 | First self-proposed improvement accepted | — |

**We start at M0 → M1.** Everything past M1 is gated on the Document Agent earning trust.

---

## 5. Proposed repository shape (agnostic)

```
CEO_STUDIO/                      # ships as an app; mounts external projects
  main/                          # Electron main (Node/TS) — the runtime
    index.ts                     # app + IPC
    agent/                       # the CEO agent loop (L1→)
      agent.ts
      context.ts                 # brain load/save (Section 1)
      tools.ts                   # read/scan/diff/edit/commit/delegate
      cost.ts                    # meter, caps, kill switch (Section 2)
      skills/                    # loaded from harness/gstack
    projects/                    # project + domain discovery, registry
  renderer/                      # UI: switchers, red circle, panels, meter
  ~/.ceo-studio/<project>/brain/ # per-project memory (outside the app)
```

Project memory and config live **outside** the app dir (`~/.ceo-studio/<project>/`) so the runtime stays agnostic and projects stay isolated.

---

## 6. Open questions to resolve before/within each level

- **L1:** Which contradiction classes first? (missing-file refs and conflicting claims are the cheapest, highest-value start.) Branch-per-session or single working branch?
- **L2:** Dream-cycle cadence and budget? What exactly is a "work package" in our Kanban?
- **L3:** Do we run our own subagents *and* hand to Hermes, or Hermes-only first? Is GBrain in scope at L3 or deferred?
- **All:** Default model + the exact $ caps you want baked in as defaults.

---

## 7. What this plan deliberately defers

- The fancy agent-controlled panel/component contract → not needed to prove L1; revisit at L2/L3 when the UI must show richer artifacts.
- GBrain, gstack-wide curation, self-PR → L3/L4, after trust + cost are proven.
- ~~Voice (Eleven Labs) → after the text loop is solid.~~ **Done (Phase 2).** Two voice paths exist, both ElevenLabs:
  - **Live voice agent (primary)** — ElevenLabs Conversational AI in `main/core/convai.js`: main creates/reuses a "CEO Studio" agent and hands the renderer a short-lived **signed URL** (key never leaves main); the renderer (`renderer/convai.js`, `@elevenlabs/client`) runs the real-time session (ASR + agent LLM + TTS + barge-in). Guardrail: hard `max_duration_seconds` on the agent + a renderer countdown + the global kill switch end the call (this is a per-minute cloud cost, so the cap is mandatory).
  - **One-shot TTS/STT** — `main/core/voice.js` (`voice:speak|listen`), metered via `CostMeter.recordVoiceUsage` (char-based TTS / time-based STT) under the same hard caps.
  - Offline-safe: with no `ELEVENLABS_API_KEY`, both disable and text still works.

The discipline: **prove the Document Agent is trustworthy and cheap, then climb.**

---

## 8. Implementation notes for Devin (model-agnostic)

This plan is written so a cloud Devin session — **on any underlying model** — can implement it without access to this conversation. Guidelines for whoever (or whatever) builds this:

### Ground rules
- **Self-contained tasks.** Each milestone (M0–M4) is independently shippable with explicit *exit criteria* (Section 3 & 4). Do not start a milestone until the previous one's exit criteria pass.
- **Reference by relative path.** This repo is `CEO_STUDIO/`. The vision/strategy assets it reuses live in the sibling repo at `PIPE/PIPE-OS/harness/` (personas, skills, brain contract, domain model). Never hardcode absolute machine paths in code; take project paths as runtime input (the app *mounts* projects).
- **Two docs are law.** `NORTH_STAR.md` (why) and this file (what/how). If reality forces a change, **edit these docs in the same PR** — never let code and plan drift.
- **No model-specific assumptions.** Talk to the model via a thin provider interface (`LLMProvider` with `complete()` / `stream()`); the model/provider is config, not code. The plan must work whether the CEO model is Claude, GPT, or other.

### Hard requirements that must exist before ANY autonomy (M1+)
These are non-negotiable and exist *because a previous swarm burned all its credits*:
1. **Hard spend caps** (`$/session`, `$/day`) enforced in `main/agent/cost.ts`. On breach → halt + require human resume. Defaults: $5 / $20 (make them config).
2. **Per-call accounting** — every model call records `{model, tokens_in, tokens_out, usd, duration}` to `~/.ceo-studio/<project>/brain/sessions/`.
3. **Live meter + kill switch** in the UI, wired before the agent can edit anything.
4. **No unbounded loops.** Any polling/orchestration loop has a max-iteration or max-wall-clock bound and backoff. No `while(true)` without an exit + budget check.
5. **No un-budgeted spawning (M3).** An agent may spawn another only by drawing from an allocated budget slice; zero allocation → spawn is refused. Enforce a concurrent-agent cap.

> Before building M3 (swarms), **read `../PIPE/PIPE-OS/harness/SWARM_ISSUES.md`** — it catalogs the concrete failures of the previous swarm runtime. Treat each one as a regression test: the new runtime must not reproduce it.

### Suggested build order for a cloud agent
1. **M0 / L0** — Electron shell, `LLMProvider` interface, project mount + domain detect, Brain skeleton (Section 1), `cost.ts` meter + caps + kill switch. *No autonomy.* Verify by opening two different projects.
2. **M1 / L1** — Document Agent: context-load from Brain, contradiction scan (start with two classes: references-to-missing-files, and conflicting claims), autonomous doc edit → commit on a branch, write artifacts/contradictions to Brain. Verify against the L1 exit criteria on the PIPE-OS project.
3. **M2 / L2**, **M3 / L3**, **M4 / L4** — only after the prior gate passes.

### Definition of done per PR
- Exit criteria for the targeted milestone are demonstrably met.
- Cost guardrails are active and tested (include a test that simulates breaching the cap and asserts the agent halts).
- Authoritative docs are updated in the same change. Run `npm run docs:check` or `npm run check`. For docs handoff rules, see `runtime/harness/architecture/DOCS_STEWARDSHIP_AND_HANDOFF.md`.
- `NORTH_STAR.md` / `E2E_PLAN.md` updated if scope changed.
- No absolute paths, no model-specific code outside the provider layer.
