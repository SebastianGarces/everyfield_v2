# Minimal Evry leadership writer protocol proposal

This is a proposal for the owner of PR #825 at `a7acc48a6da8ae8f626bedbe82ddb8ccebff4e37`. No Evry runtime file has been edited. The native implementation exports the shared lock from `src/lib/ministry-teams/leadership-lock.ts` and the eligibility predicate from `leader-eligibility.ts`.

## Snapshot constraint that must be addressed

`src/lib/evry/capabilities/teams/atomic-effect.ts:200-212` currently executes one effect statement in a Serializable transaction. Simply prepending a blocking advisory-lock SELECT is insufficient: Serializable retains the snapshot taken before the lock wait. Putting the lock in a CTE inside the effect statement has the same problem. The native protocol relies on separate READ COMMITTED statements, so its eligibility and staleness reads start after the wait.

The target is a dedicated READ COMMITTED batch for leadership-affecting team operations, leaving other Evry operations on their Serializable path. This is an implementation proposal with required coverage proofs, not approval to downgrade isolation immediately. Keep an operation on its current path until its row/set coverage and cross-writer tests below pass. Include team creation/import paths that can seat the confirmed owner, explicit appointment, membership assignment/removal, role leadership-flag edits and role deletion. Route all variants of these operations through the same protocol even when a particular plan happens not to change leader_id. A stale plan must not choose which locking protocol applies.

## Transaction order

1. Acquire the transaction-scoped plant lock as its own first statement using the authenticated execution plant ID, never an argument-provided scope:

   ```sql
   select pg_advisory_xact_lock(hashtextextended('team-leadership:' || $plant_id, 0));
   ```

   Use the native `lockPlantLeadership` builder, or generate exactly the same key and seed. Keep the lock and effect in one Neon HTTP transaction. Separate HTTP calls cannot retain a transaction lock.

2. Lock the exact action-plan lifecycle and attempt rows in the executor's established order, so cancellation/revision/attempt updates cannot invalidate the authorization predicate between its check and claim. Recheck the exact tuple and executing state afterward. The owner must verify this order against lifecycle writers before enabling the new route. Lock existing target team rows in ascending ID order, then existing expected role/membership rows if needed for writers outside the native protocol. Lock existing expected person rows and linked candidate/actor account rows before evaluating eligibility or status effects. Use exact IDs and tenant predicates. These are separate statements after the plant lock, not CTEs inside the effect. Acquire each table's rows in stable ID order. Native order remains plant lock, team row, role/membership rows. Account/person locks must follow the team lock and precede the effect; do not move the plant lock after any of them.

3. Execute the current effect CTE as the final statement. It must revalidate the confirmed plan's exact expected row JSON, set membership, actor authority, target eligibility and mutation before-states using this fresh snapshot. Its claim insertion and all domain writes remain in this one statement. Read the outcome from this final batch result.

READ COMMITTED is safe here only with complete coverage for the predicates previously protected by Serializable. For the narrowed leadership operations, role/member mutations are protected by the shared plant lock once both native and Evry writers participate. Native createRole and template imports currently insert outside that lock, so their missing-row protection additionally depends on the existing team FOR UPDATE lock conflicting with the parent FK key-share lock taken by those inserts. Explicitly test that dependency; locking only children already present does not cover new rows. Person and account facts require the explicit row locks above because other native domains mutate them without the leadership lock. Missing-row insert claims still need their existing unique constraints. If a selected operation reads an additional mutable set outside this coverage, add its concrete lock/uniqueness guard before enabling the READ COMMITTED route; do not silently weaken the current Serializable guarantee. This qualification is a technical implementation requirement, not a request for owner approval.

## Coverage to establish for each routed operation

Every row/set in the final expected-plan and set-plan payload must fit one of these protections. The owner should reject an unrecognized set kind on this narrowed route instead of assuming Serializable-equivalent coverage.

