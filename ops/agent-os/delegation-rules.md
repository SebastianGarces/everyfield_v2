# Delegation rules — what makes work delegable

Seven rules that decide whether a piece of work can be handed to the build loop with a real
chance of coming back done. The delivery machinery (`workflow.md`, `dod.md`, `spec-intake`)
enforces *process*; these rules govern the *inputs* — the design, the codebase shape, and the
task definition that process runs on. A track that fails repeatedly usually violated one of
these before the first agent was spawned.

Each rule states where it is enforced.

---

## R1 — Design the hard parts before dispatch

The build loop implements; it does not design. The hard parts — schema, shared contracts and
types, security boundaries, concurrency guards — are decided **in the issue**, before anything
is dispatched, by a human plus an architect pass. Stage 0 *lands* the shared prerequisite; it
must never *invent* it mid-build, because every parallel workstream is cut against whatever
stage 0 produced, and a wrong interface there is rework multiplied by the number of
workstreams.

Concretely, an issue is not build-ready while any of these is undecided:

- a new table or column (shape, nullability, uniqueness — the concurrency guard is part of
  the schema, not an implementation detail: see `memory/invariants.md` → Transactions)
- a contract between workstreams (the exported function signatures, the event payloads)
- who may call the new thing (`"use server"` surface, tenancy predicate, role check)
- a direction question with 2+ plausible answers → `needs-spec`, and if it is experiential,
  live prototypes (`.claude/skills/prototype/`)

**Enforced:** `spec-intake` — an issue whose stage-0 workstream needs a design verb (decide,
choose, design a schema/contract/auth surface) is `needs-spec` by definition; plus stage 0
ordering and the `prototype` skill for direction questions.

## R2 — One domain, one module, one implementation per decision

The codebase stays delegable only while an agent can be pointed at `src/lib/<domain>/` and
own it without reading the rest of the tree.

- **Feature logic lives in its domain module** (`src/lib/tasks/`, `src/lib/wiki/`,
  `src/lib/invitations/`). Routes, actions and components are thin callers. Another domain
  reaches in through the module's exports — never with its own SQL against that domain's
  tables.
- **A decision is a named, exported function, and every surface calls it.** The pattern is
  all over the invariants for a reason: `topLevelTasksOnly()`, `visibleToChurch()`,
  `daysUntilTarget()`, `evaluateResendEligibility()`, `phaseAdvanceCondition()`. The UI gate
  and the server gate are the same function. The copy is always the one that misses the fix —
  so there is no copy.
- **Cross-cutting chokepoints get one owner.** Barrels, shared constants, the schema files:
  `spec-intake` names them in `## Likely files` so one track owns them and parallel
  workstreams never collide there.
- **An interface change mid-build is a spec question, not a silent deviation.** A workstream
  that needs a different stage-0 contract stops and raises it; it does not widen the contract
  and keep going. (G5 catches the file-list symptom; this rule names the cause.)

**Enforced:** G5 (files); G6's reviewer charter asks the structural question directly — a
second implementation of an existing decision is a FAIL (`ops/agent-os/dod.md` G6).

## R3 — Scope issues to outcomes, workstreams to files

Already the law of `spec-intake`; restated here because it is the delegation rule most often
violated by instinct (small issues *feel* safer and are strictly worse).

- One **outcome** per issue; observable ACs, each naming how it is proven. If you cannot say
  how an AC is verified, it is not an AC yet.
- The unit that must stay **small and file-disjoint is the workstream**, not the issue. A
  track pays build + suite + preview + CI + PR once for all its workstreams; splitting an
  outcome into N issues pays it N times.
- Dependencies are **edges** (native `blocked-by`, or a workstream `depends on:` line), never
  prose. Semantic dependency → edge; file overlap → scheduling, `## Likely files`.
- Describe outcome and constraints; do not design the implementation in the issue. (R1 draws
  the line: interfaces are constraints, algorithms are implementation.)

**Enforced:** `spec-intake` template + rules, G0.

## R4 — Build the test seam with the feature

Good tests are designed, not requested. A feature is delegable when its decisions can be
tested without a browser, which means the seam is part of the design (R1), not something the
test-writer discovers. The three seams this codebase already proves:

- **Pure core, thin shell.** The decision is a pure function; the effect is a thin executor
  around it. `planRecurrenceChildren()` / `createNextRecurrence`, `checkSubtaskNesting()`,
  `planWipe()`. The pure half gets exhaustive unit tests; the shell gets one integration
  path.
- **Assert the emitted SQL, not the call.** Query builders render through
  `.toSQL()`/`PgDialect` and the test pins the predicate (`tenancy.test.ts`,
  `subtasks.test.ts`). This is what makes "both builders share `topLevelTasksOnly()`"
  enforceable instead of aspirational.
- **A live-DB test only for what SQL strings cannot see.** Race conditions get a real
  concurrent test (`declaration-race.test.ts`), skipped without `DATABASE_URL`. Everything
  else stays hermetic — G1's build must pass with no reachable database.

