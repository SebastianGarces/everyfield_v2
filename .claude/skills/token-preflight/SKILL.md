---
name: token-preflight
description: Before starting a build, estimate whether there is enough token/context budget to FINISH it, and recommend run-now / split-into-waves / defer. Use at the start of delivery-orchestrator and inside build-until-done's wave loop. Prevents starting a task we can't complete and stranding it half-done.
---

# token-preflight

A task you can't finish is worse than a task you didn't start — it strands a branch and burns budget.
This skill makes "do we have enough to finish?" an explicit gate before any build, exactly once per wave.

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

`waveEstimate = Σ trackEstimate`. Keep a **reserve** so the loop never strands a track mid-PR
(default reserve = the single largest track's estimate).

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

- **Reserve is sacred.** Never spend into the reserve; that's what guarantees a started track can finish.
- **Prefer SPLIT over a risky RUN.** Shipping fewer, finished tracks beats starting all and stranding some.
- **Surface the number.** Always tell the user the estimate vs remaining so the run/split/defer call is legible.
- Re-preflight before each *subsequent* wave (budget is shared and depletes as work runs).
