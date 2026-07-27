---
name: prototype
description: Build 3–4 live, throwaway prototypes of competing directions so a direction ruling becomes "try them, pick one" instead of "read prose and imagine". Use whenever a spec-question hold or a needs-spec issue is a DIRECTION question — two or more plausible answers where experiencing them beats describing them. UI questions become variants behind the prototype switcher on a preview deployment; behavior/logic questions become a throwaway interactive CLI outside the app.
---

# prototype — turn a direction question into a decision

The human queue contains decisions, not code reviews (`ops/agent-os/workflow.md`). This skill
raises the quality of one decision type: **direction questions** — where the question is not "is
this right?" but "which of these should exist?". A prose DECISION comment makes the reviewer
*imagine* each option; a prototype lets them *operate* each option. The ruling gets faster and
better-informed at the same time, and "I like this about A and this about B — combine them"
becomes a legitimate answer instead of a vague one.

## When to prototype (and when not to)

Prototype when **experiencing the options is what decides** — layout feel, interaction feel, how a
state model behaves under the awkward case. If the question is decidable from one sharp sentence
("should deleting a person cascade to their notes?" as pure policy), ask the sentence; a prototype
of a question words can settle is waste.

Reached from two places in the workflow:

- **A spec-question hold** (`build-until-done.js` gate 4): the verifier flagged a question about
  *what should have been built* and it has 2+ plausible directions. Build the prototypes into the
  held PR's branch before posting the DECISION comment.
- **A needs-spec issue at intake** (`spec-intake`): the open question that blocked build-readiness
  is a direction question. Build on a fresh `proto/<issue>-<slug>` branch and attach the DECISION
  to the issue.

## Classify the question, then follow the matching guide

- **UI question** — layout, hierarchy, density, affordance, visual or interaction direction →
  [UI.md](UI.md). Variants live in the real app behind `PrototypeSwitcher`, reviewed on the
  branch's Vercel preview.
- **Behavior question** — state transitions, data shape, algorithm, policy under edge cases →
  [LOGIC.md](LOGIC.md). A throwaway interactive CLI, completely outside the application, that
  mimics only the logic in question.
- **Both at once** — the behavior question is almost always upstream. Prototype it first; the UI
  follows the ruled behavior.

## Shared discipline (both shapes)

- **3–4 options, genuinely divergent.** Each must be defensible as the direction we'd actually
  ship. Options that differ only in styling or parameter values are not directions — three
  slightly-tweaked versions of the same idea is wallpaper, not a prototype set.
- **Disposable by construction.** Prototype code never merges. Stripping the losers and the
  harness is part of *applying the ruling*, not cleanup someone remembers later.
- **One link or one command to review.** The reviewer opens the PR/issue and is trying options
  within a minute. If reviewing requires setup instructions, the prototype has failed its job.
- **Real cases, not lorem.** UI variants render real data on the preview; CLI prototypes ship with
  the contentious scenarios preloaded. The awkward case that raised the question must be one
  keypress away.
- **Verify before presenting.** Try every option yourself (preview or terminal) before posting the
  DECISION. One broken option corrupts the whole ruling.
- **Honest tradeoffs.** State each option's win-case and cost candidly. No hiding a favorite by
  under-building the others.

## The DECISION comment

Post on the held PR (hold case) or the needs-spec issue (intake case):

```markdown
## DECISION: <the question, one line>

**Try them:** <preview URL> — flip options with the floating switcher (bottom of screen)
<!-- or, for a behavior prototype: -->
**Try them:** `git fetch origin && git checkout <branch> && pnpm tsx prototypes/<slug>/cli.ts`

| | Direction | Wins | Costs |
|---|---|---|---|
| **A** | <one line: what this direction is> | <where it's clearly better> | <what it gives up> |
| **B** | … | … | … |

**Reply to rule:** `go with A` · `combine: A's <x> + B's <y>` · `riff on B` (new round diverging
around B) · or free-form.
```

## Applying the ruling

- `go with X` — implement X at production quality (for UI this usually means collapsing X's
  variant classes into plain ones), strip every other option and the harness, and the track
  re-enters the normal gates.
- `combine: …` — treat the combination as a new one-line spec; implement it properly, then strip.
- `riff on X` — a new round of 3–4 options diverging around X's axis; same rules.
- Either way: **no prototype surface survives to merge** — no switcher mount, no init script, no
  `prototypes/` directory, no losing variants.
