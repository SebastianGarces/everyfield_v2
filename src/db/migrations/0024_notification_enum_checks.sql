-- F11 / N-CORE — enum CHECK constraints on the notification tables (issue #130).
--
-- `.$type<>()` on a varchar is a compile-time brand and nothing else. These
-- constraints move the enum into the data, so a value that never passed a Zod
-- parse is rejected by Postgres instead of sitting in the table forever,
-- invisible to the code-defined lookups that are supposed to consult it.
--
-- Additive and non-rewriting: every constraint is validated against existing
-- rows, and F11 tables were created empty by 0023, so validation is a no-op
-- scan. Nothing outside the three notification tables is touched.
--
-- ROLLBACK — run every statement, then the ledger delete, in ONE psql session:
--
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_status_check";
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_category_check";
--   ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_digest_cadence_check";
--   ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_channel_check";
--   ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_category_check";
--   ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_status_check";
--   ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_channel_check";
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0024 hash>';
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023: the journal is the repository's list of migrations,
-- the `drizzle.__drizzle_migrations` ledger is the database's record of what
-- ran, and only the ledger row is deleted. Removing the journal entry instead
-- makes drizzle-kit forget the migration while the ledger still claims it
-- applied, which is unrecoverable by restoring the entry.
--
-- `<0024 hash>` is the sha256 of THIS FILE, byte for byte, from the deployed
-- commit:
--
--   shasum -a 256 src/db/migrations/0024_notification_enum_checks.sql
--
-- or identify the row by its `_journal.json` "when":
--
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1785172723135;

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" in ('email', 'in_app'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('queued', 'sent', 'failed', 'suppressed_by_preference', 'cancelled'));--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_category_check" CHECK ("notification_preferences"."category" in ('tasks', 'meetings', 'communication', 'teams', 'phase', 'digest'));--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_channel_check" CHECK ("notification_preferences"."channel" in ('email', 'in_app'));--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_digest_cadence_check" CHECK ("notification_preferences"."digest_cadence" is null or "notification_preferences"."digest_cadence" in ('daily', 'weekly'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_category_check" CHECK ("notifications"."category" in ('tasks', 'meetings', 'communication', 'teams', 'phase', 'digest'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('pending', 'claimed', 'delivered', 'cancelled', 'failed'));