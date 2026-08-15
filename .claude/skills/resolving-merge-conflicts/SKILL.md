---
name: resolving-merge-conflicts
description: Work through an in-progress git merge or rebase conflict hunk by hunk, resolving by intent traced to each side's primary source, then finish the operation. Use when a merge or rebase stops with conflicts — especially when merging parallel track branches from a wave, or rebasing a long-running branch onto main.
---

# Resolving merge conflicts

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (`resolving-merge-conflicts`).

Tracks are planned file-disjoint, so a conflict is itself a signal: **the file ownership guessed at
intake was wrong.**

## Never abort

`git merge --abort` / `git rebase --abort` throws away a resolution the next agent must redo with
less context than you have now. Always resolve. If you genuinely cannot, stop and report which hunk
and why — leave the operation in progress for a human.

## Process

1. **See the state.** `git status`, `git log --oneline --graph -15`, `git diff --name-only
   --diff-filter=U`. Name both sides and what this merge is *for* before touching anything.

2. **Resolve each hunk by intent traced to the issue's acceptance criteria** (`gh issue view <n>`;
   the PR body states what was proven). A relevant `memory/` invariant beats either side.
   - **Preserve both intents where possible** — two tracks each adding a field to the same object
     usually both belong; the conflict is textual, not semantic.
   - **Where incompatible**, take the side matching the merge's stated goal and note the trade-off
     in the merge commit message.
   - **Never resolve to a third thing** — that is a change nobody reviewed. Take one side and raise
     the third thing separately.
   - An elaboration added to `memory/invariants/<domain>.md` with no index line in
     `memory/invariants.md` is not a conflict but an incomplete change: add the missing one-liner.

3. **Finish**, run the cheap local smoke, then push and let the required check be the verdict:

   ```bash
   git merge --continue   # or: git rebase --continue
   pnpm typecheck && pnpm test
   ```

4. **Report the ownership miss.** If tracks planned file-disjoint collided, name the file — it is a
   chokepoint, and the next `spec-intake` should give it to exactly one track's `## Likely files`.
