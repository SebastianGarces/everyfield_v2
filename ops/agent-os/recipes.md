# Build recipes — the strategy layer

## Why the seam is narrow

A **recipe** is a swappable build strategy for **one workstream attempt**. The guarantee layer
(`build-until-done.js` + `verify-and-ship.js`) keeps everything else: claiming, stage planning,
worktree management, scoped verify (G0 / G2-subset / G5), attempt accounting, merge-back,
integration verify, the review-fix loop, HR4, PR, CI anchor, the merge gate, and labels. A recipe
replaces only the inline "implement" agent call — strategy freedom, zero process freedom.

Seam ruling: [#399, A-modified, 2026-08-10](https://github.com/SebastianGarces/everyfield_v2/issues/399#issuecomment-5244426647).
The cut is narrow because the parent owns both ends of the attempt loop — attribution re-entry
with `priorReport` and per-workstream attempt accounting only work when re-invocation is the
parent's — and because one-level `workflow()` nesting plus the parent-closure budget means a
broader recipe could spend a track's build budget before the first fixed gate ran. The **broad
cut** (a recipe owning a whole track's build phase) is **explicitly deferred**: it would need a
seam-v2 ruling backed by evidence that the narrow seam is too tight for a real recipe. The four
contract amendments from the ruling are folded in below.

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
  unitBlocksRendered: <the unit blocks, pre-rendered> }
```

Notes that bind:

- **Each datum crosses the seam in exactly ONE form.** The declared file set is
  `workstream.files` — there is no separate `declaredFiles` field, and adding a second form of any
  datum is a contract widening (a factory-held change class per the ruling). Units are the one
  deliberate exception and cross in BOTH forms: `unitBlocksRendered` for prompt fidelity (ruling
  mod 2 pins the implementer prompt to the parent's rendering, so no recipe re-renders it), and
  `workstream.units` raw because judges and internal loops need per-unit acceptance criteria that
  cannot be parsed back out of rendered prose.
- **The worktree is a parent-provided input.** The parent's `prepareWorkstreamTree` cuts non-solo
  workstream trees from the track branch and asserts the cut point; solo workstreams get the track
  worktree. A recipe never creates the tree it works in.
- **`priorReport` is the structured report** the verifier returned (mod 1). Flattening it to a
  string is the exact #307 context-loss shape and is forbidden.
- **`retryBlock` carries the #307 root-cause protocol**, rendered by the parent (mod 2). When it
  is non-null, the recipe prepends it VERBATIM to its implementer prompt. No recipe file re-carries
  that lesson in its own words.

## Return contract

- MUST return `{ summary, commits: [sha], warnings: [] }` — `commits` transcribed from
  `git log --format=%H`, verbatim.
- When `priorReport != null` (a retry), the contract **widens** to additionally return
  `{ rootCause, rootCauseAddressed }` (mod 3).
- **The parent's refusal gate applies to every recipe.** It reads `rootCauseAddressed` and refuses
  the attempt **before spending a verifier** when it is empty — the #307 discipline lives in the
  parent, once, not per recipe.

## Side-effect contract

- MUST leave the implementation **committed to `branch` in `worktree`**.
- MUST NOT: push, open PRs, edit labels or issues, merge to any branch other than `branch`, or
  call `workflow()` — **nesting is one level deep**; `build-until-done.js` is the only parent.
- Local scratch branches/worktrees (`recipe/<ws.id>-*`) are permitted and MUST be gone before
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

## Budget

A recipe call is funded by **one attempt's reserve** — the per-workstream `RESERVE` the parent
sizes stages against (dispatch gate 5). Overrunning it inside one call is grounds for failing the
attempt. Mid-attempt burn is bounded to one attempt by construction — the parent re-invokes per
attempt, so a recipe can never spend past its own call — and must be **visible in the journal**:
a recipe that fans out (candidates, internal improve loops) logs what it spent the fan-out on
(ruling design note 6). `generate-and-filter` costs ~3× `implement-straight` and counts as 3
agents against the concurrency cap; dispatch sizes its workstreams at ~3× the budget-table row.

This weighting is **enforced in the loop, not just documented**: the `RECIPE_AGENT_COST` literal
in `build-until-done.js` weights the concurrency chunking (`boundedParallel` closes a chunk when
the summed recipe weight would exceed the agent cap — at stage level and at track level) and both
token-reserve checks (a stage needs `RESERVE × Σ weight`, and a workstream attempt needs
`RESERVE × weight`), so a `generate-and-filter` workstream is refused before its recipe child
launches when less than 3× `RESERVE` remains, and can never co-schedule past the cap.

## Selection — how dispatch picks a recipe

The table in `.claude/skills/dispatch/SKILL.md` §"Recipe selection" is **authoritative** for
which task shapes get which recipe; `implement-straight` is the default and the answer whenever
in doubt. Dispatch writes `recipe: <id>` onto each **unit** in the args it passes to
`build-until-done` (omitted = `implement-straight`) and records the choice on the issue for
audit, one comment per claimed issue: `Dispatch: recipe = <id> — <one-line reason>`. The parent
validates every id against `KNOWN_RECIPES` **at parse time** — an unknown id throws before any
claim and before any worktree, never mid-build. Units that share one workstream (same stage +
shared files) must agree on one recipe; a mixed set throws at plan time.

Recipe files live under `.claude/workflows/`, so **every recipe is a factory path**: dispatch
sets `hold: true` on any track that touches one, and it never auto-merges.

## The recipe library

| id | strategy | status |
|----|----------|--------|
| `implement-straight` | One implementer agent, prompt semantics preserved from the pre-#399 inline call. The default. | landed (#399 WS2) |
| `generate-and-filter` | 3 candidate diffs in throwaway worktrees → opus judge picks exactly one → ff-only land. The proof that the seam supports a genuinely different shape. | landed (#399 WS3) |

Out of scope until the seam is proven: `adversarial-implement`, `loop-until-dry` (runs INSIDE one
attempt as an internal improve loop — it must not hide attempts from parent accounting),
cross-workstream tournaments, recipe-driven staging (would need a seam-v2 ruling).

## Adding a recipe

1. Write the child workflow at `.claude/workflows/recipes/<id>.js` against the contracts above
   (pure-literal `meta`; no `workflow()`, no `Date.now()` / `Math.random()` / argless `new Date()`).
2. Append the id to the `KNOWN_RECIPES` literal in `build-until-done.js` — that is the parse-time
   gate's whole registry — and, if the recipe runs more than one agent at a time, a row to
   `RECIPE_AGENT_COST` beside it (missing = weight 1, which under-reserves a fan-out recipe).
3. Add a row to dispatch's Recipe-selection table (`.claude/skills/dispatch/SKILL.md`) saying
   which task shape earns it, and a row + section here.
4. Every recipe file is a factory path — the track that lands it carries `hold: true` and never
   auto-merges.
5. A **canary run is required**: a real low-risk issue through `build-until-done` with the new
   recipe selected, its child-workflow entries visible in the run journal, before the recipe is
   trusted on ordinary work.
