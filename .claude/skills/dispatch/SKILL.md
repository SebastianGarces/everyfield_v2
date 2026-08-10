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

### 3. The working tree is clean and local `main` **is** `origin/main`

```bash
git status --porcelain                                  # must be empty
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] && echo IN-SYNC || echo STALE
```

Dirty tree → stop. `STALE` → stop, and say which sha each side is on. This is an **equality
assertion, not a `git status` glance**: the maiden run passed a "behind main" eyeball, cut its track
from local `14c5d33` while `origin/main` was at `700c333`, and the consequences were not conflicts.
The verifiers read a two-commit-old `ops/agent-os/dod.md` out of their worktrees and graded against
it, and PR #333 landed on `mergeStateStatus: BEHIND` — the ruleset requires up-to-date branches — so
auto-merge could not fire without a manual `gh pr update-branch`.

Belt and braces: the loop's stage-prep now fetches and cuts the track branch from **`origin/main`**
itself, and asserts the new branch's HEAD sha equals the base sha before any workstream runs
(a bare `base: "main"` is normalised to `origin/main`). This gate stays because a stale local `main`
is also a stale *reading* environment for everything the pass does outside a worktree. Workstream
worktrees are still cut from the track branch's HEAD, never from any `main`.

### 4. The frontier is not empty

The frontier is every issue that is open, `agent:queued`, has **zero open blockers**, and has **no
assignee**. The canonical query is in `ops/agent-os/labels.md` — use it rather than re-deriving one.

A track then **expands from a frontier issue along `dependsOn`** to pull in the dependents it will
build in later stages, so a dispatched track legitimately contains issues the frontier query itself
would have excluded. That is the only sanctioned way a blocked issue enters a pass: its blocker is in
the same track and lands on the track branch first. A blocker **outside** the track is still a hard
stop.

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
| cluster (multi-workstream track) | ~450k + ~120k per workstream beyond the first |

*(This table is deliberately identical to the one in `token-preflight/SKILL.md`. If you change one,
change both — two tables that disagree are worse than one table in the wrong place.)*

A `generate-and-filter` workstream sizes at **~3× its row** — three candidate implementers per
attempt, not one.

`waveEstimate = Σ trackEstimate`; `reserve` = the **largest single workstream's** estimate, not the
largest track's. A track is no longer one indivisible spend: it runs stage by stage, and the thing
that must never be stranded mid-flight is a workstream. **A stage does not start unless the remaining
budget covers all of its concurrent workstreams** — a track that has to stop stops cleanly between
stages, on the track branch, with the completed stages already merged into it.

- **No `+Nk` budget directive** (the normal dispatch case) → **RUN** best-effort. The real guards
  are the per-workstream reserve and `MAX_ATTEMPTS`, plus the agent cap below.
- **Directive given** and `remaining ≥ waveEstimate + reserve` → **RUN** all of them.
- **Directive given** and only some fit (`remaining ≥ largestTrackEstimate + reserve`) → **SPLIT**:
  take only what fits, highest-value first, and say what was left.
- Otherwise → **DEFER**: stop, and say what a single track needs.

**Cap: 6 concurrent agents per pass** — not 3 tracks. A track may now hold eight workstreams, so
"3 tracks" stopped describing load at all: it could mean three agents or twenty-four. Cap the thing
that actually consumes budget and wall-clock, which is agents running at once.

The review-queue relationship still has to hold, and it is about **PRs**, not agents: a pass opens one
PR per track. Gate 1's cap stays at roughly **twice** the number of tracks a pass can finish — 6 held
PRs against ~3 tracks — so the agent cap bounds cost and the queue bounds output, and neither
substitutes for the other. A pass that opens five PRs at 03:00 still guarantees gate 1 blocks the next
four passes; steady beats bursty. Raised 2 → 3 tracks on 2026-07-26 to use more of a session, and
re-expressed as an agent cap on 2026-08-05 when a track stopped being one agent
(`product-docs/board-design-2026-07.md` §13). The binding constraint is still the human review queue,
not tokens, so measure PRs-merged-per-day before raising either number.

### Recipe selection

Every unit carries a **build recipe** — the strategy the loop uses for that unit's workstream
attempts. The guarantee layer (claiming, stages, scoped verify, attempts, the verify-and-ship tail)
is fixed; the recipe is the only swappable part. Contract: `ops/agent-os/recipes.md`.

| Recipe | Task shape |
|--------|------------|
| `implement-straight` | Any shape; the default, and the answer whenever in doubt. |
| `generate-and-filter` | A small, sharply specified, quality-sensitive unit (≤ ~2 files, low risk, no migration) where independent attempts plausibly diverge — UI polish, a tricky pure function. Costs ~3× (3 candidates) and counts as 3 agents against the 6-agent cap — machine-enforced: the loop's `RECIPE_AGENT_COST` weights both the concurrency chunking and the token-reserve checks. |

- `recipe: "<id>"` is set **per unit** in the units array; omitted means `implement-straight`.
- Units that will share a workstream (same stage + shared files) must carry the **same** recipe —
  the loop throws at plan time on a mixed set.
- An unknown id throws **at parse** — before any claim exists, before any worktree is cut. That is
  AC7's dry-run: a bogus id aborts with nothing claimed and nothing to clean up.
