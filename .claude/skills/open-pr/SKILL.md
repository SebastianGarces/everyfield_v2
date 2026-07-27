---
name: open-pr
description: Open a GitHub PR for a completed track — but ONLY when the Definition of Done verdict is PASS. Writes the DoD evidence bundle into the PR body, links the issue with Closes #, and flips the issue label to agent:in-review. Use as the final step of build-until-done. Refuses to open a PR on a FAIL verdict.
---

# open-pr (gated PR creation)

The **only** sanctioned way a PR enters existence. Its precondition is a passing DoD report — this is
what makes "a PR means it's actually done" true.

## Hard precondition

- Input is a `definition-of-done` report. If `verdict` is `FAIL` (or any gate is FAIL, or required
  evidence is missing) → **do not open a PR**. Return control to the loop to retry/block.
- The branch must be pushed: `git push -u origin <branch>`.

## The DoD is a claim. CI is the anchor.

A passing DoD report is an agent's account of its own work. That is necessary and not sufficient:
the loop's own history contains a PR whose DoD said PASS with a browser gate that never opened a
browser. **So the job does not end when the PR is open. It ends when the required check is green.**

After opening (or updating) the PR:

```bash
gh pr checks <number> --watch --fail-fast
```

Then report the conclusion of the **`Format, Lint, Typecheck, Build`** check *verbatim* —
`success`, `failure`, `timed_out`, or `none`. If it is anything but `success`, fetch the real
failure and return it:

```bash
gh run view <run-id> --log-failed
```

Three rules, all of which exist because the opposite has happened here:

- **Report what CI said, not what you believe.** "The failure looks unrelated" is not a conclusion,
  it is an opinion about a conclusion.
- **`none` is not success.** A check that never reported is the failure mode that hid PR #34 for a
  month — it reads as "not yet run" forever.
- **Never open a second PR for a branch that already has one.** On a retry the push updates the
  existing PR; a duplicate splits the evidence and the check history.

The loop treats a green DoD with a red check as a **failed attempt** and feeds the CI error back in.
That is the intended path — a red check is information, not an emergency.

## Procedure

1. Verify `verdict ∈ {PASS, PASS_WITH_WARNINGS}`. Otherwise abort with a clear reason.
2. Push the branch.
3. Build the PR body from the evidence bundle (template below).
4. Open it:
   ```bash
   gh pr create \
     --base main \
     --head <branch> \
     --title "<type>: <concise summary> (#<issue>)" \
     --body-file <path> \
     --label "agent:in-review" \
     $([ "$HIGH_RISK" = true ] && echo --label risk:high)
   ```
5. Move the issue into the review queue:
   ```bash
   gh issue edit <issue> --remove-label agent:in-progress --add-label agent:in-review
   ```
6. Return the PR URL.

## PR body template

```markdown
## What & why
<1–3 sentences. Closes #<issue>.>

## Definition of Done ✅
| Gate | Status | Evidence |
|------|--------|----------|
| G1 Static | ✅ | tsc 0 · lint 0 · build ok |
| G2 Tests | ✅ | 42 passed |
| G3 Functional | ✅ | see ACs + screenshots below |
| G4 Conventions | ✅ | cursor-pointer ✓ · db:migrate ✓ · memory ✓ |
| G5 Diff hygiene | ✅ | scoped to declared files |
| G6 Independent review | ✅ | code-reviewer: PASS |

### Acceptance criteria
- [x] <AC 1> — <verification method + result>
- [x] <AC 2> — …

### Evidence
- Screenshots: <refs>
- Lighthouse: a11y 96 / perf 82
- Console: no errors
- Migration (if any): applied; rollback verified; schema diff below

## 👀 Manual QA

**Preview:** <vercel preview URL> → <exact path(s) to open>

**Walk the happy path** (~N min)
1. <concrete click-by-click step>
2. <…>
   - Expect: <what should happen>

**What the automation could NOT check** — this is where your eyes actually add something:
- <judgement call: does the layout read right, is the copy sensible, does it feel fast>
- <edge case asserted by no AC>
- <anything the DoD proved *compiles and responds* but not that it is *good*>

**Known limitations / deliberate cuts**
- <scope explicitly excluded, so it does not read as a bug>

<details><summary>Schema diff (high-risk only)</summary>

```sql
<DDL delta>
```
</details>

🤖 Built and validated by the Agent Delivery OS. Closes #<issue>.
```

## Rules

- **Closes #<issue>** in the body so merging closes the board item — no manual bookkeeping.
- **Never open a PR without the evidence table.** The table is the contract with the reviewer.
- **Never open a PR without the Manual QA section**, and never let it restate the acceptance criteria.
  G3 already proved the ACs; repeating them wastes the one scarce resource in this system, which is
  human attention. The section earns its place only by naming what the automation *cannot* judge —
  whether it looks right, reads right, feels right, and whether an unasserted edge case bites. If a
  track genuinely has nothing a human should eyeball (a pure refactor, a docs change), say that in one
  line rather than padding the list.
- Conventional-commit-style title with the issue number.
- One PR per track/issue. Don't bundle unrelated work.
- End the PR body with the Claude Code attribution line (per repo convention).
