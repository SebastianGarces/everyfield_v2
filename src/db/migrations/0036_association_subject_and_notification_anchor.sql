-- #304 WS3 / OV-013 — the association SUBJECT and the notification ANCHOR
-- (ruling #351, 2026-08-09).
--
-- WHAT IT SETTLES. Two tables made a CHURCH the mandatory tenant of a row, and
-- the third invitation type in the product — a sending church joining a NETWORK
-- — names no church. So that association was audited nowhere and announced to
-- nobody: `association_events.church_id` was NOT NULL with a plant as its
-- subject, and `notifications.church_id` was NOT NULL as the boundary every read
-- filters on (N-010). #351 ruled for the shape `src/db/schema/association-event.ts`
-- had asked for in its own header — a subject discriminator with one FK per
-- subject kind — and for the same move on the notification side, as ONE anchored
-- table rather than a parallel org-notifications table.
--
-- EXPAND-ONLY, AND NO ROW IS REWRITTEN. Four new columns, two of them NOT NULL
-- WITH A DEFAULT (Postgres 11+ stores that in the catalog, so there is no table
-- rewrite and no long lock), two nullable. Two NOT NULL constraints are DROPPED,
-- which is a catalog change and cannot fail on data. Nothing is backfilled by a
-- statement: every pre-existing row is church-subject / church-anchored, which
-- is exactly what the two defaults give it. No existing column, index or
-- constraint is altered — in particular `notifications_dedupe_key_unique_idx` is
-- untouched, because `dbEnqueueDeps.insertIfAbsent` mirrors its predicate byte
-- for byte and every keyed enqueue in the product rides it.
--
-- ORDER MATTERS ONCE. The two `DROP NOT NULL`s run BEFORE the CHECKs are added;
-- the CHECKs are added AFTER the defaulted discriminators exist. Validating
-- `association_events_subject_check` scans the table, and it passes on legacy
-- rows precisely because `subject_type` has already defaulted to 'church' while
-- `church_id` is still populated on every one of them.
--
-- THE DEFAULTS STAY. `subject_type` and `anchor_type` keep their DEFAULT after
-- this migration, deliberately: a raw INSERT that names an org anchor and
-- forgets the discriminator then fails the CHECK (a loud error) rather than
-- being rejected for a null (a different, less legible one), and a raw INSERT
-- that names neither still files itself correctly as the church case.
--
-- ROLLBACK (HR2). Reversible in one psql session, and it loses only rows that
-- could not have existed before it — an org-anchored notification and a
-- sending-church-subject audit row are both new shapes. DELETE those first, or
-- the two `SET NOT NULL`s fail on them:
--
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_anchor_check";
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_anchor_type_check";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_check";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_type_check";
--   DROP INDEX IF EXISTS "notifications_org_feed_idx";
--   DROP INDEX IF EXISTS "notifications_org_dedupe_key_unique_idx";
--   DROP INDEX IF EXISTS "association_events_subject_sending_church_idx";
--   DELETE FROM "notifications" WHERE "anchor_org_id" IS NOT NULL;
--   DELETE FROM "association_events" WHERE "subject_sending_church_id" IS NOT NULL;
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "anchor_org_id";
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "anchor_type";
--   ALTER TABLE "association_events" DROP CONSTRAINT IF EXISTS "association_events_subject_sending_church_id_sending_churches_i";
--   ALTER TABLE "association_events" DROP COLUMN IF EXISTS "subject_sending_church_id";
--   ALTER TABLE "association_events" DROP COLUMN IF EXISTS "subject_type";
--   ALTER TABLE "notifications" ALTER COLUMN "church_id" SET NOT NULL;
--   ALTER TABLE "association_events" ALTER COLUMN "church_id" SET NOT NULL;
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786480825911;
--
-- If a database already CARRIES the four columns while its ledger holds no row
-- for this migration, that is the renumber's own residue and the rollback above
-- is only one of the two answers to it — read OPERATOR RECONCILE at the foot of
-- this header BEFORE running `pnpm db:migrate` against it.
--
-- ONE TRAP, the same one 0031 recorded, and it bit again here. The FK name
-- drizzle generates below,
-- `association_events_subject_sending_church_id_sending_churches_id_fk`, is 67
-- characters, so Postgres TRUNCATED it to 63 while this migration applied and
-- said so as a NOTICE. The name IN THE DATABASE is therefore
--
--   association_events_subject_sending_church_id_sending_churches_i
--
-- and that is the name the rollback's DROP CONSTRAINT must use. Drizzle's own
-- diff never looks, which is why `db:generate` reports no drift either way.
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of what
-- ran, and only the ledger row is deleted.
--
-- THE LEDGER ROW IS IDENTIFIED BY `created_at`, NOT BY A FILE HASH. This block
-- used to say `WHERE hash = '<this migration's hash>'` and call that hash the
-- sha256 of this file; it is not. `drizzle.__drizzle_migrations.hash` is
-- drizzle's own digest of the statements it executed, so the shasum of the file
-- on disk matches nothing and the DELETE reports `DELETE 0` — after which
-- `pnpm db:migrate` prints success and applies nothing, leaving the database
-- silently un-migrated with the ledger still claiming otherwise. The value above
-- is this migration's `"when"` in `_journal.json`, which IS the ledger's
-- `created_at`; it is the same form 0031 and 0023 settled on.
--
-- THE SILENT-SKIP HAZARD, and why this file is 0036 rather than 0035 (round 8
-- of #304, 2026-08-10). `drizzle-kit migrate` decides what to apply by comparing
-- each journal entry's `when` against the MAXIMUM `created_at` already in
-- `drizzle.__drizzle_migrations` — not by asking whether this particular
-- migration's row is there. A journal entry whose `when` is LOWER than a sibling
-- migration that reached the database first is therefore skipped in silence:
-- the CLI prints its usual success and exits 0, the columns below never exist,
-- and the very next query against `anchor_type` is what tells you. This file was
-- stamped 1786330802116 while two siblings on other branches carry 1786312591041
-- and 1786372572220, so on any ledger that already holds the later of those it
-- would have applied NOTHING while reporting success. The `when` above is now
-- strictly greater than both, and it is the `when` — never the file's number —
-- that decides. Prove an apply from `information_schema.columns`, never from the
-- CLI's exit status.
--
-- THE JOURNAL SKIPS idx 35 ON PURPOSE, and it costs nothing here.
-- `_journal.json` runs 34 → 36: idx 35 is reserved for
-- `0035_phase_prompt_answers`, in flight on `feature/U313-WS1`. NOTHING NEEDS
-- DOING ABOUT THAT NUMBER. `drizzle-kit generate` derives the next index from
-- max(idx)+1, not from `entries.length`, so the next generated migration on this
-- branch is minted as `0037_*` on its own — verified by forcing a schema change
-- and running generate, which emitted `0037_*` with journal entry `{idx: 37}`.
-- An earlier revision of this paragraph claimed `entries.length` and told the
-- next operator to rename the generated file and its journal entry down to 0037
-- by hand; following that would have MANUFACTURED the duplicate-0036 collision
-- it warned about. Do not rename a generated migration by hand.
--
-- WHAT DOES NEED DOING IS THE ORDER, AND IT POINTS FORWARD — RESERVING AN idx
-- DOES NOT RESERVE AN ORDER. `when` is what decides, and this file's `when`
-- (1786480825911) was deliberately raised above every sibling in flight,
-- including `0035_phase_prompt_answers` (`feature/U313-WS1`, `when`
-- 1786372572220 — strictly LOWER). Because `drizzle-kit migrate` applies a
-- migration only while the ledger's MAXIMUM `created_at` is strictly less than
-- that migration's `when`, any database that has applied THIS file will SILENTLY
-- SKIP that sibling: `pnpm db:migrate` prints success, exits 0, applies nothing,
-- `phase_prompt_answers` never exists, and the failure finally surfaces as a
-- runtime query error. This branch fixed the hazard for itself by raising its
-- `when` and thereby created it for the sibling.
--
-- SO, BEFORE `feature/U313-WS1` MERGES: re-stamp `0035_phase_prompt_answers`
-- with a `when` strictly greater than 1786480825911 and renumber it to `0037_*`
-- in BOTH its filename and its `_journal.json` entry. That is a re-stamp of a
-- migration that has not landed yet — not the hand-rename of a freshly generated
-- file the paragraph above forbids. Whoever owns U313-WS1 does it there; it
-- cannot be done from here.
--
-- OPERATOR RECONCILE — a database that applied the OLD 0035 needs a hand before
-- `pnpm db:migrate`. The renumber above fixes the repository and leaves every
-- database that already ran this migration under its old stamp, 1786330802116,
-- in a state the CLI cannot see: the four columns EXIST, and the ledger either
-- never held that row or no longer does (an earlier rollback ran the DELETE and
-- removed the row without dropping the columns — the two halves of the rollback
-- block are separable and one of them was run alone). Because the CLI compares
-- this file's `when` against the ledger's MAXIMUM `created_at` and not against
-- its own row, 1786480825911 wins, the DDL below is re-run, and the apply dies
-- on `ALTER TABLE "association_events" ADD COLUMN "subject_type"` — column
-- already exists — with the migration aborted and the ledger unchanged.
--
-- DETECT IT. Two reads, neither of which writes anything:
--
--   select table_name, column_name
--     from information_schema.columns
--    where (table_name = 'association_events'
--            and column_name in ('subject_type', 'subject_sending_church_id'))
--       or (table_name = 'notifications'
--            and column_name in ('anchor_type', 'anchor_org_id'));
--   select max(created_at) from drizzle.__drizzle_migrations;
--
-- Four rows back and a max BELOW 1786480825911 means this migration's effect is
-- already present and unrecorded — take an exit below. Zero rows back means a
-- normal apply; run `pnpm db:migrate` and nothing here concerns you.
--
-- EXIT A — the database carries rows worth keeping (the shared `development`
-- branch, or any environment with real data). Record the apply that already
-- happened, so the CLI skips a migration whose effect is present:
--
--   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
--   VALUES ('<sha256 of this file: shasum -a 256 src/db/migrations/0036_association_subject_and_notification_anchor.sql>', 1786480825911);
--
-- The `created_at` literal is what matters and it is this migration's journal
-- `when`; the hash column is bookkeeping for the next human, so write the real
-- digest rather than a placeholder. (It is the sha256 of this file's bytes at
-- the moment of the apply — which is exactly why the rollback DELETE above
-- cannot key on it: any header edit changes the file while the ledger keeps the
-- old value. `created_at` is stable.) THIS INSERT ASSERTS THAT THE DDL BELOW
-- MATCHES WHAT THE DATABASE ALREADY HAS. Assert it, do not assume it: the four
-- columns from the probe above, the five constraints from `pg_constraint`
-- (`association_events_subject_check`, `association_events_subject_type_check`,
-- `notifications_anchor_check`, `notifications_anchor_type_check`,
-- `association_events_subject_sending_church_id_sending_churches_i`), the three
-- indexes from `pg_indexes` (`notifications_org_feed_idx`,
-- `notifications_org_dedupe_key_unique_idx`,
-- `association_events_subject_sending_church_idx`), and `is_nullable = 'YES'` on
-- both `church_id` columns. If any one of them is missing, EXIT A is a lie the
-- ledger will keep telling; take EXIT B or add the missing piece by hand first.
-- The header's own rule applies to the result too — prove it from
-- `information_schema.columns`, never from the CLI's exit status, which is 0 for
-- "skipped" and 0 for "applied" alike.
--
-- EXIT B — a scratch, local or throwaway database. Run the ROLLBACK block above
-- in full (it drops the four columns, the five constraints and the three
-- indexes, and restores both NOT NULLs), then `pnpm db:migrate` normally and the
-- migration applies from a clean shape. It DELETES every org-anchored
-- notification and every sending-church-subject `association_events` row, which
-- is what that block already says it does; that is why this exit is for
-- databases whose rows nobody will miss.

ALTER TABLE "association_events" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "association_events" ADD COLUMN "subject_type" varchar(20) DEFAULT 'church' NOT NULL;--> statement-breakpoint
ALTER TABLE "association_events" ADD COLUMN "subject_sending_church_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "anchor_type" varchar(20) DEFAULT 'church' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "anchor_org_id" uuid;--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("subject_sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "association_events_subject_sending_church_idx" ON "association_events" USING btree ("subject_sending_church_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_dedupe_key_unique_idx" ON "notifications" USING btree ("anchor_org_id","recipient_user_id","dedupe_key") WHERE "notifications"."anchor_org_id" is not null and "notifications"."dedupe_key" is not null and "notifications"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "notifications_org_feed_idx" ON "notifications" USING btree ("anchor_org_id","recipient_user_id","created_at");--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_type_check" CHECK ("association_events"."subject_type" in ('church', 'sending_church'));--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_check" CHECK ((
        ("association_events"."subject_type" = 'church'
          and "association_events"."church_id" is not null
          and "association_events"."subject_sending_church_id" is null)
        or
        ("association_events"."subject_type" = 'sending_church'
          and "association_events"."subject_sending_church_id" is not null
          and "association_events"."church_id" is null)
      ));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_anchor_type_check" CHECK ("notifications"."anchor_type" in ('church', 'sending_church', 'network'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_anchor_check" CHECK ((
        ("notifications"."anchor_type" = 'church'
          and "notifications"."church_id" is not null
          and "notifications"."anchor_org_id" is null)
        or
        ("notifications"."anchor_type" in ('sending_church', 'network')
          and "notifications"."anchor_org_id" is not null
          and "notifications"."church_id" is null)
      ));
