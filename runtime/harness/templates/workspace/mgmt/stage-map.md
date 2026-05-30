# Stage → Team & Workflow Map — __NAME__

**Declarative binding for the orchestrator.** For each Kanban column, this file
answers: which **team** owns the work, which **workflow** they follow, and which
**personas** to activate. The orchestrator reads this instead of hardcoding
persona lists.

The machine-readable form lives in `config/kanban.py` (engine); this markdown is
the human + LLM source of truth for this project.

## Stages

### Triage (Ideas → Fully planned & approved)
**Team**: planning
**Workflow**: planning-triage
**Default Personas**: orchestrator, pm, ba, architect, qa-planning
**Guidance**: Decompose the item into a full asset package (spec, design mock if
UI, ADR if architectural, test/QA plan) before it can move to Ready.

---

### Ready for Execution (Approved, tasks created)
**Team**: execution
**Workflow**: handoff-to-builders
**Default Personas**: orchestrator, builder
**Guidance**: Planning handoff complete; builders activated with the approved package.

---

### In Progress (Builders executing)
**Team**: execution-builders
**Workflow**: implementation-plus-validation
**Default Personas**: builder, supporting specialists
**Guidance**: Every non-trivial change goes through the validation gate; evidence
posted back into the domain room.

---

### Review / Blocked
**Team**: review
**Workflow**: review-loop
**Default Personas**: reviewer, original planners, orchestrator

---

### Done
Completed and verified. Keep a short log of what shipped.