Corollary for intake: an AC's **verify:** method should name a unit seam whenever one can
exist. A browser assertion proves the integrated track once (G3); it is the most expensive
seam and the only unscopable one. An issue whose every AC is browser-verified is usually an
issue whose design has no seams.

**Enforced:** G2 requires tests; `spec-intake` states the verify preference order (unit seam >
API assertion > browser); G6's reviewer charter asks whether new logic sits behind a testable
seam and carries a missing one into the PR body as a warning.

## R5 — Documentation is a router, not a mirror

Just enough documentation means: an agent can find the right place fast, and nothing it finds
is stale.

- **The source is the source of truth.** Anything reconstructable with `ls`, Glob or reading
  the schema is not documented — it is read. `memory/` holds only what the code cannot say:
  invariants, rulings, non-obvious semantics, flow intent. Budget ≤50 KB, and the budget is a
  feature.
- **Routing over content.** `AGENTS.md` is a table of *where to look*, `memory/index.md` is
  one page, `entrypoints.md` teaches conventions for finding flows rather than enumerating
  them. Adding a doc means adding a row to a router, not a new place truth can rot.
- **Every recorded rule points at its enforcement.** An invariant names the test that pins it
  or the index that makes it impossible; a known gap names the issue that retires it. A rule
  with neither is a request, and requests go stale silently.
- **Status never lives in files.** The board is canonical; the checklist files died
  2026-07-26 because they attested what only GitHub can anchor.

**Enforced:** G4 + the `memory-maintenance` skill (same-unit updates), the 50 KB budget.

## R6 — Rules bind at two strengths, and agents escalate rather than improvise

The corpus agents read before mutating (`memory/invariants.md`) mixes two strengths, and
delegation needs them told apart:

- **Invariant** — mechanical or security fact (the stack, the tenant boundary, the auth
  surface). Never broken. An agent that thinks one is wrong is wrong.
- **Ruling** — a product decision, dated, with an issue number. Never broken *silently*: an
  agent that believes a ruling no longer fits raises a spec-question hold with options (or
  prototypes, for direction questions) and keeps building to the standing ruling meanwhile.

This is what keeps recorded decisions from calcifying into false physics: the escalation path
is cheap and already built (`workflow.md` §4, the hold agent), so "the rule seems wrong" has
somewhere to go other than being ignored or obeyed.

**Enforced:** `memory/invariants.md` carries the two-strength header and ⚖ tags on ruling
lines; the hold/ruling machinery (`workflow.md` §4) is where an escalation goes.

## R7 — A comment states a constraint; provenance lives outside the source

RULED 2026-08-13 (Sebastian, while reviewing PR #432). Agent-written code had begun narrating
its own delivery history in the files it touched, and the two kinds of sentence read alike
until you ask who they are for.

- **A comment earns its place by saying what the code cannot show** — why this statement is
  first, which invariant the order upholds, what breaks if the obvious simplification is
  applied, which named function owns the decision this one must not re-implement. That is the
  sentence the next reader of the file needs, and it is true independently of how it got there.
- **Provenance is not that sentence, and it never appears in source.** Issue and PR numbers,
  ruling dates, review-round stamps ("round 2 of the sweep", "RULED 2026-08-13", "fixes the
  finding from review round 1"), attempt counters and agent names belong in the **commit
  message**, the **PR body** and **`memory/`** — the three places that are already dated,
  attributed, ordered and searchable. `git log`/`gh` answer "how did this get here"; the file
  answers "what may I change".
- **Why the split is load-bearing.** A comment carries no date and no repo state, so provenance
  in source ages into a claim about a codebase that has moved — a round stamp outlives its
  round, an issue number outlives the issue, and neither can be verified from where it sits.
  It also grows without bound: every later round appends its own stamp to the same block, and
  the constraint the comment existed to state is pushed under a changelog nobody prunes.
- **Not the same thing as an enforcement pointer.** R5 requires a recorded rule to name what
  pins it, so a comment may cite the invariant it obeys or the test that guards it
  (`memory/invariants.md` → Transactions, `assertBatchedWrites`) — that is a live constraint
  with an address, not a history entry. The tell: an enforcement pointer names something a
  reader can go and read *now*; provenance names an event that already happened.
- **Test files are outside the rule.** A suite quoting a spelling in order to forbid it, or
  naming the round that produced a regression case, is stating its subject.

**Enforced:** G4's convention checklist runs the check over the track's **added non-test source
lines** (`ops/agent-os/dod.md` G4); G6's reviewer reports a hit as a finding, fixed in the pass
by moving the sentence to the commit message and leaving the constraint behind.

---

## Follow-up

The open `codebase-design` skill (Pocock adoption, tier 3) is the natural home for the
long-form guidance behind R2 and R4 — worked examples of module boundaries and seam design.
Until it exists, this page and the domain files under `memory/invariants/` are the reference.
