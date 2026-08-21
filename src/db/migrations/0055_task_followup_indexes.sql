-- #521 (from #323): the two follow-up residuals PR #516 deferred, both of them
-- index changes, and both about the SAME property — an index predicate must be
-- spelled exactly like the read it guards.
--
-- ORDERING. This migration holds the only migration slot in its pass, so it has
-- no sibling with a lower `when` to reconcile forward (`memory/invariants.md` →
-- Migrations, on why `idx` does not reserve an order). It is additive plus one
-- narrowing recreate, and nothing else in the tree names either index.

-- ---------------------------------------------------------------------------
-- 1. The evaluation index gains `related_type = 'meeting'`.
-- ---------------------------------------------------------------------------
-- The guard in `handleMeetingAttendanceFinalized` reads
-- (church_id, related_type = 'meeting', related_id, completion_event, deleted_at
-- is null); the index named every clause but the related type. A row carrying
-- the completion event, a meeting's id and `related_type = 'person'` therefore
-- occupied the slot while staying invisible to the guard, so the real INSERT
-- failed 23505, was read as a benign lost race, and the meeting finalized with
-- no tasks at all (#323 WS1, from #162). #323 closed the client-reachable route
-- by deleting `completionEvent` from the zod schemas; this closes the index, so
-- a row written by any other route cannot steal a slot nothing can see.
--
-- NO BACKFILL, and none is possible to need: this predicate is strictly
-- NARROWER than the one it replaces. Every row it will cover was already
-- covered by the old index and is therefore already unique on
-- (church_id, related_id).
DROP INDEX "tasks_meeting_evaluation_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_meeting_evaluation_unique_idx" ON "tasks" USING btree ("church_id","related_id") WHERE "tasks"."completion_event" = 'meeting.evaluation.completed' and "tasks"."related_type" = 'meeting' and "tasks"."deleted_at" is null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. One live follow-up per (church, person, day).
-- ---------------------------------------------------------------------------
-- The accepted residual this retires: a TOP-UP insert (a late-added first-timer
-- reconciled after the finalize) carries no evaluation row, so
-- `tasks_meeting_evaluation_unique_idx` stood over nothing and two concurrent
-- reconciles could each write that person the same follow-up.
--
-- BACKFILL FIRST, on 0022's precedent: a database that ran the un-guarded code
-- may already hold such a pair, and `CREATE UNIQUE INDEX` fails on exactly the
-- databases that hit the bug. Soft-delete the extras.
--
-- WHICH ROW SURVIVES: the oldest INCOMPLETE one, and only the oldest overall
-- when every duplicate is closed. 0022 kept the oldest outright, which is right
-- when the duplicates are clones written seconds apart; it is wrong when a
-- planter completed the first contact and is working the second, because that
-- soft-deletes live work. A completed follow-up has already written its
-- `communications` log entry (`lib/communication/log.ts`), so the record of the
-- contact survives the row.
--
-- PARTITIONED ON NON-NULL KEYS ONLY. This is a btree, where NULLs are DISTINCT:
-- rows with a null `related_id` or a null `due_date` collide with nothing and
-- were never in the way. 0022's original text partitioned on a nullable column
-- anyway and soft-deleted rows the index would have accepted; do not repeat it.
UPDATE "tasks" SET "deleted_at" = now(), "updated_at" = now() WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "church_id", "related_id", "due_date"
      ORDER BY ("status" = 'complete'), "created_at", "id"
    ) AS rn
    FROM "tasks"
    WHERE "category" = 'follow_up'
      AND "related_type" = 'person'
      AND "deleted_at" IS NULL
      AND "related_id" IS NOT NULL
      AND "due_date" IS NOT NULL
  ) ranked WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_person_follow_up_unique_idx" ON "tasks" USING btree ("church_id","related_id","due_date") WHERE "tasks"."category" = 'follow_up' and "tasks"."related_type" = 'person' and "tasks"."deleted_at" is null;
