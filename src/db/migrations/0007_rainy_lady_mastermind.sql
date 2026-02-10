CREATE TABLE "sending_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_churches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"sending_network_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_user_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	CONSTRAINT "coach_assignments_coach_church_unique" UNIQUE("coach_user_id","church_id")
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(40) NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"target_church_id" uuid,
	"target_sending_church_id" uuid,
	"sending_church_id" uuid,
	"sending_network_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"responded_by" uuid,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "church_privacy_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"share_people" boolean DEFAULT false NOT NULL,
	"share_vision_meetings" boolean DEFAULT false NOT NULL,
	"share_tasks" boolean DEFAULT false NOT NULL,
	"share_financials" boolean DEFAULT false NOT NULL,
	"share_ministry_teams" boolean DEFAULT false NOT NULL,
	"share_facilities" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "church_privacy_settings_church_id_unique" UNIQUE("church_id")
);
--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "sending_church_id" uuid;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "sending_network_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sending_church_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sending_network_id" uuid;--> statement-breakpoint
ALTER TABLE "sending_churches" ADD CONSTRAINT "sending_churches_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_target_church_id_churches_id_fk" FOREIGN KEY ("target_church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_target_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("target_sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_privacy_settings" ADD CONSTRAINT "church_privacy_settings_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_privacy_settings" ADD CONSTRAINT "church_privacy_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_assignments_coach_user_id_idx" ON "coach_assignments" USING btree ("coach_user_id");--> statement-breakpoint
CREATE INDEX "coach_assignments_church_id_idx" ON "coach_assignments" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "org_invitations_target_church_id_idx" ON "organization_invitations" USING btree ("target_church_id");--> statement-breakpoint
CREATE INDEX "org_invitations_target_sending_church_id_idx" ON "organization_invitations" USING btree ("target_sending_church_id");--> statement-breakpoint
CREATE INDEX "org_invitations_status_idx" ON "organization_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_invitations_inviter_user_id_idx" ON "organization_invitations" USING btree ("inviter_user_id");--> statement-breakpoint
ALTER TABLE "churches" ADD CONSTRAINT "churches_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churches" ADD CONSTRAINT "churches_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;