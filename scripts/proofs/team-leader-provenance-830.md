# Team leader provenance design proof

Preparation for [issue #830](https://github.com/SebastianGarces/everyfield_v2/issues/830), a child of Ministry Teams #84. Runtime and schema changes are held by orchestrator task `01a0876e-ceb0-7f32-a6f8-8806b1400213` until Evri lands. This document proposes a design; it does not amend canon.

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
