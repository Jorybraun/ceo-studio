#!/bin/bash
# Domain Scaffolder for the Domain-Driven Project Management Harness
# Usage: ./bin/create-domain.sh

set -e

echo "=== Domain-Driven Harness: Create New Domain ==="
echo

read -p "1. Domain name (kebab-case, e.g. discovery, culture-interview): " DOMAIN
read -p "2. What it does (one sentence): " PURPOSE
read -p "3. Core agents needed (comma-separated, e.g. pm,ba,architect,qa): " AGENTS_INPUT

DOMAIN_DIR="context/${DOMAIN}-team"

if [ -d "$DOMAIN_DIR" ]; then
  echo "ERROR: $DOMAIN_DIR already exists."
  exit 1
fi

echo
echo "Scaffolding $DOMAIN_DIR ..."

mkdir -p "$DOMAIN_DIR"/{team-harness,docs,mgmt}

# Root AGENTS.md for the domain team
cat > "$DOMAIN_DIR/AGENTS.md" << EOF
# ${DOMAIN} Domain Team

**Purpose**: ${PURPOSE}

This domain is managed by a self-contained agent team.  
Agents plan, document, and coordinate. They do not write production code for the main app.

## Team Structure
- Orchestrator (coordinates the domain)
- Planning Team (see below)
- Execution handoff to external builders (human or other agents)

## Core Principles (inherited)
- Documentation is the source of truth.
- No guessing.
- Recursive planning.
- Chat controls the plan.
- One feature fully planned before execution.

## Current Focus
See docs/domain-overview.md for active priorities and the current triage state.

## How to Interact
- All planning happens in Triage.
- Use team chat for plan adjustments (logged).
- Review assets (specs, designs, ADRs) during the Review Loop.
- Nothing moves to Ready without full approval + QA sign-off on impacts.
EOF

# team-harness/orchestrator.md (starter)
cat > "$DOMAIN_DIR/team-harness/orchestrator.md" << EOF
# Domain Orchestrator — ${DOMAIN}

## Responsibilities
- Owns the end-to-end planning workflow for this domain.
- Routes work through Triage → Sizing → Planning → Cross-Domain Check → QA Review → Approval.
- Maintains shared memory and context for the domain team.
- Triggers documentation refresh on any approved change.
- Escalates only when the Review Loop cannot converge.

## Handoff Rules
- Never guess requirements. Query docs/ and mgmt/ first.
- When handing off to a specialist (PM, BA, Architect, etc.), include the full relevant context slice.
- After any handoff, the receiving agent must confirm understanding before proceeding.

## Current Workflow State
See mgmt/kanban.md for live board state.
EOF

# docs/domain-overview.md (living)
cat > "$DOMAIN_DIR/docs/domain-overview.md" << EOF
# ${DOMAIN} Domain Overview

**Purpose**: ${PURPOSE}

## Current State (as of scaffold)
- This domain was created to address a foundational problem in the broader system: over-synthesis of interviews (especially Role Discovery) produces generic, low-value artifacts.
- The primary data we actually need is the **raw conversation transcript**. Insight must be derived from the transcript, not from a lossy pre-synthesized RCD.

## Key Problems We Own
- Generic insight from discovery interviews
- Rigid data structures (RCD) that force over-synthesis
- Poor interview flow and UI
- Loss of signal between actual conversation and downstream consumers

## Guiding Constraint
Any solution in this domain must keep the raw transcript as a first-class, immutable, queryable artifact. Synthesis is optional and secondary.

## Active Epics & Priorities
(See mgmt/ for the live kanban and current triage items.)

## Interfaces with Other Domains
- Will eventually produce structured outputs that other domains (culture, matching, challenges) can consume.
- Must never assume downstream consumers without explicit contracts.

Last updated: $(date +%Y-%m-%d)
EOF

# docs/feature-list.md (starter)
cat > "$DOMAIN_DIR/docs/feature-list.md" << EOF
# Feature List — ${DOMAIN}

All features must enter via Triage and receive full planning + approval before any execution work begins.

## Proposed / In Triage
- (none yet — first item will be the "Raw Transcript Primary Artifact" feature)

## Approved & Ready for Execution
- (none)

## In Progress
- (none)

## Done
- Domain scaffolding (this harness structure)
EOF

# mgmt/kanban.md (lightweight living board)
cat > "$DOMAIN_DIR/mgmt/kanban.md" << EOF
# Kanban — ${DOMAIN} Domain

**Board State**: Living document. Updated by agents during planning and execution.

## Triage (raw ideas → fully planned & approved)
- [ ] Raw Transcript as Primary Artifact (foundational — see triage item when created)

## Ready (approved plans, ready for builders)
- (none)

## In Progress
- (none)

## Review / Blocked
- (none)

## Done
- Domain structure scaffolded

## Rules
- Nothing leaves Triage without a plan, estimate, full asset set (spec + design mock + ADR if needed + test plan + cross-domain check), and explicit approval.
- All changes to this board must be logged via team chat or orchestrator.
EOF

# mgmt/triage.md (intake log)
cat > "$DOMAIN_DIR/mgmt/triage.md" << EOF
# Triage Log — ${DOMAIN}

All raw ideas enter here. They only leave as structured, approved work items.

## Intake Rules (from vision)
1. Creation — raw description only.
2. Sizing — small/medium/large + rationale.
3. Dependency Scan + blast radius.
4. Planning phase (size-dependent depth).
5. Cross-domain check.
6. QA review (especially for existing feature impact).
7. Review Loop (you annotate in Kanban/chat until solid).
8. Approval → moves to Ready as tasks.

## Current Items
(none — first item will be created in the next harness cycle)
EOF

echo "Domain '$DOMAIN' scaffolded successfully at $DOMAIN_DIR"
echo
echo "Next steps:"
echo "  - cd $DOMAIN_DIR"
echo "  - Review and edit AGENTS.md, docs/domain-overview.md"
echo "  - Run the first Triage cycle for 'Raw Transcript as Primary Artifact'"
echo
echo "The harness now has a real domain to prove the pattern on."
EOF

chmod +x harness/bin/create-domain.sh

echo "Scaffolder created and made executable."
echo "Run it with: ./harness/bin/create-domain.sh"
