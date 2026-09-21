-- #830. Root-reserved migration 0076, generated after reviewed 0075.
-- Migration timestamp: 1789105504370.
-- Shared application remains held by the coordinating task.
-- A historical leader's origin is unknown even when a matching role exists.
-- Preserve every existing leader_id and classify nonnull history as legacy.
-- No FK on leader_role_id: it is a provenance token, not a cascading authority.
--
-- Down path: scripts/proofs/team-leader-provenance-0076.down.sql.
-- Roll back dependent application code before dropping provenance columns.
-- Down preserves leader_id and all earlier schema/data, but discards provenance.
-- The scratch proof leaves the ledger intact and discards its database after down.
-- A shared rollback and any ledger reconciliation require separate authorization.

ALTER TABLE "ministry_teams" ADD COLUMN "leader_source" varchar(10);--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD COLUMN "leader_role_id" uuid;--> statement-breakpoint
UPDATE "ministry_teams"
SET "leader_source" = 'legacy'
WHERE "leader_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ministry_teams" ADD CONSTRAINT "ministry_teams_leader_provenance_check" CHECK ((
        ("ministry_teams"."leader_id" is null and "ministry_teams"."leader_source" is null and "ministry_teams"."leader_role_id" is null)
        or ("ministry_teams"."leader_id" is not null and "ministry_teams"."leader_source" is not null and (
          ("ministry_teams"."leader_source" in ('explicit', 'legacy') and "ministry_teams"."leader_role_id" is null)
          or ("ministry_teams"."leader_source" = 'role' and "ministry_teams"."leader_role_id" is not null)
        ))
      ));
