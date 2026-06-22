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
- Conventional-commit-style title with the issue number.
- One PR per track/issue. Don't bundle unrelated work.
- End the PR body with the Claude Code attribution line (per repo convention).
