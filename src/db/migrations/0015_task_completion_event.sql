ALTER TABLE "tasks" ADD COLUMN "completion_event" varchar(100);--> statement-breakpoint
CREATE INDEX "tasks_completion_event_idx" ON "tasks" USING btree ("completion_event","related_id");