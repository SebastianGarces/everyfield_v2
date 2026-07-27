# The board — labels, structure and the frontier

The durable backlog lives in **GitHub Issues**. Requirements, their status and their blocking edges
are all here; the repo holds specs and decisions, not status. Design and reasoning:
`product-docs/board-design-2026-07.md`.

**One rule governs everything below: the labels are canonical.** `build-until-done` writes them,
`standup` reads them, and the Project board's `Status` field is mirrored one way *from* them. Agents
read labels, never the board.

## Structure

```
Feature issue          label: feature      one per FRD — an index, not a store
  └─ requirement issue                     one per OPEN requirement, titled with its FRD ID
       └─ unit issue                       only where a requirement needs slicing
```

Sub-issues carry the hierarchy (100 children per parent, 8 levels deep, one parent per issue).
GitHub renders the parent's progress bar, which is what the deleted `checklist.md` files used to be.

Everything a requirement issue needs is in the `spec-intake` template: observable acceptance
criteria, a declared validation plan, a risk classification, and a `## Likely files` section.

## Status labels (mutually exclusive — exactly one per active issue)

| Label                   | Meaning                                                              |
|-------------------------|----------------------------------------------------------------------|
| `agent:queued`          | Spec accepted, not yet started. Waiting for a build slot / budget.   |
| `agent:in-progress`     | A `build-until-done` loop is actively iterating on it.               |
| `agent:in-review`       | DoD passed, PR opened — **in the human review queue**.               |
| `agent:blocked`         | Loop exhausted attempts/budget; needs a human. See the issue comment. |
| `agent:delivery-failed` | DoD passed, but pushing/opening the PR failed. The code is fine — retry the delivery. See the issue comment. |

(When the PR merges, the issue closes via `Closes #` — no separate "done" label needed.)

`agent:blocked` and `agent:delivery-failed` both mean "a human is needed", and they are kept apart
because the human does a **different thing**. `agent:blocked` says the work did not reach the
Definition of Done — read the failing gate, then tighten the spec, raise the budget, or take it
manually. `agent:delivery-failed` says the work *did* reach it and the commit exists on its branch;
only the push/PR step failed. Nothing is wrong with the code, so re-reviewing it is wasted attention:
retry the delivery. Collapsing the two sends a human to debug a build that already passed.

Two labels ever carrying `agent:in-progress` at once on the same issue is a bug, not a state. The
board-sync workflow logs a warning rather than guessing which one wins.

## Kind labels (what the issue *is*)

| Label      | Meaning                                                                        |
|------------|--------------------------------------------------------------------------------|
| `feature`  | A feature parent. Links its FRD, holds scope decisions, owns the progress bar.  |
| `decision` | An open ruling that gates work. **No PR closes it** — it closes by a ruling recorded in the decision ledger. |
| `deferred` | Off the active roadmap: cut, or kept-but-post-beta. Carries no `agent:*` label. |

`feature` and `deferred` combine — a cut feature is a closed tombstone, a post-beta feature is an
open one with no children.

## Modifier labels

| Label        | Meaning                                                           |
|--------------|-------------------------------------------------------------------|
| `risk:high`  | Touches schema/auth/tenancy/payments → extra DoD gates (HR1–HR4).  |

## Pre-queue labels

| Label        | Meaning                                                              |
|--------------|----------------------------------------------------------------------|
| `needs-spec` | **Not build-ready.** No FRD, or an unresolved question inside one.    |

`needs-spec` covers two cases: a feature with no spec at all, and a specced requirement with an open
question that changes what gets built (`DOC-008`'s schema question, `T-018` waiting on notification
infrastructure). Neither is eligible for `spec-intake` or the loop, so both carry **no** `agent:*`
label — the exactly-one rule applies only to active issues. Once it is build-ready, remove
`needs-spec` and apply `agent:queued`.

## Blocking edges and the frontier

Semantic blocking is a **native GitHub dependency**, not a line of prose and not a wave number:

```bash
gh issue edit <n> --add-blocked-by <blocker>     # gh >= 2.96
gh issue create ... --blocked-by <blocker>
```

Older `gh` needs the REST endpoint, which takes the blocker's numeric **database id** — not its
`#number`, not its `node_id`:

```bash
BLOCKER_ID=$(gh api repos/{owner}/{repo}/issues/<blocker> --jq .id)
gh api --method POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=$BLOCKER_ID
```

Every issue reports `issue_dependencies_summary.blocked_by` — **open blockers only**, so it is a live
gate rather than a historical record. The **frontier** is what that makes queryable: every issue
whose blockers are all closed and which nobody has claimed.

```bash
R={owner}/{repo}
gh issue list --state open --label agent:queued --json number --jq '.[].number' | while read n; do
  [ "$(gh api repos/$R/issues/$n --jq '.issue_dependencies_summary.blocked_by')" = "0" ] &&
  [ "$(gh api repos/$R/issues/$n --jq '.assignees | length')" = "0" ] && echo "$n"
done
```

**A dependency is semantic; file overlap is not.** Two units that both touch
`src/db/schema/index.ts` do not block each other — they merely cannot run in the same parallel batch.
Dependencies hold the first; `## Likely files` in the issue body holds the second. Conflating them
makes batches coarser than they need to be.

## Milestones

Milestones hold **dates**, not features — an issue gets one milestone and one parent, and sub-issues
already do grouping better. One exists: `Beta`.

## One-time setup

```bash
gh label create "agent:queued"      --color FBCA04 --description "Spec accepted, awaiting build" --force
gh label create "agent:in-progress" --color 0E8A16 --description "build-until-done loop running"  --force
gh label create "agent:in-review"   --color 1D76DB --description "DoD passed, PR in review queue" --force
gh label create "agent:blocked"     --color B60205 --description "Loop exhausted, needs a human"  --force
gh label create "agent:delivery-failed" --color E99695 --description "DoD passed but the PR/delivery step failed — retry delivery; the code is fine" --force
gh label create "risk:high"         --color D93F0B --description "Schema/auth/tenancy/payments"   --force
gh label create "needs-spec"        --color 5319E7 --description "Not build-ready — no FRD, or an open question inside one" --force
gh label create "feature"           --color 0052CC --description "Feature parent issue — the FRD's home on the board" --force
gh label create "decision"          --color 8B5CF6 --description "An open ruling that gates work; resolution lands in the decision ledger" --force
gh label create "deferred"          --color BFDADC --description "Off the active roadmap — cut or post-beta" --force
```

`--force` makes this idempotent (safe to re-run).
