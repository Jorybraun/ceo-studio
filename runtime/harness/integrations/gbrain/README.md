# GBrain Integration

**Status**: Phase 2 integration. The local brain + dream cycles layer is the active priority. Real GBrain wiring comes after the contract is proven.

This folder defines the future thin adapter between the CEO Harness and GBrain (or an equivalent persistent organizational brain).

## CEO Studio Wiring — Current, Live Setup (stock gbrain)

This is how the project actually connects to the brain today. **gbrain itself is
100% stock and untouched** (`~/Code/AGENT/gbrain`, upstream `garrytan/gbrain`,
clean tree). Everything below is integration glue in CEO Studio + gbrain's own
config set via gbrain's own CLI.

### Engine: Postgres + pgvector (not embedded PGLite)
- **Why**: "every provider connects to the brain" is concurrent, but stock
  PGLite is **single-writer** (one process holds the data-dir lock). gbrain's
  stock **Postgres engine** allows true concurrent connections — many agents +
  the cockpit at once. This is gbrain's own documented path for multi-client use.
- **DB**: a stock `pgvector/pgvector:pg17` Docker container (`ceo-gbrain-pg`,
  `localhost:5432`, db/user/pass `gbrain`). Both the cockpit and Devin agents run
  natively on the host, so a port-mapped Postgres is all they need.
- **Selected via**: stock `gbrain init --url postgres://gbrain:***@localhost:5432/gbrain`,
  which writes `engine: postgres` + `database_url` into `~/.gbrain/config.json`.
  The previous PGLite config is backed up at `~/.gbrain/config.json.pglite.bak`.
- Note: stock PGLite currently aborts on macOS 26.x (Bun WASM, upstream issue
  #223) **only when reopening a corrupted data dir** — fresh PGLite dirs work.
  The Postgres engine sidesteps this entirely and adds concurrency.

### How every provider/agent connects
- **Launcher**: `runtime/harness/bin/gbrain-mcp` — a committed, secret-free
  wrapper that mirrors `~/.gbrain/serve-mcp.sh` (puts Bun on PATH, keeps a stray
  `DATABASE_URL` from overriding the engine, resolves the Google embedding key
  at runtime) and then `exec gbrain serve` (stock stdio MCP). The engine
  (Postgres) comes from `~/.gbrain/config.json`.
- **Devin agents**: `.devin/config.json` (committed, project scope) registers
  `gbrain` as a stdio MCP server pointing at the launcher. Devin reads
  `mcpServers` from project config, so **every Devin agent working in this repo
  auto-connects to the shared brain** — no per-agent setup, no OAuth. Because the
  engine is Postgres, each agent's own `gbrain serve` connects concurrently.
- **Cockpit + room loop**: unchanged — they use the gbrain CLI bridge
  (`main/core/gbrain.js`) / `agents/gbrain_memory.py`, which now hit Postgres via
  the same `~/.gbrain/config.json`.

### Provisioning when a project opens
`main/core/gbrain.js` exposes `ensureProjectWiring(projectPath)`, called from
`openProjectSession` in `main/index.js`. On open it (idempotently,
non-destructively) ensures `.devin/config.json` has the `gbrain` MCP entry when
the project ships the launcher, then fire-and-forget probes `gbrain.status()` and
logs whether the brain is reachable. It does **not** manage the Docker container
(DB bring-up stays explicit). The gbrain entry is committed, so the wiring is
"part of the project" and present the moment the repo is opened.

### One-time DB setup (fresh machine)
```bash
docker run -d --name ceo-gbrain-pg -e POSTGRES_USER=gbrain -e POSTGRES_PASSWORD=gbrain \
  -e POSTGRES_DB=gbrain -p 5432:5432 -v ceo_gbrain_pgdata:/var/lib/postgresql/data \
  --restart unless-stopped pgvector/pgvector:pg17
docker exec ceo-gbrain-pg psql -U gbrain -d gbrain -c "CREATE EXTENSION IF NOT EXISTS vector;"
gbrain init --url "postgres://gbrain:gbrain@localhost:5432/gbrain"   # stock; writes ~/.gbrain/config.json
```

## Current Architecture Decision

1. `harness/brain/` is the v0 memory source layer (active now).
2. All meaningful activity — especially the new BA/Project Manager conversations, task-focused chats, and domain-room debriefs — must produce clean, provenance-rich artifacts here first.
3. Dream cycles run over the local brain and produce synthesis (document updates, roadmap signals, Kanban proposals, judgment patterns, contradictions).
4. Local indexes are built so agents and the BA can query deterministically without scanning everything.
5. GBrain (or equivalent) is introduced later as a more powerful synthesis + query backend, once we know exactly what we need to ingest and what value the dream cycles deliver.

**Do not block current work** (conversational planning UI, BA chat, task-contextual conversations, early dream cycles) on a full GBrain deployment.

See the primary source of truth:

- `../../architecture/BRAIN_AND_GBRAIN_ROADMAP.md` (updated roadmap)
- `../../architecture/SELF_IMPROVEMENT_AND_DREAM_CYCLES.md`
- The earlier React multi-agent desktop prototypes (which explored brain-backed conversational flows) have been removed in favor of herder-native tools.

## Integration Responsibilities (Future Thin Adapter)

When we introduce a real GBrain adapter, it should provide:

- **Ingest**: Clean ingestion of local brain artifacts, JSONL events, and Markdown with frontmatter (especially conversational artifacts from BA chat and task rooms).
- **Scoped Query**: Rich queries by project, domain, artifact type, decision, entity, time range, and provenance. The BA/Orchestrator and planning agents will be heavy consumers.
- **Synthesis Support**: Ability to run or trigger deeper synthesis jobs (beyond the local dream cycles) while preserving provenance.
- **Writeback**: Safe writeback of dream-cycle outputs, founder judgment observations, document update proposals, and long-term goal adjustments — with review gates.
- **Portability**: Easy export back to the local `harness/brain/` format so the harness never becomes dependent on an external brain.

## Minimum API Shape (Conceptual)

The harness should depend on a small, stable set of operations. Exact signatures will be refined once the local brain + dream cycle loop is working:

```text
# Ingestion
ingest_artifact(artifact_path, metadata)
ingest_conversation_events(domain, events_jsonl)   # especially from BA/task chats

# Query (what the BA and agents will actually call)
query_context(project, domain, natural_language_question, filters?)
get_long_term_goals(domain)
list_decisions(project, domain, since?)
list_open_questions(domain)
get_artifacts_for_task(task_id)
get_founder_judgment_patterns(domain)

# Writeback (from dream cycles / synthesis)
write_synthesis(domain, synthesis_type, content, provenance)
propose_document_updates(domain, proposals)
propose_kanban_items(domain, tasks)
```

## Safety & Product Rules

- Raw conversational records and artifacts remain first-class. GBrain must never be the only copy.
- Every synthesis output must carry strong provenance back to the source conversations or artifacts.
- Strategic or high-impact writebacks (long-term goals, major roadmap changes, document rewrites) must be reviewable through Kanban or explicit BA approval.
- GBrain is the **CEO Orchestrator / BA’s long-term memory and synthesis engine**, not a generic vector store or chat memory.
- The local `harness/brain/` folder + early dream cycles must deliver real value on their own before we invest heavily in the GBrain adapter.

## First Concrete Adapter: Live Room Memory

The first real (narrow) slice of this contract is implemented for live rooms:

- `agents/gbrain_memory.py` — a thin CLI bridge (`GBrainMemory`) that mirrors the
  cockpit's Node bridge (`main/core/gbrain.js`) and exposes `capture()` (ingest a
  room message, fire-and-forget) and `recall()` (semantic query, short-timeout).
