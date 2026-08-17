---
name: dispatch
description: One autonomous pass over the board's frontier — take the unblocked, unclaimed work and build it to reviewed PRs. Use when a schedule fires, or when the user asks to "dispatch", "run a pass", or "pick up whatever is ready". Refuses to run when the review queue is full, a loop is already in flight, or the board is not in sync.
---

# dispatch

One guarded pass over the frontier, to reviewed PRs, with no human in the loop for its duration. The
board holds the order (`ops/agent-os/labels.md`); `build-until-done` implements, validates against
the DoD (`ops/agent-os/dod.md`), and opens the PR. This skill decides only **whether to run, and on
what**. The human reviews; you never merge by hand. Read `ops/agent-os/invocation.md` before this
pass — that is the orchestrator↔track contract (issue comments, never `SendMessage`; serialize
loops; schema-capable tracks).

## Preconditions — check in order, stop at the first failure

Stopping is a normal outcome. Report which gate stopped it, and stop.

**1. The review queue has room.** A dispatcher that outruns the reviewer builds a backlog of
unreviewed branches that rot against a moving `main`.

```bash
gh pr list --limit 200 --state open --json number,labels --jq '[.[] | select(.labels[].name == "agent:in-review")] | length'
```

Cap: **6**. At or over → stop with "review queue full (N open) — nothing dispatched."

**2. Nothing in flight, and the board is in sync.** A claim means another pass, a human, or a dead
run; all three mean do not start. A stale local `main` is a stale reading environment for everything
the pass does outside a worktree.

```bash
gh issue list --limit 200 --state open --label agent:in-progress --json number,title   # must be empty
git status --porcelain                                                                  # must be empty
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] && echo IN-SYNC || echo STALE
```

Any claim, a dirty tree, or `STALE` → stop, and say which sha each side is on. Never clear a claim
automatically — that is how two loops end up on one branch. A claim whose owning agent is gone is
reverted with the command in `ops/agent-os/invocation.md`, not by editing labels in the UI, and not
by this pass.

**3. The frontier is not empty.** Use the canonical frontier query in `ops/agent-os/labels.md`; do
not re-derive one. It unions `agent:queued` and `agent:changes-requested`. Expand each track along
`dependsOn` to pull in the dependents it will build in later stages — a blocker *inside* the track
lands on the track branch first, one outside it is a hard stop. **Skip `risk:high` unless the
caller opted in** (`dispatch high-risk`): unattended and recurring is a different axis from
autonomous, so auth and tenancy changes start when someone is around. Say how many you skipped.
Empty frontier → stop with what the board waits on.

A unit labelled `agent:changes-requested` keeps its existing branch and PR: set
`changesRequested: true` on it so the loop resumes rather than recutting, reads the PR's review
threads, and re-runs the full DoD. Applying that label is the only human action required.

**3b. At most one schema-capable track per pass.** A track is schema-capable when its `files`
include `db/` / `src/db/` **or** when its spec might need schema even though the file list does
not — a new persisted field, a status column, a unique index, anything that will mint a migration.
Worked example: #202 declared onboarding components and lib, no `db/`, then added
`churches.leadership_status` and minted migration 0028 while another in-flight track minted a
different 0028. Two schema-capable tracks in one pass recreate that journal collision; G5 only
sees one track's declaration. Prefer the track that already declares `db/`; park the rest for the
next pass and say so.

**4. The budget can finish what it starts.** Do not start a stage you cannot finish. No arithmetic
here — the per-attempt reserve before each integration attempt and before each stage, plus
`MAX_ATTEMPTS`, are the real guards inside the loop.

## The pass

```
Workflow({ name: "build-until-done", args: {
  units: [...],
  base: "origin/main",
  autoMerge: true,
  maxConcurrentAgents: 6
} })
```

- `base` is always a **remote** ref. A bare `"main"` is normalised to `origin/main`.
- **Omit `maxAttempts`** — the loop owns it.
- **Cap: 6 concurrent agents**, because a track may hold several workstreams and agents-at-once is
  what consumes wall-clock.
- **`autoMerge: true` is what dispatch adds.** It is off by default so a direct `/deliver` cannot
  merge to `main` by surprise. Under it the loop merges a track only when CI is green, the track is
  not `risk:high`, no unit carries `hold: true`, and no product-shaping question survived unruled.
- On an amendment pass, **the unit id must equal the PR's head branch name** (`U313-WS1`, never
  `U313-fix`) — the track branch is `feature/<unitId>`, so any other id builds validated commits on
  a branch no PR head carries.

Each unit is `{id, title, lane, files, summary, acceptanceCriteria, issue, risk, dependsOn, hold, changesRequested?}`.
`files` comes from the issue's `## Likely files`, the per-workstream lists from `## Workstreams`.
`changesRequested` is true when the issue currently carries `agent:changes-requested`. The loop
cuts units into tracks (shared files ∪ `dependsOn`), then stages, then workstreams, and owns
everything after: claiming, gates, retries, the PR, or `agent:blocked` on exhaustion. Do not
re-implement any of it here, and do not second-guess its verdict.

Talk to a running track only through **issue comments** on the issues it claimed. `SendMessage` to
a loop agent resumes a duplicate continuation (`ops/agent-os/invocation.md`).

### When to set `hold: true`

`hold` means this track never auto-merges: the PR opens, the issues flip to `agent:in-review`, and a
human decides. The loop cannot infer it — set the per-unit flag in two cases:

1. The issue body declares it (never-auto-merge, hold for review, or names a human as the decision).
2. **Always when the unit's files touch the factory** — `.claude/workflows/`, the delivery-OS skills
   under `.claude/skills/`, `.cursor/`, or `ops/agent-os/`. A change to the machine that decides what
   merges keeps a human, because the thing being changed is the thing that would otherwise catch the
   mistake. Use the flag, not `autoMerge: false`, which would stall every clean track beside it.

## After the pass

1. **PRs opened** — number, title, `risk:high` first. This is the human's queue.
2. **Blocked** — issue, the gate that failed, and the one thing needed to unblock it.
3. **Surviving worktrees** — one line each, with the branch it holds. They are the only re-runnable
   copy of a held or blocked track; do not remove them.
4. **Browser sweep** — run `scripts/cleanup-mcp-browsers.sh` and report its output line. It catches
   browsers whose agent died before teardown; run it only at a pass boundary.

## Hard rules

- **Never merge outside the loop's gate**, and never merge a `risk:high` or factory PR at all.
- **Never clear an `agent:in-progress` claim** this pass did not set.
- **One pass, then stop.** A quiet no-op is a success — never manufacture work to justify the run.
