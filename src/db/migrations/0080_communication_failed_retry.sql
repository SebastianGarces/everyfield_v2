-- New retries are source-bound; historical failures remain unclassified.
-- Apply after immutable 0079 before deploying the failed-recipient retry path.
CREATE TABLE "communication_failed_retries" (
	"source_recipient_id" uuid PRIMARY KEY NOT NULL,
	"retry_recipient_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"effect_key" text NOT NULL,
	"outbound" jsonb,
	"first_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comm_failed_retries_distinct_check" CHECK ("communication_failed_retries"."source_recipient_id" <> "communication_failed_retries"."retry_recipient_id"),
	CONSTRAINT "comm_failed_retries_attempt_check" CHECK (("communication_failed_retries"."outbound" is null) = ("communication_failed_retries"."first_attempt_at" is null))
);
--> statement-breakpoint
ALTER TABLE "communication_recipients" ADD COLUMN "failure_origin" varchar(40);--> statement-breakpoint
ALTER TABLE "communication_failed_retries" ADD CONSTRAINT "communication_failed_retries_source_recipient_id_communication_recipients_id_fk" FOREIGN KEY ("source_recipient_id") REFERENCES "public"."communication_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_failed_retries" ADD CONSTRAINT "communication_failed_retries_retry_recipient_id_communication_recipients_id_fk" FOREIGN KEY ("retry_recipient_id") REFERENCES "public"."communication_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_failed_retries" ADD CONSTRAINT "communication_failed_retries_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_failed_retries" ADD CONSTRAINT "communication_failed_retries_plan_id_evry_action_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."evry_action_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comm_failed_retries_child_unique_idx" ON "communication_failed_retries" USING btree ("retry_recipient_id");--> statement-breakpoint
CREATE INDEX "comm_failed_retries_church_idx" ON "communication_failed_retries" USING btree ("church_id");--> statement-breakpoint
ALTER TABLE "communication_recipients" ADD CONSTRAINT "comm_recipients_failure_origin_check" CHECK ("communication_recipients"."failure_origin" is null or "communication_recipients"."failure_origin" = 'provider_delivery_failed');
