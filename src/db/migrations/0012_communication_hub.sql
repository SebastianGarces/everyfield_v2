-- ============================================================================
-- Migration 0012: Communication Hub
-- Creates tables for the Communication Hub feature (F9)
-- Note: church_meetings, meeting_attendance, and related changes were already
-- applied by migrations 0010 and 0011. This migration only adds communication
-- tables. The snapshot includes everything to keep Drizzle in sync.
-- ============================================================================

CREATE TABLE "communication_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"channel" varchar(10) DEFAULT 'email' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"external_id" varchar(255),
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"subject" varchar(500),
	"body" text NOT NULL,
	"body_html" text,
	"channel" varchar(10) DEFAULT 'email' NOT NULL,
	"template_id" uuid,
	"meeting_id" uuid,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"recipient_count" integer,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_confirmation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(255) NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_confirmation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(30) NOT NULL,
	"channel" varchar(10) DEFAULT 'email' NOT NULL,
	"subject" varchar(500),
	"body" text NOT NULL,
	"body_html" text,
	"merge_fields" jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"source_template_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_meeting_id_church_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."church_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_confirmation_tokens" ADD CONSTRAINT "meeting_confirmation_tokens_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_confirmation_tokens" ADD CONSTRAINT "meeting_confirmation_tokens_meeting_id_church_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."church_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_confirmation_tokens" ADD CONSTRAINT "meeting_confirmation_tokens_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comm_recipients_communication_id_idx" ON "communication_recipients" USING btree ("communication_id");--> statement-breakpoint
CREATE INDEX "comm_recipients_person_id_idx" ON "communication_recipients" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "comm_recipients_external_id_idx" ON "communication_recipients" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "comm_recipients_status_idx" ON "communication_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "communications_church_id_idx" ON "communications" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "communications_status_idx" ON "communications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "communications_meeting_id_idx" ON "communications" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "communications_created_by_idx" ON "communications" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "meeting_confirm_tokens_token_idx" ON "meeting_confirmation_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "meeting_confirm_tokens_meeting_id_idx" ON "meeting_confirmation_tokens" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_confirm_tokens_person_id_idx" ON "meeting_confirmation_tokens" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "message_templates_church_id_idx" ON "message_templates" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "message_templates_category_idx" ON "message_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "message_templates_is_system_idx" ON "message_templates" USING btree ("is_system");
