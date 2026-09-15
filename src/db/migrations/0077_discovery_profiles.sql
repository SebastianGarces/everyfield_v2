-- #294. Root-reserved discovery migration 0077 after immutable wiki75 and leadership76.
-- Journal timestamp: 1789106379915. Shared application remains held by root.
-- Explicit down: scripts/proofs/discovery-profile-0077.down.sql.
-- Down discards discovery-only state; preserves prior tenancy, wiki and leadership.
-- Full history/replay/down proof: scripts/proofs/discovery-profile-migration-294.sh.

CREATE TABLE "discovery_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sending_church_id" uuid,
	"sending_network_id" uuid
);
--> statement-breakpoint
ALTER TABLE "association_events" DROP CONSTRAINT "association_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "association_events" DROP CONSTRAINT "association_events_subject_check";--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "target_user_id" uuid;--> statement-breakpoint
ALTER TABLE "association_events" ADD COLUMN "discovery_user_id" uuid;--> statement-breakpoint
ALTER TABLE "discovery_profiles" ADD CONSTRAINT "discovery_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_profiles" ADD CONSTRAINT "discovery_profiles_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_profiles" ADD CONSTRAINT "discovery_profiles_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_discovery_user_id_users_id_fk" FOREIGN KEY ("discovery_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invitations_target_user_id_idx" ON "organization_invitations" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "association_events_discovery_user_idx" ON "association_events" USING btree ("discovery_user_id","created_at");--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_type_check" CHECK ("association_events"."subject_type" in ('church', 'sending_church', 'discovery'));--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_check" CHECK ((
        ("association_events"."subject_type" = 'church'
          and "association_events"."church_id" is not null
          and "association_events"."subject_sending_church_id" is null
          and "association_events"."discovery_user_id" is null)
        or
        ("association_events"."subject_type" = 'sending_church'
          and "association_events"."subject_sending_church_id" is not null
          and "association_events"."church_id" is null
          and "association_events"."discovery_user_id" is null)
        or ("association_events"."subject_type" = 'discovery'
          and "association_events"."discovery_user_id" is not null
          and "association_events"."church_id" is null
          and "association_events"."subject_sending_church_id" is null)
      ));
