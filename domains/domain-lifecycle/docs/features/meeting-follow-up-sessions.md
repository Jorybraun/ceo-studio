# Feature Spec: Meeting And Follow-Up Sessions

## Purpose
Meeting and follow-up sessions are first-class Domain Lifecycle work. They let a domain convene agents, humans, or external providers around a concrete agenda and save the resulting synthesis as a domain-owned artifact.

## v1 Contract
- Capture a meeting Agenda Item before or during the session.
- Required fields: domain, participants, agenda, expected outcome, source handoff when present, and output artifact path.
- Store synthesized output under `agendas/`.
- Keep the Agenda Item proposal-only until a human approves Kanban task creation or agent dispatch.
- If provider, model, or registry support is missing, capture a `bug/system repair` Agenda Item instead of silently dropping the gap.
- For Brief Run meetings, parse the durable room synthesis into typed follow-up proposals automatically.
- Keep proposal generation separate from materialization: only an explicit human approval may record the proposal or change the parent task state.
- Preserve rejected proposals and source hashes so repeated room polling does not recreate or silently re-approve them.

## Calendar Automation
Calendar scheduling is tracked as domain work, not implied future work.

Agenda Item:
- Type: feature
- Title: Add calendar scheduling automation for Domain Lifecycle follow-up sessions
- Expected outcome: CEO Studio can propose times, invite participants, link calendar events to domain Agenda Items, and save meeting output under the domain.
- Human approval required: yes

## Verification
- Start a domain meeting from the cockpit.
- Confirm room transcript is visible while running.
- Confirm synthesized output is saved under `agendas/`.
- Confirm a meeting Agenda Item points at the saved artifact.
- Confirm provider/registry failures create a domain-owned repair Agenda Item.
- Confirm meeting proposal approval is explicit, auditable, and idempotent.
