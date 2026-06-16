CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"ip" text,
	"kind" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_memberships" DROP CONSTRAINT "team_memberships_active_unique";--> statement-breakpoint
CREATE INDEX "auth_attempts_identifier_kind_created_at_idx" ON "auth_attempts" USING btree ("identifier","kind","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_ip_kind_created_at_idx" ON "auth_attempts" USING btree ("ip","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_active_unique" ON "team_memberships" USING btree ("team_id","person_id","role_id") WHERE status = 'active';