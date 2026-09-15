-- Explicit 0076 rollback. Discards provenance, preserves leader_id.
ALTER TABLE "ministry_teams" DROP CONSTRAINT "ministry_teams_leader_provenance_check";
ALTER TABLE "ministry_teams" DROP COLUMN "leader_role_id";
ALTER TABLE "ministry_teams" DROP COLUMN "leader_source";
