# Definition of Done (DoD)

This is the **single source of truth** for when work is allowed to become a PR.
Every skill and workflow in the Agent Delivery OS cites this file. A track is **DONE** only when
**every applicable gate passes with captured evidence** — some of those gates scoped to a single
workstream, the rest run once over the integrated track (see *Scoped vs integration* below). No PASS
→ no PR. The loop (`build-until-done`) keeps iterating until DONE or a circuit breaker trips.

The evidence collected here becomes the **"Definition of Done ✅"** section of the PR body, so a
human reviewer can confirm each claim without re-running anything.

---

## Anchored vs attested — read this before trusting any gate below

Every gate is one of two kinds, and the difference decides how much you have to supervise:

- **Anchored** — something that cannot argue back said so. A check run's conclusion. A test exit
  code. An HTTP response from a deployment that actually contains this branch's code.
- **Attested** — an agent says so, and its evidence is its own prose.

An attested gate is not worthless, but it fails in a specific way: it stays green while the thing
it describes quietly stops being true. This repo has three worked examples. A DoD reported PASS
with a browser gate that had never opened a browser. CI was believed to be validating PRs while it
had not passed once since April. G3 drove `localhost:3000`, which serves `main`, so it exercised
code the branch had never written.

> Topology does not buy truth. Anchors do.

| Gate | Kind | What anchors it |
|---|---|---|
| G0 Spec mapped | attested | — judgment, inherently |
| G1 Static | **anchored** | the `Format, Lint, Typecheck, Build` check on the PR |
| G2 Tests | **anchored** | `pnpm test` runs in that same check |
| G3 Functional | partly anchored | a real preview deployment containing this branch; assertions are still attested |
| G4 Conventions | attested | — |
| G5 Diff hygiene | **computed** | `git diff --name-only` compared against the declared file set |
| G6 Independent sign-off | attested | fresh-context reviewer; judgment by design |

**The rule that follows:** a passing DoD report is a claim, and the PR's required check is the
verdict. `open-pr` waits for it, and the loop treats *green DoD + red check* as a failed attempt.

---

## Scoped vs integration — which gates run where

A track is no longer one agent's worth of work. It is a set of **stages** — topological levels over
`dependsOn` — and each stage holds one or more **workstreams**, a workstream being the units in that
stage which share a declared file and therefore need one agent working sequentially. File-disjoint
workstreams in the same stage run in parallel, each in its own worktree branched from the **track
branch HEAD**, and merge back before the next stage starts. Still one branch, one PR — but a PR that
may close several issues.

So the gates split by what they can actually see:

| Scope | Gates | Where it runs |
|---|---|---|
| **Per workstream** | G0, G2-subset, G5 | that workstream's own worktree, in parallel with its siblings |
| **Integration** | G1, G2 (full), G3, G4, G6 (+ HR1–HR4) | once, on the track branch, after the last stage merges |

**The split falls on what is scopable, not on what is convenient.** G0 is about *this* workstream's
ACs, G5 is a diff against *this* workstream's declared files, and a test subset covering its changed
files means something on its own. G1 and G3 are neither scopable nor cheap: `pnpm build` is repo-wide
by construction, and G3 is tied to a **Vercel preview deployment created by the push**, so it is
one-per-branch (G3 below already says this — it is why a frontend track opens its PR before it can
validate). Running N builds and N preview cycles on one branch proves nothing that one of each does
not. Amortising a single G1 + G3 + CI cycle across every workstream in the track is the entire
throughput argument for staging.

**Aggregation is fail-closed, exactly like HR4.** Any workstream verifier reporting FAIL blocks the
track, and a workstream verifier that **died counts as a NO** — missing evidence is a FAIL everywhere
else in this document, and a dead verifier is missing evidence.

Two consequences for the gates as written below:

- **G0's blocker rule is about blockers *outside* the track.** A track is a connected component over
  `dependsOn`, so a stage-1 unit is by construction blocked by a stage-0 unit in the same track —
  whose issue stays open until the track's single PR merges. Inside a track that edge is satisfied by
  **its stage having landed on the track branch**, not by the issue closing. Against anything outside
  the track `blocked_by == 0` still holds in full; that is what the frontier query filters on, and
  building past one of those is still how a merge conflict becomes a design conflict.
- **G5's baseline is the workstream's branch point**, which is the track branch HEAD it was cut from,
  not `origin/main`. Using `origin/main` would report every earlier stage's files as deviations.

---

## Gates

### G0 — Spec mapped
*Scope: per workstream — its own ACs, not the track's.*

- Every acceptance criterion (AC) on the source GitHub Issue has a declared **verification method**
  (which gate proves it, and how).
