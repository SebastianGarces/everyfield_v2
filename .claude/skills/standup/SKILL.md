---
name: standup
description: Answer "what's pending?" / "what are we working on?" with a morning status board — GitHub issues grouped by status label, the open-PR review queue, and any running build loops — then rule the open decision issues so the frontier is unlocked before dispatch. Use when the user asks for status, a standup, the backlog, or "what should I review". Read-only for builds.
---

# standup ("what's pending?")

The morning board plus the morning's rulings. Never starts build work.

## Procedure

1. **The board.** One query, grouped locally:

   ```bash
   gh issue list --limit 200 --state open --json number,title,labels,updatedAt
   gh pr list   --limit 200 --state open --json number,title,headRefName,labels,isDraft,createdAt
   ```

   `--limit 200` is mandatory — `gh` truncates silently at 30. Group by `agent:*` label, and keep
   `agent:delivery-failed` separate from `agent:blocked`: the first needs a retry, the second a human.

2. **The frontier.** Which queued issues are takeable right now — use the canonical frontier query in
   `ops/agent-os/labels.md`. Queued with an open blocker is not runnable, and reporting it as
   available is the main way a standup misleads.

3. **Live work.** `TaskList` and `/workflows` for running loops; for each blocked issue, its latest
   comment, so the failing gate is in the report.

4. **Features.** `gh issue list --limit 200 --label feature --state open`, plus
   `gh api repos/{owner}/{repo}/issues/<parent> --jq '.sub_issues_summary'` for the roll-up.

5. **Rule the open `decision` issues — do not just list them.** Read each issue and the evidence it
   links, then rule it from `product-docs/product-values.md`, `CONTEXT.md` and
   `memory/invariants.md`; convene a short consulate (2–3 perspectives, one synthesis) for a hard
   call. Record the ruling in `product-docs/decisions.md`, amend the owning FRD, file whatever issues
   it creates, and close the decision issue with it. Put the call to the user only when it is
   irreversible or a matter of their taste — and never nag a deferred one.

## Output

One compact board, in this order: **needs you** (review queue, `risk:high` first, then blocked with
the failing gate and the one thing that unblocks it) · **in flight** · **frontier** (takeable, then
queued-but-blocked with what each waits on) · **decisions** (ruled today, and any escalated) ·
**features** · **shipped since yesterday**. Counts and IDs, not paragraphs.

## Rules

- **Read-only for builds.** Never start, retry, or merge build work here; the user starts work with
  `/deliver`. Rulings are the one write path standup owns.
- **Queued ≠ takeable**, and the `agent:*` labels are canonical — never read status from the Project
  board (`ops/agent-os/labels.md`).
