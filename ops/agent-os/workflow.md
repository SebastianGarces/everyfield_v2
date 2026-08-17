# The loop — cycle and fences

The build loop is `.claude/workflows/build-until-done.js`. This page is the contract the prompts
implement; do not re-derive it from a transcript.

## Cycle

```
setup (serialize + claim + cut + env + inbox) → implement (per workstream) → integrate
  → review → at most one fix → ship (WORKS + PR + CI + labels)
```

One branch, one PR, however many issues the track closes. Exhaustion is `agent:blocked` plus an
evidence comment — never a silent stop. Factory-path and `risk:high` tracks never auto-merge.

## Inbox — issue comments, at a defined point

After setup has claimed the issues and cut the tree, **before any implementer runs**, the loop
reads each claimed issue's comments. Orchestrator instructions posted mid-track appear in the
implementer's prompt. The implementer reports the comment ids it consumed; those ids are the
record. Comments the loop itself wrote (claim notices, exit evidence) are not instructions.

A `SendMessage` is not an inbox item — see `ops/agent-os/invocation.md`.

## Serialized invocation

Setup's first read is the open `agent:in-progress` list, ignoring issues this invocation already
owns. Any other holder → refuse, name them, do not build. Issues this loop already claimed are
reverted to `agent:queued` (not `agent:blocked` — nothing failed the DoD). Recovery for a claim
whose agent is gone is in `ops/agent-os/invocation.md`.

The scan is `gh api --paginate "repos/$R/issues?labels=agent:in-progress&state=open&per_page=100"`,
never `gh issue list --limit N` — see `ops/agent-os/labels.md`. A bare limit caps at 30 and answers
from a window over the newest issues, so a holder outside the window reads as an empty board and two
loops run at once.

**The claim is re-checked after it is written.** Reading holders and writing the claim are two steps,
so two loops launched together both read an empty board and both claim. Setup therefore re-runs the
same scan *after* its label writes; a claimant that appears there makes this loop release exactly the
issues it claimed and refuse.

> **Accepted residual.** In a dead heat both loops see each other and both back off, so the pass
> builds nothing. That is fail-safe rather than fail-dangerous — a pass nobody ran costs one
> re-dispatch, while two loops on one branch and one claim is corrupted work. Do not "fix" it with a
> tie-break that lets one side proceed on its own reading of the board.

## G5 — undeclared migrations are blocking

File-ownership fencing is the workstream's declared files. A new path under `src/db/migrations/`
when `db/` is **not** in that declaration is a **blocking** deviation, never a justified one. The
halt tells the agent to **re-declare** (add the migration and schema files to the workstream)
rather than to delete the migration. Deleting it would drop the DDL and still leave the next track
free to mint a colliding journal number.

Worked example: #202 declared onboarding files, no `db/`, minted `0028` while #224 minted a
different `0028`.

## Changes-requested re-entry

`agent:changes-requested` is a status label, mutually exclusive with the others. Applying it to an
issue whose PR is open is the only human action required to put the work back on the frontier. The
loop then:

1. Claims by dropping `agent:changes-requested` (or `agent:queued`) for `agent:in-progress`.
2. Resumes the existing branch — never recuts, never opens a second PR.
3. Reads the PR's review threads and inline comments as implementer input.
4. Re-runs the **full DoD** — a **new pass**, with its own single code review, its own WORKS look and
   its own CI anchor. A human asking for a change does not lower the bar.
5. Replies on every thread: what changed, or not actioned and why. Silence is not a reply.

### Thread routing — one thread, one answering place

Every review thread is routed to **exactly one** place before any implementer runs:

- A thread whose path a workstream's **declared files** own goes to that workstream, and that
  workstream is gated on **its** threads only.
- A thread with no path, or a path no workstream declared, is **track-level** and the **ship** pass
  answers it — the only step holding the whole track's diff. An unanswered one is a merge refusal in
  the same class as a stale body sha: the remedy is another ship pass, never a fix round.
- A track with a single workstream *is* the track, so that workstream owns every thread.

Handing every thread to every workstream is wrong in both directions at once: each workstream either
posts a duplicate reply on a thread about someone else's files, or correctly declines it and is then
blocked for not covering it.

## Worktree materialisation

One in-repo command creates a track worktree: `scripts/worktree-add.sh`, which is
`git worktree add` then `scripts/worktree-env.sh`. Loop sites go through that
command only — never raw `git worktree add`, never `isolation: "worktree"`.

The workflow runtime cannot exec the script itself yet, so implementers still run
`scripts/worktree-env.sh` if `.env.local` is missing (idempotent). `pnpm install`
is a separate agent step; a fresh worktree has no `node_modules`.
