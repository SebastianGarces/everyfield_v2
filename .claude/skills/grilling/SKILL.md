---
name: grilling
description: Interview the user relentlessly about a plan, decision, or idea until every branch of the decision tree is resolved. Use before writing a spec or starting a build when the ask is fuzzy, when the user says "grill me" / "stress-test this" / "am I missing anything", or when you notice you are about to guess at something that changes what gets built.
---

# Grilling

The factory builds correctly whatever it is aimed at. Nothing downstream of `spec-intake` questions
the aim — `ops/agent-os/dod.md` proves the code works, never that it was the right code. This skill
is the gate before that gate.

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (`grilling`).

## The loop

Interview the user relentlessly about every aspect of this until you reach a shared understanding.
Walk down each branch of the decision tree, resolving dependencies between decisions one at a time.

**One question at a time.** Wait for the answer before asking the next. Asking five at once is
bewildering and produces shallow answers to all five.

**Always give your recommended answer** with the question, and say why. "Should X or Y? I'd pick X
because …" is far easier to react to than an open prompt. The user's job is to correct you, not to
compose an essay.

**Look up facts; ask only for decisions.** If something can be discovered from the environment,
discover it — never spend a question on it. In this repo, in order:

1. `memory/` — `invariants.md`, `invariants/`, `flows/`, `contracts/` (non-obvious behaviors; see `memory/index.md`)
2. `product-docs/features/<feature>/frd.md` for existing requirements
3. The codebase, `gh issue view`, `git log`

The **decisions** are the user's. Put each one to them and wait.

**Do not act until they confirm.** No files written, no issues created, no code. Grilling ends when
the user says the understanding is shared — then, and only then, hand off.

## What to grill

Prioritise the branches where a wrong guess changes what gets built:

- **Scope edges** — what is explicitly *not* in this? (This becomes the issue's `## Out of scope`.)
- **Observable outcome** — how would we know it works, in a browser or an API response? An answer
  that can't be observed isn't an acceptance criterion yet.
- **Existing behaviour it collides with** — what does this change for flows that already work?
- **Tenancy, auth, and permissions** — who can see and do this? Check `memory/invariants.md` and put
  anything it doesn't already settle to the user.
- **Data shape** — does this need schema? If yes the unit is `risk:high`; say so during the session,
  not after.
- **The thing they haven't thought about** — empty states, failure modes, what happens on the second
  attempt, what an admin sees versus a member.

## Handing off

When the understanding is shared, say so and offer the next step rather than taking it:

- Building it → `spec-intake` (the answers become the ACs and the `## Out of scope` block)
- Too big for one session → decompose first (`frd-plan`), then intake each unit
- It was a decision, not a build → record it where it will be found again, and say where

A grilling session that ends in a `spec-intake` issue is the point of this skill. Answers that stay
in the conversation are lost at the next `/clear`.
