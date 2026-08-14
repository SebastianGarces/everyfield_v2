---
name: open-pr
description: Open a GitHub PR for a completed track — but ONLY when the Definition of Done verdict is PASS. Writes the DoD evidence bundle into the PR body, links the issue with Closes #, and flips the issue label to agent:in-review. Use as the final step of build-until-done. Refuses to open a PR on a FAIL verdict.
---

# open-pr

The only sanctioned way a PR enters existence. Precondition: a `definition-of-done` verdict of `PASS`
or `PASS_WITH_WARNINGS`. On `FAIL`, or with required evidence missing, do not open a PR — return
control to the loop.

## Procedure

1. Push the branch: `git push -u origin <branch>`.
2. Build the body from the evidence bundle (template below) and open, or update, **the** PR for this
   branch — never a second one.
   ```bash
   gh pr create --base main --head <branch> \
     --title "<type>: <concise summary> (#<issue>)" \
     --body-file <path> --label "agent:in-review" \
     $([ "$HIGH_RISK" = true ] && echo --label risk:high)
   ```
3. Flip **every** issue the track closes, and read each label back:
   ```bash
   for i in <issue>...; do
     gh issue edit $i --add-label agent:in-review --remove-label agent:in-progress
     gh issue view $i --json labels --jq '[.labels[].name]'   # must print agent:in-review
   done
   ```
4. Anchor on CI: `gh pr checks <number> --watch --fail-fast`.
5. Return the PR URL.

## The CI anchor, and the labels

Report the conclusion of the **`Format, Lint, Typecheck, Build`** check *verbatim* — `success`,
`failure`, `timed_out` or `none`. Anything else: fetch the real failure with
`gh run view <run-id> --log-failed` and return it.

- **Report what CI said, not what you believe.** "The failure looks unrelated" is an opinion about a
  conclusion, not a conclusion. **`none` is not success** — a check that never reported reads as "not
  yet run" forever. A green DoD with a red check is a failed attempt whose error feeds back.
- **Never report a label you did not observe.** `gh issue edit` exiting 0 is not proof; what
  `gh issue view --json labels` prints is. Retry a write that did not stick — it is idempotent — and
  make sure `agent:in-progress` is *gone*, not merely joined by `agent:in-review`.
- **A label that cannot be confirmed is an ERROR**, reported as such. A green PR whose issue still
  reads `agent:in-progress` is worse than a failed one, because it will be believed.

## PR body template

```markdown
## What & why
<1–3 sentences. One `Closes #<issue>` line per issue this track closes.>

## Definition of Done ✅

| Gate | Status | Evidence |
|------|--------|----------|
| CI green | ✅ | `Format, Lint, Typecheck, Build` at <sha> |
| Works | ✅ | screenshots <refs> · a11y <n> · console clean — or the request transcript |
| Reviewed | ✅ | code-reviewer: PASS — <n> findings, all applied |

### Acceptance criteria
- [x] <AC 1> — <verification method + result>

## 👀 Manual QA

**Preview:** <url> → <exact path(s) to open>

**Walk the happy path** (~N min)
1. <concrete click-by-click step> — Expect: <what should happen>

**What the automation could NOT check** — this is where your eyes add something:
- <does the layout read right, is the copy sensible, does it feel fast>
- <edge case asserted by no AC>

**Known limitations / deliberate cuts**
- <scope explicitly excluded, so it does not read as a bug>

<details><summary>Schema diff (high-risk only)</summary>

```sql
<DDL delta>
```
</details>

🤖 Built and validated by the Agent Delivery OS.
```

**Never omit `Closes #<issue>`** — one line per issue the track closes, or the board silently keeps an
issue open. **Never let Manual QA restate the acceptance criteria**: the gates proved those, and human
attention is the scarcest resource here. That section earns its place only by naming what the
automation cannot judge — whether it looks right, reads right, feels right, and whether an unasserted
edge case bites. A pure refactor or docs change says so in one line rather than padding the list.
