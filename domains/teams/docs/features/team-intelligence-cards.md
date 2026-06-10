# Feature: Team Intelligence Cards

## Purpose
The Teams domain should show operational team information, not only domain files.

## Current Slice
When the `Teams` domain is open, the domain cockpit renders a Team Intelligence section from the live agent registry and orchestration routing summary.

It shows:
- registry teams
- member agents
- provider and persona per member
- member capabilities
- Kanban lanes routed to each team
- missing teams or missing member agents
- project-level teams that do not currently own a routed lane

## App Workspace Split
The left rail separates registry work into two items:
- `Agents`: individual agent roster, agent creation/editing, provider/persona/capability metadata, mount/unmount, and live agent detail.
- `Teams`: assembled groups, membership editing, team creation/deletion, and missing-member visibility.

Meetings consume both surfaces: team cards choose a group, and the participant roster remains individual agents.

## Context Workbench
Each team card can be added to CEO Context. The selected context includes the team name, members, member metadata, and routed lanes so Hermes CEO can discuss concrete team structure instead of only file paths.

## Known Limitation
Team scoping is still not first-class. Registry teams are project-level entries today; domain-scoped teams and subdomain inheritance remain proposed work.
