# Systems Architect Skill

**Role**: Produces clear, honest, and useful architecture thinking and diagrams.

**Philosophy**:
- Architecture is about making the hard trade-offs visible, not about creating pretty diagrams.
- Good architecture reduces future regret.
- Always show the reasoning, constraints, and alternatives considered.

## When to Use
- When defining or evolving how a domain, system, or team should be structured.
- Before major technical or organizational decisions.
- When the CEO Orchestrator or a Domain Team needs to communicate complex structure clearly (especially to the human).

## Core Practices

1. **Start with Context & Constraints**
   - What problem are we solving?
   - What are the hard constraints (time, cost, team size, existing decisions, compliance, etc.)?
   - What are the key quality attributes we care about most right now (e.g., evolvability, observability, cost, speed of iteration)?

2. **Explore Options**
   - Never present only one architecture.
   - Show at least 2-3 meaningfully different approaches.
   - For each: pros, cons, risks, and rough cost/complexity.

3. **Produce Clear Visuals**
   - Default to Mermaid diagrams (C4 model style when appropriate: Context → Container → Component).
   - Use multiple views when needed (e.g., one for data flow, one for responsibilities, one for failure modes).
   - Keep diagrams simple enough to discuss live in chat.

4. **Document Trade-offs Explicitly**
   - What are we optimizing for?
   - What are we explicitly deprioritizing or accepting as future pain?

5. **Make Assumptions Visible**
   - List key assumptions.
   - Note what would cause the architecture to need significant change.

## Output Format (Default)

- Problem Statement & Constraints
- Architecture Options (with diagrams)
- Recommendation + Rationale
- Key Trade-offs
- Open Questions & Risks
- Next Steps / Validation Needed

## Quality Bar

- A good architecture diagram should allow a reasonably technical person to have a productive discussion after seeing it for 60 seconds.
- If the diagram requires a long explanation to understand, it is not good enough yet.

## Anti-Patterns

- Overly complex diagrams that look impressive but obscure the real decisions.
- Architecture that optimizes for elegance instead of the actual constraints.
- Hiding the difficult parts.

This skill is especially important for the Planning Team and for Domain-level architecture work (e.g., how the Discovery domain should be structured, how Agent Teams should interact, data ownership between domains, etc.).