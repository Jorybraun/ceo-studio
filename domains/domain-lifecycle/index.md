# Domain Lifecycle

This is the canonical, versioned home for the **Domain Lifecycle** domain inside the CEO_STUDIO project.

It was created following the new Domain Creation Process (Domain Architect interview + live AGUI outline + explicit handoff to Agenda Agent + captured entities).

## Core Artifacts
- `definition.md` — The clean synthesized definition (output of the creation process)
- `handoffs/001-domain-lifecycle-initial-handoff.md` — First-class handoff record to the Agenda Agent
- `captured-agenda-items.md` — Entities and next steps explicitly extracted during definition
- `docs/`, `requirements/`, `agendas/`, `handoffs/` — The basic owned structure the creation process says should be provisioned

## Machine Representation
The app's brain also contains the corresponding domain record at:
`~/.ceo-studio/ceo-studio/brain/domains/domain-lifecycle.json`

This means when you open the CEO_STUDIO project in CEO Studio, "domain-lifecycle" should appear as a selectable domain with the purpose, goal, and context defined here.

## Source of the Definition
Synthesized from the June 2026 design discussion. The original design artifacts now live **inside this domain** at:

- `docs/design/` — the 7 core spec documents (system overview, creation process, handoff protocol, critical agents, scoping model, terminology, recursive linking)
- `docs/personas/` — the three specialized personas used during the design (Domain Architect, Agenda Agent, BA Document Guard)

See `handoffs/001-domain-lifecycle-initial-handoff.md` for the full provenance and raw material references.

**This domain owns its own definition and evolution.** Future work on the domain functionality should attach to clean artifacts under this tree.
