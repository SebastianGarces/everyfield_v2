-- #324 (from #262) — `email_suppressions`: an ADDRESS the product must stop
-- mailing, and the record of anybody clearing it.
--
-- WHY THIS EXISTS, AND WHY NOW. `notification_deliveries.error` already carries
-- `PERMANENT_FAILURE_PREFIX`, and `channelEligibility` refuses to retry a row
-- that has it. That stops ONE (notification, channel) pair. It says nothing
-- about the NEXT notification, which gets a fresh delivery row with a fresh
-- attempt count and mails the same dead mailbox again. Real exposure at merge
-- time is ZERO — nothing calls `enqueueNotification` in production yet — and
-- that is precisely the failure mode this migration is filed against: between
-- #251 and the first enqueueing feature no alarm fires, and a sending domain's
-- reputation is slow to earn back once it is spent. The first production
-- enqueuer is the planter digest (U135), which declares a dependsOn edge on
-- this work for that reason.
--
-- THE ADDRESS IS THE KEY, NOT THE USER. The same mailbox can sit on two
-- accounts, an account can change address, and the provider's webhook names an
-- address and never a user id. `email` is stored ALREADY NORMALISED —
-- lowercased and trimmed by `normalizeEmailAddress`
-- (`src/lib/notifications/channels/suppression.ts`), the single writer of that
-- form — rather than indexed through `lower(email)`, because an expression
-- index makes the `ON CONFLICT` target unspellable (the same reasoning that
-- rejected a `coalesce` index in memory/invariants.md → Transactions).
--
-- `email_suppressions_active_email_idx` IS THE GUARD, not a service check.
-- Partial — unique on `email` only `where cleared_at is null` — so "at most one
-- ACTIVE suppression per address" is a database property, while the cleared
-- history sits beside it unconstrained. It is also the arbiter for the
-- recorder's `ON CONFLICT … DO NOTHING`, so the provider delivering the same
-- bounce twice writes one row. A SELECT-then-INSERT would not do: two webhook
-- deliveries arrive concurrently (memory/invariants.md → Transactions).
--
-- WHY `cleared_at` AND NOT A DELETE. A bounce must not be a life sentence — the
-- address holder can re-verify, an admin can clear it — but the history of "this
-- address bounced in August" is what makes a second bounce legible. An address
-- that bounces, clears and bounces again is three rows and a story, not one row
-- overwritten twice. `email_suppressions_cleared_check` ties `cleared_at` and
-- `cleared_reason` together in both directions: a clear that does not say why is
-- indistinguishable from a bug that cleared it. `cleared_by_user_id` is
-- deliberately NOT part of that test — a self-service re-verification has no
-- actor row to name.
--
-- ADDITIVE AND NON-REWRITING. One new table, one foreign key, two indexes and
-- two CHECKs. Nothing existing is altered, nothing is backfilled, and no row of
-- any other table is read or written. `cleared_by_user_id` does not cascade, so
-- a cleared suppression outlives the admin who cleared it; `planWipe()` derives
-- that order from `pg_constraint` at seed time — never write it down as a list
-- (memory/invariants.md → Dev Seeds).
--
-- DEPLOY MIGRATION FIRST, AND THIS ONE IS NOT "EITHER ORDER". The recorder
-- writes `ON CONFLICT (email) WHERE cleared_at is null DO NOTHING`, and
-- `ON CONFLICT (…) WHERE …` against a database lacking that partial index is
-- SQLSTATE 42P10 on EVERY call — the 0038 trap, restated because it applies
-- here. Code-first means every hard-bounce webhook raises 42P10 until the
-- migration runs. The dispatcher's read half fails the same way, on
-- `relation "email_suppressions" does not exist`, and it is inside
-- `runDispatch`, so a code-first deploy takes the whole dispatch run down rather
-- than degrading. Nothing in this repo applies migrations on deploy
-- (`package.json` has only `"build": "next build"`), so an operator must run
-- `pnpm db:migrate` BEFORE the deploy that carries the code.
--
-- SIBLING RECONCILE. This migration and 0041 land in the same PR; 0041 holds the
-- LOWER `when` (1786769848658 < 1786769854360), so a `db:migrate` run applies
-- 0041 then 0042 and neither is skipped. Nothing here owes a forward reconcile.
-- A migration from ANOTHER branch merging with a `when` above 1786769854360
-- owes it (memory/invariants.md → Migrations).
--
-- ROLLBACK (HR2). Two statements, then the ledger delete, in ONE psql session:
--
--   DROP TABLE IF EXISTS "email_suppressions";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786769854360;
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0040: the journal is the
-- repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted. Removing
-- the journal entry instead makes drizzle-kit forget the migration while the
-- ledger still claims it applied, which is unrecoverable by restoring the entry.
--
-- The row can also be identified by the sha256 of THIS FILE, byte for byte,
-- from the deployed commit:
--
--   shasum -a 256 src/db/migrations/0042_email_suppressions.sql
--
-- ROLLING BACK REQUIRES REVERTING THE CODE TOO, unlike 0040. The dispatcher
-- reads this table on every run and the webhook writes it on every permanent
-- bounce, so dropping it under a live build breaks dispatch outright. Revert the
-- application half first, then drop. Dropping the table also FORGETS every
-- suppression, so the addresses it was protecting become mailable again — which
-- is the reason to check the row count before running it.
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"source" varchar(64),
	"detail" text,
	"suppressed_at" timestamp DEFAULT now() NOT NULL,
	"cleared_at" timestamp,
	"cleared_by_user_id" uuid,
	"cleared_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_reason_check" CHECK ("email_suppressions"."reason" in ('hard_bounce', 'spam_complaint')),
	CONSTRAINT "email_suppressions_cleared_check" CHECK (("email_suppressions"."cleared_at" is null) = ("email_suppressions"."cleared_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_active_email_idx" ON "email_suppressions" USING btree ("email") WHERE "email_suppressions"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "email_suppressions_email_idx" ON "email_suppressions" USING btree ("email");