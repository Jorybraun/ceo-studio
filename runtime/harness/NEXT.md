# Immediate Next Steps (Post Conversation)

## Done in this session
- Old agent-harness archived and disregarded.
- New harness/README.md updated with current philosophy.
- DESIGN.md created capturing CEO-level + Kanban + selective involvement + portability.
- CEO Orchestrator persona defined.
- Kanban Review + Selective Conversation workflow documented.
- PORTABILITY.md added.

## Recommended Next Execution Items

1. **CEO Orchestrator v0 definition**
   - Flesh out how the CEO Orchestrator actually maintains holistic context.
   - Make the orchestrator read from the local brain/index before proposing work.
   - Define what state it keeps directly vs what it queries from the brain.

2. **Brain / GBrain v0 contract**
   - Treat `harness/brain/` as the immediate v0 memory source layer.
   - Do not block on a full GBrain deployment.
   - Implement the artifact/event contract from `architecture/BRAIN_AND_GBRAIN_ROADMAP.md`.
   - Ensure raw logs and transcripts remain first-class; synthesis is derived, not destructive.

3. **First dream-cycle loop**
   - Build a small command or script that reads recent chat logs, room logs, agent outputs, and Kanban decisions.
   - Produce `brain/dream-cycles/YYYY-MM-DD.md` with:
     - what changed
     - founder judgment signals
     - decisions made
     - contradictions / unresolved questions
     - stale assumptions
     - suggested priorities
     - proposed Kanban tasks
   - Append a compact event to `brain/index/dream_cycles.jsonl`.

4. **Local brain index**
   - Create `brain/index/` with initial JSONL or Markdown indexes:
     - `artifacts.jsonl`
     - `decisions.jsonl`
     - `entities.jsonl`
     - `open_questions.jsonl`
     - `kanban_events.jsonl`
     - `dream_cycles.jsonl`
     - `founder_judgment.md`
     - `current_strategy.md`

5. **First minimal work package format**
   - Define the concrete shape of something that appears in Kanban for the human to approve/deny.
   - Include source refs into `brain/`, acceptance criteria, validation requirements, and decision rationale fields.

6. **Communication bus sketch**
   - How do agents actually talk to each other in an inspectable way?
   - Start with structured logs + domain rooms + future mail bus.
   - Ensure every important message can be ingested into the brain.

7. **Portability spike**
   - Create or refine Docker/package structure so the harness is external and mounts target projects.
   - Preserve the local brain folder as a portable source layer while allowing future GBrain integration.

8. **Discovery domain pilot (light)**
   - Using the new structure, have the CEO Orchestrator + discovery team produce the first real work package for "Raw Transcript as Primary Artifact" and surface it for review.
   - Store the pilot's raw discussion, proposal, decision, and dream-cycle reflection in the brain.

## Principle
Keep moving fast on making this system actually usable for the founder to review real strategic work, rather than just more scaffolding.
