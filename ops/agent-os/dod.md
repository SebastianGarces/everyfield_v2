# Definition of Done

The single contract for when work may become a PR. No PASS, no PR.

Workstreams build in parallel worktrees off the track branch and merge back; **every gate below runs
once, on the assembled branch**. One branch, one PR, however many issues the track closes.

CI's conclusion is the verdict. Everything an agent reports is a claim — so a green DoD report beside
a red required check is a failed attempt, not a disagreement.

Size the rigor to the diff: a ruled two-line change gets the one review and the CI anchor, nothing
else.

---

## The four gates

### 1 — CI GREEN

The `Format, Lint, Typecheck, Build` check (format:check · lint · typecheck · test · build) is green
**at the PR head sha**.

- **A green anchor IS the gate — never re-derive beside it.** A green run at the exact sha under test
  satisfies this gate whole. Local runs are an optional pre-flight for avoiding a red check; they are
  never separate evidence.
- Local re-derivation is the fallback for a **missing** anchor. Run the build the way CI does —
  hermetic, no reachable database:
  ```bash
  CI=1 DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" \
    RESEND_API_KEY="re_ci_placeholder" pnpm build
  ```
- New or changed logic carries tests (happy path + at least one failure path). No `.only`, no
  `.skip`, no commented-out tests. A pre-existing failure is not a free pass: name the test and prove
  it fails on `main` too.

### 2 — WORKS

The change is demonstrated against a running deployment of **this sha**, once, after the fix pass.

