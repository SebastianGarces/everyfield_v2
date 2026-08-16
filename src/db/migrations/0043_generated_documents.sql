-- DOC-008 — `generated_documents`: one row per file a planter generated,
-- pointing at the bytes in the private Tigris bucket so history can
-- re-download without re-rendering.
--
-- WHY THIS EXISTS. Generation was on-demand and stateless: the file streamed
-- to the browser and nothing was recorded, so `/documents/history` had no
-- data source. A log-only design would silently return a *different* document
-- after a template edit. Storing the artifact is the only option that
-- satisfies "re-download without regenerating" as written.
--
-- THIS IS NOT A TEMPLATE TABLE. Audit decision #15 rules out DB-backed
-- *template* tables; the catalog stays code-defined. A generation log records
-- what was produced, not what can be produced, and does not reopen that
-- decision.
--
-- ADDITIVE AND NON-REWRITING. One new table, two foreign keys, two indexes
-- and one CHECK. Nothing existing is altered, nothing is backfilled, and no
-- row of any other table is read or written. `churches` and `users` do not
-- cascade, which `planWipe()` derives from `pg_constraint` at seed time —
-- never write that order down as a list (memory/invariants.md → Dev Seeds).
--
-- WHY THE CHECK. `format` is `varchar(8)` and `GeneratedDocumentFormat` is a
-- `.$type<>()` brand, which is a compile-time fact and nothing else (0040's
-- lesson). Without the constraint a typo'd format is as writable as a real
-- one and sits in the table forever, invisible to a re-download that looks
-- up MIME type from the three words the code knows. Widening the vocabulary
-- means widening this CHECK in a new migration — never editing this file.
--
-- `storage_key` is UNIQUE: two rows must not point at the same object. The
-- list reads `(church_id, created_at)` together — tenancy is
-- application-enforced here (no RLS) — so that is the index the history
-- page actually uses.
--
-- DEPLOY IN EITHER ORDER, and the claim is checked rather than inherited (the
-- 0038 correction of 2026-08-13). Nothing in this repo INFERS anything against
-- this table's constraints:
--   - migration first — the old build never names `generated_documents`, so
--     the table sits empty and unread.
--   - code first — every read and write of `generated_documents` is new in
--     the same change, so a build that has the code and not the table raises
--     `relation "generated_documents" does not exist` on generate (after
--     render) and on `/documents/history`, and nowhere else. No existing
--     surface changes behaviour until persist runs.
-- There is no `ON CONFLICT (…) WHERE …` here, so the 42P10 trap that forced
-- 0038's arbiter-index-first ordering does not apply.
-- Nothing in this repo applies migrations on deploy (`package.json` has only
-- `"build": "next build"`), so code-first is the DEFAULT unless an operator
-- runs `pnpm db:migrate`.
--
-- SIBLING RECONCILE. Main's head is 0042 (`when` 1786769854360). This
-- migration's `when` is 1786859369921, ABOVE that, so a `pnpm db:migrate`
-- against a database that has applied 0042 will apply this one. Nothing here
-- owes a forward reconcile. A migration from ANOTHER branch merging with a
-- `when` between 1786769854360 and 1786859369921, or above 1786859369921,
-- owes it (memory/invariants.md → Migrations).
--
-- ROLLBACK (HR2). Two statements, then the ledger delete, in ONE psql session:
--
--   DROP TABLE IF EXISTS "generated_documents";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786859369921;
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0040/0041/0042: the journal is
-- the repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted. Removing
-- the journal entry instead makes drizzle-kit forget the migration while the
-- ledger still claims it applied, which is unrecoverable by restoring the
-- entry.
--
-- The row can also be identified by the sha256 of THIS FILE, byte for byte,
-- from the deployed commit:
--
--   shasum -a 256 src/db/migrations/0043_generated_documents.sql
--
-- DROPPING THE TABLE DESTROYS DATA — every stored generation log row. The
-- objects in the private bucket are NOT deleted by this rollback. That is
-- what makes this migration safe to roll back only BEFORE planters have
-- generated documents they expect to re-download, and it is the one thing
-- to check before running it.
--
-- ROLLING BACK REQUIRES REVERTING THE CODE TOO. The generation route writes
-- this table after every non-preview render and `/documents/history` reads
-- it, so dropping it under a live build 500s those two surfaces.
CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" varchar(64) NOT NULL,
	"format" varchar(8) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generated_documents_format_check" CHECK ("generated_documents"."format" in ('pdf', 'docx', 'xlsx'))
);
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_documents_church_created_at_idx" ON "generated_documents" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_storage_key_idx" ON "generated_documents" USING btree ("storage_key");
