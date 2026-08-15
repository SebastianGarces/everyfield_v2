---
name: handoff
description: Create or resume a session handoff — captures current session state to project memory so the next session picks up instantly. `/handoff` to create, `/handoff resume` to re-orient.
disable-model-invocation: true
---

# Handoff

End a session so the next one knows exactly where to continue. `/handoff resume` (or "where were
we?") reads the latest handoff back instead of writing one.

## Where it goes

- **`<project-memory-dir>/session_handoff.md`** — always **overwritten**; one current handoff, never
  `handoff-2.md`. The memory dir is given in the memory instructions each session; for this project
  it is `/Users/sebastian/.claude/projects/-Users-sebastian-dev-everyfield-v2/memory/`.
- **One pointer line in `MEMORY.md`**, updated in place, never duplicated:
  `- [▶ Latest handoff](session_handoff.md) — <one-line status + the next action>`

`MEMORY.md` auto-loads next session, so the pointer is how the handoff is found.

## Procedure

Ground it in git first (`git status --short`, `git log --oneline -5`) so committed and uncommitted
are not confused. Write the file, update the pointer line, print the handoff in chat. Anything that
should outlive this task also belongs in a normal memory file; the handoff is disposable.

## Template

```markdown
# Handoff — <project / focus> (<absolute date>)

## Where we are
<1–3 sentences: current state, and what this session changed — committed vs. uncommitted.>

## Decisions locked
<Key decisions, so they are not re-litigated.>

## ▶ Start the next session here
<The single most important next action: file paths, commands, the exact unit. This is the point of
the document — make it concrete.>

## Blockers / pending
<External dependencies or info still needed. Absolute dates only.>
```
