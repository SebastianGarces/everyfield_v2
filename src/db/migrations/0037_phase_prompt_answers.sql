-- RE-STAMPED 0035 -> 0037 (2026-08-12, obligation from #304 / PR #414). This
-- migration was first minted as `0035_phase_prompt_answers` with `when`
-- 1786372572220. Migration 0036 (association subject + notification anchor)
-- then landed on main with `when` 1786480825911 — deliberately raised, its
-- header says why — and drizzle applies a migration only when the ledger's
-- MAX `created_at` is strictly below the migration's `when`, so under the old
-- stamp this file would have been SILENTLY SKIPPED on any database that had
-- applied 0036. The fix (recorded in `memory/invariants.md` -> Migrations:
-- reserving an idx does not reserve an ORDER — `when` decides) was to
-- regenerate this migration after merging main: `drizzle-kit generate` minted
-- idx 37 / `when` 1786542394700, and the emitted DDL was diffed byte-identical
-- against the old 0035 body before the old file and snapshot were deleted.
--
-- OPERATOR RECONCILE, ALREADY DONE: the shared `development` branch had run
-- this migration under the OLD stamp (ledger row `created_at` 1786372572220).
-- That row was UPDATEd to 1786542394700 on 2026-08-12 so the re-stamped file
-- is not re-applied there. Any OTHER database that ran the old 0035 needs the
-- same one-row UPDATE before `pnpm db:migrate`:
--
--   UPDATE drizzle.__drizzle_migrations
--      SET created_at = 1786542394700
--    WHERE created_at = 1786372572220;
--
-- T-020 — `phase_prompt_answers`, the durable home for "this planter already
-- answered the checklist prompt for this transition" (issue #313, ruled by
-- Sebastian on PR #393, 2026-08-10).
--
-- WHY THIS EXISTS. The prompt on /tasks is DERIVED — the latest
-- `phase_transitions` row plus the code-defined catalog — and that stays true.
-- The one fact that cannot be derived is the answer, and it shipped as an
-- httpOnly cookie holding the answered transition's id. A cookie is per
-- BROWSER, so the same planter on a phone, in a second browser, or after
-- clearing cookies was prompted about the SAME transition, and accepting there
-- imported a second full set of 22–26 tasks. The ruling: persist the answer,
-- and make accept idempotent per transition on any device.
--
-- THE UNIQUE INDEX IS THE RULE, NOT A HINT. `memory/invariants.md` →
-- Transactions: SELECT-then-INSERT is not a concurrency guard, and neon-http
-- has no interactive transaction to hold instead. Two presses a few
-- milliseconds apart (a double-clicked "Import checklists", or two devices)
-- both pass a "has this been answered?" read. So
-- `phase_prompt_answers_transition_unique_idx` makes the second answer
-- unrepresentable, and `acceptPhaseTemplatePrompt` claims the row with
-- `ON CONFLICT DO NOTHING` as its FIRST write, gating the import on the claim's
-- own rowcount.
--
-- THE CLAIM GOES FIRST, WHICH INVERTS THE USUAL MARKER-LAST RULE, DELIBERATELY.
-- Marker-last is for redo-safe steps. Importing a checklist is not redo-safe —
-- it creates a second copy by design (T-012 has no dedupe and says so) — so a
-- marker written after the import is written after the damage. Claiming first
-- carries the opposite failure: a crash between the claim and the first INSERT
-- leaves a transition answered with no tasks. That one is visible and
-- repairable — every checklist stays reachable at /tasks/templates — and the
-- service releases the claim itself when the import failed having created
-- nothing.
--
-- UNIQUE ON `transition_id` ALONE. A transition belongs to exactly one church,
-- so (church_id, transition_id) would be a wider key for the same rule and
-- would let a forged church id claim a second answer for one transition.
-- `church_id` is here for tenant-scoped reads and for the seed wipe's FK walk.
--
-- ON DELETE CASCADE FROM `phase_transitions`. An answer about a transition that
-- no longer exists says nothing. `church_id` and `answered_by_id` follow the
-- house pattern and do NOT cascade; `planWipe()` (scripts/seed-dev-db.ts)
-- derives the delete order from `pg_constraint` at runtime, so this table joins
-- the dev-seed wipe on its own and no list has to be kept in step
-- (`memory/invariants.md` → Dev Seeds).
--
-- EXPAND-ONLY DDL — WHICH IS NOT THE SAME AS "DEPLOY IN EITHER ORDER". Nothing
-- is dropped and nothing is rewritten, so a build deployed BEFORE this
-- migration keeps working: it never names the table and answers with the cookie
-- only. The build that SHIPS WITH this migration is the other story.
-- `getLatestPhaseTransition` (src/lib/tasks/phase-prompt.ts) LEFT JOINs
-- `phase_prompt_answers` on EVERY /tasks render, because `PhaseTemplatePrompt`
-- is mounted unconditionally in src/app/(dashboard)/tasks/page.tsx, and there
-- is no route-level error boundary anywhere under src/app — only
-- src/app/global-error.tsx. A missing table is therefore not a degraded prompt.
-- It is an unhandled Postgres error that fails the WHOLE /tasks render, for
-- every planter, on their FIRST page load — not at the first answer.
--
-- SO: APPLY THIS MIGRATION BEFORE DEPLOYING THIS BUILD. Nothing needs
-- back-filling: an unanswered transition is the absence of a row, and every
-- planter's outstanding prompt is their LATEST transition, which no cookie from
-- before this change can have answered durably. The worst a planter sees is one
-- prompt they had already dismissed in their own browser — where the cookie
-- still suppresses it anyway.
--
-- ROLLBACK (HR2) RUNS THE ORDER BACKWARDS: CODE FIRST, TABLE SECOND. Ship the
-- application revert first — or in the same deploy — and run the DDL only once
-- no live build reads `phase_prompt_answers`. Dropping the table under a
-- running build breaks /tasks for exactly the reason above. The revert is one
-- change, not two: the `ON CONFLICT` claim in `acceptPhaseTemplatePrompt` goes
-- with it, which un-fixes the cross-device duplicate this migration exists to
-- close. Once the code is back, run in ONE psql session:
--
--   DROP TABLE IF EXISTS "phase_prompt_answers";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786542394700;
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0034: the journal is the
-- repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted. Removing
-- the journal entry instead makes drizzle-kit forget the migration while the
-- ledger still claims it applied, which is unrecoverable by restoring the entry.
--
-- THE LEDGER ROW IS IDENTIFIED BY `created_at`, NOT BY A FILE HASH — the 0036
-- header records why: `drizzle.__drizzle_migrations.hash` is drizzle's own
-- digest of the executed statements, so the shasum of this file matches
-- nothing and a hash-keyed DELETE reports `DELETE 0`. The literal above is
-- this migration's `"when"` in `_journal.json`, which IS the ledger's
-- `created_at`.
CREATE TABLE "phase_prompt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"transition_id" uuid NOT NULL,
	"answer" varchar(20) NOT NULL,
	"answered_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phase_prompt_answers_answer_check" CHECK ("phase_prompt_answers"."answer" in ('accepted', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "phase_prompt_answers" ADD CONSTRAINT "phase_prompt_answers_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_prompt_answers" ADD CONSTRAINT "phase_prompt_answers_transition_id_phase_transitions_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."phase_transitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_prompt_answers" ADD CONSTRAINT "phase_prompt_answers_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phase_prompt_answers_transition_unique_idx" ON "phase_prompt_answers" USING btree ("transition_id");--> statement-breakpoint
CREATE INDEX "phase_prompt_answers_church_id_idx" ON "phase_prompt_answers" USING btree ("church_id");