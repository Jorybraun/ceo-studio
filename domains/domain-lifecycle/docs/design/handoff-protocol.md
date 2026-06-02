# Handoff Protocol Specification

**Version:** 0.1  
**Date:** 2026-06-01  
**Status:** Draft  
**Related Documents:**
- `domain-creation-process.md`
- `personas/domain-architect.md`
- `personas/agenda-agent.md`

---

## 1. Purpose of the Handoff Protocol

The handoff protocol exists to ensure that when one specialized agent (e.g. Domain Architect) finishes its work, responsibility is **explicitly transferred** to the next agent (Agenda Agent) in a structured, auditable, and recoverable way.

Key goals:
- Nothing important is lost during transition
- The receiving agent has enough context to act intelligently
- Humans (CEO / user) can see and influence what happens next
- The process remains intentional — no automatic execution of deep work
- Supports recursive / multi-step workflows over time

---

## 2. Handoff as a First-Class Entity

A **Handoff** is a persisted record in the system. It is not just a message — it is a trackable object.

### Core Fields of a Handoff

| Field                    | Description                                                                 | Required |
|--------------------------|-----------------------------------------------------------------------------|----------|
| `id`                     | Unique identifier                                                           | Yes      |
| `from_agent`             | Persona / agent that initiated the handoff (e.g. `domain-architect`)        | Yes      |
| `to_agent`               | Intended recipient (e.g. `agenda-agent`)                                    | Yes      |
| `triggered_by`           | User action or system event that caused the handoff                         | Yes      |
| `context`                | Project + Domain(s) this handoff relates to                                 | Yes      |
| `payload`                | Structured data package (see below)                                         | Yes      |
| `raw_artifacts`          | Links to raw transcripts, notes, or files                                   | Yes      |
| `status`                 | `pending` / `acknowledged` / `in_progress` / `completed` / `needs_human`    | Yes      |
| `created_at`             | Timestamp                                                                   | Yes      |
| `acknowledged_at`        | When the receiving agent confirmed receipt                                  | No       |
| `next_agenda_items`      | List of suggested Agenda Items created as part of this handoff              | No       |
| `human_visible`          | Whether this handoff should appear in the CEO / user dashboard              | Yes      |
| `notes`                  | Freeform context or decisions made during handoff                           | No       |

---

## 3. Handoff Payload Structure

The payload is the most important part. It must be rich enough for the Agenda Agent to make good decisions without needing to re-ask everything.

### Recommended Payload Contents

**Always included:**
- Synthesized domain definition (clean, structured)
- List of captured entities during interview (Subdomains, Features, Requirements, Agenda Items, new Models)
- Initial relationships / dependencies noted
- User confirmation statement (the moment they said “this feels good”)
- Suggested next agenda items from Domain Architect’s perspective

**Strongly recommended:**
- Raw transcript or full conversation log (especially for voice)
- Any sketches, notes, or partial artifacts created during the interview
- Open questions or uncertainties flagged by the Domain Architect
- Scope warnings (e.g. “This domain might be too broad — consider splitting”)

**Optional / future:**
- Confidence score from Domain Architect
- Suggested decomposition points
- Links to related existing domains

---

## 4. Handoff Protocol Steps

### Phase 1: Creation (Domain Architect)

1. Domain Architect completes the interview and gets explicit user confirmation.
2. It synthesizes the definition + extracts entities.
3. It creates a **Handoff** record with full payload.
4. It surfaces a clear message to the user:
   > “Initial definition complete. I’ve created a handoff for the Agenda Agent. Would you like me to notify them now, or should we wait?”

5. The handoff is persisted and visible in the system (especially to the CEO).

### Phase 2: Delivery

Two possible modes:

**A. Explicit Notification (Recommended)**
- Domain Architect sends a structured message to the Agenda Agent containing the handoff ID.
- Agenda Agent is expected to acknowledge within a reasonable time.

**B. Passive Queue (Future)**
- Handoffs are placed in a shared work queue that the Agenda Agent monitors.
- This is lower priority for now.

### Phase 3: Acknowledgment (Agenda Agent)

When the Agenda Agent receives a handoff, it should:

1. **Acknowledge receipt** (update status to `acknowledged`)
2. **Validate payload** — check that required fields are present
3. **Perform initial triage**:
   - What kind of work does this handoff represent?
   - Does it need immediate human attention?
   - Can it be decomposed into agenda items right now?
   - Should it be routed to other specialized agents?
4. **Create Agenda Items** as appropriate
5. **Update handoff status** to `in_progress` or `needs_human`

### Phase 4: Human Visibility & Control

- All handoffs should be visible in a “Handoffs” or “Inbox” view for the CEO / user.
- The user should be able to:
  - See pending handoffs
  - Prioritize or pause them
  - Add instructions before the Agenda Agent acts
  - Reassign the handoff to a different agent if needed

---

## 5. What Each Side Must Do

### Domain Architect Responsibilities (Sender)

- Only create a handoff after explicit user confirmation
- Always include both **synthesized** and **raw** artifacts
- Clearly flag any captured subdomains, features, or agenda items
- Do **not** decide the next meetings or deep work itself
- Make the handoff message human-readable

### Agenda Agent Responsibilities (Receiver)

- Acknowledge every handoff it receives
- Never silently ignore or auto-execute a handoff
- Use good judgment about when to involve humans
- Create clear, actionable agenda items from the payload
- Maintain traceability back to the original handoff

---

## 6. Open Questions & Decisions Needed

- Should handoffs be **push** (Domain Architect notifies Agenda) or **pull** (Agenda checks a queue)?
- How do we handle handoffs that the Agenda Agent cannot process (bad payload, missing context)?
- Should there be a timeout or escalation if a handoff is not acknowledged?
- How much autonomy should the Agenda Agent have to create meetings vs. always asking the CEO first?
- Do we need different handoff types (e.g. “Domain Created”, “Feature Ready for Spec”, “User Journey Complete”)?
- How do we version or update a handoff if new information emerges later?

---

## 7. Example Handoff (Conceptual)

**From:** Domain Architect  
**To:** Agenda Agent  
**Context:** CEO_STUDIO project → Agents domain

**Payload Summary:**
- Domain: Agents
- Purpose: Own agent registry, creation, editing, and basic lifecycle
- Captured during interview:
  - Potential Subdomain: Agent Details
  - Agenda Item: Explore whether Agent Details needs its own domain
- Raw transcript available
- User said: “This feels good for now”

**Suggested next step from Domain Architect:**
> “Agenda Agent should review and propose whether we schedule a kickoff to explore the Agent Details subdomain and overall agent workflows.”

---

This document is intentionally focused only on the **handoff mechanics**. We can now refine any part of it.

Ready when you are.
