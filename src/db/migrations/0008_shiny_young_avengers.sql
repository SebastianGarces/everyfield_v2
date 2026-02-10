CREATE TABLE "ministry_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) DEFAULT 'predefined' NOT NULL,
	"description" text,
	"icon" varchar(50),
	"leader_id" uuid,
	"reports_to_team_id" uuid,
	"phase_introduced" varchar(10) DEFAULT 'phase_2' NOT NULL,
	"status" varchar(20) DEFAULT 'forming' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_meeting_attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'attended' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_meeting_attendances_unique" UNIQUE("meeting_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "team_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"meeting_type" varchar(20) DEFAULT 'regular' NOT NULL,
	"datetime" timestamp NOT NULL,
	"duration_minutes" integer,
	"location" varchar(500),
	"agenda" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_active_unique" UNIQUE("team_id","person_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"reports_to_role_id" uuid,
	"is_leadership_role" boolean DEFAULT false NOT NULL,
	"time_commitment" varchar(10),
	"desired_skills" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"training_program_id" uuid NOT NULL,
	"completed_at" timestamp NOT NULL,
	"verified_by" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_completions_unique" UNIQUE("person_id","training_program_id")
);
--> statement-breakpoint
CREATE TABLE "training_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"team_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD CONSTRAINT "ministry_teams_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD CONSTRAINT "ministry_teams_leader_id_persons_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD CONSTRAINT "ministry_teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meeting_attendances" ADD CONSTRAINT "team_meeting_attendances_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meeting_attendances" ADD CONSTRAINT "team_meeting_attendances_meeting_id_team_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."team_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meeting_attendances" ADD CONSTRAINT "team_meeting_attendances_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meeting_attendances" ADD CONSTRAINT "team_meeting_attendances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meetings" ADD CONSTRAINT "team_meetings_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meetings" ADD CONSTRAINT "team_meetings_team_id_ministry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meetings" ADD CONSTRAINT "team_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_ministry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_role_id_team_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."team_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_team_id_ministry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_training_program_id_training_programs_id_fk" FOREIGN KEY ("training_program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_team_id_ministry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ministry_teams_church_id_idx" ON "ministry_teams" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "ministry_teams_leader_id_idx" ON "ministry_teams" USING btree ("leader_id");--> statement-breakpoint
CREATE INDEX "team_meeting_attendances_church_id_idx" ON "team_meeting_attendances" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "team_meeting_attendances_meeting_id_idx" ON "team_meeting_attendances" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "team_meetings_church_id_idx" ON "team_meetings" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "team_meetings_team_id_idx" ON "team_meetings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_meetings_datetime_idx" ON "team_meetings" USING btree ("datetime");--> statement-breakpoint
CREATE INDEX "team_memberships_church_id_idx" ON "team_memberships" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_memberships_person_id_idx" ON "team_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "team_memberships_role_id_idx" ON "team_memberships" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "team_roles_church_id_idx" ON "team_roles" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "team_roles_team_id_idx" ON "team_roles" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "training_completions_church_id_idx" ON "training_completions" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "training_completions_person_id_idx" ON "training_completions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "training_completions_program_id_idx" ON "training_completions" USING btree ("training_program_id");--> statement-breakpoint
CREATE INDEX "training_programs_church_id_idx" ON "training_programs" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "training_programs_team_id_idx" ON "training_programs" USING btree ("team_id");