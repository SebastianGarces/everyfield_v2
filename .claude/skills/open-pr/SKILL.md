---
name: open-pr
description: The PR body template and the label-write discipline for a completed track. Use when opening or updating a PR from an evidence bundle — the loop's ship pass applies this inline.
---

# open-pr

**The authority for the PR body template and the label discipline.** The loop's ship pass applies
both inline rather than calling this skill; anything opening a PR by hand follows it directly.

## Procedure

1. Push the branch: `git push -u origin <branch>`.
2. Build the body from the evidence bundle (template below) and open, or update, **the** PR for this
   branch — never a second one.
   ```bash
   gh pr create --base main --head <branch> \
     --title "<type>: <concise summary> (#<issue>)" \
     --body-file <path>
   ```
   **The body file is owned, never shared**: write it to a path carrying the issue number —
   `pr-body-<issue>.md` — never a generic `pr-body.md`. Concurrent tracks share one scratchpad, and
   a generic name is a silent cross-track clobber (it happened: a `gh pr edit --body-file` pushed
   another track's body onto a merged PR). Re-read the file immediately before every
   `--body-file` use and confirm it opens with your own `Closes #<issue>`.

   The schema diff below is owed by any diff carrying a migration — no label decides that, the diff
   does. The issues keep `agent:in-progress`; the merge closes them via `Closes #`, and a closed
   issue's labels are history (ruled 2026-08-19 — `agent:in-review` is retired with the review
   queue).
3. Anchor on CI: `gh pr checks <number> --watch --fail-fast`.
4. **Take the merge off autopilot, then back-fill the body from the anchor.** In that order:
   ```bash
   gh pr merge <number> --disable-auto
   gh pr edit <number> --body-file <path>
   gh pr view <number> --json headRefOid   # the body must still describe the head
   ```
   `--disable-auto` runs **every time**, not only after a stall, and it is safe when nothing is
   armed. With strict required checks, auto-merge silently rebases the branch and can fire
   *between* the back-fill and your merge — #571 landed with an accurate body only by ordering
   luck. The back-fill replaces the CI row with the conclusion GitHub reported and the sha it ran
   at.
5. Merge, behind the hold check:
   ```bash
   ops/merge-hold.sh <number> --wait && gh pr merge <number> --squash
   ```
   **The check and the merge are one command, joined by `&&`** — see *The merge hold* below. Never
   run the check earlier in the ship step and merge minutes later, and never arm `--auto` to get
   around a hold: it fires later without re-reading anything.
6. Return the PR URL.

## The merge hold

When one PR is starved — main keeps moving under it and it never becomes mergeable — the
orchestrator puts **`merge-priority`** on it and every other track holds its merge until that PR
lands. The hold lives on the board, so you read it; nobody sends it to you.

`ops/merge-hold.sh <your-pr> [--wait]` is that read. Exit 0 is clear, exit 1 names the PR holding
you. It considers only OPEN pull requests, so a label left behind on a merged one holds nobody.

- **Call it in the same command as the merge**, `&&`-joined. The window a hold has to close is the
  gap between deciding to merge and merging, and a check at the top of the ship step *is* that gap:
  CI takes minutes and the hold lands inside them. This is not hypothetical — on 2026-08-21 a track
  merged 13 seconds before its hold arrived and knocked the starved PR back to `BEHIND`.
- **Arming auto-merge counts as merging.** `--auto` fires later without re-reading anything, so
  never arm it while the check exits 1. Wait with `--wait`, then merge for real.
- **Your own PR never holds you** — pass your number and it is excluded.

## The CI anchor, and the labels

Report the conclusion of the **`Format, Lint, Typecheck, Build`** check *verbatim* — `success`,
`failure`, `timed_out` or `none`. Anything else: fetch the real failure with
`gh run view <run-id> --log-failed` and return it.

- **Report what CI said, not what you believe.** "The failure looks unrelated" is an opinion about a
  conclusion, not a conclusion. **`none` is not success** — a check that never reported reads as "not
  yet run" forever. A red check is a failed attempt whose error feeds back.
- **Never report a label you did not observe.** `gh issue edit` exiting 0 is not proof; what
  `gh issue view --json labels` prints is. Retry a write that did not stick — it is idempotent.
- **The body is evidence, so it is checked like evidence: every sha it cites must be the head sha.**
  A table still reading `⏳ anchoring`, or `CI ❌ at <ancestor sha>`, or a preview validated one
  commit back, describes a different commit than the one about to merge — and it will be believed
  too. **This refuses the merge**, it is not a note for later: back-fill the CI cell from the landed
  anchor, correct any cell the fix round moved, and only then merge. This is why the merge is the
  last step and `--disable-auto` comes before the back-fill — a merge that beats the edit makes
  `⏳ anchoring` the permanent record. After any merge you did not personally execute, read the
  published body back (`gh pr view <number> --json body`).

## PR body template

```markdown
## What & why
<1–3 sentences. One `Closes #<issue>` line per issue this track closes.>

## Evidence ✅

| Check | Status | Evidence |
|-------|--------|----------|
| CI green | ✅ | `Format, Lint, Typecheck, Build` at <sha> |
| Works | ✅ | screenshots <refs> · a11y <n> · console clean — or the request transcript |
| Reviewed | ✅ | code-reviewer: PASS — <n> findings, all applied |

### Acceptance criteria
- [x] <AC 1> — <verification method + result>

## Rulings
<Only when the review ruled on something, or left a finding standing.>
- <the call> — <the source that ruled it: product-values, CONTEXT, or the invariant>
- <a standing finding, verbatim, as a decision: merge as-is / a named fix / take it manually>

## 👀 Manual QA

**Preview:** <url> → <exact path(s) to open>

**Walk the happy path** (~N min)
1. <concrete click-by-click step> — Expect: <what should happen>

**What the automation could NOT check** — this is where your eyes add something:
- <does the layout read right, is the copy sensible, does it feel fast>
- <edge case asserted by no AC>

**Known limitations / deliberate cuts**
- <scope explicitly excluded, so it does not read as a bug>

<details><summary>Schema diff (whenever the diff carries a migration)</summary>

```sql
<DDL delta>
```

**Applies** (`pnpm db:migrate` on a scratch DB):
```
<transcript, verbatim>
```

**Rolls back** (the down path, on that same scratch DB):
```
<transcript, verbatim>
```
</details>

🤖 Built and validated by the Agent Delivery OS.
```

**The schema-diff section is owed whole or not at all**: the DDL delta alone is a FAIL, because a
delta nobody applied is a claim. Both transcripts, both directions, from a scratch DB — and if either
direction will not run, fix the migration rather than writing the section anyway.

**Never omit `Closes #<issue>`** — one line per issue the track closes, or the board silently keeps an
issue open. **Never let Manual QA restate the acceptance criteria**: the checks proved those, and human
attention is the scarcest resource here. That section earns its place only by naming what the
automation cannot judge — whether it looks right, reads right, feels right, and whether an unasserted
edge case bites. A pure refactor or docs change says so in one line rather than padding the list.
