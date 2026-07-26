# The board: moving requirements out of markdown and into GitHub

**Status:** proposal — nothing built. Written 2026-07-26 against `main` @ `6b2b6f7`.
**Question it answers:** we have 11 FRDs and 11 checklists holding requirements. How does an FRD
*transfer* to GitHub — milestones? epics? issues with sub-issues? And what does that cost?

---

## 1. What GitHub actually offers — verified against *this* repo

`SebastianGarces/everyfield_v2` is owned by a **User**, not an organization. That single fact
decides half the design, because GitHub's newest issue primitives are organization-scoped.

Probed directly (`gh api`, 2026-07-26):

| Primitive | Available here? | Evidence |
|---|---|---|
| **Sub-issues** (parent/child) | ✅ | `GET /repos/…/issues/67/sub_issues` → `200 []`; every issue carries `sub_issues_summary {total, completed, percent_completed}` |
| **Issue dependencies** (`blocked_by` / `blocking`) | ✅ | `GET /repos/…/issues/67/dependencies/blocked_by` → `200 []`; every issue carries `issue_dependencies_summary {blocked_by, blocking, total_blocked_by, total_blocking}` |
| **Milestones** | ✅ | `GET /repos/…/milestones` → `200 []` (none defined yet) |
| **Labels** | ✅ | the six in `ops/agent-os/labels.md` |
| **Projects v2** (user-owned) | ✅ | not yet created; `gh project list` fails only on a missing OAuth scope — `gh auth refresh -s project` |
| **Issue types** (`bug`/`feature`/`task`, first-class) | ❌ **org-only** | `GET /orgs/SebastianGarces/issue-types` → `404`; the `type` field exists on every issue but is `null` and unsettable without an org |
| **Issue fields** (GA 2026-07-02) | ❌ **org-only** | same restriction — announced for organizations on Free/Team/Enterprise |

Limits that matter: **100 sub-issues per parent**, **8 levels of nesting**, **one parent per issue**,
**50 links per dependency relationship**. Dependencies have been GA since 2025-08-21 and are fully
supported in the REST API and webhooks.

### Two hard consequences

**"Epic" is not a primitive here.** On an org it would be an issue type. On a personal repo it is a
label plus a title convention, nothing more. If the repo ever moves to an organization, the upgrade
is a one-pass relabel — `feature` label → `Epic` issue type — so choosing labels now costs nothing
later.

**~~The local `gh` is too old.~~ Fixed 2026-07-26 — upgraded 2.58.0 → 2.96.0.** The June 2026 release
added native flags, so the migration used them directly:

```bash
gh issue create --title "…" -l agent:queued --parent 69 --blocked-by 87 --body-file …
gh issue edit 63 --parent 95 --add-blocked-by 29
```

The REST fallback is still worth writing down for anything running on an older `gh`, because it is
easy to get wrong — it takes the blocker's numeric **database id**, not its `#number` and not its
`node_id`:

```bash
BLOCKER_ID=$(gh api repos/$R/issues/62 --jq .id)
gh api --method POST repos/$R/issues/63/dependencies/blocked_by -F issue_id=$BLOCKER_ID
```

One `gh` quirk that cost a rerun during the migration: **zsh does not word-split unquoted
parameters**, so a shell helper passing `"$FLAGS"` hands `gh` one argument and it dies on
`unknown flag: --label agent:queued`. Pass flags explicitly, or use `${=VAR}`.

---

## 2. Prior art: what `to-tickets`, `triage` and `wayfinder` actually teach

Read from `mattpocock/skills` (`skills/engineering/*`, plus `setup-matt-pocock-skills/issue-tracker-github.md`).
Three ideas transfer; one does not.

