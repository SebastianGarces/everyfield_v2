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
