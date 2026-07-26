---
name: memory-maintenance
description: Keep `memory/` accurate when a change touches entrypoints, flows, contracts, or invariants. Use while implementing anything that adds a route or server action, changes DB schema, alters an API contract or env var, or touches auth/tenancy behaviour — and before committing such a change.
---

# Memory maintenance

`memory/` is the summarized context every agent loads before opening source files (see
`.agents/memory-first.md`). It is only worth loading while it is true, and it goes stale silently —
nothing fails when it drifts, which is exactly why it needs a deliberate step.

Extracted from the retired `work-in-progress` skill (decision #19,
`product-docs/docs-audit-2026-07.md`), which paired this discipline with a pre-factory workflow that
now contradicts `ops/agent-os/dod.md`. The memory discipline was worth keeping; the workflow was not.

## What belongs in memory

| File | Holds |
|------|-------|
| `memory/entrypoints.md` | Flow entry points, with `file:symbol` references |
| `memory/flows/*.mmd` | Mermaid diagrams of control/data flow |
| `memory/contracts/*.md` | API routes, DB schema, config summaries |
| `memory/invariants.md` | Rules that must not be violated |

## When planning

Decide up front whether the change will touch:

- [ ] **Entrypoints** — new routes, server actions, triggers
- [ ] **Flows** — control flow changes
- [ ] **Contracts** — schema, API, config
- [ ] **Invariants** — security, tenancy, auth

If any box is ticked, make the memory update an explicit item in the plan. A memory update decided at
the end is a memory update that doesn't happen.

## While implementing

Update memory **in the same unit of work**, not afterwards, when the change adds or modifies:

- routes or server actions
- database schema
- an API contract
- config or env vars
- auth or tenancy behaviour

## Before committing

1. Review the touched areas against what memory currently says.
2. If the change implies drift, confirm memory was actually updated.
3. If it doesn't, say so explicitly in the PR body — "memory unchanged: no impact on entrypoints,
   flows, contracts, or invariants" — so a reviewer knows it was considered rather than forgotten.

Under the Definition of Done this is part of **G4 (conventions & invariants)**.

## Quality rules

- **Never dump code** into memory — summarize and link to file paths.
- **Keep it small.** The stated budget is ≤50 KB total; check it, because the whole value of memory is
  being cheaper to load than the source.
- **Anchor diagram nodes** to `file:function()` or `file route`.
- **Split diagrams** that grow past ~50 lines.
- Add a diagram only when it prevents future file reads. Decoration costs tokens on every session.
