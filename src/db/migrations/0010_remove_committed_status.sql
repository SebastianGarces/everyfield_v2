-- Remove the 'committed' pipeline status.
-- Commitment recording now advances people directly to 'core_group'.
-- The 'committed' status was an unnecessary intermediate step between
-- 'interviewed' and 'core_group' that didn't match the Launch Playbook funnel.

-- Update any persons with status 'committed' to 'core_group'
UPDATE "persons" SET "status" = 'core_group', "updated_at" = NOW()
  WHERE "status" = 'committed';

-- Historical activity metadata is left as-is for audit trail.
-- The display code already handles unknown statuses gracefully via fallback.
