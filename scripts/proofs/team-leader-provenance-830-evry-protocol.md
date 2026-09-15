# Evry leadership writer protocol proposal

Retain Serializable isolation and the existing single full-transaction retry for SQLSTATE `40001` or `40P01`. READ COMMITTED necessity is unproven. This replaces the earlier conditional isolation-change proposal. No Evry runtime file is changed.

The pinned owner baseline is PR #825 at `a7acc48a6da8ae8f626bedbe82ddb8ccebff4e37`. Its `atomic-effect.ts` executes the effect in a Serializable Neon transaction and recovers exact receipts before retrying. Keep that behavior and the same confirmed arguments.

## Transaction order and checks

Use a closed operation set for all leadership-affecting variants. Resolve the plant ID from trusted execution context. Acquire the native `lockPlantLeadership` advisory lock as the first SQL statement in the same Neon transaction. Its key is `hashtextextended('team-leadership:' || plant_id, 0)`. Lock existing teams next, then required role/membership rows, candidate person rows and their stored linked user rows, in stable ID order per table. Cover actor authority and exact lifecycle/attempt rows too, after verifying their order against existing lifecycle writers. Never derive lock scope from untrusted operation arguments.

A Serializable snapshot predates an advisory wait. Subsequent `FOR UPDATE` locks on rows changed since that snapshot force a serialization failure. The existing bounded retry then opens a new transaction and evaluates the unchanged confirmed plan. Row locks are conflict fences here; they do not refresh the current snapshot.

Keep the existing claim/domain CTE last. Recheck exact expected row JSON and set membership, lifecycle state, attempt identity, actor authority and candidate eligibility. Include `leader_source` and `leader_role_id` in before/after state. A live unlinked CRM person is eligible. A linked person requires a user with the same plant and a nonnull seat. Reuse `canLeadTeam` semantics. If a confirmed leadership mutation is no longer eligible, refuse it without claim or domain writes. Do not silently replace the confirmed mutation set.

The exact receipt lookup runs before any effect attempt and after uncertain failure. Preserve the complete attempt/plan/plant/actor/fingerprint/correlation/effect/step/capability identity. A completed receipt remains completed after a later seat removal and replay must never reapply its appointment. Preserve receipt uniqueness, atomic claim/domain rollback, one full retry and existing recipe failure handling. The scratch adapter proves none of the executor's recipe semantics.

## Insert cases remain blocked on shared version guards

The local PostgreSQL proof reproduced stale-set claims for both a newly inserted role and a newly inserted qualifying owner person. Neither the advisory lock nor locking an unchanged parent row makes that insert visible to the old Serializable snapshot. Serializable permits this ordering against a native READ COMMITTED writer; a lock-only protocol is insufficient for the confirmed-plan contract.

A test-only parent UPDATE before each insert caused `40001`, then unchanged-plan refusal on retry. This demonstrates the mechanism, not complete production writer coverage.

- Role imports require a shared team-version update in the same transaction, before child changes, for every native and Evry writer that can change the checked role set. Cover createRole, template imports, deletion and relevant membership sets according to the resolved operation. A parent FK key-share lock alone is insufficient.
- Confirmed-owner initialization requires a shared plant-version update before every qualifying-set change, including insertion, identity linking, ownership, tenancy and soft deletion. An insert-only guard is insufficient. Verify church/team/person/account lock order across those writers.
- Keep initialization/import variants unreleased until all writers and all resolved sets have concrete guards and production-path proofs. Do not broaden isolation as a fallback. The proof's `updated_at` updates are test-only witnesses, not a selected production version-field design.

## Local evidence and its limits

Run in one disposable bounded PostgreSQL container:

```sh
PG_MODULE=/private/tmp/ef830-pg/node_modules/pg/lib/index.js \
PROVENANCE_PROOF_SCRIPT=scripts/proofs/team-leader-provenance-serializable-830.mjs \
bash scripts/proofs/team-leader-provenance-races-830.sh
```

The adapter uses the actual Neon driver, generated production plant/team lock SQL, production eligibility SQL and actual native `removeSeat`. It observes database lock waits and honors the driver's Serializable batch header. Its claim/staleness CTE and retry wrapper are test-only miniatures.

The run passed empty-team AS-016 removal-first refusal after `40001`; effect-first removal plus receipt-only replay; person soft deletion, seat removal, plant change and role-flag change; same-person provenance drift; unlinked CRM appointment; committed-response-loss receipt recovery; and rollback after an error inside the final effect. It reproduced both insert gaps and passed both test-only parent-version fixes.

The Evry owner must still integrate the real resolver/effect path, lifecycle locks, full receipt identity and operation-specific sets, then prove both directions of native/Evry role/member/explicit races. This proof is local compatibility evidence, not production Evry acceptance or a hosted Neon result.

## Provenance and frozen migration

Role fills stamp `role` and the exact role ID. Explicit appointments stamp `explicit` and null the role token even for the same person. Vacancy cleanup clears all three fields only for the matching stored derivation. Imports preserve all three fields. Update the real effect SQL persistence list and resolved before/after JSON accordingly.

Migration 0076 remains frozen at SHA256 `16758f56574e9e5b93def6c754bc8c83c3ad51b9c28d34add6fb55ab46d3fdb0`, journal time `1789105504370`. No migration, shared database or publication changes belong to this proposal.
