---
name: grilling
description: Interview the user relentlessly about a plan, decision, or idea until every branch of the decision tree is resolved. Use before writing a spec or starting a build when the ask is fuzzy, when the user says "grill me" / "stress-test this" / "am I missing anything", or when you notice you are about to guess at something that changes what gets built.
---

# Grilling

The factory builds correctly whatever it is aimed at. CI and the preview look prove the code works,
never that it was the right code. This skill is the check before that check.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (`grilling`).

## The loop

**Look up facts; ask only for decisions.** Anything discoverable from the repo costs no question.
In order:

1. `memory/` — `invariants.md`, `invariants/`, `contracts/` (see `memory/index.md`)
2. `product-docs/features/<feature>/frd.md`
3. The codebase, `gh issue view`, `git log`

**One question at a time, with your recommended answer and why.** "X or Y? I'd pick X because …" is
far easier to react to than an open prompt. Wait for the answer before asking the next.

**Walk every branch** where a wrong guess changes what gets built. Two the repo will not settle for
you: **tenancy, auth and permissions** — who can see and do this, beyond what `memory/invariants.md`
already fixes — and **data shape**, because what gets persisted decides what can be built on top of
it, and the schema is the hardest part to walk back.

**Do not act until they confirm.** No files, no issues, no code. When the understanding is shared,
say so and hand off to `spec-intake` — the answers become its ACs and its `## Out of scope`.
