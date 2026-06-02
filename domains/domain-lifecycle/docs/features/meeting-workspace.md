# Feature Spec: Meeting Workspace

## Purpose
The Meetings view is the operator workspace for convening domain-owned agent sessions. It should feel like preparing a real working room: choose the domain context, frame the agenda, pick the team, watch the room, and save the synthesis back into the domain.

## Implemented v1
- The meeting engine remains the real harness path: `runtime/harness/bin/agent meeting`.
- The app shows the full registry roster, not only mounted tmux sessions.
- Agent rows expose availability, provider, persona, and capability summary.
- Team cards select the team and check the matching participants.
- Meeting templates load useful agenda/outcome briefs:
  - Kickoff
  - Handoff triage
  - Requirements
  - Build plan
  - Repair review
- Selected CEO Context items can be included in the meeting agenda.
- Saved meeting artifacts preserve selected source context under `## Source Context`.
- Completed synthesis is saved under `domains/<domain>/agendas/`.
- Saving a synthesis also appends a meeting Agenda Item that points to the output artifact.

## Domain Contract
Every meeting artifact must include:
- Domain
- Room
- Participants
- Agenda
- Expected outcome
- Source handoff when present
- Source context item count
- Synthesized output
- Output artifact path in the matching Agenda Item

## Product Requirements
- The user must be able to start from selected domain artifacts instead of a blank prompt.
- The user must be able to pick a team by role, then adjust individual participants.
- Provider cost must remain explicit through the paid-provider opt-in.
- Failed provider or registry support must stay visible and become repair work when invoked from a domain workflow.

## Verification
- Open Meetings with no selected context and confirm the workspace renders.
- Select a domain artifact as CEO Context, open Meetings, and confirm it appears in Selected Context.
- Pick a template and confirm agenda, outcome, and team selection update.
- Pick a team card and confirm matching member checkboxes update.
- Start a meeting and confirm the live room transcript is shown.
- Confirm completed output is saved under `agendas/` with `## Source Context`.
