---
name: resolving-merge-conflicts
description: Work through an in-progress git merge or rebase conflict hunk by hunk, resolving by intent traced to each side's primary source, then finish the operation. Use when a merge or rebase stops with conflicts — especially when merging parallel track branches from a wave, or rebasing a long-running branch onto main.
---

# Resolving merge conflicts

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (`resolving-merge-conflicts`).

Conflicts are common here because tracks are built in parallel in isolated worktrees and merged
afterwards (`frd-implement-wave`, `build-until-done`). Tracks are planned to be file-disjoint, so a
conflict is itself a signal: **the file ownership guessed at intake was wrong.** Note it — it is
worth more than the resolution.

## Never abort

`git merge --abort` / `git rebase --abort` throws away a resolution the next agent will have to
redo, with less context than you have right now. Always resolve. If you genuinely cannot, stop and
report which hunk and why — leave the operation in progress for a human.

## Process

### 1. See the current state

```bash
git status                       # which operation, which files
git log --oneline --graph -15
git diff --name-only --diff-filter=U
```

Name both sides explicitly before touching anything: what is `ours`, what is `theirs`, and what this
merge is *for*. A resolution without that framing is a guess.

### 2. Find each side's primary source

Understand deeply **why** each change was made — resolve by intent, never by which hunk looks
tidier. In this repo the primary sources, in order of authority:

1. **The issue the branch closes** — `gh issue view <n>`. The acceptance criteria are the intent.
2. **The PR body** — it carries the DoD evidence bundle, so it states what was actually proven.
3. **Commit messages** and `git log -p <file>` on each side.
4. **`memory/`** — `invariants.md` and `contracts/` settle conflicts that are really contract
   disagreements. An invariant always wins over either side of the hunk.

### 3. Resolve each hunk

- **Preserve both intents where possible.** Two tracks that each added a field to the same object
  usually both belong; the conflict is textual, not semantic.
- **Where incompatible**, pick the one matching the merge's stated goal, and note the trade-off in
  the merge commit message.
- **Do not invent new behaviour.** A resolution that is neither side is a change nobody reviewed and
  nobody's DoD covered. If the correct answer is a third thing, resolve to one side and raise the
  third thing separately.
- Check the resolved file against `memory/invariants.md` before moving on — tenancy and auth
  boundaries are exactly what a careless "take both" breaks.

### 4. Finish and verify

Complete the operation (`git merge --continue` / `git rebase --continue`), then run the checks a
merge can break. These are the same four CI requires, plus tests:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

Fix anything the merge broke — a conflict resolution that typechecks is not the same as one that is
correct, and `pnpm test` is the cheapest evidence you have that both intents survived.

> CI runs Node 24 and its job name `Format, Lint, Typecheck, Build` is a contract with the branch
> ruleset. A green local run is not the verdict; the required check on the PR is.

### 5. Report the ownership miss

If tracks that were planned as file-disjoint collided, say so, and name the file. That file is a
chokepoint (a barrel, a constants module, a shared schema) and the next `spec-intake` should assign
it to exactly one track's `## Likely files`.
