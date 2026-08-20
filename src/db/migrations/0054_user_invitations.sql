-- #495 / AS-010 + AS-011 — `user_invitations`, the ONE table for both
-- invitations INTO an account: a plant or org SEAT, and a COACH assignment.
--
-- WHAT IT SETTLES. `organization_invitations` binds one ORG to another and
-- never creates an account. Nothing in the product could invite a PERSON, so a
-- plant's Owner had no way to give anybody else a login on their own plant. This
-- table is that row: an address, exactly one inviting tenancy, a hashed token,
-- a status, an expiry — and, for a seat invitation, the seat it grants.
--
-- ADDITIVE ONLY. One new table, five FKs, six indexes, four CHECKs. No existing
-- table, column, index or constraint is touched, so there is nothing to back
-- fill and no lock on anything already in use.
--
-- THE FOUR CHECKS, and why each is in the database rather than in a comment:
--
--   * `user_invitations_tenancy_check` — EXACTLY ONE of `church_id`,
--     `sending_church_id`, `sending_network_id`. The `association_events` 0036
--     precedent: a row naming two tenancies is a row two organizations can both
--     claim, and tenant isolation here is application-layer with no RLS behind
--     it (`memory/invariants.md` → Multi-Tenancy). `num_nonnulls(...) = 1` is
--     the whole rule in one expression, and it is NULL-safe by construction —
--     `num_nonnulls` counts nulls, it never returns one.
--   * `user_invitations_seat_check` — `kind = 'seat'` ⟺ `seat IS NOT NULL`, and
--     the seat is `admin` or `member`. A seat invitation granting no seat is
--     unanswerable; a coach invitation carrying one would grant a seat outside
--     the two places AS-012 allows (registration, and seat management). `owner`
--     is absent on purpose — the Owner seat is created with the tenancy.
--   * `user_invitations_kind_check` / `user_invitations_status_check` — the two
--     vocabularies, in the DATA. `.$type<>()` on a varchar is a compile-time
--     brand and nothing else, the same reasoning `users_seat_check` records.
--
-- WHY THE SEAT CHECK IS A BICONDITIONAL AND NOT TWO ARMS. `NULL` PASSES A
-- CHECK. The obvious spelling of the ⟺ —
--
--     (kind = 'seat' and seat in ('admin','member'))
--       or (kind = 'coach' and seat is null)
--
-- — admits exactly the row it is named after. For `kind = 'seat', seat = NULL`
-- the first arm is `true and NULL` = `NULL`, the second is `false`, and
-- `NULL or false` is `NULL`; a CHECK rejects only `false`, so an `UNKNOWN`
-- result is ACCEPTED (SQL:2011 §11.9). That spelling was written, reviewed and
-- read as correct, and a scratch Postgres answered `INSERT 0 1`.
-- `(kind = 'seat') = (seat is not null)` compares two non-null booleans, so it
-- is two-valued whatever the columns hold, and the vocabulary rides alongside
-- guarded by `seat is null or …` so it says nothing when there is no seat.
--
-- THE TOKEN IS NEVER STORED. `token_hash` is sha256 (hex, 64 chars) of the token
-- the invitation email carried, so a database read hands nobody a working invite
-- link. `user_invitations_token_hash_unique_idx` is what makes the registration
-- lookup a point read and what stops two rows carrying one token.
--
-- ROLLBACK (one statement, and it loses only rows this migration made possible):
--
--   DROP TABLE IF EXISTS "user_invitations";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787257458645;
--
-- THE LEDGER ROW IS IDENTIFIED BY `created_at`, NOT BY A FILE HASH — the same
-- correction 0036's header records. `drizzle.__drizzle_migrations.hash` is
-- drizzle's digest of the statements it executed, so the shasum of this file
-- matches nothing and the DELETE would report `DELETE 0`, after which
-- `pnpm db:migrate` prints success and applies nothing. The literal above is
-- this migration's `"when"` in `_journal.json`, which IS the ledger's
-- `created_at`.
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- The journal is the repository's list of migrations; the ledger is the
-- database's record of what ran. Only the ledger row is deleted.
--
-- THE SILENT-SKIP HAZARD (0036's, restated because it is still live).
-- `drizzle-kit migrate` compares each journal entry's `when` against the MAXIMUM
-- `created_at` already in the ledger, never against that migration's own row. A
-- `when` lower than a sibling that reached the database first is skipped in
-- SILENCE — success printed, exit 0, nothing applied. This file's `when`,
-- 1787257458645, is strictly greater than every entry on `main` at the time it
-- was cut (0053 is 1787227890551). A sibling migration merging after this one
-- must be re-stamped ABOVE it. Prove an apply from `information_schema.tables`,
-- never from the CLI's exit status.

CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"invitee_email" varchar(255) NOT NULL,
	"church_id" uuid,
	"sending_church_id" uuid,
	"sending_network_id" uuid,
	"seat" varchar(20),
	"token_hash" varchar(64) NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"responded_by" uuid,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "user_invitations_kind_check" CHECK ("user_invitations"."kind" in ('seat', 'coach')),
	CONSTRAINT "user_invitations_status_check" CHECK ("user_invitations"."status" in ('pending', 'accepted', 'expired', 'revoked')),
	CONSTRAINT "user_invitations_tenancy_check" CHECK (num_nonnulls("user_invitations"."church_id", "user_invitations"."sending_church_id", "user_invitations"."sending_network_id") = 1),
	CONSTRAINT "user_invitations_seat_check" CHECK (("user_invitations"."kind" = 'seat') = ("user_invitations"."seat" is not null) and ("user_invitations"."seat" is null or "user_invitations"."seat" in ('admin', 'member')))
);
--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_sending_church_id_sending_churches_id_fk" FOREIGN KEY ("sending_church_id") REFERENCES "public"."sending_churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_sending_network_id_sending_networks_id_fk" FOREIGN KEY ("sending_network_id") REFERENCES "public"."sending_networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitations_token_hash_unique_idx" ON "user_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_invitations_church_idx" ON "user_invitations" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "user_invitations_sending_church_idx" ON "user_invitations" USING btree ("sending_church_id","status");--> statement-breakpoint
CREATE INDEX "user_invitations_sending_network_idx" ON "user_invitations" USING btree ("sending_network_id","status");--> statement-breakpoint
CREATE INDEX "user_invitations_invitee_email_idx" ON "user_invitations" USING btree ("invitee_email");
