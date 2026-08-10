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
-- EXPAND-ONLY. Nothing is dropped and nothing is rewritten. A build deployed
-- BEFORE this migration keeps working (it never names the table — it answers
-- with the cookie only), and the build deployed AFTER it works against a
-- database that has not run the migration only until the first answer. Deploy
-- in either order. Nothing needs back-filling: an unanswered transition is the
-- absence of a row, and every planter's outstanding prompt is their LATEST
-- transition, which no cookie from before this change can have answered
-- durably. The worst a planter sees is one prompt they had already dismissed in
-- their own browser — where the cookie still suppresses it anyway.
--
-- ROLLBACK (HR2). Drop what was added. Nothing else referenced it, and the
-- cookie fast path still works on its own, so the application code degrades to
-- the pre-ruling per-browser behaviour rather than breaking. Run in ONE psql
-- session:
--
--   DROP TABLE IF EXISTS "phase_prompt_answers";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0035 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032/0033/0034: the journal is the
-- repository's list of migrations, `drizzle.__drizzle_migrations` is the
-- database's record of what ran, and only the ledger row is deleted. Removing
-- the journal entry instead makes drizzle-kit forget the migration while the
-- ledger still claims it applied, which is unrecoverable by restoring the entry.
--
-- `<0035 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0035_phase_prompt_answers.sql
--
-- Rolling back also un-fixes the cross-device duplicate, so the `ON CONFLICT`
-- claim in `acceptPhaseTemplatePrompt` must be reverted with it — the two are
-- one change.
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