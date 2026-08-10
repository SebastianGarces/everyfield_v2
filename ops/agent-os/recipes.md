# Build recipes — the strategy layer

A **recipe** is a swappable build strategy for **one workstream attempt**. The guarantee layer
(`build-until-done.js` + `verify-and-ship.js`) keeps everything else: claiming, stage planning,
worktree management, scoped verify (G0 / G2-subset / G5), attempt accounting, merge-back,
integration verify, the review-fix loop, HR4, PR, CI anchor, the merge gate, and labels. A recipe
replaces only the inline "implement" agent call — strategy freedom, zero process freedom.

Seam ruling: #399 (A-modified, 2026-08-10). The four contract amendments from that ruling are
folded in below.

## Where recipes live, and the nesting rule

A recipe is a child workflow at `.claude/workflows/recipes/<id>.js`, invoked by the parent as
`workflow({ scriptPath }, recipeArgs)` once per workstream attempt.

**`workflow()` nesting is ONE level deep.** `build-until-done.js` is the top-level parent; recipes
(and `verify-and-ship.js`) are its children and **must never call `workflow()` themselves**. A
recipe uses only `agent()`, `parallel()` and `log`.

Every recipe's `export const meta` must be a **pure literal** — no computed values, no
`Date.now()`, no `Math.random()`, no argless `new Date()` anywhere in a workflow script (the
runtime throws on all three).

## Input — `recipeArgs` (normative)

```
{ track: { id, issues, branch: trackBranch },
  workstream: { id, lane, issues, files, summary, units },
  worktree: <absolute-ish path — the workstream worktree, parent-provided, already on `branch` with a test env>,
  branch, stageIndex, attempt,
  priorReport: <structured verifier report | null>,   // mod 1 — the report OBJECT, never a flattened string
  retryBlock:  <parent-rendered string | null>,       // mod 2 — recipes prepend it verbatim to their prompt
  conventions: <the CONVENTIONS block the parent assembles>,
  implAgentType: "backend" | "frontend",
  unitBlocksRendered: <the unit blocks, pre-rendered>,
  declaredFiles: [<the workstream's declared file set>] }
```

Notes that bind:

- **The worktree is a parent-provided input.** The parent's `prepareWorkstreamTree` cuts non-solo
  workstream trees from the track branch and asserts the cut point; solo workstreams get the track
  worktree. A recipe never creates the tree it works in.
- **`priorReport` is the structured report** the verifier returned (mod 1). Flattening it to a
  string is the exact #307 context-loss shape and is forbidden.
- **`retryBlock` carries the #307 root-cause protocol**, rendered by the parent (mod 2). When it
  is non-null, the recipe prepends it VERBATIM to its implementer prompt. No recipe file re-carries
  that lesson in its own words.

## Obligation — return + side-effect contract

- MUST leave the implementation **committed in `worktree` on `branch`**.
- MUST return `{ summary, commits: [sha], warnings: [] }` — `commits` transcribed from
  `git log --format=%H`, verbatim.
- When `priorReport != null` (a retry), MUST additionally return
  `{ rootCause, rootCauseAddressed }` (mod 3) — the parent's refusal gate reads
  `rootCauseAddressed` and refuses the attempt **before spending a verifier** when it is empty.
- MUST NOT: push, open PRs, edit labels or issues, merge to any branch other than `branch`, or
  call `workflow()`.
- Local scratch branches/worktrees (`recipe/<ws.id>-*`) are permitted and MUST be removed before
  return.

## Enforcement — how violations are caught

- **Ref-snapshot detector (mod 4):** the parent transcribes
  `git ls-remote --heads origin <branch> <trackBranch>` before and after every recipe call. Any
  new, moved or deleted origin ref = contract violation = **failed attempt**
  (`failingGate: "recipe-contract"`), refused before a verifier is spent.
- **Empty result:** a recipe that returns nothing, or returns no `commits`, is a failed attempt
  (`failingGate: "recipe"`).
- **Label damage:** `settleLabels` read-backs and the claim blast-radius assert remain the
  detectors for board mutations.
- A bad recipe can only waste tokens — the scoped gates and the verify-and-ship tail still decide
  whether anything ships.

## Selection — how dispatch picks a recipe

Dispatch writes `recipe: <id>` onto each unit in the args it passes to `build-until-done`
(default `implement-straight`) and records the choice on the issue for audit. The parent
validates every id against `KNOWN_RECIPES` **at parse time** — an unknown id throws before any
claim and before any worktree, never mid-build. Units that share one workstream (same stage +
shared files) must agree on one recipe; a mixed set throws at plan time.

Recipe files live under `.claude/workflows/`, so **every recipe is a factory path**: dispatch
sets `hold: true` on any track that touches one, and it never auto-merges.

## The recipe library

| id | strategy | status |
|----|----------|--------|
| `implement-straight` | One implementer agent, prompt semantics preserved from the pre-#399 inline call. The default. | landed (#399 WS2) |
| `generate-and-filter` | N candidate diffs → judge → commit the winner. The proof that the seam supports a genuinely different shape. | #399 WS3 |

Out of scope until the seam is proven: `adversarial-implement`, `loop-until-dry` (runs INSIDE one
attempt as an internal improve loop — it must not hide attempts from parent accounting),
cross-workstream tournaments, recipe-driven staging (would need a seam-v2 ruling).
