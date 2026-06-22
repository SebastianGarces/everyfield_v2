---
name: standup
description: Answer "what's pending?" / "what are we working on?" with a morning status board — GitHub issues grouped by status label, the open-PR review queue, and any running build loops. Use when the user asks for status, a standup, the backlog, or "what should I review". Read-only.
---

# standup ("what's pending?")

The morning report. Read-only — it reports, it doesn't start work. Pulls the durable board (GitHub
Issues) + the live PR review queue + in-flight loops, and renders one compact view.

## Procedure

1. **Board** — issues by status label:
   ```bash
   gh issue list --label agent:in-progress --state open --json number,title,labels,updatedAt
   gh issue list --label agent:queued      --state open --json number,title,labels
   gh issue list --label agent:blocked     --state open --json number,title,labels,updatedAt
   gh issue list --label agent:in-review    --state open --json number,title
   ```
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

⚪ QUEUED (3)
  • #19, #20, #21   (~240k budget to clear all 3)

✅ Shipped since yesterday: #08, #09 (PRs merged)
```

## Rules

- **Read-only.** Never start, retry, or merge from standup — just report. (The user starts work with `/deliver`.)
- **Lead with what needs the human:** review queue + blocked, before in-flight/queued.
- **Blocked = actionable:** always include the failing gate + the one thing needed to unblock.
- Keep it scannable — counts and IDs, not paragraphs.
