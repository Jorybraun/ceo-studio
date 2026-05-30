# Integrating A2A (Agent2Agent Protocol) into the Herder

**Link:** https://github.com/a2aproject/A2A  
**Status:** Analysis for PIPE-OS herder (May 2026)

## Why This Matters for Us

The user explicitly wants to avoid reinventing wheels for agent-to-agent communication and orchestration, while still building a powerful "Chat Orchestrator" inside the herder that can launch and manage swarms of persona-driven agents.

A2A is the emerging open standard (led by Google + partners) for exactly this: structured, interoperable communication between independent AI agents.

It is a natural fit and a much smarter long-term foundation than a fully custom herder_mail protocol.

## Core A2A Concepts (Quick Map to Herder)

| A2A Concept       | Herder Equivalent / Adaptation                                                                 | Notes |
|-------------------|-----------------------------------------------------------------------------------------------|-------|
| **Agent Card**    | Extension of our Agent Registry entry + persona definition                                    | Public discovery document (capabilities, skills/persona, endpoint, auth). We can generate one per launched persona agent. |
| **Task**          | Natural mapping to "work item" coming from Kanban or orchestrator delegation                  | Stateful, with status (submitted, working, completed, failed, canceled). Supports long-running + human-in-loop. |
| **Message**       | Can flow through domain room (visible) **and/or** structured herder_mail (machine)            | role: user/agent, parts (text, file, data). |
| **Artifact**      | Output from a specialist agent (report, spec, code, graph, etc.)                              | Returned as part of Task completion. |
| **Streaming (SSE)** | Real-time updates from agents into the domain room or dashboard feed                        | Excellent for live visibility in herder-dashboard. |
| **Push Notifications** | Webhook-style delivery from long-running agents                                            | Useful for agents that aren't constantly polling the room. |
| **JSON-RPC / gRPC / HTTP** | Transport layer                                                                 | Our domain rooms are currently a shared log bus. We can add A2A HTTP endpoints as a parallel structured channel. |

## Recommended Integration Strategy (Herder-Native, Not Reinventing)

**Do not** throw away domain rooms. They remain the **human-visible, auditable, shared coordination layer** (core herder principle).

**Do** adopt A2A as the **machine-to-machine structured protocol** between the Chat Orchestrator and specialist persona agents.

### Concrete Path

1. **Make the Chat Orchestrator an A2A Client + Server**
   - It can discover other A2A agents via Agent Cards.
   - It can send Tasks to specialist agents that expose A2A endpoints.
   - It can receive updates via streaming or push.

2. **Make persona agents A2A-capable (via adapters)**
   - For agents running via our `domain-room-watch` + external runtimes (Grok CLI, etc.): Wrap them with a small A2A server adapter.
   - The adapter translates between A2A Tasks/Messages and our current room + herder_mail.
   - This gives us Overstory-style structured coordination while keeping the room as the human window.

3. **Use domain rooms for visibility + A2A for precision**
   - High-level status, decisions, and human-relevant discussion stay in the visible domain room (and show up in herder-dashboard).
   - Detailed task delegation, intermediate artifacts, and heavy back-and-forth use A2A (typed, stateful, streamable).
   - The Chat Orchestrator can bridge: important A2A events are summarized/posted into the room.

4. **Agent Cards as extension of our registry + personas**
   - An agent's Agent Card can declare its persona, skills, supported input/output modalities, and A2A endpoint.
   - This makes the registry more powerful for discovery (both by the orchestrator and potentially external systems later).

5. **Leverage existing herder_mail work**
   - herder_mail.py can evolve to be A2A-message compatible (or act as a local transport that can gateway to full A2A HTTP).

## Benefits

- We get a battle-tested, community-driven protocol for the hard parts of A2A (task lifecycle, streaming, artifacts, security model) instead of inventing our own.
- Future interoperability: Our persona agents could eventually talk to agents built on other frameworks that also speak A2A.
- Aligns perfectly with the "steal good patterns from Overstory" goal — Overstory-style orchestration on top of an open A2A communication substrate.
- Still honors the herder principles (visibility via domain rooms, Kanban as source of truth, registry as canonical agent definition).

## Risks / Considerations

- A2A is still relatively young (1.0-ish as of mid-2026 in this timeline). We should treat it as a strong direction rather than a frozen standard we must comply with 100% on day one.
- We need to decide the exact boundary: When does something go through the visible room vs. pure A2A machine channel?
- For pure internal herder swarms, the current herder_mail + domain room combo may be "good enough" for a while. A2A becomes the upgrade path for more advanced coordination and external interoperability.

## Recommended Next Steps

1. **Short term (now):** Treat herder_mail as our internal "A2A-like" transport while we study the real A2A spec and SDKs.
2. **Medium term:** Add an `A2A adapter` in `herder-overstory/` that can wrap a persona agent (watcher + runtime) and expose it as an A2A server.
3. Make the Chat Orchestrator itself A2A-capable (so it can talk A2A to specialists and still post human-visible updates to the room).
4. Generate basic Agent Cards from the agent registry + persona definitions.
5. Update the herder-dashboard to understand A2A Tasks/Messages (in addition to raw room chat).

This is the cleanest way to get Overstory-level swarm orchestration power without building a closed, custom communication system from scratch.

---

**For the Chat Orchestrator specifically:** It should be designed from the start as an A2A participant (client + server). This future-proofs the whole communication layer.
