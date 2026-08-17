# The board — labels, structure and the frontier

The durable backlog lives in **GitHub Issues**: requirements, their status and their blocking edges.
The repo holds specs and decisions, not status. **The labels are canonical** — the Project board's
`Status` field is a one-way mirror of them (`.github/workflows/board-sync.yml`), so agents read
labels, never the board. Create the labels once with `ops/agent-os/setup-labels.sh` (idempotent).

## Structure

```
Feature issue          label: feature      one per FRD — an index, not a store
  └─ requirement issue                     one per OPEN requirement, titled with its FRD ID
       └─ unit issue                       only where a requirement needs slicing
```

Sub-issues carry the hierarchy and GitHub renders the parent's progress bar. Everything a requirement
issue needs is in the `spec-intake` template: observable acceptance criteria, a declared validation
plan, a risk classification, and a `## Likely files` section — lose that section and parallel tracks
collide silently.

Read a parent with `gh issue view <n> --json parent --jq .parent` (GraphQL). The REST form
`gh api repos/{owner}/{repo}/issues/<n> --jq .parent` returns `null` even when a parent exists,
silently — never use it.

## Status labels (mutually exclusive — exactly one per active issue)

| Label                   | Meaning                                                              |
|-------------------------|----------------------------------------------------------------------|
| `agent:queued`              | Spec accepted, not yet started. Waiting for a build slot / budget.   |
| `agent:in-progress`         | A `build-until-done` loop is actively iterating on it.               |
| `agent:in-review`           | DoD passed, PR opened — **in the human review queue**.               |
| `agent:changes-requested`   | Human review asked for changes. Applying this to an issue whose PR is open is enough to make the work takeable again. The loop resumes the existing branch and PR, reads the review threads, and re-runs the full DoD. |
| `agent:blocked`             | Loop exhausted attempts/budget; needs a human. See the issue comment. |
| `agent:delivery-failed`     | DoD passed, but pushing/opening the PR failed. The code is fine — retry the delivery. See the issue comment. |

When the PR merges the issue closes via `Closes #`, so there is no "done" label. Two `agent:*` labels
at once is a bug, not a state; board-sync fails on it.

## Kind, modifier and pre-queue labels

| Label        | Meaning                                                                      |
|--------------|------------------------------------------------------------------------------|
| `feature`    | A feature parent. Links its FRD, holds scope decisions, owns the progress bar. |
| `decision`   | An open ruling that gates work. **No PR closes it** — it closes by a ruling recorded in the decision ledger. |
| `deferred`   | Off the active roadmap: cut, or kept-but-post-beta. Combines with `feature`. Carries no `agent:*` label. |
| `risk:high`  | **Auth/tenancy/payments** → the rider in `ops/agent-os/dod.md`: security lens, never auto-merges. Pre-release, schema and migrations are *not* high-risk on their own (ruled 2026-08-13 — no separate prod DB holds client data; they return here when alpha or beta serves one). The migration proofs — the DDL delta **and** both scratch-DB transcripts in the PR body, apply and rollback — fire on any diff carrying a migration, at any tier, and the delta alone does not satisfy them. |
| `needs-spec` | **Not build-ready**, and a last resort — an agent rules for itself wherever `product-docs/product-values.md`, `CONTEXT.md` and `memory/invariants.md` can answer. Reserved for a feature with no spec, or a question that is irreversible or the owner's taste. Carries no `agent:*` label. |

Milestones hold **dates**, not features — one milestone and one parent per issue; `Beta` is the only
one.

## Blocking edges and the frontier

Semantic blocking is a **native GitHub dependency**, not prose. Older `gh` needs the REST endpoint,
which takes the blocker's numeric **database id**:

```bash
gh issue edit <n> --add-blocked-by <blocker>     # gh >= 2.96
gh issue create ... --blocked-by <blocker>

BLOCKER_ID=$(gh api repos/{owner}/{repo}/issues/<blocker> --jq .id)
gh api --method POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=$BLOCKER_ID
```

`issue_dependencies_summary.blocked_by` counts **open blockers only**, so it is a live gate. The
**frontier** is every issue whose blockers are all closed and which nobody has claimed, labelled
`agent:queued` **or** `agent:changes-requested`. GitHub's `labels=` query is AND, so those two
cannot share one request — two paginated lists, unioned:

```bash
R={owner}/{repo}
for label in agent:queued agent:changes-requested; do
  gh api --paginate "repos/$R/issues?labels=$label&state=open&per_page=100" \
    --jq '.[]
          | select(.pull_request == null)
          | select(.issue_dependencies_summary.blocked_by == 0 and (.assignees | length) == 0)
          | .number'
done
```

Three parts are load-bearing: **`--paginate`, never a bare limit** (`gh issue list` caps at 30 and
silently answers from a window over the newest issues); **`select(.pull_request == null)`** (the REST
issues endpoint returns pull requests too, and `gh api` does not filter them, so a PR can otherwise
enter the frontier as buildable work); and **reuse this payload rather than re-fetching per issue** —
`body`, `labels` and `assignees` are already in it, so `## Likely files` and the ACs need no second
call. `agent:changes-requested` sits on the issue, not the PR, so the pull_request filter still
holds. Applying that label is enough to make an open-PR issue takeable again.

**A dependency is semantic; file overlap is not.** Two units touching `src/db/schema/index.ts` do not
block each other — they merely cannot run in the same parallel batch. Blocking edges decide a track's
**stages**; file overlap decides which units inside a stage union into one **workstream** and which
run in parallel. A track expands from the frontier along `dependsOn`, so it legitimately contains
issues blocked *by the track itself*; `blocked_by` against anything **outside** the track is a hard
stop.
