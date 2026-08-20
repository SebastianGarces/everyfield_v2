-- MEET-011: the application-level SELECT-then-INSERT guard that this index
-- replaces could be raced, so a database that already ran the buggy code may
-- hold more than one live evaluation task for the same meeting. Soft-delete the
-- extras (keeping the oldest, which is the one people have been looking at) so
-- the unique index can be created. Without this, the migration would fail on
-- exactly the databases that actually hit the bug.
--
-- AMENDED 2026-08-20 (#323 WS1, from #162): the inner WHERE gained
-- `AND "related_id" IS NOT NULL`. The index below is a btree on
-- (church_id, related_id), and in a btree NULLs are DISTINCT — two rows with a
-- null related_id never collide, so they were never in the way. The backfill
-- partitioned on that column anyway, which put every such row in ONE partition
-- per church and soft-deleted all but the oldest: rows the index would have
-- accepted, deleted to make room for nothing. Correcting the text only changes
-- what a database migrating from here on does; every database that already ran
-- this migration ran the over-reaching form (dev matched 0 rows, so no data
-- changed there), and drizzle-kit decides what to apply from the journal's
-- timestamps, never by re-reading this file.
UPDATE "tasks" SET "deleted_at" = now(), "updated_at" = now() WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "church_id", "related_id" ORDER BY "created_at", "id"
    ) AS rn
    FROM "tasks"
    WHERE "completion_event" = 'meeting.evaluation.completed'
      AND "deleted_at" IS NULL
      AND "related_id" IS NOT NULL
  ) ranked WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_meeting_evaluation_unique_idx" ON "tasks" USING btree ("church_id","related_id") WHERE "tasks"."completion_event" = 'meeting.evaluation.completed' and "tasks"."deleted_at" is null;
