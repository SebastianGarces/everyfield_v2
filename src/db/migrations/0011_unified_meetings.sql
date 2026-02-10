-- ============================================================================
-- Migration 0011: Unified Meetings
-- Consolidates vision_meetings + team_meetings into church_meetings
-- Consolidates vision_meeting_attendance + team_meeting_attendances into meeting_attendance
-- ============================================================================

-- Step 1: Rename privacy column
ALTER TABLE "church_privacy_settings"
  RENAME COLUMN "share_vision_meetings" TO "share_meetings";

-- Step 2: Create unified church_meetings table
CREATE TABLE IF NOT EXISTS "church_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "church_id" uuid NOT NULL REFERENCES "churches"("id"),
  "type" varchar(20) NOT NULL,
  "title" varchar(255),
  "datetime" timestamp NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'planning',
  "location_id" uuid REFERENCES "locations"("id"),
  "location_name" varchar(255),
  "location_address" varchar(500),
  "meeting_number" integer,
  "team_id" uuid REFERENCES "ministry_teams"("id"),
  "meeting_subtype" varchar(20),
  "estimated_attendance" integer,
  "actual_attendance" integer,
  "duration_minutes" integer,
  "notes" text,
  "agenda" jsonb,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Step 3: Migrate vision_meetings into church_meetings
INSERT INTO "church_meetings" (
  "id", "church_id", "type", "title", "datetime", "status",
  "location_id", "location_name", "location_address",
  "meeting_number", "estimated_attendance", "actual_attendance",
  "notes", "agenda", "created_by", "created_at", "updated_at"
)
SELECT
  "id", "church_id", 'vision_meeting',
  'Vision Meeting #' || "meeting_number",
  "datetime", "status",
  "location_id", "location_name", "location_address",
  "meeting_number", "estimated_attendance", "actual_attendance",
  "notes", "agenda", "created_by", "created_at", "updated_at"
FROM "vision_meetings";

-- Step 4: Migrate team_meetings into church_meetings
INSERT INTO "church_meetings" (
  "id", "church_id", "type", "title", "datetime", "status",
  "team_id", "meeting_subtype", "duration_minutes",
  "location_name", "notes", "agenda",
  "created_by", "created_at", "updated_at"
)
SELECT
  "id", "church_id", 'team_meeting',
  "title", "datetime", 'completed',
  "team_id", "meeting_type", "duration_minutes",
  "location", "notes", to_jsonb("agenda"),
  "created_by", "created_at", "updated_at"
FROM "team_meetings";

-- Step 5: Create indexes on church_meetings
CREATE INDEX "church_meetings_church_id_idx" ON "church_meetings" ("church_id");
CREATE INDEX "church_meetings_type_idx" ON "church_meetings" ("type");
CREATE INDEX "church_meetings_status_idx" ON "church_meetings" ("status");
CREATE INDEX "church_meetings_team_id_idx" ON "church_meetings" ("team_id");
CREATE UNIQUE INDEX "church_meetings_church_meeting_number" ON "church_meetings" ("church_id", "meeting_number");

-- Step 6: Create unified meeting_attendance table
CREATE TABLE IF NOT EXISTS "meeting_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "church_id" uuid NOT NULL REFERENCES "churches"("id"),
  "meeting_id" uuid NOT NULL REFERENCES "church_meetings"("id") ON DELETE CASCADE,
  "person_id" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
  "attendance_type" varchar(50),
  "status" varchar(10) NOT NULL DEFAULT 'attended',
  "invited_by_id" uuid REFERENCES "persons"("id"),
  "response_status" varchar(50),
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Step 7: Migrate vision_meeting_attendance
INSERT INTO "meeting_attendance" (
  "id", "church_id", "meeting_id", "person_id",
  "attendance_type", "status", "invited_by_id", "response_status",
  "notes", "created_at", "updated_at"
)
SELECT
  "id", "church_id", "meeting_id", "person_id",
  "attendance_type", 'attended', "invited_by_id", "response_status",
  "notes", "created_at", "updated_at"
FROM "vision_meeting_attendance";

-- Step 8: Migrate team_meeting_attendances
INSERT INTO "meeting_attendance" (
  "id", "church_id", "meeting_id", "person_id",
  "status", "created_by", "created_at", "updated_at"
)
SELECT
  "id", "church_id", "meeting_id", "person_id",
  "status", "created_by", "created_at", "updated_at"
FROM "team_meeting_attendances";

-- Step 9: Create indexes on meeting_attendance
CREATE UNIQUE INDEX "meeting_attendance_meeting_person_unique" ON "meeting_attendance" ("meeting_id", "person_id");
CREATE INDEX "meeting_attendance_meeting_id_idx" ON "meeting_attendance" ("meeting_id");
CREATE INDEX "meeting_attendance_person_id_idx" ON "meeting_attendance" ("person_id");

-- Step 10: Update FK references on extension tables
-- meeting_evaluations: drop old FK, add new
ALTER TABLE "meeting_evaluations" DROP CONSTRAINT IF EXISTS "meeting_evaluations_meeting_id_vision_meetings_id_fk";
ALTER TABLE "meeting_evaluations"
  ADD CONSTRAINT "meeting_evaluations_meeting_id_church_meetings_id_fk"
  FOREIGN KEY ("meeting_id") REFERENCES "church_meetings"("id") ON DELETE CASCADE;

-- meeting_checklist_items: drop old FK, add new
ALTER TABLE "meeting_checklist_items" DROP CONSTRAINT IF EXISTS "meeting_checklist_items_meeting_id_vision_meetings_id_fk";
ALTER TABLE "meeting_checklist_items"
  ADD CONSTRAINT "meeting_checklist_items_meeting_id_church_meetings_id_fk"
  FOREIGN KEY ("meeting_id") REFERENCES "church_meetings"("id") ON DELETE CASCADE;

-- invitations: drop old FK, add new
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_meeting_id_vision_meetings_id_fk";
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_meeting_id_church_meetings_id_fk"
  FOREIGN KEY ("meeting_id") REFERENCES "church_meetings"("id") ON DELETE CASCADE;

-- Step 11: Drop old tables (order matters for FK dependencies)
DROP TABLE IF EXISTS "vision_meeting_attendance" CASCADE;
DROP TABLE IF EXISTS "team_meeting_attendances" CASCADE;
DROP TABLE IF EXISTS "vision_meetings" CASCADE;
DROP TABLE IF EXISTS "team_meetings" CASCADE;
