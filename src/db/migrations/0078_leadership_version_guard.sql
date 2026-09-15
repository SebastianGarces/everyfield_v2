CREATE TABLE "leadership_versions" (
	"church_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leadership_versions" ADD CONSTRAINT "leadership_versions_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- #825/#830. Apply only after the frozen 0075/0076/0077 sequence. This is a
-- separate conflict witness so version bumps never rewrite business timestamps
-- or interfere with the effect CTE's exact ministry_teams/churches row writes.
INSERT INTO leadership_versions (church_id) SELECT id FROM churches;
--> statement-breakpoint
CREATE FUNCTION advance_leadership_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_document jsonb;
  new_document jsonb;
  old_plant uuid;
  new_plant uuid;
  plant uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_document := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_document := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'churches' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO leadership_versions (church_id) VALUES (NEW.id);
      RETURN NULL;
    END IF;
    old_plant := (old_document->>'id')::uuid;
    new_plant := (new_document->>'id')::uuid;
  ELSE
    old_plant := (old_document->>'church_id')::uuid;
    new_plant := (new_document->>'church_id')::uuid;
  END IF;
  -- A tenancy move invalidates both plants, in a stable order. DELETE during
  -- plant cleanup must never recreate a guard whose parent has disappeared.
  FOR plant IN SELECT DISTINCT id FROM unnest(ARRAY[old_plant, new_plant]) id
    WHERE id IS NOT NULL ORDER BY id
  LOOP
    UPDATE leadership_versions SET version = version + 1 WHERE church_id = plant;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leadership_version_church_insert AFTER INSERT ON churches
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_church_update AFTER UPDATE OF leadership_status ON churches
FOR EACH ROW WHEN (OLD.leadership_status IS DISTINCT FROM NEW.leadership_status)
EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_people AFTER INSERT OR UPDATE OR DELETE ON persons
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_users_insert_delete AFTER INSERT OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_users_update AFTER UPDATE OF seat, church_id, sending_church_id, sending_network_id ON users
FOR EACH ROW WHEN ((OLD.seat, OLD.church_id, OLD.sending_church_id, OLD.sending_network_id)
  IS DISTINCT FROM (NEW.seat, NEW.church_id, NEW.sending_church_id, NEW.sending_network_id))
EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_teams AFTER INSERT OR UPDATE OR DELETE ON ministry_teams
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_roles AFTER INSERT OR UPDATE OR DELETE ON team_roles
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
--> statement-breakpoint
CREATE TRIGGER leadership_version_memberships AFTER INSERT OR UPDATE OR DELETE ON team_memberships
FOR EACH ROW EXECUTE FUNCTION advance_leadership_version();
