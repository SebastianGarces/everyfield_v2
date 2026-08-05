---
name: dispatch
description: One autonomous pass over the board's frontier — take the unblocked, unclaimed work and build it to reviewed PRs. Use when a schedule fires, or when the user asks to "dispatch", "run a pass", or "pick up whatever is ready". Refuses to run when the review queue is full, a loop is already in flight, or the budget cannot finish a track.
---

# dispatch

One pass of the factory, with no human in the loop for the duration of the pass.

> **Status: no schedule exists yet — run it by hand with `/dispatch`.**
> The skill is built to be cron-invoked and `ops/agent-os/invocation.md` classifies it that way, but
> the cron is deliberately not created until a pass has been *observed* producing a real PR. This
> system has already shipped one component that looked correct and was failing every run
> (`board-sync`, see `product-docs/board-design-2026-07.md` §9), and an unattended job that opens PRs
> is a worse thing to be wrong about. Create the schedule after the first watched pass, not before.

Everything it needs already exists: the board holds durable order (`ops/agent-os/labels.md`), the
frontier query says what is takeable, and `build-until-done` implements → validates against the DoD →
opens a PR with the evidence bundle. `dispatch` is the thin, careful thing that decides **whether to
run at all**, and how much.

> **The human is the bottleneck, and that is by design.** A PR only exists because the DoD passed,
> but merging is still a human judgement. A dispatcher that outruns the review queue does not ship
> faster — it builds a backlog of unreviewed branches that rot against a moving `main`. Most of this
> skill is about not doing that.

## Preconditions — check in order, stop at the first failure

Report which gate stopped it and stop. **Stopping is a normal outcome**, not an error; a scheduled
job that no-ops quietly is working correctly.

### 1. The review queue has room

```bash
gh pr list --limit 200 --state open --json number,labels --jq '[.[] | select(.labels[].name == "agent:in-review")] | length'
```

**Cap: 6.** At or over, stop with "review queue full (N open) — nothing dispatched."

This is the most important gate. The others prevent waste; this one prevents the failure mode that
makes the whole system worse than doing nothing.

**Under auto-merge this counts only the PRs that were *held*** — a clean pass merges itself and never
enters the queue. That is the point: the queue now fills exclusively with work that raised a question
about *what should have been built*, which is the only thing a human was ever needed for. If this gate
starts tripping regularly, the signal is that specs are going into the loop underdetermined, not that
the cap is too low. Fix the intake, not the number.

### 2. Nothing is already in flight

```bash
gh issue list --limit 200 --state open --label agent:in-progress --json number,title
```

Any result means a previous pass is still running, a human is working, or a run died mid-flight and
left a claim behind. All three mean **do not start**. If the issues look stale (check the last
comment and `updatedAt`), say so and let a human clear them — never clear a claim automatically, as
that is exactly how two loops end up on one branch.

### 3. The working tree is clean and `main` is current

```bash
git status --porcelain && git fetch -q origin && git status -sb | head -1
```

Dirty tree or behind `main` → stop. Tracks branch from `main`, and building on a stale base produces
conflicts a human then has to untangle.

### 4. The frontier is not empty

The frontier is every issue that is open, `agent:queued`, has **zero open blockers**, and has **no
assignee**. The canonical query is in `ops/agent-os/labels.md` — use it rather than re-deriving one.

**Exclude `risk:high` unless the caller explicitly opted in** (`dispatch high-risk`). Not because the
DoD cannot handle it — HR1–HR4 exist precisely so high-risk work can go autonomously to PR — but
because *unattended and recurring* is a different axis from *autonomous*. Schema, auth and tenancy
changes should start when someone is around to notice. Say how many were skipped for this reason.

Empty frontier → stop with what the board is waiting on (the blocked list, and what blocks it).

### 5. The budget can finish what it starts

Size the candidate tracks **inline — do not launch the `token-preflight` skill here**. It is a
lookup table plus a sum, and launching it as the last skill before the wave fan-out made the whole
build loop's subagent usage read as "token-preflight" in /usage. The skill remains for
`/deliver` runs that carry an explicit `+Nk` directive; dispatch does the arithmetic itself:

