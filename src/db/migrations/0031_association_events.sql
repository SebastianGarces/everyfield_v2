-- OV-008 — `association_events`, the append-only audit of a plant's oversight
-- association (issue #303, FRD `product-docs/features/oversight/frd.md`).
--
-- EXPAND-ONLY. One new table, three new FK constraints on it, two new indexes on
-- it. No existing table is read, rewritten, or altered — the FKs point OUT of
-- this table at `churches`, `users` and `organization_invitations`, which take a
-- catalog entry and no row rewrite. Nothing in the application references the
-- table yet (the accept and sever writes land with #277/#278), so deploying this
-- ahead of the code is a no-op for every running request.
--
-- WHY THE ENUMS ARE CHECKS. `.$type<>()` on a varchar is a compile-time brand and
-- nothing else — the same finding migration 0024 acted on for the notification
-- tables. `org_type` and `event` are closed sets, so they are closed in the data.
--
-- WHY `org_id` HAS NO FK. It points at `sending_churches` OR `sending_networks`
-- depending on `org_type`, and Postgres has no polymorphic foreign key. An audit
-- row must also outlive its referent. See `src/db/schema/association-event.ts`.
--
-- ROLLBACK (HR2). The table is new and nothing references it — no other table has
-- an FK INTO it and no shipped code path reads or writes it — so the down path is
-- one statement and loses nothing but this table's own rows. Run both statements
-- in ONE psql session:
--
--   DROP TABLE IF EXISTS "association_events";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0031 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023/0024: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of what
-- ran, and only the ledger row is deleted. Removing the journal entry instead
-- makes drizzle-kit forget the migration while the ledger still claims it
-- applied, which is unrecoverable by restoring the entry.
--
-- `<0031 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0031_association_events.sql
--
-- or identify the row by its `_journal.json` "when":
--
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1785946522697;

CREATE TABLE "association_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"org_type" varchar(20) NOT NULL,
	"org_id" uuid NOT NULL,
	"event" varchar(20) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"source_invitation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "association_events_org_type_check" CHECK ("association_events"."org_type" in ('sending_church', 'network')),
	CONSTRAINT "association_events_event_check" CHECK ("association_events"."event" in ('associated', 'disassociated'))
);
--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_source_invitation_id_organization_invitations_id_fk" FOREIGN KEY ("source_invitation_id") REFERENCES "public"."organization_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "association_events_church_id_created_at_idx" ON "association_events" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "association_events_org_idx" ON "association_events" USING btree ("org_type","org_id");