- No AC is left unverifiable ("looks good" is not a method).
- The issue **has a parent**, and that parent is a `feature` issue linking an FRD. An orphan unit is
  work nobody can trace back to a requirement — check with
  `gh issue view <n> --json parent --jq .parent`. **Use that form, not the REST field.**
  `gh api repos/{owner}/{repo}/issues/<n> --jq .parent` returns `null` even when a parent exists, so
  reading it there reports a false orphan and fails this gate on a lie (`ops/agent-os/labels.md`).
  The one standing exception is platform work that no FRD covers (oversight, CI, the factory itself);
  say so explicitly in the evidence rather than inventing a parent.
- The issue is **not blocked** — `issue_dependencies_summary.blocked_by == 0`. Building past an open
  blocker is how a merge conflict becomes a design conflict.
- **Evidence:** AC → method table, plus the parent issue and blocker count.

### G1 — Static checks
*Scope: integration — once, on the track branch. The build is repo-wide; there is no scoped version.*

- `pnpm typecheck` → clean (0 errors).
- `pnpm lint` → clean (0 errors; warnings noted).
- `pnpm format:check` → clean.
- `pnpm build` → succeeds. Run it the way CI does — **hermetic**, no reachable database:
  ```bash
  CI=1 DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" \
    RESEND_API_KEY="re_ci_placeholder" pnpm build
  ```
  A build that only succeeds against a live database will pass locally and fail in CI.
- **Evidence:** the tail of each command + exit code — *and* the PR check, which is the anchor.
  Running these locally is how you avoid a red check; it is not what proves the gate.

### G2 — Tests
*Scope: both. A workstream runs the **subset covering its changed files**; the full suite is an
integration gate. A green subset is not a green suite and may never be reported as one.*

- `pnpm test` → green.
- New/changed logic has tests (happy path + at least one failure/edge path).
- No `.only`, no `.skip`, no commented-out tests.
- **Anchored:** CI runs the suite too, so a number reported here that CI cannot reproduce fails the
  PR. If a test only passes with your `.env.local`, it does not pass.
- A pre-existing failure is not a free pass. Say which test, and prove it fails on `main` as well —
  otherwise you are shipping on the assumption that someone else broke it.
- **Evidence:** test summary (counts) + exit code.

### G3 — Functional validation (the proof — MCP-driven)
*Scope: integration — once, on the track branch. The preview deployment is created by the push, so
this gate is one-per-branch whether the track holds one workstream or eight.*

The track must be demonstrated **working against the running app**, not just compiling — every AC
from every workstream in it, on the integrated branch.

**Before this gate runs, the branch is pushed and the two shas are compared.** A preview deployment
is built from `origin/<branch>`, not from the worktree, so a worktree that is one commit ahead means
the gate is examining code the fix has already replaced — and it will keep saying so, convincingly,
until the attempts run out. That is what happened on #307: local `a4c5ede` against origin `f604b2b`,
two attempts spent on a preview of the previous commit. So:

```bash
git -C <wt> push -u origin <branch> && git -C <wt> fetch origin <branch>
git -C <wt> rev-parse HEAD            # must equal…
git -C <wt> rev-parse origin/<branch> # …this, before anything validates a preview
```

The loop does this itself and refuses to call the verifier while they differ. A verifier that drives
a preview must still confirm the deployment it opened was built from that sha; if it was not, **FAIL
G3 and name the sha the preview came from** rather than reporting on it anyway.

**Frontend / fullstack units** → run the `validate-frontend` skill:
- Drive the branch's **Vercel preview deployment**, not `localhost:3000`. Localhost serves the
  **main checkout**, so it never contains the track's work — validating there proves nothing about
  the change and is how a UI gate passes without anything being exercised.
  Get the URL with `./scripts/preview-url.sh --wait --bypass <pr-number>`; the full procedure and
  its two traps are in `.claude/skills/browser-validation/SKILL.md`.
- **Consequence for the loop:** the preview is created by the push, so a frontend track opens its PR
  with G3 at ⏳, validates against the preview, then edits the PR body to ✅. A PR may exist briefly
  unvalidated; it may never *claim* a gate it did not run.
- For each AC: navigate to the flow, perform the interaction, and assert the visible outcome
  (`browser_snapshot` / `browser_click` / `browser_evaluate`).
- `browser_console_messages` must contain **no errors** (warnings noted).
- Capture a **screenshot** of each key state.
- Run a **chrome-devtools `lighthouse_audit`** on the touched page; **accessibility ≥ 90**
  (perf/best-practices recorded, not blocking unless the AC says so).
