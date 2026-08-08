---
name: memory-maintenance
description: Keep `memory/` accurate when a change touches invariants, flow diagrams, or the non-obvious semantics memory records. Use while implementing anything that adds or changes a rule that must not be violated, alters a diagrammed flow, or introduces behavior a reader could not guess from the source — and before committing such a change.
---

# Memory maintenance

`memory/` holds what the code cannot tell you: invariants, rulings, non-obvious semantics, and
flow diagrams (see `memory/index.md`). It deliberately does NOT mirror schemas, routes, or file
layouts — the source covers those. Memory goes stale silently — nothing fails when it drifts —
which is why this is a deliberate step.

## What belongs in memory

| File | Holds |
|------|-------|
| `memory/invariants.md` | EVERY rule that must not be violated — security, tenancy, auth, atomicity — stated as one self-sufficient line each. The index IS the rule set |
| `memory/invariants/<domain>.md` | The elaboration behind those lines: the why, the SQL/code pattern, worked examples. One file per domain; some domains are index-only |
| `memory/flows/*.mmd` | Mermaid diagrams of control/data flow (intent, not code) |
| `memory/contracts/*.md` | ONLY non-obvious behaviors: cron/webhook/tokened routes, column semantics a reader would misread, env-var gotchas |
| `memory/entrypoints.md` | Conventions for finding flows — not an enumeration of them |

What does NOT belong: table-by-table schema, route/action listings, file trees, anything a
session reconstructs with `ls` or by reading the schema file. If you are copying source into
memory, stop.

## The check (DoD gate G4)

Before committing, ask: did this change **add or alter an invariant, a diagrammed flow, or a
non-obvious behavior**?

- Yes → update the matching memory file **in the same unit of work**, not afterwards.
- No → say so in the PR body — "memory unchanged: no new invariants or flow changes" — so a
  reviewer knows it was considered rather than forgotten.

A new route, action, or table does **not** by itself require a memory update — only the
non-obvious part of it does.

## Adding an invariant

Two steps, in this order, and the first is not optional:

1. **Write the one-liner in `memory/invariants.md`**, under its domain heading. It must state the
   rule on its own — a reader who opens nothing else has still been told what not to do. Not "see
   the domain file for the batching rule": the rule itself.
2. **Add the elaboration to `memory/invariants/<domain>.md`** — the why, the pattern, the worked
   example. If there is nothing to add beyond the one-liner, stop at step 1; index-only is a valid
   outcome, and a domain with no elaboration file simply carries no pointer.

**Never elaboration without an index line.** A rule that exists only in a domain file is invisible
to every agent that reads the index and stops, which is most of them. If you find one, promote it.

## Quality rules

- **Never dump code** into memory — summarize and link to file paths.
- **Keep it small.** Budget ≤50 KB total; the value of memory is being cheaper than the source.
- **Anchor diagram nodes** to `file:function()` or a route.
- Add a diagram only when it prevents future file reads; split diagrams past ~50 lines.