- Dispatch RECORDS the choice for audit, one comment per claimed issue:
  `Dispatch: recipe = <id> — <one-line reason>`.

## The pass

Call the `build-until-done` workflow with the selected tracks:

```
Workflow({ name: "build-until-done", args: { units: [...], base: "origin/main", maxAttempts: 3, autoMerge: true } })
```

`base` is a **remote** ref. A bare `"main"` is normalised to `origin/main` rather than trusted, for
the reason gate 3 exists; pass a sha or an explicit `origin/<branch>` when you mean something else.

`maxAttempts` is **per workstream**, not per track. A workstream that passed is never re-implemented,
so one failing AC no longer burns an attempt for every healthy unit beside it.

**`autoMerge: true` is what dispatch adds.** It is off by default so a direct `/deliver` call cannot
merge to `main` by surprise; a dispatch pass opts in. Under it the loop merges a track only when all
five hold: the DoD passed **and** the required check is green, the track is not `risk:high`, no unit
in it carries `hold: true`, no warning was classified `spec-question`, and no review finding survived
the quality rounds unresolved. Reviewer findings (Critical + structural) are **fixed in the same
pass** by the review-fix loop, ≤2 rounds per site (scoped and integration); a track with unresolved
findings HOLDs with a DECISION comment — never merged with findings, never `agent:blocked` for them
(#399, RULED 2026-08-10). Spec-question warnings hold exactly as before. See §12 and §13 of
`product-docs/board-design-2026-07.md`, `ops/agent-os/labels.md`, and `DOD_SCHEMA.warnings`.

### When to set `hold: true` on a unit

`hold` is a per-unit boolean meaning **this never auto-merges**. A track holds if *any* of its units
does, and a held track is treated exactly like `risk:high`: the PR opens, the issues flip to
`agent:in-review`, the hold agent comments why, and the loop never merges it.

Set it in the units array — the loop cannot infer it — in **two** cases:

1. **The issue body declares it.** Anything that says never-auto-merge, hold for review, or names a
   human as the merge decision.
2. **ALWAYS when the unit's files touch the factory** — `.claude/workflows/` (including
   `.claude/workflows/recipes/`), the delivery-OS entries
   under `.claude/skills/` (`dispatch`, `build-until-done`, `definition-of-done`, `open-pr`,
   `frd-plan`, `frd-implement`), or `ops/agent-os/`. A change to the machine that decides what merges
   keeps a human, because the thing being changed is the thing that would otherwise have caught the
   mistake. This is a standing policy, not a judgement call per pass.

Set the flag rather than dropping the whole pass to `autoMerge: false`. Turning auto-merge off
globally to hold one factory track also stalls every clean track beside it in a mixed wave, and those
are exactly the PRs the queue can absorb.

Each unit is `{id, title, lane, files, summary, acceptanceCriteria, issue, risk, dependsOn, hold, recipe}`. The
loop cuts the units into **tracks** (connected components over shared-file ∪ `dependsOn`), then into
**stages** (topological levels by `dependsOn`), then into **workstreams** (units in one stage sharing
a file — one agent, sequential). `files` comes from the issue's **Likely files** section and the
per-workstream lists from its `## Workstreams` section; the first keeps parallel tracks from
colliding, the second scopes each workstream's G5.

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
5. **Surviving worktrees** — every path in the loop's `survivingWorktrees`, with the branch it holds.
   A merged track removed its own; a held or blocked one kept its trees on purpose, because they are
   the only re-runnable copy of the work. Repeat them here even though the exit comment names them:
   the trees from the first two passes were cleaned up by hand only because someone remembered they
   existed. Do not remove them yourself — they belong to whoever takes the issue next.

6. **Browser sweep** — run `scripts/cleanup-mcp-browsers.sh` and report its output line. Verifiers
   close their own browsers (validate-frontend teardown rule); the sweep catches the ones whose
   agent died first. It only ever matches MCP-owned browser processes, and a pass boundary is the
   one safe moment to run it — never run it while a verifier is in flight.

Then stop. **Never merge**, never close an issue, never clear another run's claim, and never widen
scope because the frontier looked thin.

## Hard rules

- **Merge only through the loop's gate, never by hand.** Auto-merge is a property of a track that
  passed every gate with no spec-question raised; it is not a judgement this skill gets to make about
  a PR it is looking at. If a PR is held, it is held — reaching past the gate to merge it is the same
  class of error as clearing another run's claim.
- **Never merge a `risk:high` PR, auto or otherwise.** Schema, auth and tenancy keep a human.
- **Never merge a factory change, auto or otherwise.** Mark its units `hold: true` on the way in;
  do not reach past the gate on the way out.
- **Never clear an `agent:in-progress` claim** that this pass did not set.
- **Never dispatch `risk:high` unattended** without an explicit opt-in.
- **One pass, then stop.** Do not loop waiting for PRs to be merged so more work unblocks — that is
  the schedule's job, and a pass that waits is a pass holding a claim open.
- **A quiet no-op is a success.** Do not manufacture work to justify the run: no inventing issues, no
  relabelling `needs-spec` to `agent:queued` to fill a pass.
