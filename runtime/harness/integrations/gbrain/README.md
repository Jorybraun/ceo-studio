# GBrain Integration

**Status**: Phase 2 integration. The local brain + dream cycles layer is the active priority. Real GBrain wiring comes after the contract is proven.

This folder defines the future thin adapter between the CEO Harness and GBrain (or an equivalent persistent organizational brain).

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
