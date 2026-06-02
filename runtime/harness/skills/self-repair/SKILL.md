---
name: self-repair
description: "Diagnose CEO Studio failures or improvement requests, implement verified repairs, update docs when behavior changes, and commit all work. Use when voice/planner/autonomy asks for self-repair or when tests, tools, UI, IPC, provider routing, or agent orchestration fail."
version: 0.1.0
author: CEO Studio
tags: [self-repair, diagnostics, verification, git, documentation, autonomy]
related_skills: [docs-steward]
---

# Self Repair

Use this skill when CEO Studio asks for a repair, diagnosis, or system improvement.

## Job

Turn a reported failure or improvement opportunity into real implemented work with proof. This skill is not a mock responder and does not mark work done based on intent alone.

## Required Pass

1. Read the bug/task, room handoff, evidence, and related source files.
2. Reproduce or explain the issue from concrete evidence.
3. Implement the smallest safe repair or improvement.
4. Update authoritative docs when behavior, workflows, agents, skills, voice tools, IPC, provider routing, or verification changes.
5. Run `npm run check` and `npm test` unless blocked.
6. Commit all file changes with a focused git commit.
7. Post the root cause, files changed, verification result, docs status, commit hash, and residual risks back to the bug/task or room.

## Constraints

- The conversational CEO remains Hermes through `main/core/hermes.js` and `hermes chat -q`.
- Do not introduce `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` CEO paths.
- Do not bypass tests or add fake implementations to pass verification.
- Do not claim a repair is complete without evidence and a commit hash.

## Handoff Template

```markdown
Self-repair handoff:
- Root cause:
- Repair:
- Files changed:
- Docs:
- Verification:
- Commit:
- Remaining risks:
```
