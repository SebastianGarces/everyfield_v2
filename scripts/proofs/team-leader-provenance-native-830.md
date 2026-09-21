# Native leadership provenance proof

The native-only #830 release preserves explicit ministry-team appointments through role removal, deletion and leadership-flag removal. Role-derived appointments store the source role and clear only when that source is vacant. Explicitly appointing the same person converts the provenance. Historical leaders remain `legacy`; role changes do not infer how they were appointed. AS-016 seat removal clears all three leadership fields while retaining the person and roster.

Native role/member writes, explicit appointment, direct synchronization and plant seat removal acquire one plant advisory lock before team/child writes. Later READ COMMITTED statements see commits made while waiting. Assignment RETURNING gates derived fill; role enabling reads the current false flag; vacancy checks the stored source against current active membership. A linked person needs a current seat in the same plant for leadership. An unlinked CRM person remains eligible.

## Rerunnable local checks

Install the proof drivers outside the repository and use Node24 with the worktree's own frozen dependencies:

```sh
npm install --prefix /private/tmp/native-leadership830-drivers --no-audit --no-fund pg@8.16.3 @electric-sql/pglite@0.5.8
PGLITE_MODULE=/private/tmp/native-leadership830-drivers/node_modules/@electric-sql/pglite/dist/index.js \
  node --no-warnings --experimental-test-module-mocks --import tsx scripts/proofs/team-leader-provenance-830.mjs
PG_MODULE=/private/tmp/native-leadership830-drivers/node_modules/pg/lib/index.js \
  bash scripts/proofs/team-leader-provenance-races-830.sh
```

The sequential proof imports production services and builds isolated tables from the production schema. It checks explicit and derived vacancy variants, same-person conversion, unrelated-role preservation, tenant/eligibility refusals, constraint rejection and AS-016 cleanup. The PostgreSQL race proof uses the actual Neon driver with a test fetch adapter. It observes database lock waits for role/membership and seat-removal interleavings, event eligibility and rollback. The runner owns one bounded temporary container and removes it on exit. Neither proof accesses a shared database or calls a paid service.

These tests do not substitute for the exact-head native preview. The PR evidence records that deployment, browser interactions and current CI separately. The existing live-test additions require a database with the compatible schema.

## Migration prerequisite

This extraction is based on main `a5239fb47edbf3273d50da0e67cd36847f6737f5`, whose journal ends at0069. It changes no migration SQL, snapshots or journal entries. The coordinating task owns restoring the immutable applied migration baseline; do not copy a sparse0076 entry into main or renumber applied migrations.

Native runtime requires the `leader_source`, `leader_role_id` columns and `ministry_teams_leader_provenance_check` from applied0076. Its frozen SQL hash is `16758f56574e9e5b93def6c754bc8c83c3ad51b9c28d34add6fb55ab46d3fdb0`, journal time `1789105504370`. The shared development database has this migration. Deployment to another database requires that prerequisite first. Native code does not require0078's version guards.

This branch contains no Evry feature history, runtime changes or Serializable adapter. Evry integration remains its owner's work. Root reviews and merges the native PR after resolving schema compatibility.
