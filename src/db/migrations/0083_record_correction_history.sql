CREATE TABLE "record_corrections" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "church_id" uuid NOT NULL REFERENCES "churches"("id"),
 "entity_type" text NOT NULL,
 "entity_id" uuid NOT NULL,
 "before" jsonb NOT NULL,
 "after" jsonb NOT NULL,
 "corrected_by" uuid NOT NULL REFERENCES "users"("id"),
 "corrected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "record_corrections_record_idx" ON "record_corrections" ("church_id", "entity_type", "entity_id");
