-- W-016 — `wiki_article_feedback`: one helpful/unhelpful vote per
-- (church, user, article).
--
-- WHY THIS EXISTS. `wiki_progress` tracks reading and captures no judgement.
-- A planter can tell us an article helped or did not, so the playbook can be
-- improved with evidence instead of guesswork. Votes are church-scoped: two
-- plants rating the same global slug are two independent rows, and a read
-- that dropped `church_id` would return another plant's vote.
--
-- `wiki_article_feedback_church_user_article_idx` IS THE GUARD, not a
-- service check. Unique on `(church_id, user_id, article_slug)` so a second
-- press is an UPDATE rather than a duplicate. It is also the arbiter for
-- the writer's `ON CONFLICT … DO UPDATE`, so a double-clicked thumb writes
-- one row. A SELECT-then-INSERT would not do (memory/invariants.md →
-- Transactions).
--
-- WHY A CHECK. `rating` is `varchar(20)` and `WikiArticleFeedbackRating` is
-- a `.$type<>()` brand, which is a compile-time fact and nothing else
-- (0040's lesson). Without the constraint a forged rating is as writable as
-- a real one and sits in the table forever.
--
-- ADDITIVE AND NON-REWRITING. One new table, two foreign keys, two indexes
-- and one CHECK. Nothing existing is altered, nothing is backfilled, and no
-- row of any other table is read or written. Both FKs cascade so a deleted
-- church or user takes its votes; `planWipe()` derives that order from
-- `pg_constraint` at seed time — never write it down as a list
-- (memory/invariants.md → Dev Seeds).
--
-- DEPLOY MIGRATION FIRST. The writer infers `ON CONFLICT (church_id, user_id,
-- article_slug)`, and `ON CONFLICT (…)` against a database lacking that
-- unique index is SQLSTATE 42P10 on EVERY call. Code-first also fails on
-- `relation "wiki_article_feedback" does not exist`. Nothing in this repo
-- applies migrations on deploy (`package.json` has only `"build": "next
-- build"`), so an operator must run `pnpm db:migrate` BEFORE the deploy that
-- carries the code.
--
-- SIBLING RECONCILE. This migration's `when` is 1786859463138, above 0042's
-- 1786769854360, so a `db:migrate` run applies 0042 then 0043 and neither is
-- skipped. A migration from ANOTHER branch merging with a `when` above
-- 1786859463138 owes it (memory/invariants.md → Migrations).
--
-- ROLLBACK. Two statements, then the ledger delete, in ONE psql session:
--
--   DROP TABLE IF EXISTS "wiki_article_feedback";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786859463138;
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0041/0042: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of
-- what ran, and only the ledger row is deleted.
--
-- ROLLING BACK REQUIRES REVERTING THE CODE TOO. The article page and the
-- vote action read and write this table, so dropping it under a live build
-- breaks the article render. Revert the application half first, then drop.
CREATE TABLE "wiki_article_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"article_slug" text NOT NULL,
	"rating" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_article_feedback_rating_check" CHECK ("wiki_article_feedback"."rating" in ('helpful', 'unhelpful'))
);
--> statement-breakpoint
ALTER TABLE "wiki_article_feedback" ADD CONSTRAINT "wiki_article_feedback_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_article_feedback" ADD CONSTRAINT "wiki_article_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_article_feedback_church_user_article_idx" ON "wiki_article_feedback" USING btree ("church_id","user_id","article_slug");--> statement-breakpoint
CREATE INDEX "wiki_article_feedback_church_article_idx" ON "wiki_article_feedback" USING btree ("church_id","article_slug");