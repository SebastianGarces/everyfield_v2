-- Typed outputs belong to their successful immutable step claim. A consumer
-- receives them only through an exact direct dependency and effect key.
--
-- ROLLBACK (isolated database only):
--   ALTER TABLE "evry_execution_outcomes" DROP COLUMN "dependency_output";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788109077100;

ALTER TABLE "evry_execution_outcomes" ADD COLUMN "dependency_output" jsonb;
