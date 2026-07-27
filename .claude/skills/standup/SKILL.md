---
name: standup
description: Answer "what's pending?" / "what are we working on?" with a morning status board — GitHub issues grouped by status label, the open-PR review queue, and any running build loops — then interview the user on open decision issues so rulings land before dispatch. Use when the user asks for status, a standup, the backlog, or "what should I review". Read-only for builds; decisions get ruled.
---

# standup ("what's pending?")

The morning report, plus the morning's rulings. Pulls the durable board (GitHub Issues) + the live PR
review queue + in-flight loops, renders one compact view — then walks the open `decision` issues with
the user so as much of the frontier as possible is unlocked before `/dispatch`. It never starts build
work.

## Procedure

1. **Board** — issues by status label:
   ```bash
   gh issue list --label agent:in-progress --state open --json number,title,labels,updatedAt
   gh issue list --label agent:queued      --state open --json number,title,labels
   gh issue list --label agent:blocked     --state open --json number,title,labels,updatedAt
   gh issue list --label agent:in-review    --state open --json number,title
   gh issue list --label agent:delivery-failed --state open --json number,title,labels,updatedAt
   ```
   Report `agent:delivery-failed` **separately from** `agent:blocked`, and say what it means: those
   passed the DoD and only the push/PR step failed, so the action is to retry the delivery, not to
   review the code. Folding them together is how a finished build gets re-litigated.
1b. **The frontier** — of the queued issues, which are actually *takeable* right now. A queued issue
   with an open blocker is not runnable, and reporting it as available is the main way a standup
   misleads:
   ```bash
   R={owner}/{repo}
   gh issue list --state open --label agent:queued --json number --jq '.[].number' | while read n; do
     b=$(gh api repos/$R/issues/$n --jq '.issue_dependencies_summary.blocked_by')
     [ "$b" = "0" ] && echo "frontier $n" || echo "blocked-by-dep $n ($b open)"
   done
   ```
1c. **Feature progress** — the roll-up that replaced the checklist files:
   ```bash
   gh issue list --label feature --state open --json number,title
   gh api repos/$R/issues/<parent> --jq '.sub_issues_summary'   # {completed, total, percent_completed}
   ```
   Also surface open `decision` issues. They gate builds, they never close by a PR, and they are the
   easiest thing on the board to forget — a decision nobody rules on silently stalls its dependents.
1d. **Interview the decisions — don't just list them.** (Ruled in 2026-07-27: rulings are part of the
   standup, so the frontier is as unlocked as possible before dispatch.) After rendering the board:
   - For each open `decision` issue, read the issue body **and the evidence it links** (usually a
     `docs-audit` § or an FRD line) so the question is concrete, not a title.
   - Present the context compactly in chat, then ask via **AskUserQuestion** — one question per
     decision (max 4 per call), each option carrying its consequence (migration? build issue? just a
     doc fix?). Recommend one when the evidence supports it.
   - Apply each ruling the whole way: append to the decision ledger (`docs-audit-2026-07.md` §4),
     amend the owning FRD so canon reads as canon, file build/`needs-spec` issues where the ruling
     changes shipped behaviour or needs discovery, close the decision issue with the ruling, and PR
     the doc changes. The user may defer any question ("skip", "later") — deferring is a valid
     answer, never nag.
   Do the same for `needs-spec` issues ONLY if the user asks — those need discovery sessions, not a
   multiple-choice ruling.
2. **Your review queue** — open PRs the factory has produced:
   ```bash
   gh pr list --state open --json number,title,headRefName,labels,isDraft,createdAt
   ```
   Flag `risk:high` PRs first.
3. **Running loops** — check live background work in this session:
   - `TaskList` (in-session tasks) and `/workflows` (running `build-until-done` runs).
4. **For blocked items**, pull the latest issue comment (the failing gate + evidence) so the user knows
   what each needs.

## Output (render as a compact board)

```
📋 Standup — <date>

🔴 NEEDS YOU
  • Review queue (PRs):
      #PR 41  feat: documents sidebar           risk:high   ← review first
      #PR 42  fix: empty-state copy
  • Blocked (2):
      #18  schema: plant signals   — G3 migration rollback failed (attempt 3/3). See comment.

🟢 IN FLIGHT
  • #12  in-progress  build-until-done attempt 2/3 (G3 frontend)
  • #15  in-progress  …

⚪ FRONTIER (3 takeable)
  • #19, #20, #21   (~240k budget to clear all 3)
  ⤷ also queued but blocked: #94 (waits on #29), #101 (waits on #29)

🟣 DECISIONS OPEN (2) — no PR closes these; interviewing after the board (step 1d)
  • #85  MT-011: training per role or per team?
  • #96  VM: which attendees get an auto follow-up task?

📊 FEATURES
  • F6 Documents  1/3     F1 Wiki  0/9     F3 Meetings  0/9

✅ Shipped since yesterday: #08, #09 (PRs merged)
```

## Rules

- **Read-only for builds.** Never start, retry, or merge build work from standup — just report. (The
  user starts work with `/deliver`.) The one write path standup owns is step 1d: ruling on open
  `decision` issues and landing those rulings (ledger, FRD, issues, PR).
- **Lead with what needs the human:** review queue + blocked, before in-flight/queued.
- **Queued ≠ takeable.** Always separate the frontier from queued-but-dependency-blocked. Reporting a
  blocked issue as available sends the loop at work it cannot finish.
- **Never read status from the Project board.** The `agent:*` labels are canonical; the board's
  `Status` field is mirrored from them and can lag or fail. See `ops/agent-os/labels.md`.
- **Blocked = actionable:** always include the failing gate + the one thing needed to unblock.
- Keep it scannable — counts and IDs, not paragraphs.