**Blocking edges belong in the tracker, not in a plan file.** `to-tickets` publishes tickets *in
dependency order, blockers first*, so each ticket's "Blocked by" can reference a real identifier,
and it uses the platform's native relationship where one exists. The payoff is the **frontier**: any
ticket whose blockers are all closed is grabbable, so several agents can run at once without a
human re-reading a wave plan. This is exactly the durable dependency state `waves → DAG` needs, and
Pocock's GitHub tracker doc names the same endpoint verified above.

**The parent is an index, not a store.** `wayfinder`'s map issue "gists and links, never restates" —
each decision lives in exactly one place, and a session loads the map at low resolution then zooms
in. That is the answer to "where does the FRD's prose live": *not* copied into an issue body.

**One category role and one state role, never two.** `triage` refuses to leave an item with zero or
two conflicting states. Our `agent:*` scheme already says this; the board must not quietly introduce
a second status field that can disagree with the label.

**What does not transfer:** `triage`'s verify-before-brief loop is built for inbound reports from
strangers. Our issues are authored by `spec-intake` from our own specs — already DoD-shaped, already
observable. We have no untrusted inbox. Adopt the state-machine discipline, skip the reproduction
step.

---

## 3. The content triage: three kinds of content, three homes

The docs feel like one problem but hold three materials with very different half-lives. Sorting them
is the whole design; the GitHub mechanics after that are easy.

| Material | Example | Half-life | Home | Why |
|---|---|---|---|---|
| **Spec prose** | F6 screens, workflows, data model, integration contracts | months | **stays in the repo** (`frd.md`) | wants review-in-PR, diffs, and to sit next to the code it constrains. An issue body has no diff history and no reviewer. |
| **Requirement inventory + status** | `- [ ] DOC-008: Generated document history` | days | **becomes issues** | this is the *only* material that goes stale, and it already duplicates issue state |
| **Decisions** | the 19-item audit ledger | permanent | **stays a doc** (append-only) | it is neither task nor spec; it is read as context by every agent, and it must be greppable. Closed issues are a bad archive. |

The corollary is sharper than it first looks: **`checklist.md` is the only file that has to die.**
The FRD requirement tables (`| DOC-001 | Template library | … |`) carry no status — they are a
statement of *what the feature is*, Must/Should/Nice included. They stay. The checklist was the
duplicate all along.

