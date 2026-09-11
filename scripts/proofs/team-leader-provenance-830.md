# Team leader provenance design proof

Local native implementation and evidence for [issue #830](https://github.com/SebastianGarces/everyfield_v2/issues/830), a child of Ministry Teams #84. The orchestrator authorized local schema and native writer changes on 2026-09-11. Numbered migrations, Evry adaptations, publication, shared databases and release remain held. Earlier design notes below are historical context; the local implementation section records the current result.

The SQL beside this file reproduces the current vacancy predicate against a temporary table and tests proposed provenance predicates in PostgreSQL. It does not import application services, run a migration, exercise concurrency, validate authorization, or prove a browser outcome.

## Source observations

Native source inspected at `3087520543316726ae44def09c0ab7a4793656cc`. PR #821 inspected at `0052a140d8faa369cf8897a622d0982a3558c318`; PR #825 at `3ee60bb697bc9031581642b2bbb95d876e122f36`. Re-read these sources when resuming; their owners are still active.

| Writer or caller | Location | Required integration |
| --- | --- | --- |
| Explicit appointment | `src/lib/ministry-teams/teams.ts:318` | Write explicit provenance even when the person already leads through a role. |
| Derived fill | `src/lib/ministry-teams/leader-sync.ts:86` | Store the source role with the leader, keep the same-row null guard and active-seat assertion. |
| Derived vacancy | `src/lib/ministry-teams/leader-sync.ts:127` | Match source kind and role, plus person, team and plant. Clear all provenance together. |
| Fill/removal callers | `src/lib/ministry-teams/memberships.ts`, `roles.ts` | Pass the source role, and preserve explicit appointments on removal, deletion and unmarking. |
| Seat removal | `src/lib/seats/roster.ts:400` | Keep AS-016 cleanup regardless of source; clear provenance in the same write. |
| Person soft deletion | `src/lib/people/service.ts:552` | No leader cleanup today. Coordinate with People owner before extending this path; do not infer that removing a role deletes a person. |
| Evri initial team rows | PR #821 `resolver.ts:257` | Include the agreed empty provenance state. |
| Evri confirmed-owner role fill | PR #821 `resolver.ts:413` | Record source role; propagate it through role import at line 952. |
| Evri explicit appointment | PR #821 `resolver.ts:524` | Set explicit provenance, including same-person replacement. |
| Evri role marking/unmarking | PR #821 `resolver.ts:771`, `799` | Fill with source role; vacancy matches provenance. |
| Evri role deletion | PR #821 `resolver.ts:847` | Clear only the source-derived appointment. |
| Evri membership fill/removal | PR #821 `resolver.ts:1206`, `1312` | Apply the same source rules. |
| Evri physical writes | PR #821 `atomic-effect.ts:179`, `180` | Inserts populate the entire table row from JSON; updates list columns explicitly. Adding schema alone neither supplies missing insert values nor updates provenance. |

The two native changes in #821 and #825 are `responsibilities.ts` and the `service.ts` barrel, adding `listStoredResponsibilities`. This fix does not need either file. Evri's planner, atomic writer, snapshots and proof fixtures still need coordinated integration after its work lands.

## Proposed semantics

An explicit appointment is independent of role membership, matching MT-003 and the service allowing any active person in the plant. Removing a role, including the person's last role, therefore leaves the explicit appointment intact. Removing the person's account seat still clears leadership under AS-016.

A role-derived appointment names one source role. Vacating that source clears leadership; vacating another role held by the same person does not. No successor is automatically selected. An explicit appointment of the same person replaces the role provenance.

The candidate stored shape is `leader_id`, `leader_source` and `leader_role_id`. Empty leadership has all three null. A role-derived leader requires source `role` and a non-null role id. Explicit and historical leaders use `explicit` or `legacy` and no role id. The SQL tests a closed CHECK that also refuses SQL-null loopholes.

Historical rows cannot reveal which writer set them. The proposed backfill preserves their leader and marks source `legacy`; role vacancies leave it intact until an explicit replacement. This deliberately changes vacancy handling for historical derived leaders, so the integration review must approve or replace that policy. Matching a role is not evidence that an explicit appointment never happened.

Before implementation, settle source-role referential integrity and mutation ordering. A foreign key must not cascade-delete a team or null only part of the provenance. Role deletion, membership removal, fills and explicit appointments need live race tests using the real batch/lock strategy. The temporary-table proof intentionally has no role FK and cannot settle those questions.

## Reproduce

Run the adjacent SQL with `psql -v ON_ERROR_STOP=1` in an owned disposable PostgreSQL database. All proof tables and the helper function are temporary. Use a separate container with no published ports and no shared volumes; delete only that container afterward.

The expected transcript includes a reproduced explicit-appointment loss, then passing checks for exact role/person matching, explicit preservation, tenant predicates, same-person conversion, source-independent cleanup, malformed states and reversible candidate-column DDL. This DDL experiment is not the required `pnpm db:migrate` apply/rollback evidence.

Implementation acceptance criteria, ownership and the schema hold live on #830. No preview or PR has been produced by this preparation pass.

## Reassessment against main on 2026-09-11

The preparation branch was rebased locally onto `a5239fb47edbf3273d50da0e67cd36847f6737f5`. PR #840, merged at `2091b074`, closes #22 and adds Member leader authorization. It changes none of `leader-sync.ts`, `teams.ts`, `roles.ts`, `memberships.ts` or the ministry-team schema. The provenance defect therefore remains. The prior work was a SQL design proof and inventory, not a runtime implementation.

`authorization.ts` resolves the live `leader_id` through a non-deleted, same-church person's `user_id`. An erroneous vacancy now also removes the Member's own-team write access. Preserve this authorization query and its action guards. In particular, `assignTeamLeaderAction` remains `teams.write`, reserved for Owner/Admin; role-derived leadership must not become a way for a Member to assign an explicit leader.

The current active consolidated Evry PR is #825 at `a7acc48a6da8ae8f626bedbe82ddb8ccebff4e37`. Its `src/lib/evry/capabilities/teams/resolver.ts` still has the same leader writes at lines 257, 413, 524, 771, 799, 847, 952, 1206 and 1312. Its `atomic-effect.ts` still lists `leader_id` explicitly at line 180 and has no provenance writes. PR #821 remains open at the source commit recorded above. The mention of #875 is unresolved by the orchestrator; it is not treated as a replacement owner or permission to edit Evry.

The smallest coordinated implementation for the issue's full acceptance criteria is:

1. Add the candidate source kind and source-role columns with their closed state constraint, a reviewed historical backfill policy and a versioned migration/snapshot after a schema slot is granted.
2. Update the native explicit writer, derived fill/vacancy and their role-id callers. Set or clear all provenance in the same leadership write. Same-person explicit appointment must replace provenance; role removal must match the source role.
3. Preserve AS-016 by clearing all provenance in the seat-removal write. Keep person soft-delete outside this bounded fix unless its owner coordinates that separate cleanup.
4. Have the Evry owner update its planner, import propagation, physical column writes and matching effect proofs to the same contract. Native-only provenance would leave its writes inconsistent, so it is not an independently releasable patch.
5. Prove the coordinated implementation through the real services, source-role deletion and race cases, permission negatives and the final preview. The merged permission checks remain intact.

No schema slot has been granted. Source-role foreign-key ordering and historical `legacy` policy remain integration decisions. No runtime or schema edits were made during this reassessment, and no shared database, new Docker stack, full build or publication was used.

The independent PostgreSQL 16 run from 2026-09-09 passed the temporary-table design proof, including all six malformed-state cases, and confirmed owned-container cleanup. This supersedes the first local startup failures as the design's execution evidence. It does not prove application runtime, versioned migration apply/rollback, FK lifecycle, concurrency, authorization or browser outcomes.

Focused local verification on the rebased branch passed 16 tests, with zero failures or skips: `node --import tsx --test 'src/app/(dashboard)/teams/authorization.test.ts' src/lib/auth/seats.test.ts`. The action proof mocks persistence; the capability tests exercise seat/tenancy predicates. The process used a dummy database URL and did not read `.env.local`. These tests confirm the local authorization checks and do not establish database persistence or fix the provenance bug. The first `tsx` CLI attempt was refused by the sandbox's IPC restriction; the direct Node invocation above completed successfully.


## Local native implementation, 2026-09-11

The native implementation uses `leaderSource` / `leader_source` with `explicit`, `role` and `legacy`, plus nullable `leaderRoleId` / `leader_role_id`. The production schema declares `ministry_teams_leader_provenance_check`, closing the valid states and refusing SQL-null loopholes. No migration number, SQL migration, journal entry or snapshot has been allocated. Schema-to-snapshot alignment is therefore still part of the held migration work, and this branch cannot be released as-is.

`assignTeamLeader` writes explicit provenance even for a same-person appointment. `syncLeaderOnFill` now takes the source role and asserts that exact role is a leadership role in the same team and plant with an active membership for the person. `syncLeaderOnVacate` requires the same source kind, role, person, team and plant. All role and membership callers pass that role id. AS-016 clears all provenance in the existing seat-removal write. Native eval seed and seat-removal test fixtures stamp explicit provenance for their intentional appointments. Neither `authorization.ts` nor its action guards changed.

The role id is deliberately an internal historical token without an FK, preserving post-delete synchronization and preventing an FK action from revoking an explicit appointment. Historical non-null leaders will be backfilled as `legacy`; that choice is recorded in the decision ledger. No historical backfill has been applied.

### Focused executable proof

`team-leader-provenance-830.mjs` calls the real native services and `mayManageTeam` against an isolated in-memory PGlite PostgreSQL engine. Columns, defaults and CHECK constraints come from the production Drizzle schema. The proof uses Drizzle's PostgreSQL proxy driver with a sequential SQL transaction adapter for `db.batch`. Domain events are stubbed; it does not test notifications or person-status event subscribers. Unrelated FKs/indexes are omitted; the role-membership cascade and role-seat unique index are included. No environment file, shared database, Docker stack or server is used.

Install the test-only dependency outside the repository, then run from the worktree:

```sh
npm install --prefix /tmp/ef830-pglite --no-audit --no-fund --ignore-scripts @electric-sql/pglite@0.5.8
PGLITE_MODULE=/tmp/ef830-pglite/node_modules/@electric-sql/pglite/dist/index.js node --no-warnings --experimental-test-module-mocks --import tsx scripts/proofs/team-leader-provenance-830.mjs
```

The proof passed removal, unmarking and deletion for both explicit and derived paths, including repeat operations and same-person explicit conversion. It reads stored provenance after each operation and queries Member access: explicit appointments keep access, while source-derived vacancy removes it. It also passed unrelated-role/person/tenant vacancy, inactive/ordinary/unheld/wrong-team/foreign-tenant fill refusals, explicit and legacy preservation, six malformed provenance states and real seat removal across all three sources, retaining the person/roster and leaving a foreign plant unchanged.

The 34 targeted local tests and the requirement-ID guard also passed: team-action authorization, seat capabilities, seat-removal source guards, membership-conflict handling and predefined-team guards. Four regressions were added to the existing Neon live suite for eventual coordinated migration verification; that suite has not been run against a migrated Neon-compatible database in this pass. Independent review ran the PGlite proof successfully and found fixture provenance gaps, subsequently corrected; final focused re-review reported no findings. Targeted formatting passed. ESLint reported no errors for the native source/test files; repository configuration ignores the proof and eval seed scripts, so those were not linted. Full typecheck/build and current-head CI were not run in this focused local pass.

This establishes sequential native persistence through the test adapter. It does not establish migration apply/rollback, Neon transport, concurrent-writer correctness, browser behavior or release readiness. Two pre-existing races remain explicitly recorded in memory: a delete using a stale holder snapshot can miss a replacement holder's cleanup, and delayed vacancy can clear a same-person/same-role reassignment. Provenance alone does not serialize those writers.

### Evry integration contract, owned by the orchestrator

At the inspected #825 head `a7acc48a6da8ae8f626bedbe82ddb8ccebff4e37`, the required changes remain confined to its owner:

- `src/lib/evry/capabilities/teams/resolver.ts`: empty team rows at 257 need both provenance columns null; explicit assignment at 524 writes `leader_source: "explicit", leader_role_id: null`, even for the same person. Confirmed-owner fill at 413, leadership marking at 771 and membership fill at 1206 write `leader_source: "role"` and the exact source role id. Role import at 952 must propagate all three leader fields, not only `leader_id`.
- Vacancy plans at 799, 847 and 1312 must require source `role` plus matching role/person and clear all three fields. Explicit and legacy appointments remain intact.
- `atomic-effect.ts:179-180`: JSON-populated inserts must include the valid provenance state whenever a leader is non-null; the explicit UPDATE column list must write `leader_source=p.leader_source, leader_role_id=p.leader_role_id` alongside `leader_id`. Both before/after snapshots and proof fixtures must include provenance so a same-person source change is visible to stale-plan checks.
- Keep existing authority, effect claim, confirmation and retry rules. Run the owner's effect proofs against the coordinated schema and preserve #840's administrative explicit-appointment boundary. No Evry code was changed by this native branch.
