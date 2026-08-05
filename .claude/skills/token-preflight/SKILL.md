---
name: token-preflight
description: Estimate whether an explicit `+Nk` token budget can FINISH a wave, and recommend run-now / split-into-batches / defer. Use ONLY in delivery-orchestrator (/deliver) when the user gave a `+Nk` budget directive. Do NOT use in dispatch — its gate 5 does this arithmetic inline — and do not launch it when no budget directive exists (the answer is RUN best-effort by definition).
---

# token-preflight

A task you can't finish is worse than a task you didn't start — it strands a branch and burns budget.
This skill makes "do we have enough to finish?" an explicit gate before a budgeted build, exactly once
per wave.

> **Scope (narrowed 2026-07-27):** only `/deliver` with an explicit `+Nk` directive launches this
> skill. `dispatch` sizes its candidate tracks inline in gate 5 using the same table below — launching
> a skill for arithmetic right before the wave fan-out made /usage attribute the entire build loop's
> subagents to "token-preflight".

## Inputs

- The set of tracks/issues about to run (count + rough size/risk each).
- Remaining budget:
  - **Inside a workflow:** the `budget` global — `budget.total`, `budget.spent()`, `budget.remaining()`
    (the user's `+Nk` directive; `total` is `null` if none set).
  - **Interactive (no directive):** ask the user to check `/context`, or treat the session as
    best-effort and rely on the per-track reserve instead.

## Cost model (heuristic — tune as we learn)

Per track, one full build-until-done pass ≈ implement + validate + ~1 retry:

| Track size | Est. output tokens / track (incl. ~1 retry) |
|------------|---------------------------------------------|
| small (1–2 files, low risk)     | ~120k |
| medium (3–6 files)              | ~250k |
| large / high-risk (2 verifiers) | ~450k |
| cluster (multi-workstream track) | ~450k + ~120k per workstream beyond the first |

*(This table is deliberately identical to the one in `dispatch/SKILL.md` gate 5. If you change one,
change both — two tables that disagree are worse than one table in the wrong place.)*

A **cluster** is what a track usually is now: stages of parallel workstreams on one branch. Its
integration gates (G1 hermetic build, G2 full suite, G3 preview, G4, G6) are paid once no matter how
many workstreams it holds — that is why the marginal workstream costs roughly a small track and not a
large one.

`waveEstimate = Σ trackEstimate`. Keep a **reserve** so the loop never strands work mid-flight —
**default reserve = the single largest *workstream's* estimate**, not the largest track's. A track
can stop cleanly between stages with its completed stages already merged into the track branch; a
workstream cut off mid-implementation cannot. The corollary is a hard rule: **a stage does not start
unless the remaining budget covers all of its concurrent workstreams.**

## Decision

```
if budget.total is null (no directive):
    → RUN best-effort, but cap concurrency and lean on per-track MAX_ATTEMPTS/reserve.
elif remaining >= waveEstimate + reserve:
    → RUN the whole wave.
elif remaining >= largestTrackEstimate + reserve:
    → SPLIT: run as many tracks as fit (greedy, smallest-first or highest-priority-first); defer the rest to agent:queued.
else:
    → DEFER: don't start. Tell the user how much budget a single track needs and suggest `+Nk` or running fewer items.
```

## Output

```json
{
  "decision": "RUN | SPLIT | DEFER",
  "waveEstimate": 740000,
  "remaining": 500000,
  "reserve": 450000,
  "runNow": ["#12", "#15"],
  "deferred": ["#18"],
  "message": "Running 2 small tracks (~240k); deferred #18 (high-risk ~450k) — needs more budget. Re-run with +500k to include it."
}
```

## Rules

- **Reserve is sacred.** Never spend into the reserve; that's what guarantees a started **workstream**
  can finish, and a track that runs out between stages stops on a branch that still integrates.
- **Prefer SPLIT over a risky RUN.** Shipping fewer, finished tracks beats starting all and stranding some.
- **Surface the number.** Always tell the user the estimate vs remaining so the run/split/defer call is legible.
- Re-preflight before each *subsequent* wave (budget is shared and depletes as work runs).