| Operations | Mutable facts read | Competing writers and required protection |
| --- | --- | --- |
| All routed operations | Exact plan lifecycle status, execution attempt tuple, current actor seat/plant, existing receipt | Plan confirmation/revision/cancellation and executor attempt updates: lock their exact rows in verified lifecycle order before final evaluation. Seat/tenancy updates: lock the actor user row. Receipt uniqueness and exact-tuple lookup remain the arbiter for duplicate execution. |
| `assignTeamLeaderAction` | Team before-state/provenance, target person identity/deletion/status, target linked account seat/plant | Native team writes and AS-016: shared plant lock plus team FOR UPDATE. People edits/deletion and account changes: lock the target person and linked user rows, then re-read their current state. |
| `assignMemberAction`, `removeMemberAction` | Team, role, membership before-states; `active_role_memberships`, `person_role_memberships`, `active_person_team_memberships`; target person/status and linked seat | Native membership mutations: shared plant lock. New child inserts outside the protocol: team/role parent FOR UPDATE versus FK key-share, plus the active-role unique index. People/account edits: exact row locks. Activity inserts retain their unique IDs and statement-level atomicity. |
| `updateRoleAction`, `deleteRoleAction` | Team provenance, role before-state, active holder or complete `role_memberships`, affected person's status | Shared plant lock for native role/member edits; team/role parent row locks for concurrent child inserts and cascades; affected person/user locks for status/eligibility. Test role creation/import outside the advisory protocol rather than assuming they participate. |
| `initializeTeamsWithRolesAction`, `importRoleTemplatesAction`, and any initialization variant that can seat a confirmed owner | Above facts plus `church_teams`, `team_roles`, `confirmed_owner_people` and `churches.leadership_status` | Lock the plant church row FOR UPDATE before validating initialization sets. It blocks new plant-scoped team/person/user inserts through their church FKs. Lock the relevant existing teams, and every existing plant person/user that can enter the confirmed-owner set, not merely today's owner. This covers status, soft-delete, identity-link and ownership changes of existing rows; prove those writers' lock ordering. Keep these variants off the new route until phantom-insert and ownership-change cases pass. |

The church-row rule is deliberately limited to initialization/import variants. It introduces a broader contention and lock-order question, so those variants are a separate verifiable integration unit. Plain explicit/role/member operations should not acquire that broad lock just to make imports convenient. Any additional mutable set in a real resolved plan requires a named protection and a test before that operation switches isolation.

## Staleness and eligibility

- Preserve exact `expected_plan` comparisons and membership-set checks. Include `leader_source` and `leader_role_id` in every before/after snapshot. A same-person role-to-explicit change must invalidate an earlier plan.
- A nonnull leader must be a live person in the plant. Unlinked CRM people need no login. A linked person must still have a user with that plant's church ID and a nonnull seat. Check this in the final effect after the locks, including confirmed-owner fills and explicit appointment.
- If the plan proposed leadership and the linked seat disappeared while waiting, refuse the stale confirmed effect. Do not silently replace its mutation set or issue a new confirmation from the writer. The native membership API may retain membership without granting leadership, but Evry must preserve the exact confirmed-plan contract.
- A completed exact effect receipt remains completed even if later seat removal cleared its resulting leader. Replay returns the stored outcome; it never re-applies the appointment. Preserve the full attempt/plan/plant/actor/fingerprint/correlation/effect/step/capability tuple.
- An uncompleted stale effect must write neither claim nor domain rows. Existing claim uniqueness still arbitrates duplicate executions. Keep the current exact-receipt recovery and bounded retry behavior for serialization/deadlock errors. A retry uses the same confirmed arguments, obtains a fresh transaction and revalidates them; it must not refresh the plan silently.
- Domain events and notification reconciliation remain after durable commit and follow the durable outcome.

## Provenance adaptations remain required

The detailed handoff lists resolver sites at lines 257, 413, 524, 771, 799, 847, 952, 1206 and 1312. Fill must stamp source `role` and the exact role ID. Explicit appointment sets source `explicit` and null role token even for the same person. Vacancies clear only a matching stored role derivation and all three fields together. Import copies all three fields. The SQL update list at `atomic-effect.ts:180` must persist both new columns; JSON inserts at 179 need complete valid state.

## Proof required before integration

Use the native scratch PostgreSQL approach with the real Neon driver and two database connections. Capture lock waits, not timing guesses. Cover native/Evry assignment and vacancy in both directions; role deletion after holder replacement; repeated same-person derivation; same-person explicit conversion; stale provenance-only plan; and AS-016 removal versus each Evry appointment path. The removal-first case must leave no leader and no new receipt for the refused plan. In the effect-first case, subsequent removal clears leadership, while retrying the completed effect only returns its receipt. Include an ordinary unlinked CRM person, a foreign linked account, exact claim replay after simulated response loss, and an injected failure inside the final claim/effect statement or at commit that rolls back both claim and domain writes. There is no production statement after the effect in this proposal, so a failure in a fictional later statement would not prove its rollback boundary.

The numbered migration, historical legacy backfill, hosted Neon validation and publication remain owned by the coordinating task. This proposal does not claim system-wide serialization for unrelated account-tenancy writers or for any Evry operation left on the old path.
