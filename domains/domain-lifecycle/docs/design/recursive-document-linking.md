# Recursive Document Linking

## Concept

During the **Review & Deep Dive** phase of domain creation (and later during normal work), users should be able to click on any node or section in the left panel and **go deeper** into that topic by creating or opening a linked child document.

This creates a recursive, tree-like structure of documents instead of one giant flat document.

## How It Works

1. User is in the Review phase of a domain definition.
2. User clicks on a node (e.g., "Agent Details" feature, or a specific requirement).
3. User chooses **"Deep Dive"** or **"Explore Further"**.
4. The system creates (or opens) a **child document** linked to that specific node.
5. The child document inherits context from its parent (the domain + the specific section).
6. The child document can itself support further deep dives → recursion.
7. All documents remain linked in a navigable tree.

## Goals

- Allow natural exploration without overwhelming the initial domain definition.
- Keep high-level definitions clean while still capturing depth where needed.
- Prevent "document explosion" by making deep dives intentional and linked.
- Support progressive disclosure of complexity.

## Key Design Questions

| Question | Current Thinking |
|----------|------------------|
| Should child documents be separate files or embedded sections? | Separate files with parent references (more flexible for recursion) |
| How do we show the tree in the UI? | Left panel should support tree navigation (expand/collapse) |
| How do we prevent too many nested documents? | Deep Dive should be a deliberate action, not automatic. BA Agent can help flag when nesting is getting excessive. |
| What metadata should each link carry? | Parent ID, relationship type (e.g., "subdomain", "feature", "requirement"), creation timestamp, status (Dirty/Clean) |
| When should deep diving happen? | Primarily during the **Review & Refinement** phase, after the initial high-level interview is stable. |

## Relationship to Other Concepts

- Works together with the **interactive left panel** in `domain-creation-process.md`.
- Deep dive documents start in **Dirty** state and must be reviewed by the **BA Agent**.
- The **Agenda Agent** may create follow-up items when deep dives reveal new work.
- This is one of the main mechanisms for **recursive refinement** without losing the high-level view.

## Open Questions

- Should there be a maximum recommended depth?
- How do we surface "orphan" deep dive documents that were never properly linked back?
- Should deep dive documents have their own handoff process, or do they stay attached to the parent domain's handoff?