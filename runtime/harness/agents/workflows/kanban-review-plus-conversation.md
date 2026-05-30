# Workflow: Kanban Review + Selective Conversation Involvement

## Goal

Give agents high agency while keeping the human in control through a clean review loop, with the ability to jump into the actual thinking process when it matters.

## Primary Flow (Default Mode)

1. Agents (Domain teams + CEO Orchestrator) do real work.
2. They prepare a **work package** and surface it in the Kanban (Triage or appropriate column).
3. Human reviews the package.
4. Human takes one of these actions:
   - **Approve** → Work moves forward (tasks created, agents can execute or continue).
   - **Deny + Reason** → Package is rejected with clear feedback. Agents must address the feedback before resubmitting.
   - **Comment / Request Changes** → Package stays in review. Agents revise and resubmit.

This is the main control surface. Most interaction should happen here.

## Secondary Flow (Selective Deep Involvement)

When the human wants to be involved in the actual thinking:

- They can enter a specific conversation thread or agent discussion (via future UI / logs / chat interface).
- They inject thoughts, constraints, vision, or corrections directly into the conversation.
- The agents incorporate this input.
- The final output still comes back through the Kanban for formal approval.

This mode is expected to be used more heavily in the beginning (while agents are learning the founder's specific judgment about the application) and less over time.

## Work Package Contents (Minimum)

When something is surfaced for review, it should generally include:

- Clear problem / opportunity statement
- Recommended approach + rationale
- Tradeoffs considered
- Impact on other domains (CEO Orchestrator should have reviewed this)
- Proposed next steps / tasks
- Any mocks, specs, or ADRs produced
- What the agents are uncertain about

## Autonomy Ramp (Explicit)

**Early phase**:
- High volume of conversation involvement from human.
- Most non-trivial packages require human approval.
- CEO Orchestrator frequently checks in with human on strategic questions.

**Middle phase**:
- Agents surface more complete, well-reasoned packages.
- Human mostly reviews via Kanban.
- Some classes of decisions can be made by CEO Orchestrator with audit trail.

**Mature phase**:
- CEO Orchestrator + domain teams can run large parts of the planning and strategy loop with only periodic human review at major milestones.
- Human is mostly reading high-quality synthesized outputs and only jumps in for truly directional calls.

The system should be designed to support this progression without major rewrites.

## Logging & Visibility

All inter-agent conversations that lead to a work package should be logged in a way that is:
- Searchable by the brain/memory layer
- Inspectable by the human when they want deeper context ("why did you recommend this?")

The human should never feel like decisions are happening in a black box.

## Rules

- The Kanban is the source of truth for "what has human approval."
- Jumping into a conversation does **not** count as formal approval — the output must still go through the Kanban.
- Agents are encouraged to be opinionated and to propose clear recommendations rather than open-ended questions.
- When the human denies something, agents are expected to treat the feedback as high-signal data about the founder's judgment model.
