# Brain and GBrain Roadmap

**Status**: Architecture direction and implementation contract (updated for conversational planning priority)

The CEO Harness needs a persistent organizational memory layer, but it should not block on a production GBrain integration. The immediate priority is to make every meaningful event — especially the new conversational planning flows — produce clean, durable brain-ingest artifacts. GBrain, or an equivalent synthesis/query backend, can then be layered on top once the contract is clear.

**Current Focus**: The brain + early dream cycles are foundational infrastructure for the BA/Orchestrator to maintain long-term goals and for conversations (BA chat + task-focused chats + room debriefs) to result in updated living documents, roadmap, and Kanban items.

(Note: The earlier React-based multi-agent desktop prototypes that explored some of these flows have been removed to reduce duplication with the herder-native terminal tools.)

## Core Principle

Record first. Synthesize later.

The harness should preserve raw context, decisions, agent outputs, room conversations, and artifacts before attempting to flatten them into summaries. Summaries and dream-cycle outputs are derived products, not replacements for the underlying record.

This matches the larger PIPE preference: raw transcript and semantic graph data stay first-class; synthesis is useful, but should not destroy provenance.

## Relationship to Conversational Planning & BA Interface (Current Priority)

The brain is the primary mechanism that makes the following possible (as defined in the UI design plans):

- A human has a natural conversation with the BA/Project Manager.
- The BA references and renders documents during the chat.
- The BA delegates tasks from the conversation.
- The human selects a task and has a focused conversation with the involved agents (seeing requirements, DoD, testing strategy).
- Team debriefs happen where agents plan together.
- The output of those conversations reliably updates living documents, roadmap items, and Kanban tasks.

**All of the above activity must produce structured artifacts in the local brain folder.**

Dream cycles then turn that raw conversational record into:
- Proposed document updates
- Roadmap / long-term goal adjustments
- New or refined Kanban tasks
- Judgment pattern observations
- Contradictions and open questions

This is how the BA/Orchestrator can credibly "maintain the long-term goal and manage short-term goals" without everything living only in chat history.

## Short-Term Plan: Local Brain Folder as v0

The current v0 memory layer is:

```text
harness/brain/
```

It currently holds, or is intended to hold:

- chat logs
- domain room logs
- agent conversation logs
- planning artifacts
- domain context
- Kanban-linked decisions and proposals

This is enough to make the harness useful immediately. Do not wait for GBrain before building the CEO Orchestrator, domain rooms, Kanban review loop, or dream-cycle prototypes.

## Required Inputs

The following activity should flow into the brain as durable artifacts:

1. Human steering chats
   - Strategic direction
   - Corrections
   - Rejections
   - Priority shifts
   - Founder judgment signals

2. Domain-room conversations
   - Human + agent discussions
   - Open questions
   - Debrief threads
   - Team conclusions

3. Kanban decisions
   - Approved items
   - Rejected items
   - Comments and rationale
   - Links to source briefs and outputs

4. Agent outputs
   - Research briefs
   - Design proposals
   - Planning docs
   - Implementation handoffs
   - Review notes

5. Project artifacts
   - Requirements
   - UX decisions
   - Discovery-domain decisions
   - Architecture records
   - Meeting notes
   - Micro-app briefs

## Brain Artifact Contract

Every durable brain artifact should be structured enough for agents to query later without guessing.

Minimum fields:

```yaml
id: stable-or-generated-id
type: chat|room_message|decision|proposal|artifact|agent_output|dream_cycle|kanban_event
title: human-readable title
created_at: ISO-8601 timestamp if available
source:
  system: chat|domain-room|kanban|agent|manual|external-harness
  path: relative/path/or/external/url
  actor: human-or-agent-name
project: project slug, e.g. pipe-os
domain: optional domain slug, e.g. discovery
summary: short derived summary, never the only record
provenance:
  raw_refs:
    - path or message id
  related_artifacts:
    - path or id
status: draft|active|superseded|accepted|rejected
```

For JSONL event logs, use one event per line with equivalent fields.

For Markdown artifacts, put equivalent YAML frontmatter at the top when possible.

## Brain Index v1

Before wiring in GBrain, build a simple local index that agents can read.

Suggested files:

```text
harness/brain/index/
  artifacts.jsonl
  decisions.jsonl
  entities.jsonl
  open_questions.jsonl
  kanban_events.jsonl
  dream_cycles.jsonl
  founder_judgment.md
  current_strategy.md
```

Purpose:

- make the CEO Orchestrator's context-gathering deterministic
- let dream cycles write back structured findings
- avoid requiring every agent to scan the whole repository
- make future GBrain ingestion straightforward

## Dream Cycles: First Compounding Loop (High Priority for Planning Loop)

Dream cycles are the first high-value consumer of the brain and are critical for making the conversational planning system compound.

A dream cycle should periodically review recent activity (especially BA chats, task-focused conversations, and domain-room debriefs) and produce:

