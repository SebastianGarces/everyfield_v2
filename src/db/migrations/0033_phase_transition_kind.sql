-- OB-005 — `phase_transitions.kind`, and the index that makes a SECOND initial
-- declaration unrepresentable (issue #306 / WS1, required by the G4 exit
-- comment of 2026-08-09).
--
-- WHY THIS EXISTS. `declareInitialPhaseStatement` locks the `churches` row
-- `FOR UPDATE` as statement one, then decided whether to insert with
-- `WHERE NOT EXISTS (SELECT 1 FROM phase_transitions …)`. The lock and the
-- predicate are about DIFFERENT rows: under READ COMMITTED, EvalPlanQual
-- re-checks only the row that changed (`churches`) when the waiter unblocks, so
-- the subquery still answers from the pre-wait snapshot. Both submitters pass
-- it and both insert. Raced live against the dev database on 2026-08-09: 2 of 3
-- runs wrote TWO rows, and the second read `from_phase 5 → to_phase 3` — a
-- transition the planter never took, fabricated into the OB-005 audit trail.
-- This is the "subquery trap" in `memory/invariants/transactions-atomicity.md`,
-- and `memory/invariants.md`'s remedy is the one applied here: make duplicates
-- impossible with a partial unique index.
--
-- WHY A COLUMN AND NOT AN INDEX ON THE REASON TEXT. The marker used to be a
-- reserved sentence in `reason`, compared against a TypeScript constant. An
-- index predicate would have to repeat that sentence as a SQL literal, in a
-- file nothing re-generates, so the day the constant is reworded the index
-- silently stops covering the rows it exists for. `kind` is a closed set, and
-- the CHECK closes it in the data (same reasoning as 0024/0031/0032: `.$type<>()`
-- on a varchar is a compile-time brand and nothing else).
--
-- ORDER MATTERS. The column lands, existing declarations are re-marked onto it,
-- and only THEN is the unique index built — a build before the backfill would
-- index nothing and let the first real duplicate through.
--
-- WHAT THE BACKFILL DOES NOT DO. Where a church somehow has MORE than one
-- reserved-reason row (only the raced code above can produce that), the
-- earliest is marked as the declaration and the later ones stay `transition`
-- rather than being deleted: they are rows in an append-only audit table, and a
-- migration is the wrong place to decide that recorded history is fiction. Such
-- rows must be corrected by hand. There are none in any database today —
-- `phase_transitions` is empty everywhere after #326's reseed (verified
-- 2026-08-09, 0 rows), so this branch is defensive only.
--
-- EXPAND-ONLY. Nothing is dropped and nothing is rewritten: a build deployed
-- BEFORE this migration keeps working (it never names `kind`, which defaults),
-- and a build deployed AFTER it works against a database that has not run it
-- only until the first declaration. Deploy in either order.
--
-- ROLLBACK (HR2). Drop what was added, in reverse. The column's data is
-- reconstructible from `reason`, so nothing is lost. Run in ONE psql session:
--
--   ALTER TABLE "phase_transitions" DROP CONSTRAINT IF EXISTS "phase_transitions_kind_check";
--   DROP INDEX IF EXISTS "phase_transitions_initial_declaration_unique_idx";
--   ALTER TABLE "phase_transitions" DROP COLUMN IF EXISTS "kind";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0033 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024/0031/0032: the journal is the repository's list
-- of migrations, `drizzle.__drizzle_migrations` is the database's record of
-- what ran, and only the ledger row is deleted. Removing the journal entry
-- instead makes drizzle-kit forget the migration while the ledger still claims
-- it applied, which is unrecoverable by restoring the entry.
--
-- `<0033 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0033_phase_transition_kind.sql
--
-- Rolling back also un-fixes the race, so the application code that gates on
-- `ON CONFLICT` must be reverted with it — the two are one change.
ALTER TABLE "phase_transitions" ADD COLUMN "kind" varchar(32) DEFAULT 'transition' NOT NULL;--> statement-breakpoint
-- Re-mark the declarations that were identified by the reserved reason. The
-- sentence is frozen here on purpose: it is the value those rows CARRY, not a
-- constant this migration shares with the application, and it must keep
-- matching them even after the TypeScript copy is reworded.
UPDATE "phase_transitions" SET "kind" = 'initial_declaration' WHERE "id" IN (
	SELECT DISTINCT ON (t."church_id") t."id"
	FROM "phase_transitions" t
	WHERE t."reason" = 'Declared at setup — where this plant already was when it joined EveryField.'
	ORDER BY t."church_id", t."created_at", t."id"
);--> statement-breakpoint
CREATE UNIQUE INDEX "phase_transitions_initial_declaration_unique_idx" ON "phase_transitions" USING btree ("church_id") WHERE "phase_transitions"."kind" = 'initial_declaration';--> statement-breakpoint
ALTER TABLE "phase_transitions" ADD CONSTRAINT "phase_transitions_kind_check" CHECK ("phase_transitions"."kind" in ('transition', 'initial_declaration'));
