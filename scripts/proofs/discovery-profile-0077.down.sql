-- Explicit scratch/operator rollback of 0077. Roll back discovery application code first.
-- Discovery-only profiles, invitations and audit subjects have no representation at 0076.
-- Discard those new records; preserve all earlier subjects, tenancy, wiki and leadership data.
BEGIN;
DELETE FROM "association_events" WHERE "subject_type" = 'discovery';
DELETE FROM "organization_invitations" WHERE "target_user_id" IS NOT NULL OR "type" IN ('discovery_to_sending_church', 'discovery_to_network');
ALTER TABLE "association_events" DROP CONSTRAINT "association_events_subject_check";
ALTER TABLE "association_events" DROP CONSTRAINT "association_events_subject_type_check";
ALTER TABLE "association_events" DROP COLUMN "discovery_user_id";
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_type_check" CHECK ("subject_type" IN ('church', 'sending_church'));
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_subject_check" CHECK (
  ("subject_type" = 'church' AND "church_id" IS NOT NULL AND "subject_sending_church_id" IS NULL)
  OR ("subject_type" = 'sending_church' AND "subject_sending_church_id" IS NOT NULL AND "church_id" IS NULL)
);
ALTER TABLE "organization_invitations" DROP COLUMN "target_user_id";
DROP TABLE "discovery_profiles";
COMMIT;
