-- ============================================================================
-- Migration 0019: Attendance Type Backfill (task A7)
-- Derives meeting_attendance.attendance_type for existing rows that have
-- status='attended' but attendance_type IS NULL, so the analytics layer
-- (src/lib/meetings/analytics.ts new-vs-returning breakdowns) has data.
--
-- Idempotent: only ever sets rows where attendance_type IS NULL. Never
-- overwrites a non-null value, so re-running is a no-op.
-- ============================================================================

-- Rule (a): If the person's CURRENT status is core_group / launch_team / leader,
-- classify their attended rows as 'core_group'.
-- NOTE: This is an approximation. We only have the person's CURRENT status, not
-- their historical status at the time of each meeting. Treating current
-- core-group-or-beyond people as 'core_group' attendees is the best available
-- proxy for their historical membership.
UPDATE "meeting_attendance" AS ma
SET "attendance_type" = 'core_group'
FROM "persons" AS p
WHERE ma."person_id" = p."id"
  AND ma."status" = 'attended'
  AND ma."attendance_type" IS NULL
  AND p."status" IN ('core_group', 'launch_team', 'leader');
--> statement-breakpoint

-- Rule (b): For the remaining attended rows still lacking a type, rank each
-- person's attended rows by meeting date. The earliest attended meeting is
-- 'first_time'; every later one is 'returning'.
WITH ranked AS (
  SELECT
    ma."id" AS attendance_id,
    ROW_NUMBER() OVER (
      PARTITION BY ma."person_id"
      ORDER BY cm."datetime" ASC, ma."created_at" ASC, ma."id" ASC
    ) AS rn
  FROM "meeting_attendance" AS ma
  JOIN "church_meetings" AS cm ON cm."id" = ma."meeting_id"
  WHERE ma."status" = 'attended'
    AND ma."attendance_type" IS NULL
)
UPDATE "meeting_attendance" AS ma
SET "attendance_type" = CASE WHEN ranked.rn = 1 THEN 'first_time' ELSE 'returning' END
FROM ranked
WHERE ma."id" = ranked.attendance_id;
