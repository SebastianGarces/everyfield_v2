-- ROLLBACK (owned scratch database only):
-- DROP TRIGGER task_status_history_trigger ON tasks;
-- DROP FUNCTION record_task_status_history();
-- DROP TABLE task_status_history;
-- DROP INDEX tasks_follow_up_obligation_unique_idx;
-- DROP INDEX tasks_open_recurrence_series_unique_idx;
-- ALTER TABLE tasks DROP COLUMN follow_up_started_at, DROP COLUMN follow_up_meeting_id, DROP COLUMN follow_up_obligation_key;
-- Before restoring the old open-series index, restore waived tasks to their prior status.
-- CREATE UNIQUE INDEX tasks_open_recurrence_series_unique_idx ON tasks (church_id,(coalesce(recurrence_rule ->> 'seriesId', id::text))) WHERE is_recurring AND status <> 'complete' AND deleted_at IS NULL;

CREATE TABLE "task_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"previous_status" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "tasks_open_recurrence_series_unique_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "follow_up_meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "follow_up_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "follow_up_obligation_key" text;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_follow_up_obligation_unique_idx" ON "tasks" USING btree ("church_id","follow_up_obligation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_open_recurrence_series_unique_idx" ON "tasks" USING btree ("church_id",(coalesce("recurrence_rule" ->> 'seriesId', "id"::text))) WHERE "tasks"."is_recurring" and "tasks"."status" not in ('complete', 'no_longer_needed') and "tasks"."deleted_at" is null;
--> statement-breakpoint
CREATE FUNCTION record_task_status_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_status_history(task_id, church_id, previous_status, status)
    VALUES (NEW.id, NEW.church_id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_status_history_trigger AFTER UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION record_task_status_history();