And the fourth material, hiding in `work-queue.md`: **operational narrative** ("CI is hermetic
because…", "skip steps, never the workflow"). That is not backlog at all. It is already in
`ops/agent-os/` and in memory. The file goes stale precisely because it mixes durable prose with a
volatile track list — the same failure mode, one level up.

---

## 4. The proposed shape

### Two levels by default, three only when a requirement needs slicing

```
Feature issue          #100  [feature] F6 — Document Templates & Generation
  ├─ sub-issue         #101  DOC-008 — Generated document history
  ├─ sub-issue         #102  DOC-014 — Contextual access from other features
  └─ sub-issue          #67  F6 phase 2 — documents worth handing to a church
       ├─ sub-issue     #—   church branding upload (Blob + settings surface)   [risk:high]
       └─ sub-issue     #—   designed DOCX templates (tables, headers, colour)
```

**Level 1 — the feature issue.** One per FRD, eleven total, labelled `feature`. The body is
deliberately thin: a link to the FRD, three lines of scope, the settled scope decisions, and
nothing else. GitHub renders the sub-issue progress bar, which *is* the checklist — live, and
impossible to leave stale because closing a PR moves it.

**Level 2 — the requirement issue.** One per **open** requirement ID, titled with the ID
(`DOC-008 — Generated document history`) so the FRD and the board share one vocabulary. This is
what `spec-intake` already produces; the only change is that it now gets a parent.

**Level 3 — units, only when needed.** Most requirements are one track and stop at level 2. Big ones
(#67, the phase engine) slice into sub-issues. Depth 8 is available; we will never need past 3.

### Blocking edges: native dependencies, not waves

Semantic blocking — "the schema migration must land before the signal layer" — becomes a native
`blocked_by` edge. `frd-plan` stops emitting a static `wave-plan.json` and instead publishes issues
blockers-first with edges attached; `frd-implement` stops reading a wave array and instead runs
a **frontier query**:

```bash
gh issue list --state open --label agent:queued --json number,title,assignees \
  --jq '.[] | .number' | while read n; do
    [ "$(gh api repos/$R/issues/$n --jq .issue_dependencies_summary.blocked_by)" = "0" ] && echo $n
  done
```

One distinction the current wave model blurs and the DAG must keep separate: **a dependency is
semantic, file-overlap is a scheduling constraint.** Two units that both touch `src/db/schema/index.ts`
are not blocked by each other — they merely cannot run in the same parallel batch. Dependencies hold
the first; the `## Likely files` section already in the `spec-intake` template holds the second, and
the dispatcher reads both. Conflating them is why waves are coarser than they need to be.

### Milestones: for time, not for features

An issue gets **one** milestone and **one** parent. Spending the milestone slot on feature grouping
would waste it, because sub-issues already do grouping better (nested, with a progress bar).
Milestones instead hold the thing sub-issues cannot express — a **date**. Recommend exactly one to
start: `Beta`. Anything more is ceremony for a solo developer.

### The Project: a derived view, never a second source of truth

Create one user-owned Project, `EveryField Delivery`, and enable the built-in **Parent issue** and
**Sub-issue progress** fields plus the auto-add workflow. It gives three views the issue list cannot:
a **board** of the delivery pipeline, a roadmap by milestone, and a table grouped by feature.

**It does not own status.** `agent:*` labels stay canonical — `build-until-done` writes them and
`standup` reads them. The board's `Status` field is **mirrored one way from the labels** by a small
Action; nothing writes back. See §9 for the mapping and its consequences.

The rule that keeps this safe is one line: **agents read labels, never the board.** A derived field
that something else can also write is `work-queue.md`'s failure re-created inside the tool meant to
fix it; a derived field with exactly one writer is just a rendering.

### Decisions: doc, with a live edge for the unresolved ones

The §4 ledger stays exactly where it is. But the **three unresolved rulings** (#10 meetings follow-up
generation, #12b MT-011 training model, #14 wiki data model) are work — they gate builds — so each
becomes an issue labelled `decision`, with `blocking` edges to the requirement issues waiting on it.
That is `wayfinder`'s decision-ticket idea scoped to what we actually have. When a decision issue
closes, the resolution is appended to the ledger in the same PR. The board shows *what is undecided*;
the doc remains the record of *what was decided*.

---

## 5. Where every existing document goes

| Today | Tomorrow | Note |
|---|---|---|
| 11 × `frd.md` | **unchanged** | the requirement tables stay; add one line linking the feature issue |
| 9 × requirement `checklist.md` | **deleted** → sub-issues | wiki, comms, MT, tasks, docs, phase-engine, dashboard, facility, financial |
| `meetings/checklist.md` (382 ln), `people-crm/checklist.md` (332 ln) | **deleted, not migrated** | these are phase-by-phase *build logs*, not requirement inventories — 151 and 142 items already `[x]`. Git history is the archive. |
| `work-queue.md` (439 ln) | **deleted**, split two ways | durable CI/ruleset prose → already in `ops/agent-os/` + memory; the track list → issues |
| `docs-audit-2026-07.md` §4 ledger | **unchanged** | append-only decision record |
| `docs-audit-2026-07.md` §5 pending | 3 × `decision` issues | with `blocking` edges |
| `phase-engine/wave-plan.json` | **deleted** → dependency edges | the DAG replaces it |
| `ops/agent-os/labels.md` | **+3 labels** | `feature`, `decision`, `deferred` |

---

## 6. What the migration actually costs

The naive number is 204 open checkboxes. The real number is far smaller, because the audit already
decided most of them out:

| Feature | Open items | Migrate? |
|---|---:|---|
| F10 Facility Management | 26 | **No — cut** (audit decision #3: off the roadmap, not deferred). One closed `feature` issue as a tombstone. |
| F7 Financial Tracking | 25 | **No — deferred.** One `feature` + `deferred` issue, no children until it revives. |
| F4 Progress Dashboard | 21 | **No — folded into the phase engine** as PE-022..027. Its survivors are already phase-engine requirements. |
| F3 Meetings, F2 People | 41 + 23 | **Mostly no** — build-log items, already shipped or already covered by the 13 `agent:queued` issues. Expect ~5 genuine survivors after dedupe. |
| F1 Wiki | 15 | yes |
| F5 Tasks | 17 | yes |
| F9 Communication Hub | 12 | yes |
| F8 Ministry Teams | 9 | yes |
| F6 Documents | 8 | yes |
| Phase engine | 7 | yes |

**~68 candidates, minus overlap with the 27 issues that already exist ≈ 45–55 new issues.** Plus 11
feature parents and 3 decision issues. Call it **60–70 issues**, every one of which needs a real
title and a parent link, and roughly a third of which need `Blocked by` edges.

> **Executed 2026-07-26.** All four passes below are done — see §10 for what actually landed. The
> estimate held: **45 new issues**, against the 45–55 predicted.

That is too much for one blind script and too little to justify tooling. **Gradual, in four passes:**

1. **Setup + pilot (30 min).** `gh auth refresh -s project`, `brew upgrade gh`, three new labels,
   the `Beta` milestone. Then migrate **F6 alone** — 8 open items, and #67 is live, so the pilot is
   real work rather than a rehearsal. F6 proves the shape end to end before anything else moves.
2. **The four clean features (F1, F5, F9, F8).** One scripted pass per feature: read the checklist,
   create the parent, create children for open Must/Should, attach dependencies, delete the file.
   Nice-to-Haves stay in the FRD — they are spec, not backlog.
3. **The messy three (F2, F3, phase engine).** By hand. These need dedupe against the 27 existing
   issues and carry the "Partial / Diverged" evidence notes, which are genuinely valuable and belong
   in issue bodies as *What exists today*. Do not let a script eat them.
4. **The tombstones + rewiring.** F10/F7/F4 markers, delete `work-queue.md`, then the skill changes
   below.

Each pass is independently mergeable and leaves the repo consistent. Nothing forces a big-bang.

---

## 7. What has to change in the factory

| Skill / file | Change |
|---|---|
| `spec-intake` | add `## Parent` linkage + a `--parent` step; emit `Blocked by` edges via the dependencies API |
| `frd-plan` | stop emitting `wave-plan.json`; publish issues blockers-first with native edges |
| `frd-implement` | renamed from `frd-implement-wave`; waves → **frontier query** (`blocked_by == 0` and unassigned) |
| `standup` | read `sub_issues_summary` for per-feature progress; report the frontier |
| `build-until-done` | **unchanged** — still label-driven. This is the point of not duplicating status. |
| `definition-of-done` | G0 "spec mapped" now means: the issue has a parent and its parent links an FRD |
| `requirements-docs` | drop the checklist-maintenance rule |
| `memory-maintenance` | drop checklist references |
| `AGENTS.md`, `architect.md`, `prd.md` | remove `checklist.md` from the routing table |

Unblocked once this lands, in order: **waves → DAG** (needs durable dependency state — this design
supplies it), then the **scheduled autonomous dispatcher** (cron → frontier query → `build-until-done`
→ PR), which is currently impossible because "what is runnable now" lives in a markdown file a human
has to re-read.

---

## 8. Decisions

Settled 2026-07-26:

1. **Stay on the personal repo.** No org transfer. Issue types stay out of reach and `feature` /
   `decision` remain labels; if the repo ever moves, the upgrade is one relabel pass. A transfer
   would touch Vercel and the CI ruleset for a cosmetic gain.
2. **Nice-to-Have items stay in the FRD.** They are spec, not backlog. 62 speculative checkboxes on
   a board would be noise that makes the frontier query less trustworthy.
3. **The two build-log checklists are deleted, not archived.** Git history is the archive;
   `ops/archive/` is reserved for things agents should still be able to read.
4. **One Project, with a kanban board whose columns are mirrored from the labels** (option A of the
   three considered). Rejected: making `Status` canonical and dropping the labels — it would push
   `build-until-done` and `standup` onto GraphQL project mutations and remove state from
   `gh issue list`, which is what the loop actually reads. Also rejected: four filtered table views
   with no automation — a list of lists, not a board. Details in §9.

---

## 9. The board columns

A Projects v2 board has no separate notion of a column: **the columns *are* a single-select field**,
conventionally `Status`. So "which columns" and "which field" are one question, and the only real
choice is who writes it.

Our pipeline already exists as the `agent:*` state machine, so the field is a straight render of it:

| Column | Source of truth | Set by |
|---|---|---|
| **Backlog** | `needs-spec` label | `spec-intake` triage / by hand |
| **Todo** | `agent:queued` label | `spec-intake` on issue creation |
| **In Progress** | `agent:in-progress` label | `build-until-done` on claim |
| **Pending PR review** | `agent:in-review` label | `build-until-done` on DoD PASS + PR open |
| **Blocked** | `agent:blocked` label | `build-until-done` on exhaustion |
| **Done** | issue **closed** | GitHub, via `Closes #` on merge |

Casing matters — GitHub's default option is `In Progress`, and the mirror matches an option by name.

**Not every issue belongs on the board.** An issue with no mapped label is not a work item: `feature`
parents are indexes, `decision` issues close by a ruling rather than a PR, and `deferred` ones are off
the roadmap. All three stay off deliberately — a kanban full of cards nobody can pick up is noise.
Feature grouping is still available through the built-in **Parent issue** field on the children.

`Done` needs no mirroring: the two workflows enabled by default on every new project already set
Status → Done when an issue closes or a PR merges. The Action only has to map the five active labels.

### The mirror

A single workflow on `issues: [labeled, unlabeled, opened]`. For an issue carrying exactly one
`agent:*` label (or `needs-spec`), it resolves the project item — adding it with
`addProjectV2ItemById` if the auto-add workflow hasn't yet — and sets the field with
`updateProjectV2ItemFieldValue`, passing the `Status` field id and the target option's id. Both ids
are stable, so read them once at setup and inline them rather than querying per run.

Two things will bite if they aren't planned for:

- **`GITHUB_TOKEN` cannot write a user-owned Project v2.** The workflow needs a PAT with the
  `project` scope stored as a repo secret. This is the single most likely reason the mirror silently
  does nothing.
- **The exactly-one-`agent:*` invariant is what makes the mapping total.** It is already the rule in
  `ops/agent-os/labels.md`. If an issue ever carries two, the last-labeled event wins and the board
  lies — so the Action should log a warning rather than guess.

### What this costs

**Dragging a card does nothing durable.** `Status` is derived, so a manual move is overwritten by the
next label event. Moving work by hand means editing the label — `gh issue edit <n> --add-label
agent:queued --remove-label needs-spec` — and the card follows. That is the price of one writer, and
it was accepted deliberately.

The mirror can also lag or fail. That is tolerable *only* because of the §4 rule: the board informs a
human, and no agent ever reads it. A broken mirror is a stale picture, never a wrong build.

Implemented as `.github/workflows/board-sync.yml`. It exits with a notice rather than failing when
`PROJECT_TOKEN` is absent — a missing board must never turn a PR red.

---

## 10. What landed (2026-07-26)

**47 issues, #69–#115.** Eight feature parents holding 49 children, three tombstones, three decision
issues, four dependency edges.

| Parent | Children | Notes |
|---|---:|---|
| #69 F6 Documents | 3 | the pilot; #67 adopted as a child |
| #72 F1 Wiki | 9 | four existing issues adopted, W-019 stays cut |
| #77 F9 Communication | 8 | includes the two `deferred` post-beta items |
| #84 F8 Ministry Teams | 2 | MT-010 lives under F2 with the files it touches |
| #86 F5 Tasks | 8 | one internal edge: T-020 blocked by T-011+T-012 |
| #95 F3 Meetings | 9 | build-log checklist deleted, not migrated |
| #102 F2 People | 3 | same |
| #105 Phase Engine | 7 | includes PE-022..027, the folded F4 |

**Tombstones:** #113 F10 (closed, cut), #114 F7 (open, deferred), #115 F4 (closed, folded).

**Decisions:** #85 MT-011 training model, #96 follow-up task generation, #112 wiki data model. None
closes by a PR.

**Edges:** #88→#87, #94→#29, #101→#29, #107→#106. The two pointing at #29 are the useful ones — task
notifications and meeting reminders were both quietly waiting on notification infrastructure, and the
old checklists recorded that only as prose in a parenthetical.

**Deleted:** 11 `checklist.md`, `work-queue.md`, `phase-engine/wave-plan.json` — 1,573 lines.

### Judgement calls worth knowing about

- **Some requirements were merged into one issue** where they are a single vertical slice: `W-018 +
  W-020` (print and PDF are one stylesheet), `T-011 + T-012` (a template nobody can import is dead
  weight), `VM-010k + VM-016c`, `PE-022 + PE-025`, `PE-026 + PE-027`. Each says so in its title and
  explains the merge in its body.
- **Two loose meetings items folded into #63** rather than becoming issues: `VM-S02i` and `VM-011k`
  are both the dead invited-by subtree #63 already removes.
- **DOC-008 was filed `needs-spec`, not `agent:queued`.** It is the one F6 requirement needing a
  `documents` table, which presses on audit decision #15. The issue names the tension and lays out
  three options rather than resolving it quietly — the handoff's instruction was to reopen that
  deliberately, not drift into it.
- **#23 (oversight planter-invitation UI) has no parent.** No FRD covers oversight. G0 now allows
  that explicitly for platform work rather than forcing a wrong parent.

### The Project (created 2026-07-26)

**[EveryField Delivery](https://github.com/users/SebastianGarces/projects/1)** — user-owned, number 1,
which is what `board-sync.yml` already expected. Private, and **linked** to the repo so it appears on
its Projects tab.

**A Project does not live in a repository.** Projects v2 are owned by a user or an organization only;
the repo-scoped boards were Projects (classic), which GitHub shut down. Linking is as close as it
gets — the URL stays user-scoped.

Two things follow, and the second is the reason the split is safe:

- **This is why the mirror needs `PROJECT_TOKEN`.** `GITHUB_TOKEN` is scoped to the *repository*, and
  a user-owned project sits outside it. No workflow permission block can bridge that.
- **Everything durable is repo-owned; only the view is not.** Issues, labels, parent/sub-issue links,
  dependency edges and milestones all belong to the repo and travel with it. The Project and its
  `Status` field belong to the account. If the repo ever moves to an organization, the hierarchy and
  the blocking edges move with it and the board is simply rebuilt — a scripted ten minutes. Had
  status lived in the Project field instead of the labels, that move would have lost state rather
  than a rendering.

Its default `Status` field was **updated in place** rather than replaced, so the field id survived and
the two workflows GitHub enables by default (issue closed → Done, PR merged → Done) stay bound to it.
Replacing the field would have silently unbound them.

**55 work items backfilled**, using the same label rule the workflow uses so the two cannot disagree:
37 Todo, 18 Backlog. The `feature`, `decision` and `deferred` issues were correctly skipped.

Worth an eyeball in the UI once: **Project → Workflows**, to confirm the two Done automations still
point at the `Done` option. The option ids were regenerated when the six columns were written, and
that is not observable from the API.

### The mirror is live (2026-07-26)

`PROJECT_TOKEN` is set. The first label round-trip on #73 **failed** — four runs, all
`unknown owner type` — and the failure was briefly mistaken for success because the card's end state
happened to be correct anyway. It was already `Todo` from the backfill, so a mirror that never ran
left it exactly where a working mirror would have. **A consistent end state is not evidence of a
working pipeline; the run log is.** Check `gh run list --workflow=board-sync.yml`.

The cause is worth keeping: **`gh project --owner <name>` has to resolve whether the owner is a user
or an organization, and a `project`-scoped token cannot make that lookup.** The fix was to drop the
`gh project` porcelain and call GraphQL with pre-resolved node ids — which also removed two API
round-trips per run. Those ids are in the workflow's `env` block; re-resolve them only if the project
is ever rebuilt.

The alternative fix — widening the PAT with `read:user` — was rejected. Adding scope to make a
convenience wrapper work is exactly the scope creep the token note warns about.

**Verified after the fix**, this time against the run log rather than the end state: toggling #73 to
`agent:in-progress` produced a **successful** run and moved the card to In Progress; toggling it back
produced another and returned it to Todo. Board tally unchanged at 37 Todo / 18 Backlog, and #73 is
back on `agent:queued`.

**The PAT is a classic token, `project` scope only, with no expiration.** That is a deliberate call,
not an oversight — do not "harden" it to a 90-day expiry without reading this first:

- The scope grants read/write on project boards and **nothing else** — no code, no pushes, no
  secrets, no ability to touch the issues themselves. A leak vandalises a view we designed to be
  rebuildable from labels.
- The realistic leak vectors are closed. Secrets are masked in logs, the workflow calls no
  third-party Actions, and forks never receive secrets — this triggers on `issues` events, which a
  fork cannot fire anyway.
- Expiry's cost is recurring and certain: a rotation every 90 days, with a real chance of the board
  sitting broken between the warning email and someone acting on it.

The risk that *is* worth guarding is **scope creep** — a long-lived token quietly acquiring `repo`
because something else needed access and it was already there. Defence: the token's note is
`everyfield board-sync`, and anything else that needs GitHub access gets its own token rather than
widening this one.

### waves → DAG (landed 2026-07-26, after the migration)

Deliberately held back from the migration so neither change reviewed as half-verified. Now done.

**`frd-plan`** no longer returns a wave array. It decomposes, groups by shared file as before, then
**publishes the tracks as issues with native `blocked_by` edges**. The topological sort survives, but
its job changed: it now orders the *writes*, so a blocker always exists before something references
it. `publish:false` gives a dry run.

Two behaviours are genuinely new rather than moved:

- **A dependency on a gated prerequisite is kept as an edge.** The old model dropped those
  (`wave 0/human`) and conveyed "the schema lands first" as a sentence in a plan. It is now durable
  state, which is the whole premise of the board.
- **A dependency cycle throws at plan time.** Every member of a cycle has an open blocker forever, so
  none can ever reach the frontier. Publishing one would be a silent, permanent deadlock.

**`frd-implement`** (renamed from `frd-implement-wave` — "wave" was the concept being removed) takes
no units array. It queries the frontier, claims what it takes (`--add-assignee @me` first, so two runs
cannot grab the same issue), reads each issue body for the files and ACs, then runs the existing
implement → review pipeline. A **Settle** phase writes outcomes back, because leaving issues on
`agent:in-progress` after a run is exactly the stale state this board exists to prevent.

It deliberately does **not** promote to `agent:in-review` on success. That label means "DoD passed, PR
opened", and this workflow runs neither the DoD gates nor `open-pr`. Claiming a readiness it has not
earned would be the same class of error as trusting a board card over a run log.

**What this does and does not buy.** Within one run the human merge is still the gate — a dependent
track needs its blocker's *code* on the base branch, and that only happens when you merge. What
changed is that each pass takes the **maximal** unblocked set computed from durable state rather than
a pre-baked layer, and the ordering survives across sessions with nothing to carry between them. The
fully rolling behaviour arrives with the scheduled dispatcher, which can close its own PRs.

**Tests:** `ops/agent-os/tests/frd-workflows.test.mjs` — 13 tests over the deterministic half
(grouping, ordering, cycle rejection, frontier handling), run by stubbing the workflow globals so they
cost no agent calls. `pnpm test`'s glob was widened to `ops/**/*.test.mjs` to run them; that glob was
also what stranded the earlier HR4 harness.

---

## 11. The claim step swept the whole board (2026-07-26)

The second component to look correct and fail on every run — after `board-sync` (§9). Same lesson, so it
is recorded the same way: against the run log, not against intent.

**What happened.** A `dispatch` pass of **2 units** claimed **35 issues**. A second pass of 1 unit claimed
the remaining 5. Net effect: the entire `agent:queued` label was flipped to `agent:in-progress` — 29 issues
that had no branch, no worktree and no agent.

**The evidence.** Two sweeps, each starting seconds after a workflow launched, in descending issue order:

| Sweep | Started | Launched at | Units in that pass | Issues claimed |
|-------|---------|-------------|--------------------|----------------|
| 1 | 19:40:21 UTC | 19:40:06 (+15s) | 2 | 30 |
| 2 | 19:46:58 UTC | 19:46:12 (+46s) | 1 | 5 |

30-then-5 is the tell: `gh issue list` pages at 30 by default, so the first sweep took a full page and the
second took what was left after the first had been relabelled. `git branch -a` showed exactly 8 feature
branches — one per genuinely dispatched track — and none for the other 29.

**Why it happened.** `build-until-done.js`'s claim step delegated labelling to an agent whose prompt was
**already correctly scoped** to `track.issues`. It ran on `haiku` at `effort: low` under a comment reading:

> `// Two shell commands and a fixed return value. No judgment involved.`

That assumption is the bug. The step involved no judgment *as specified*, so it got the cheapest model and
no verification — and the cheapest model resolved "claim the issues for this track" into "claim the queued
work", which is a locally reasonable reading of a board whose whole vocabulary is about claiming queued
work. A correct instruction with no check on its blast radius is not a control.

**Why it mattered more than it looked.** Nothing was built wrongly and no code was harmed. The damage was
to the board's meaning: `dispatch`'s gate 2 ("nothing is already in flight") saw 35 claims and would have
refused **every future pass**, and `standup` would have reported 29 items as underway. An autonomous
factory whose durable state lies about itself is worse than one that has stopped, because it looks like it
is working.

It also went undetected through two full passes. It was found only because a routine `agent:queued` count
came back as 11 when it should have been ~37 — i.e. by a number looking wrong in passing, not by any gate.

**The fix.** The blast radius is now asserted rather than assumed:

- `PASS_ISSUES` is computed once — the complete set of issues a pass may touch.
- The claim prompt forbids `gh issue list` / `gh search` for *deciding what to edit*, states the exact
  expected count, and returns both what it edited and the current global `agent:in-progress` set.
- Any issue carrying `agent:in-progress` outside `PASS_ISSUES` **throws**, aborting the track. `parallel()`
  surfaces it through the existing `lost` path, so it is reported rather than swallowed.

**The generalisable rule.** *Assign a cheap model to a step whose instruction is unambiguous, but never to
one whose blast radius is unbounded.* Cost tiering is fine; unverified mutation of shared state is not. Any
step that writes durable state on the board should report what it touched and have that compared against
what it was permitted to touch.

**Not fixed here.** The revert was done by hand (29 label flips, live tracks protected by branch existence).
There is no tooling to reconcile the board against `git branch -a`, which is the check that made the
diagnosis obvious and would make the next one instant.