- `agents/room_loop.py` uses it to **capture every turn** (human + agent) and
  **recall relevant context per turn**, injecting it ahead of the agent's prompt.
- This AUGMENTS, never replaces: the raw `brain/rooms/<room>/chat.log` stays the
  first-class record (gbrain is never the only copy), and provider sessions still
  carry tight in-conversation continuity. gbrain adds durable, shared,
  cross-room/long-term recall.
- Safety: if the `gbrain` CLI is missing or unhealthy, `available()` is False and
  all calls become silent no-ops — the room runs exactly as before. Disable
  explicitly with `bin/agent room --no-gbrain`.
- Context ceiling: recalled context is bounded twice — `--gbrain-limit` caps the
  number of results, and `--gbrain-ceiling` (default 4000 chars, 0 = no cap) is a
  hard character budget on the recalled block injected per turn. The cap trims on
  a line boundary and appends a truncation marker, so the shared brain can never
  balloon an agent's context window.

This stays within the rule that gbrain is "the long-term memory and synthesis
engine": room turns are durable conversational artifacts, not transient scratch.

## Current State (as of this document)

- Active work is happening on the local `harness/brain/` folder + early dream cycles.
- The earlier multi-agent desktop prototypes (which explored brain-backed conversational flows) have been removed. Focus is now on herder-native domain rooms and terminal tools.
- The Docker placeholder for GBrain exists in `docker-compose.yml` but is not yet wired.
- The integration contract above is intentionally high-level until we have real usage data from the local brain + dream cycle loop.

## Next Steps for This Integration

1. Let the local brain + first dream cycles stabilize while supporting the BA conversational planning flows.
2. Gather real usage patterns of what the BA and planning agents actually query for.
3. Refine the API shape above based on that usage.
4. Then implement the thin adapter + switch the backend for synthesis-heavy queries to real GBrain.
