-- ============================================================================
-- Migration 0013: Schema Hardening
-- Addresses code review findings: adds missing church_id to recipients,
-- self-referential FKs for team hierarchy, source_template FK,
-- and tenant-scoped indexes on hierarchy columns.
-- ============================================================================

-- 1. Add church_id to communication_recipients (tenant isolation)
ALTER TABLE "communication_recipients" ADD COLUMN "church_id" uuid;--> statement-breakpoint
-- Backfill church_id from the parent communication
UPDATE "communication_recipients" cr
  SET "church_id" = c."church_id"
  FROM "communications" c
  WHERE cr."communication_id" = c."id";--> statement-breakpoint
-- Make NOT NULL after backfill
ALTER TABLE "communication_recipients" ALTER COLUMN "church_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comm_recipients_church_id_idx" ON "communication_recipients" USING btree ("church_id");--> statement-breakpoint

-- 2. Self-referential FK for ministry_teams.reports_to_team_id
ALTER TABLE "ministry_teams" ADD CONSTRAINT "ministry_teams_reports_to_team_id_ministry_teams_id_fk" FOREIGN KEY ("reports_to_team_id") REFERENCES "public"."ministry_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 3. Self-referential FK for team_roles.reports_to_role_id
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_reports_to_role_id_team_roles_id_fk" FOREIGN KEY ("reports_to_role_id") REFERENCES "public"."team_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 4. FK for message_templates.source_template_id
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_source_template_id_message_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 5. Indexes on hierarchy FK columns for efficient tenant-scoped queries
CREATE INDEX "churches_sending_church_id_idx" ON "churches" USING btree ("sending_church_id");--> statement-breakpoint
CREATE INDEX "churches_sending_network_id_idx" ON "churches" USING btree ("sending_network_id");--> statement-breakpoint
CREATE INDEX "users_sending_church_id_idx" ON "users" USING btree ("sending_church_id");--> statement-breakpoint
CREATE INDEX "users_sending_network_id_idx" ON "users" USING btree ("sending_network_id");
