-- VM-014 (#98) — `meeting_responses`: what an attendee said on their Response
-- Card, captured per attendee, counted on the meeting's Outcomes tab.
--
-- WHY THIS EXISTS. F6 already prints the Response Card (DOC-010), so the paper
-- half of VM-014 has shipped for months and the cards come back to a planter
-- with nowhere to go. Nothing in the product could answer "of the nineteen
-- people in the room, how many want to join the core group?" — the number the
-- next vision meeting is planned around.
--
-- WHY A TABLE AND NOT A COLUMN ON `meeting_attendance`. That row already
-- carries `response_status`, which is the RSVP ("are you coming?"), and `notes`,
-- which is the attendee-note surface. A third meaning on the same row makes
-- "response" ambiguous exactly where a planter reads it, and — the load-bearing
-- half — it makes "no card came back" a NULL on a row that always exists, which
-- every reader then has to remember to distinguish from `not_interested`.
-- VM-014's own acceptance criterion is that an attendee with no card is not
-- counted as a negative response; NO ROW says that without a defensive null
-- check anywhere. The full reasoning is in `src/db/schema/meetings.ts`.
--
-- ADDITIVE AND NON-REWRITING. One new table, four foreign keys, two indexes and
-- one CHECK. Nothing existing is altered, nothing is backfilled, and no row of
-- any other table is read or written. `church_meetings` and `persons` cascade
-- on delete so a deleted meeting or person takes its cards with it; `churches`
-- and `users` do not, which `planWipe()` derives from `pg_constraint` at seed
-- time — never write that order down as a list (memory/invariants.md → Dev
-- Seeds).
--
-- WHY THE CHECK. `response_type` is `varchar(32)` and `ResponseCardType` is a
-- `.$type<>()` brand, which is a compile-time fact and nothing else (0040's
-- lesson). Without the constraint a typo'd response type is as writable as a
-- real one and sits in the table forever, invisible to a breakdown that counts
-- the five words the code knows. Widening the vocabulary means widening this
-- CHECK in a new migration — never editing this file.
--
-- DEPLOY IN EITHER ORDER, and the claim is checked rather than inherited (the
-- 0038 correction of 2026-08-13). Nothing in this repo INFERS anything against
-- this table's constraints:
--   - migration first — the old build never names `meeting_responses`, so the
--     table sits empty and unread.
--   - code first — every read and write of `meeting_responses` is new in the
--     same PR, so a build that has the code and not the table raises
--     `relation "meeting_responses" does not exist` on the Outcomes tab and
--     nowhere else. No existing surface changes behaviour.
-- There is no `ON CONFLICT (…) WHERE …` here — the upsert targets a plain
-- UNIQUE CONSTRAINT created inside the CREATE TABLE — so the 42P10 trap that
-- forced 0038's arbiter-index-first ordering does not apply.
-- Nothing in this repo applies migrations on deploy (`package.json` has only
-- `"build": "next build"`), so code-first is the DEFAULT unless an operator
-- runs `pnpm db:migrate`.
--
-- SIBLING RECONCILE. This migration and 0042 land in the same PR and 0041 holds
-- the LOWER `when` (1786769848658 < 1786769854360), so a `pnpm db:migrate` that
-- applies 0041 leaves the ledger maximum below 0042's `when` and 0042 applies on
-- the same run. Nothing here owes a forward reconcile. If a migration from
-- ANOTHER branch merges between them with a `when` above 1786769854360, that
-- migration owes the reconcile, not this one (memory/invariants.md →
-- Migrations).
--
-- ROLLBACK (HR2). Two statements, then the ledger delete, in ONE psql session:
--
--   DROP TABLE IF EXISTS "meeting_responses";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786769848658;
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
--   shasum -a 256 src/db/migrations/0041_meeting_responses.sql
--
-- DROPPING THE TABLE DESTROYS DATA — every recorded card. That is what makes
-- this migration safe to roll back only BEFORE a planter has keyed cards in, and
-- it is the one thing to check before running it.
CREATE TABLE "meeting_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"response_type" varchar(32) NOT NULL,
	"notes" text,
	"recorded_by_id" uuid,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_responses_meeting_person_unique" UNIQUE("meeting_id","person_id"),
	CONSTRAINT "meeting_responses_type_check" CHECK ("meeting_responses"."response_type" in ('ready_commit', 'interested', 'prayer_request', 'stay_informed', 'not_interested'))
);
--> statement-breakpoint
ALTER TABLE "meeting_responses" ADD CONSTRAINT "meeting_responses_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_responses" ADD CONSTRAINT "meeting_responses_meeting_id_church_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."church_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_responses" ADD CONSTRAINT "meeting_responses_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_responses" ADD CONSTRAINT "meeting_responses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_responses_church_meeting_idx" ON "meeting_responses" USING btree ("church_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_responses_person_id_idx" ON "meeting_responses" USING btree ("person_id");