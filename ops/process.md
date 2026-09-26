# How we work

Ruled 2026-08-19: pre-alpha, no customers. Build fast and fall forward. A wrong implementation costs
one quick fix; a stalled agent costs a day. The principles injected at session start (source:
`.agents/skills/principle-*/`) are the guidance. There is no mandated pass graph: pick the process
that fits the task and keep moving.

Host setup is an adapter, not a second process: Codex specifics live in `ops/codex.md`.

## The loop

1. **Pick work.** An open, unblocked, unassigned issue on the board, or whatever Sebastian asked
   for. No issue yet? Write a two-line one with an observable outcome, then build. The canonical
   frontier query is a script, so there is one of it:
   ```bash
   ops/board.sh frontier   # open, unblocked, unassigned, agent:queued or agent:changes-requested
   ```
   **Never re-derive it with `gh issue list --label` or `?labels=`.** A server-side label filter
   lags about three seconds behind the write, so an issue another pass claimed moments ago still
   reads as queued — the script fetches the issues and matches labels itself. The reason, measured:
   the header of `ops/board.sh`.

   Claim by swapping the label for `agent:in-progress`; two parallel sessions on one issue is the
   only collision worth guarding.
2. **Decide, don't ask.** Rule from `product-docs/product-values.md`, `CONTEXT.md` and `memory/`.
   Record product rulings in `product-docs/decisions.md`, code rulings in the PR body. A wrong
   ruling is cheap; a stalled task is not. Two exceptions: owner taste on UI direction gets 2-3
   live prototypes behind the switcher (`.agents/skills/prototype/`), and an idea that is not yet
   fleshed out carries `needs-spec` — the marker for "Sebastian and the agent still need to talk
   this through" (`.agents/skills/grilling/`). `needs-spec` issues never enter the frontier; the
   conversation turns them into `agent:queued` issues. In both cases, continue other work.
3. **Read `memory/invariants.md` before mutating.** It holds facts about this codebase, not
   ceremony. An invariant is never broken; a ⚖ ruling is never broken silently.
4. **Build.** Branch off `origin/main`. In the Codex app, start isolated work in a managed
   worktree: `.worktreeinclude` copies `.env.local`, and the selected local environment must run
   `pnpm install`. When an agent or human creates the worktree from the shell, use
   `scripts/worktree-add.sh`; it links the env without copying it. Never use a raw
   `git worktree add`. Every fresh worktree needs its own real `pnpm install`. Before starting a
   local preview, replace or remove the inherited `.env.local`, whether copied or linked, and
   configure owned disposable services per `ops/local-previews.md`. Preserve the main env file.
5. **Prove the changed behavior locally.** Use Portless development mode while iterating, then a
   production-mode snapshot of the clean final commit for runtime acceptance evidence. Setup and
   cleanup: `ops/local-previews.md`. Browser mechanics: `.agents/skills/browser-validation/`.
   Assert each outcome; readiness and screenshots alone are not proof. Backend work gets real
   requests asserting status and shape. Docs-only work uses relevant document/config checks and
   records runtime validation as not applicable. No push or PR is needed to create a local preview.
6. **Ship one coherent change per PR.** Related issues may share a branch and PR when they have
   one reviewable outcome. Keep fixes and review rounds on that PR; keep unrelated work separate.
   Include `Closes #<issue>` per resolved issue and evidence in the body. CI green
   (`Format, Lint, Typecheck, Build`) is the merge bar, and you drive the merge yourself rather
   than waiting for a human. If a migration is in the diff, apply it on a scratch DB first and
   paste the DDL delta in the body. The order is anchor → `--disable-auto` → back-fill the body →
   merge, and when another PR carries **`merge-priority`** it is starved, so every other track
   holds until it lands — read that off the board in the same breath as merging, never earlier:
   `ops/merge-hold.sh <your-pr> --wait && gh pr merge <your-pr> --squash`. Full recipe and the
   reason the merge goes last: `.agents/skills/open-pr/`.
7. **Clean up when review is finished.** Stop the previews with `portless preview down <id>`.
   Once all users of a clean secondary worktree are done, use `--remove-worktree` on its last
   preview. Keep evidence outside the worktree; Git retains the branch. See `ops/local-previews.md`
   for leases, cleanup verification and resources that need project teardown.
8. **If something fails, fix it and go again.** There is no attempt cap, no blocked label, no
   handing the work back. "I could not finish because X" is only acceptable when X is missing
   access or credentials.

## Still true

- The board is the system of record. Labels are canonical; status never lives in a file.
- A change that adds or alters a rule updates `memory/` in the same change: one 1-3 sentence line
  in `memory/invariants.md`, the why in `memory/invariants/<domain>.md` only when the source cannot
  show it. A new route or table alone does not.
- Start branch servers through Portless. Never message a running workflow agent directly (it forks a duplicate);
  comment on its issue instead.
- New UI components come from the shadcn CLI. Migrations run with `pnpm db:migrate`, never
  `db:push`. Every clickable gets `cursor-pointer`.
- Live labels: `agent:queued`, `agent:in-progress`, `agent:changes-requested`, `needs-spec`, plus
  `feature`, `decision`, `deferred` (`ops/setup-labels.sh`). Retired labels on old issues are
  history, not instructions.

## Removed 2026-08-19

The four-gate DoD, `MAX_ATTEMPTS`, `agent:blocked`, DECISION holds, the human review
queue, the never-auto-merge holds, the `risk:high` classification (gone entirely — auth and tenancy
work ships like everything else), and the three `.claude/workflows/*.js` loops (build-until-done,
frd-plan, frd-implement; git history keeps them). They were the right shape for a system serving
customers, which this is not yet. Revisit at alpha, when real client data raises the cost of
breakage; until then relevant CI and functional evidence are the merge bars. Automatic hosting deployments
are limited to `main`; local review does not require a hosted deployment.
