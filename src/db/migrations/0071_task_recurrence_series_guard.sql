-- #783 EV-028 — one open task per recurrence series, including concurrent
-- canonical owner and Evry completion paths.
--
-- ROLLBACK (isolated database only):
--   DROP INDEX IF EXISTS tasks_open_recurrence_series_unique_idx;
-- Remove this exact migration hash from drizzle.__drizzle_migrations before
-- reapplying. Dropping the guard does not delete or rewrite task rows.

CREATE UNIQUE INDEX "tasks_open_recurrence_series_unique_idx" ON "tasks" USING btree ("church_id",(coalesce("recurrence_rule" ->> 'seriesId', "id"::text))) WHERE "tasks"."is_recurring" and "tasks"."status" <> 'complete' and "tasks"."deleted_at" is null;