- **Design review (mandatory, ruled 2026-08-08):** run the **`better-interface`** skill against the
  touched surfaces on the preview — layout, hierarchy, and copy, not just defects. Every finding is
  **dispositioned**: applied on the branch, or carried in the PR body as a named limitation with a
  reason. A frontend/fullstack track whose evidence bundle shows no better-interface disposition
  table has **not passed G3**. (Why: two tracks — #303's oversight pages and #305's /launch — shipped
  through every correctness gate and were flagged as structurally wrong by the reviewer on sight.
  Correctness gates do not see layout. Workflow-script plumbing for this gate is #337's AC; this
  document binds verifiers regardless.)
- **Evidence:** per-AC pass/fail, screenshot refs, console dump, lighthouse summary, and the
  better-interface disposition table.

**Backend / API units** → run the `validate-backend` skill:
- Exercise the route / server action (curl or a `tsx` harness) and assert response **status + shape**
  against the contract declared by the unit's issue/FRD and the source (non-obvious behaviors:
  `memory/contracts/api.md`).
- `pnpm db:migrate` applies cleanly on a scratch/shadow DB.
- **Evidence:** request/response transcript, migration output.

### G4 — Conventions & invariants
*Scope: integration — once, over the track's whole diff.*

- `cursor-pointer` on every clickable (per `AGENTS.md`).
- New shadcn components added via `pnpm dlx shadcn@latest add` (never hand-written).
- Migrations via `pnpm db:migrate` — **never** `db:push`.
- `memory/*` updated **in the same change** if the unit added or altered an invariant, a diagrammed
  flow, or a non-obvious behavior (per the `memory-maintenance` skill; a new route or table alone
  does not require it).
- Tenancy / auth boundaries respected (`memory/invariants.md`, plus the `memory/invariants/*.md`
  domain files matching the files touched).
- **Evidence:** checklist with the specific lines/files touched.

### G5 — Diff hygiene
*Scope: per workstream — against **that workstream's** declared file set, not the track's union.
A track-wide G5 would pass a workstream that wandered into a sibling's files, which is precisely the
collision staging exists to prevent.*

- Changes confined to the workstream's declared files; any deviation is named and justified.
- Conventional commit messages.
- No debug logs, no commented dead code, no secrets/keys, no `.env` edits.
- **Compute the file list, do not recall it.** Run it and compare against the declared set:
  ```bash
  git diff --name-only $(git merge-base origin/main HEAD)...HEAD
  ```
  In a workstream worktree the baseline is the **track branch HEAD it was cut from**, not
  `origin/main` — otherwise every earlier stage's files read as deviations of yours:
  ```bash
  git diff --name-only $(git merge-base <track-branch> HEAD)...HEAD
  ```
  Anything in that output and not in the workstream's declared files is a deviation, whether or not
  it felt significant while writing it. "I stayed in scope" is a memory; this command is a fact.
- **Evidence:** the raw command output, plus `git diff --stat` and a one-line deviation note
  (or "none").

### G6 — Independent sign-off
*Scope: integration — one reviewer for the track, reading the scoped reports plus the integrated diff.
It is also the gate that catches what no workstream could see: two file-disjoint workstreams that are
individually correct and jointly wrong.*

- A **separate** `code-reviewer` agent (NOT the implementer) confirms G1–G5 **from the evidence,
  adversarially** — default to reject when a gate's evidence is missing or unconvincing.
- Verdict ∈ `PASS` | `PASS_WITH_WARNINGS` | `FAIL`. Only `PASS` / `PASS_WITH_WARNINGS` may open a PR.
- **Evidence:** reviewer verdict + findings.

---

## High-risk units (extra gates)

A unit is **high-risk** if it touches: DB schema/migrations, auth/permissions/roles, multi-tenant
boundaries, or payments/billing. These are **still autonomous to PR** (the PR review is the human
checkpoint), but they must additionally satisfy:

- **HR1 Migration dry-run** — migration applied to a scratch DB and the resulting schema diff captured.
- **HR2 Rollback verified** — down-migration (or documented rollback) proven to restore prior state.
- **HR3 Schema diff in PR body** — the exact DDL delta is shown to the reviewer.
- **HR4 Diverse-lens sign-off** — after G6, three *independent* reviewers each examine the branch
  through **one** lens, and **every one must clear**. Any FAIL blocks; a lens whose agent dies also
  blocks, because missing evidence is a FAIL everywhere else in this document.

  | Lens | The question it owns |
  |---|---|
  | `correctness` | Does it do what the ACs asked, including the edge cases nobody wrote an AC for? Is the DDL itself right, and does existing data survive it? |
  | `security` | Auth on every new entrypoint, multi-tenant boundaries, injection, secrets or internal data leaking to a client bundle or log. Reads `memory/invariants.md` AND every file under `memory/invariants/`, and holds all of it as hard requirements. |
  | `reproducibility` | Re-runs the migration dry-run, the rollback, and `pnpm test`, and re-derives the schema diff — then checks the first verifier's claims against what it actually observed. |

  This replaced *two identical `code-reviewer` passes*. Two identical reviewers largely reproduce
  each other's blind spots — the second agrees with the first for the same reasons the first was
  wrong. Three different questions don't correlate that way.

  **The votes are not pooled, and that is the point.** Majority voting is the correct aggregation
  for *redundant* verifiers, where identical skeptics generate correlated noise and outvoting
  filters it. These verifiers are *diverse*: a `security` FAIL is not noise the other two can
  outvote, because neither of them looked at security. Each lens holds a veto over its own axis.

  Findings from lenses that **do** clear are carried into the PR body, so the human reviewer can see
  what each axis actually examined rather than just that it passed.
