CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_name" varchar(255),
	"invitee_id" uuid,
	"status" varchar(50) DEFAULT 'invited' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" varchar(500) NOT NULL,
	"contact_name" varchar(255),
	"contact_phone" varchar(50),
	"contact_email" varchar(255),
	"cost" varchar(50),
	"capacity" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"assigned_to" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"attendance_score" integer NOT NULL,
	"location_score" integer NOT NULL,
	"logistics_score" integer NOT NULL,
	"agenda_score" integer NOT NULL,
	"vibe_score" integer NOT NULL,
	"message_score" integer NOT NULL,
	"close_score" integer NOT NULL,
	"next_steps_score" integer NOT NULL,
	"total_score" varchar(10) NOT NULL,
	"notes" text,
	"evaluated_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_meeting_unique" UNIQUE("meeting_id")
);
--> statement-breakpoint
CREATE TABLE "vision_meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"attendance_type" varchar(50) NOT NULL,
	"invited_by_id" uuid,
	"response_status" varchar(50),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_meeting_person_unique" UNIQUE("meeting_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "vision_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_number" integer NOT NULL,
	"datetime" timestamp NOT NULL,
	"location_id" uuid,
	"location_name" varchar(255),
	"location_address" varchar(500),
	"estimated_attendance" integer,
	"actual_attendance" integer,
	"status" varchar(50) DEFAULT 'planning' NOT NULL,
	"notes" text,
	"agenda" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vision_meetings_church_meeting_number" UNIQUE("church_id","meeting_number")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_meeting_id_vision_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."vision_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_persons_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitee_id_persons_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_checklist_items" ADD CONSTRAINT "meeting_checklist_items_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_checklist_items" ADD CONSTRAINT "meeting_checklist_items_meeting_id_vision_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."vision_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_checklist_items" ADD CONSTRAINT "meeting_checklist_items_assigned_to_persons_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_evaluations" ADD CONSTRAINT "meeting_evaluations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_evaluations" ADD CONSTRAINT "meeting_evaluations_meeting_id_vision_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."vision_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_evaluations" ADD CONSTRAINT "meeting_evaluations_evaluated_by_users_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meeting_attendance" ADD CONSTRAINT "vision_meeting_attendance_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meeting_attendance" ADD CONSTRAINT "vision_meeting_attendance_meeting_id_vision_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."vision_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meeting_attendance" ADD CONSTRAINT "vision_meeting_attendance_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meeting_attendance" ADD CONSTRAINT "vision_meeting_attendance_invited_by_id_persons_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meetings" ADD CONSTRAINT "vision_meetings_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meetings" ADD CONSTRAINT "vision_meetings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_meetings" ADD CONSTRAINT "vision_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_meeting_id_idx" ON "invitations" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "locations_church_id_idx" ON "locations" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "meeting_checklist_items_meeting_id_idx" ON "meeting_checklist_items" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "vision_meeting_attendance_meeting_id_idx" ON "vision_meeting_attendance" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "vision_meeting_attendance_person_id_idx" ON "vision_meeting_attendance" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "vision_meetings_church_id_idx" ON "vision_meetings" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "vision_meetings_status_idx" ON "vision_meetings" USING btree ("status");