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
4. Re-runs the **full DoD** (review, WORKS, CI). A human asking for a change does not lower the bar.
5. Replies on every thread: what changed, or not actioned and why. Silence is not a reply.

## Worktree materialisation

One in-repo command creates a track worktree: `scripts/worktree-add.sh`, which is
`git worktree add` then `scripts/worktree-env.sh`. Loop sites go through that
command only — never raw `git worktree add`, never `isolation: "worktree"`.

The workflow runtime cannot exec the script itself yet, so implementers still run
`scripts/worktree-env.sh` if `.env.local` is missing (idempotent). `pnpm install`
is a separate agent step; a fresh worktree has no `node_modules`.
