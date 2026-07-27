-- MEET-011: the application-level SELECT-then-INSERT guard that this index
-- replaces could be raced, so a database that already ran the buggy code may
-- hold more than one live evaluation task for the same meeting. Soft-delete the
-- extras (keeping the oldest, which is the one people have been looking at) so
-- the unique index can be created. Without this, the migration would fail on
-- exactly the databases that actually hit the bug.
UPDATE "tasks" SET "deleted_at" = now(), "updated_at" = now() WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "church_id", "related_id" ORDER BY "created_at", "id"
    ) AS rn
    FROM "tasks"
    WHERE "completion_event" = 'meeting.evaluation.completed'
      AND "deleted_at" IS NULL
  ) ranked WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_meeting_evaluation_unique_idx" ON "tasks" USING btree ("church_id","related_id") WHERE "tasks"."completion_event" = 'meeting.evaluation.completed' and "tasks"."deleted_at" is null;
