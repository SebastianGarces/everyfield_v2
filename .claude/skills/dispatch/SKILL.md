---
name: dispatch
description: One autonomous pass over the board's frontier — take the unblocked, unclaimed work and build it to PRs. Use when a schedule fires, or when the user asks to "dispatch", "run a pass", or "pick up whatever is ready". Refuses to run when another pass already holds a claim.
---

# dispatch

One unattended pass over the frontier, to PRs on auto-merge, with no human in the loop for its
duration. **You run the process yourself** — read `ops/process.md` first; it is the authority for the
loop, and this skill only adds the guard, the pass shape, and the report.

## 1. Refuse if another pass is in flight

A claim means another pass, a human, or a dead run. All three mean do not start.

```bash
R=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api --paginate "repos/$R/issues?labels=agent:in-progress&state=open&per_page=100" \
  --jq '.[] | select(.pull_request == null) | "\(.number)\t\(.title)"'    # must be empty
git status --porcelain                                                    # must be empty
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] && echo IN-SYNC || echo STALE
```

Any claim, a dirty tree, or `STALE` → stop, and say which sha each side is on. Stopping is a normal
outcome; report which check stopped it.

**Never clear a claim automatically** — that is how two passes end up on one branch. A claim whose
owning agent is confirmed gone is recovered one issue at a time, by hand, not by this pass:

```bash
gh issue edit <n> --add-label agent:queued --remove-label agent:in-progress
```

## 2. Read the frontier

Run the canonical frontier query in `ops/process.md` § The loop. Do not re-derive one. An empty
frontier → stop, and say what the board is waiting on. A quiet no-op is a success.

Pick what this pass will build. Two or three issues is a normal pass; prefer issues whose
`## Likely files` do not overlap, and take at most one issue that will mint a migration — two
migrations in one pass collide on the journal number.

## 3. Build each picked issue

Per `ops/process.md`, in order:

1. **Claim it** — swap `agent:queued` (or `agent:changes-requested`) for `agent:in-progress`, and
   read the label back with `gh issue view <n> --json labels`.
2. **Worktree** — `scripts/worktree-add.sh -b feature/<slug> <path> origin/main`, never raw
   `git worktree add`. A fresh worktree has no `node_modules`: run `pnpm install` in it.
3. **Implement** — spawn subagents in the worktree, every one pinned to model `opus`. An issue
   labelled `agent:changes-requested` keeps its existing branch and PR: resume it, read the PR's
   review threads, and re-validate rather than recutting.
4. **Prove it works, once** — the branch's Vercel preview, never `localhost:3000`
   (`.claude/skills/browser-validation/`). Backend work gets one real request asserting status and
   shape.
5. **Ship** — open the PR per `.claude/skills/open-pr/`, `Closes #<issue>` per issue, evidence in the
   body, then enable auto-merge and move on. A migration in the diff owes its scratch-DB transcripts
   and DDL delta.

If something fails, fix it and go again. No attempt cap, no handing the work back.

## 4. End of pass

1. **PRs opened** — number, title, and whether each merged on green CI.
2. **What failed** — issue, what failed, and what you did about it.
3. **Surviving worktrees** — one line each with the branch it holds. They are the only re-runnable
   copy of an unmerged branch; do not remove them.
4. **Browser sweep** — run `scripts/cleanup-mcp-browsers.sh` and report its output line. It catches
   browsers whose agent died before teardown; run it only at a pass boundary.

**One pass, then stop.** Never manufacture work to justify the run.
