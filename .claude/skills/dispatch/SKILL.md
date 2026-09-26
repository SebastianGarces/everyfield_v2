---
name: dispatch
description: One autonomous pass over the board's frontier — take the unblocked, unclaimed work and build it to PRs. Use when a schedule fires, or when the user asks to "dispatch", "run a pass", or "pick up whatever is ready". Refuses to run when another pass already holds a claim.
---

# dispatch

One unattended pass over the frontier, to reviewed PRs merged after green CI, with no human in the loop for its
duration. **You run the process yourself** — read `ops/process.md` first; it is the authority for the
loop, and this skill only adds the guard, the pass shape, and the report.

## 1. Refuse if another pass is in flight

A claim means another pass, a human, or a dead run. All three mean do not start.

```bash
ops/board.sh claims          # must be empty
git status --porcelain       # must be empty
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] && echo IN-SYNC || echo STALE
```

The claim read matches labels itself rather than asking the API to filter them. A server-side
label filter lags about three seconds behind the write, and two passes starting inside that window
would both read an empty claim list and both proceed — the exact collision this section exists to
refuse. Measurement in the header of `ops/board.sh`.

Any claim, a dirty tree, or `STALE` → stop, and say which sha each side is on. Stopping is a normal
outcome; report which check stopped it.

**Never clear a claim automatically** — that is how two passes end up on one branch. A claim whose
owning agent is confirmed gone is recovered one issue at a time, by hand, not by this pass:

```bash
gh issue edit <n> --add-label agent:queued --remove-label agent:in-progress
```

## 2. Read the frontier

`ops/board.sh frontier` — the canonical query, and the only one. Do not re-derive it with
`gh issue list --label` or `?labels=`; see § 1. An empty frontier → stop, and say what the board is
waiting on. A quiet no-op is a success.

Pick what this pass will build. Two or three issues is a normal pass; prefer issues whose
`## Likely files` do not overlap, and take at most one issue that will mint a migration — two
migrations in one pass collide on the journal number.

## 3. Build each coherent change

Related issues may share one branch and PR when they form one reviewable outcome. Claim every
included issue, keep follow-up fixes on that PR, and keep unrelated changes separate.

Per `ops/process.md`, in order:

1. **Claim it** — swap `agent:queued` (or `agent:changes-requested`) for `agent:in-progress`, and
   read the label back with `gh issue view <n> --json labels`.
2. **Worktree** — use the current checkout when the host already placed this task in a managed
   Codex worktree. Otherwise run
   `scripts/worktree-add.sh -b codex/<slug> <path> origin/main`, never raw `git worktree add`.
   A fresh worktree has no `node_modules`: run `pnpm install` in it.
3. **Implement** — use one subagent per genuinely file-disjoint workstream and inherit the host's
   configured model unless the user explicitly requested an override. An issue
   labelled `agent:changes-requested` keeps its existing branch and PR: resume it, read the PR's
   review threads, and re-validate rather than recutting.
4. **Prove the changed behavior** using a Portless production-mode snapshot of the final commit
   (`ops/local-previews.md`, `.agents/skills/browser-validation/`). Use development mode while
   iterating. Backend work gets real requests asserting status and shape. Docs-only work uses
   relevant document/config checks and needs no app deployment.
5. **Ship** — open the PR per `.agents/skills/open-pr/`, `Closes #<issue>` per issue, evidence in the
   body, then wait for CI and perform the explicit merge after the current merge-hold check. Never
   arm auto-merge. A migration in the diff owes its scratch-DB transcripts and DDL delta.

If something fails, fix it and go again. No attempt cap, no handing the work back.

## 4. End of pass

1. **PRs opened** — number, title, and whether each merged on green CI.
2. **What failed** — issue, what failed, and what you did about it.
3. **Preview cleanup** — stop completed previews and remove clean secondary worktrees once all
   users are finished, following `ops/local-previews.md`. Commits remain on the retained branches.
   Report surviving previews/worktrees, their owner and lease, and any incomplete cleanup.
4. **Browser sweep** — run `scripts/cleanup-mcp-browsers.sh` and report its output line. It catches
   browsers whose agent died before teardown; run it only at a pass boundary.

**One pass, then stop.** Never manufacture work to justify the run.
