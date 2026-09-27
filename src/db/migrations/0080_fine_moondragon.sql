CREATE TABLE "person_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"church_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"survivor_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"survivor_before" jsonb NOT NULL,
	"choices" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_merges_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "person_merges_distinct_check" CHECK ("person_merges"."source_id" <> "person_merges"."survivor_id")
);
--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_source_id_persons_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_survivor_id_persons_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_merges_church_idx" ON "person_merges" USING btree ("church_id");--> statement-breakpoint
-- A foreign key alone accepts a tombstoned UUID after waiting for the merge's
-- FOR UPDATE lock. Lock first, then check the receipt in a fresh snapshot.
CREATE FUNCTION guard_merged_person_reference() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE reference_ids uuid[];
BEGIN
  IF TG_TABLE_NAME = 'tasks' AND (to_jsonb(NEW)->>'related_type') IS DISTINCT FROM 'person' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'notifications' AND (to_jsonb(NEW)->>'entity_type') IS DISTINCT FROM 'person' THEN RETURN NEW; END IF;
  SELECT array_agg(id ORDER BY id) INTO reference_ids FROM (
    SELECT DISTINCT (to_jsonb(NEW)->>column_name)::uuid AS id
    FROM unnest(TG_ARGV) column_name
    WHERE to_jsonb(NEW)->>column_name IS NOT NULL
  ) refs;
  IF reference_ids IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM persons WHERE id = ANY(reference_ids) ORDER BY id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM person_merges WHERE source_id = ANY(reference_ids)) THEN
    RAISE EXCEPTION 'Person was merged; refresh before saving' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_merged_person_update() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM person_merges WHERE source_id=OLD.id) THEN
    RAISE EXCEPTION 'Person was merged; refresh before saving' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER persons_merged_update_guard BEFORE UPDATE ON persons
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_update();

--> statement-breakpoint
CREATE TRIGGER person_tags_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON person_tags
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER assessments_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON assessments
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER interviews_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON interviews
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER commitments_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON commitments
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER skills_inventory_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON skills_inventory
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER person_activities_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON person_activities
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER meeting_attendance_merged_person_guard BEFORE INSERT OR UPDATE OF person_id, invited_by_id ON meeting_attendance
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id','invited_by_id');

--> statement-breakpoint
CREATE TRIGGER meeting_responses_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON meeting_responses
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER invitations_merged_person_guard BEFORE INSERT OR UPDATE OF inviter_id, invitee_id ON invitations
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('inviter_id','invitee_id');

--> statement-breakpoint
CREATE TRIGGER meeting_checklist_items_merged_person_guard BEFORE INSERT OR UPDATE OF assigned_to ON meeting_checklist_items
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('assigned_to');

--> statement-breakpoint
CREATE TRIGGER team_memberships_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON team_memberships
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER ministry_teams_merged_person_guard BEFORE INSERT OR UPDATE OF leader_id ON ministry_teams
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('leader_id');

--> statement-breakpoint
CREATE TRIGGER training_completions_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON training_completions
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER communication_recipients_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON communication_recipients
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER meeting_confirmation_tokens_merged_person_guard BEFORE INSERT OR UPDATE OF person_id ON meeting_confirmation_tokens
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('person_id');

--> statement-breakpoint
CREATE TRIGGER tasks_merged_person_guard BEFORE INSERT OR UPDATE OF related_id, related_type ON tasks
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('related_id');

--> statement-breakpoint
CREATE TRIGGER notifications_merged_person_guard BEFORE INSERT OR UPDATE OF entity_id, entity_type ON notifications
FOR EACH ROW EXECUTE FUNCTION guard_merged_person_reference('entity_id');
