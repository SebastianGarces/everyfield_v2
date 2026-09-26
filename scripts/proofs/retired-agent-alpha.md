# Retired agent boundary, 2026-09-26

Sebastian requested removal of the current Evry implementation and retirement of Jev experimentation so alpha can proceed independently. This change removes the launcher, chat workspace, API routes, runtime, communication adapters and dedicated eval/proof tooling. Plant Intelligence, its model configuration and Langfuse tracing, native task guards, and native leadership locking remain.

The unmerged Evry pull requests are closed without merging. Their Git history remains recoverable, but is not a release dependency. The feature parent and open capability/recipe work are deferred. A future agent starts from a new decision, not by merging those branches.

## Database decision

No database mutation is required for this runtime removal. Existing SQL migrations, snapshots and journal are unchanged. Unused Drizzle declarations remain so future generation does not silently propose deleting tables.

A read-only audit of the shared development database found 52 legacy conversations, 248 messages, 85 artifacts, 10 plans and 7 Eve session ownership records. Those records were not read for content, exported, changed or deleted. The three older `assistant_*` tables, `evry_execution_effect_claims`, `evry_eve_attachments` and `communication_failed_retries` were empty.

The shared database is ahead of main by two migrations. Both hashes match commit `b4c3461e` exactly:

- `0080_communication_failed_retry` creates `communication_failed_retries` and adds nullable `communication_recipients.failure_origin` with its check constraint. The retry table references `evry_action_plans`; dropping only agent-prefixed tables would miss that dependency.
- `0081_evry_session_attachments` creates `evry_eve_attachments`, which references session ownership records.

These applied migrations are accepted history, not missing migrations to replay or ledger rows to erase. Do not import the retired runtime to account for them. A separately approved cleanup must use a forward migration, preserve unrelated recipient records, inventory foreign keys and agent-owned views/functions/triggers, and be proven on a scratch database before application. Do not use a blanket `CASCADE`. Allocate future migration numbers and timestamps after the applied 0081 tail, not just main's 0079 tail.

Keep migrations 0071/0072, which enforce native task recurrence and structure, and 0075–0078, which contain wiki sharing, leadership and discovery changes. Nothing in this retirement rolls back native alpha work.

## Repeat the checks

```sh
node --import tsx --test scripts/retired-agent-boundary.test.ts
pnpm test:ci
pnpm exec tsc --noEmit --incremental false
pnpm exec tsx scripts/audit-retired-agent-db.ts /path/to/.env.local
```

The last command uses SELECTs only and prints table counts, incoming foreign keys and ledger metadata, never credentials or message contents. No live model calls are needed for removal validation. Preview checks must confirm the authenticated native shell has no Evry control, ordinary navigation and settings still work, and `/evry` plus `/api/evry/conversations` return 404.