- The PR is labelled `risk:high` so it sorts to the top of the review queue.

---

## Verdict

```
WORKSTREAM DONE = G0 + G2-subset + G5 all PASS, in its own worktree
        (a verifier that died counts as a NO — it is not DONE)
  NOT DONE
        → feed the failing gate + evidence back to THAT workstream, retry (its attempt++)
  EXHAUSTED (its MAX_ATTEMPTS, default 3)
        → the track cannot integrate; block as below

TRACK DONE = every workstream DONE  AND  G1 + G2 (full) + G3 + G4 + G6 PASS
             (+ HR1..HR4 if high-risk)
        → open PR, attach evidence, label every issue the track closes `agent:in-review`
  NOT DONE
        → an integration failure that NAMES a workstream goes back to that workstream and
          consumes ITS attempt; an unattributable one consumes a track-level integration attempt
EXHAUSTED (max attempts or token reserve hit)
        → DO NOT open a PR; label issue `agent:blocked`, comment the failing gate + evidence,
          alert the human. Never stop silently.
```

**A workstream that passed is never re-implemented.** Attempt accounting is per workstream precisely
because the flat `G0..G6` verdict this replaced re-ran the entire track over one failing AC and burned
an attempt for every healthy unit in it.

### What a retry must carry, and what it must answer

A failing verdict travels to the fixer **as evidence, not as a summary**. The retry prompt quotes the
failing gate's evidence and the failed ACs' evidence verbatim; `fixInstructions` rides along but does
not replace them. A paraphrase is where a named `ReferenceError` becomes "the page doesn't render".

The fix's structured result must then answer that named cause — `rootCause` (the cause restated) and
`rootCauseAddressed` (what changed, and the command output proving it is gone) — and **nothing else it
did counts until it does**: the loop rejects the attempt without spending a verifier on it. This is
the #307 failure written down. The verifier named a module-eval crash; attempts 2 and 3 came back
having fixed a stuck button and pinned a test, both plausible, both against a page that still crashed,
and the track exhausted its attempts with the named cause untouched. An honest "could not fix it, here
is why" is a better attempt than a fix report for something else.

### Exit hygiene — who owns the worktrees

Every exit says what happened to the build trees, because both live passes left them unowned (PR #333
held with `bud-310-ws1*` still on disk; #303/#307 blocked with theirs intact, found only because a
human knew to look).

- **Merged** — the track removes its own worktrees and local branches (`git worktree remove` +
  `git branch -D` + `git worktree prune`) and reports what `git worktree list` printed afterwards.
  Only on a *confirmed* merge: a PR queued for auto-merge has not landed, and deleting the tree under
  it is how the work disappears.
- **Held / blocked / delivery-failed** — the trees stay, and the exit comment **names every one**:
  path, branch, and what it holds. Those trees are the only re-runnable copy of the work, so they are
  handed over explicitly rather than left for someone to discover.

**"Re-runnable" is a guarantee, not a hope.** Track prep takes one of two paths. A branch that does
not exist yet is **cut** from `origin/main` and must equal it — a fresh branch *is* its base commit.
A branch that already exists is **resumed**: prep fetches, merges `origin/main` into it
(fast-forwarding when it can), and asserts `origin/main` is an **ancestor** of the branch HEAD. That
is the same invariant as the fresh-cut check — never build or validate on a base behind
`origin/main` — stated the only way it can be for a branch that carries prior commits. Asserting
equality on the resume path would reject every preserved tree the moment main moved, which is to say
it would reject exactly the artifact this section exists to preserve. If the update **conflicts**, the
merge is aborted and the track stops cleanly with the conflicted paths named: nothing is
auto-resolved, nothing is deleted, and the resolution is a human's with
`.claude/skills/resolving-merge-conflicts/SKILL.md`.