| Track size | Est. output tokens (incl. ~1 retry) |
|------------|--------------------------------------|
| small (1–2 files, low risk)     | ~120k |
| medium (3–6 files)              | ~250k |
| large / high-risk (2 verifiers) | ~450k |

`waveEstimate = Σ trackEstimate`; `reserve` = the largest single track's estimate.

- **No `+Nk` budget directive** (the normal dispatch case) → **RUN** best-effort. The real guards
  are the workflow's per-track reserve and `MAX_ATTEMPTS`, plus the track cap below.
- **Directive given** and `remaining ≥ waveEstimate + reserve` → **RUN** all of them.
- **Directive given** and only some fit (`remaining ≥ largestTrackEstimate + reserve`) → **SPLIT**:
  take only what fits, highest-value first, and say what was left.
- Otherwise → **DEFER**: stop, and say what a single track needs.

**Cap: 3 tracks per pass**, even when the budget allows more. A pass that opens five PRs at 03:00
guarantees gate 1 blocks the next four passes. Steady beats bursty.

This cap and gate 1's are one setting in two places: a pass may not be able to fill the review queue
on its own, or every pass ends by blocking the next one. Keep gate 1 at roughly **twice** this
number. Raised 2 → 3 on 2026-07-26 to use more of a session; the binding constraint is the human
review queue, not tokens, so measure PRs-merged-per-day before raising it again.

## The pass

Call the `build-until-done` workflow with the selected tracks:

```
Workflow({ name: "build-until-done", args: { units: [...], base: "main", maxAttempts: 3, autoMerge: true } })
```

**`autoMerge: true` is what dispatch adds.** It is off by default so a direct `/deliver` call cannot
merge to `main` by surprise; a dispatch pass opts in. Under it the loop merges a track only when all
three hold: the DoD passed **and** the required check is green, the track is not `risk:high`, and no
warning was classified `spec-question`. Code-quality warnings are filed as follow-up issues and land
back on the frontier — they do not stall a good branch. See §11's sibling note in
`product-docs/board-design-2026-07.md` and `DOD_SCHEMA.warnings`.

Each unit is `{id, title, lane, files, summary, acceptanceCriteria, issue, risk}` — `files` comes
from the issue's **Likely files** section, which is what keeps parallel tracks from colliding.

The loop owns everything after that: claiming (`agent:in-progress`), the DoD gates, retries, opening
the PR with its evidence bundle and flipping to `agent:in-review`, or labelling `agent:blocked` with
the failing gate on exhaustion. **Do not re-implement any of it here, and do not second-guess its
verdict.** A PR it did not open is a PR that did not earn one.

## After the pass

Report, in this order:

1. **PRs opened** — number, title, `risk:high` first. This is the human's queue.
2. **Blocked** — issue, the gate that failed, and the one thing needed to unblock it.
3. **Left on the frontier** — what was ready but not taken, and why (cap, budget).
4. **Still blocked by dependencies** — with what each waits on.

Then stop. **Never merge**, never close an issue, never clear another run's claim, and never widen
scope because the frontier looked thin.

## Hard rules

- **Merge only through the loop's gate, never by hand.** Auto-merge is a property of a track that
  passed every gate with no spec-question raised; it is not a judgement this skill gets to make about
  a PR it is looking at. If a PR is held, it is held — reaching past the gate to merge it is the same
  class of error as clearing another run's claim.
- **Never merge a `risk:high` PR, auto or otherwise.** Schema, auth and tenancy keep a human.
- **Never clear an `agent:in-progress` claim** that this pass did not set.
- **Never dispatch `risk:high` unattended** without an explicit opt-in.
- **One pass, then stop.** Do not loop waiting for PRs to be merged so more work unblocks — that is
  the schedule's job, and a pass that waits is a pass holding a claim open.
- **A quiet no-op is a success.** Do not manufacture work to justify the run: no inventing issues, no
  relabelling `needs-spec` to `agent:queued` to fill a pass.