- What changed since the last cycle
- What the human seems to care about (founder judgment patterns)
- Key decisions made in recent conversations
- Contradictions or unresolved strategic questions surfaced in rooms or BA chat
- Stale plans or assumptions that should be revisited
- Suggested priorities for the domain
- Specific documents, briefs, or roadmap sections that should be updated (with pointers to the source conversation)
- Proposed new or refined Kanban tasks (with links back to the originating discussion)
- Gaps in current documentation or planning artifacts

Initial output location:

```text
harness/brain/dream-cycles/YYYY-MM-DD.md
```

Each dream-cycle output should also append a compact event to:

```text
harness/brain/index/dream_cycles.jsonl
```

Dream cycle outputs are intended to be surfaced directly in the multi-agent desktop (especially in the BA goal surface and as "proposed document updates" from recent conversations). They are reviewable artifacts, not automatic mutations.

## GBrain Phase 2 Role

GBrain should become the CEO Orchestrator's long-term memory and synthesis backend, not merely vector search.

It should answer questions like:

- What is the current strategy?
- What did Hans decide recently?
- What does Hans consistently reject?
- What does the Discovery domain currently believe?
- What are the unresolved strategic questions?
- What plans are stale?
- What should the CEO Orchestrator read before assigning work?

The harness already has a placeholder Docker service in:

```text
harness/docker-compose.yml
```

That placeholder is useful, but installation is not the bottleneck. The bottleneck is defining the ingest/query/writeback contract.

## GBrain Integration Contract

When a real GBrain or equivalent backend is introduced, the integration should support three capabilities.

### 1. Ingest

Input:

- raw logs
- structured JSONL events
- Markdown artifacts with frontmatter
- Kanban decisions
- dream-cycle outputs
- external harness handoff packages

Required behavior:

- preserve provenance
- preserve raw references
- identify entities and relationships
- support project/domain scoping
- avoid overwriting raw data with synthesis

### 2. Query

The CEO Orchestrator and subagents need a small set of stable query patterns:

- current strategy by project/domain
- recent decisions by project/domain
- founder judgment patterns
- open questions
- stale assumptions
- relevant artifacts for a proposed work package
- prior attempts and why they succeeded or failed

### 3. Writeback

Dream cycles and synthesis agents should be able to write back:

- updated strategy pages
- founder judgment observations
- contradiction reports
- open question lists
- proposed Kanban tasks
- suggested skill/prompt updates

Writeback should be reviewable. Strategic changes and noisy suggestions should go through Kanban rather than silently mutating core direction.

## Implementation Sequence (Aligned with Conversational Planning Priority)

**Current phase priority**: Make the brain + dream cycles support the BA/PM conversational interface and task-focused planning conversations before expanding into heavy execution features.

1. **V0 (Current)**: Continue using and improving structured Markdown/JSONL in `harness/brain/`. Ensure all new BA chat, task chat, and room debrief activity produces clean artifacts with good provenance.

2. **V1 (High priority now)**: Build the first useful dream-cycle pass focused on conversational inputs (BA chat + task conversations + domain-room debriefs). Produce reviewable outputs for document updates and Kanban suggestions.

3. **V2**: Add local brain indexes (artifacts, decisions, open_questions, dream_cycles, founder_judgment, current_strategy, etc.) so the BA and subagents can query effectively.

4. **V3**: Wire the multi-agent desktop (BA chat surface, task selection, dream cycle output panel) to read from and write to the local brain + dream cycles.

5. **V4**: Make the BA/Orchestrator (and relevant planning agents) routinely read the brain index before and during important conversations.

6. **V5**: Wire real GBrain (or equivalent) as the more powerful synthesis/query backend once the local ingestion + dream cycle value is proven.

7. **V6**: Expand requirements for subagents and external harness handoffs to produce brain-ingest-ready artifacts by default.

8. **V7**: Let mature dream cycles propose broader improvements (skill updates, prompt refinements, cross-domain awareness) with appropriate review gates.

## Non-Goals for Now

- Do not block harness usability on a full GBrain deployment.
- Do not flatten raw transcripts into summaries only.
- Do not require perfect ontology design before recording useful artifacts.
- Do not let synthesis silently erase provenance.
- Do not make GBrain the only place where data exists; the local brain folder remains the portable source layer.

## Immediate Next Build Target

Build the smallest useful loop that supports the conversational planning priority:

1. Make BA chat, task-focused chat, and room debriefs write meaningful, structured events into `harness/brain/`.
2. Generate a simple local brain index.
3. Run the first dream-cycle pass over recent conversational activity.
4. Surface the dream-cycle output in the multi-agent desktop (proposed document updates, Kanban suggestions, contradictions, judgment signals).
5. Close the loop: human reviews and approves → documents and roadmap are updated with clear provenance back to the source conversations.

This loop makes the conversational BA/PM experience actually compound instead of just accumulating chat history.

**Key flow diagram**: Earlier visual explorations lived in the (now removed) React multi-agent desktop prototypes. The core flows are now expressed through domain rooms + herder tools.

## Related Design Work

See the following documents for how the brain and dream cycles integrate with the human interface:

- The earlier React UI prototype work (multi-agent-desktop + room-chat) has been removed to eliminate duplication. Focus has shifted to herder-native terminal tools (`herder-chat`, `herder-steer`, domain rooms + presence).