- **Frontend / fullstack** → one browser look at the branch's **Vercel preview**, never
  `localhost:3000` (localhost serves the main checkout, so it never contains the track's work).
  Procedure: `.claude/skills/validate/SKILL.md`. Assert the visible outcome per AC, require a clean
  console, capture a screenshot per key state, and run a lighthouse audit with **accessibility ≥ 90**.
  While you are on the preview, judge layout, hierarchy and copy as well as defects — fix what you
  can, name what you cannot in the PR body.
- **Backend / API** → one real request against the route or server action, asserting **status and
  shape** against the contract the issue and the source declare (`memory/contracts/api.md` for
  non-obvious behavior). `pnpm db:migrate` applies cleanly on a scratch DB.
- **Evidence:** per-AC pass/fail, screenshots or the request transcript, console dump, lighthouse
  summary.

### 3 — REVIEWED

**Exactly one code review per PR**, by an agent that did not implement the change
(`.claude/agents/code-reviewer.md`). It reads the assembled diff and covers, in one pass:

- **Spec mapping** — every AC on every issue the track closes has a verification method and a result.
  Each issue has a `feature` parent: `gh issue view <n> --json parent --jq .parent`. **Use that
  form.** `gh api repos/{owner}/{repo}/issues/<n> --jq .parent` returns `null` even when a parent
  exists, so it fails this gate on a lie. Platform work no FRD covers is the standing exception — say
  so. Nothing outside the track is still `blocked_by` open.
- **Conventions and invariants** — `AGENTS.md`, `memory/invariants.md`, and the
  `memory/invariants/*.md` domain files matching the files touched, held as hard requirements. On
  schema, auth, tenancy or payments diffs the reviewer holds the **security lens** explicitly: auth on
  every new entrypoint, tenant boundaries, injection, secrets or internal data reaching a client
  bundle or a log.
- **Diff hygiene** — changes confined to the declared files, conventional commit messages, no debug
  logs, dead code, secrets or `.env` edits. Compute the list, do not recall it:
  ```bash
  git diff --name-only $(git merge-base origin/main HEAD)...HEAD
  ```
- **Comment provenance** — an added non-test source line may state a constraint the code cannot
  show; it may not carry provenance. Issue numbers, ruling dates and review-round stamps belong in
  the commit message, the PR body and `memory/`, never in a source comment.
- **Structure** — a second implementation of a decision that already has one is a finding; so is new
  logic reachable only through a browser when a pure seam was available.

Output splits **warnings** (spec-questions) from **actionable findings**, each carrying a `remedy`.

### 4 — SHIPPED

One PR (`.claude/skills/open-pr/SKILL.md`) carrying: the evidence for gates 1–3, one `Closes #<issue>`
line per issue the track closes, and a **Manual QA** section that names what the automation could not
judge and **never restates the acceptance criteria**. Labels written and **read back** — the label is
the record, and a label you did not observe is not a label you may report.

---

## Migrations, and the high-risk rider

A unit is **high-risk** when it touches auth/permissions/roles, tenant boundaries, or
payments/billing. Pre-release, schema and migrations are *not* high-risk on their own: no separate
production database holds client data (ruled 2026-08-13). **Revert condition:** the day alpha or
beta serves real client data from its own production DB, schema and migrations return to `risk:high`.

- **Whenever the diff carries a migration, at any risk tier:** prove it **applies and rolls back** on
  a scratch DB, and paste the exact **DDL delta** into the PR body.
- **`risk:high` only:** the reviewer holds the security lens (gate 3) and reads every matching
  `memory/invariants/*.md`; the PR is labelled `risk:high` and **never auto-merges** — the human PR
  review is the checkpoint, and this is the one class of change a revert cannot undo. Factory-path
  changes (`.claude/workflows/`, delivery-OS skills, `ops/agent-os/`) hold the same way: the machine
  that decides what merges keeps a human.

---

## Verdict

```
DONE = gates 1–4 all PASS on the assembled branch (+ the migration proofs if the
       diff carries a migration; + the security lens if risk:high) → PR, evidence
       attached, every issue the track closes labelled agent:in-review
FAIL → ONE retry, and it must answer the NAMED cause verbatim. The retry prompt quotes
       the failing gate's evidence, not a paraphrase; a fix that answers no finding is
       refused. "Could not fix it, here is why" beats a fix report for something else.
MAX_ATTEMPTS = 2
EXHAUSTED → no PR. Label the issue agent:blocked, comment the failing gate and its
       evidence verbatim, alert the human. Never stop silently.
```

A publish or anchor failure is **not** a code failure and never burns an attempt: when the named
cause is that the PR head is not the validated sha, or no CI run exists at that sha, the remedy is a
**ref operation** — push the sha to the PR's head ref, dispatch CI at it (`gh workflow run
"PR Checks" --ref <ref>`), correct the body, re-check the anchor alone.

Unresolved findings do not block the PR by default. Rule on them from `product-docs/product-values.md`,
`CONTEXT.md` and `memory/invariants.md`, apply or waive, and record the ruling in the PR body. HOLD
with a DECISION comment only when the ruling would change product shape.

## Publish discipline

- Before validating: the worktree sha must equal the origin sha. A preview is built from
  `origin/<branch>`, so validating one commit behind reports on code the fix already replaced.
- Before merging: `gh pr view <n> --json headRefOid` must equal the validated sha. A fix that lands
  on a side branch moves the tree but not the ref, and then nothing anchors.
- Never satisfy gate 1 with a run at an ancestor sha. A green run at the parent is exactly the
  staleness this rule catches.

## Memory (part of gate 3)

`memory/` records what the code cannot say. A change that adds or alters a rule updates it **in the
same change**; a new route or table alone does not.

- A new or changed rule gets **one line in `memory/invariants.md`**, under its domain heading, tagged
  by strength (invariant, or ⚖ ruling).
- The *why* goes in the matching `memory/invariants/<domain>.md` file **only when it is not derivable
  from the source**. Never write elaboration without the index line — the index is what agents read.
- Point at the source; never mirror it. No incident narration, no dates, no test-file citations.
- **Keep each rule to 1–3 sentences.** There is no byte cap any more (ruled 2026-08-15 — the cap was
  re-pinned four times in two days and had become a tax on unrelated passes), so brevity is the
  reviewer's job rather than a test's. The failure it now guards against is prose, not rule count: a
  rule that needs a paragraph is a rule whose *why* belongs in `memory/invariants/<domain>.md`.
