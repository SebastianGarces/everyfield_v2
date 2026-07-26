# GitHub label scheme (the board)

The durable backlog lives in **GitHub Issues**. Status is a single `agent:*` label per issue; PRs
link back with `Closes #<id>` so merging a PR closes its issue. The `standup` skill reads these.

## Status labels (mutually exclusive — exactly one per active issue)

| Label              | Meaning                                                              |
|--------------------|---------------------------------------------------------------------|
| `agent:queued`     | Spec accepted, not yet started. Waiting for a build slot / budget.   |
| `agent:in-progress`| A `build-until-done` loop is actively iterating on it.              |
| `agent:in-review`  | DoD passed, PR opened — **in the human review queue**.              |
| `agent:blocked`    | Loop exhausted attempts/budget; needs a human. See the issue comment.|

(When the PR merges, the issue closes via `Closes #` — no separate "done" label needed.)

## Modifier labels

| Label        | Meaning                                                        |
|--------------|----------------------------------------------------------------|
| `risk:high`  | Touches schema/auth/tenancy/payments → extra DoD gates (HR1–HR4). |

## Pre-queue labels

| Label        | Meaning                                                              |
|--------------|----------------------------------------------------------------------|
| `needs-spec` | Feature in docs but no FRD — write a spec before it can be built.    |

`needs-spec` issues are not yet eligible for `spec-intake`, so they carry **no** `agent:*` label
(the exactly-one rule applies only to active issues). Once a spec exists, remove `needs-spec` and
apply `agent:queued`.

## One-time setup

```bash
gh label create "agent:queued"      --color FBCA04 --description "Spec accepted, awaiting build" --force
gh label create "agent:in-progress" --color 0E8A16 --description "build-until-done loop running"  --force
gh label create "agent:in-review"   --color 1D76DB --description "DoD passed, PR in review queue" --force
gh label create "agent:blocked"     --color B60205 --description "Loop exhausted, needs a human"  --force
gh label create "risk:high"         --color D93F0B --description "Schema/auth/tenancy/payments"   --force
gh label create "needs-spec"        --color 5319E7 --description "Feature in docs but no FRD — write a spec before it can be built" --force
```

`--force` makes this idempotent (safe to re-run).
