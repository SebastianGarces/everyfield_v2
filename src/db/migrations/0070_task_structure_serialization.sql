-- Task structure is shared state. Parent/checklist relationships and the
-- prerequisite graph have several writers (the Tasks UI, Evry, imports, and
-- maintenance scripts), so a lock in one service cannot protect the invariant.
-- These triggers put one plant-scoped transaction lock at the database door.
-- Competing plants remain independent; competing writers in one plant observe
-- the winner's committed structure before validating their own row.
--
-- The hierarchy guard has two halves. The BEFORE trigger serializes and checks
-- a live child's parent immediately. The deferred trigger checks descendants
-- after the whole transaction, which lets the owning one-statement soft-delete
-- update a parent and all of its children together without exposing an orphan.
--
-- The dependency trigger performs the cycle walk after taking the same lock.
-- Thus opposite edges from different request/effect keys cannot both commit.
-- The lock also serializes a parent mutation against an edge insertion.
--
-- ROLLBACK (run in one psql session with ON_ERROR_STOP):
--   DROP TRIGGER IF EXISTS task_dependencies_structure_guard ON task_dependencies;
--   DROP TRIGGER IF EXISTS tasks_no_live_orphan_children_guard ON tasks;
--   DROP TRIGGER IF EXISTS tasks_structure_guard ON tasks;
--   DROP FUNCTION IF EXISTS task_dependencies_guard_structure();
--   DROP FUNCTION IF EXISTS tasks_validate_no_live_orphan_children();
--   DROP FUNCTION IF EXISTS tasks_guard_structure();
--   DROP FUNCTION IF EXISTS lock_task_structure(uuid);
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788031147139;

CREATE OR REPLACE FUNCTION lock_task_structure(target_church_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'everyfield:tasks:structure:' || target_church_id::text,
      0
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION tasks_guard_structure()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  target_church_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_church_id := OLD.church_id;
  ELSE
    target_church_id := NEW.church_id;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.church_id <> OLD.church_id THEN
    RAISE EXCEPTION 'A Task cannot move between plants'
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_church_immutable_guard';
  END IF;

  PERFORM lock_task_structure(target_church_id);

  IF TG_OP <> 'DELETE'
     AND NEW.deleted_at IS NULL
     AND NEW.parent_task_id IS NOT NULL THEN
    -- A multi-row INSERT may create a recurrence successor and its checklist
    -- together. Postgres does not promise which source row reaches this
    -- row-level trigger first, so a parent absent *during* the statement is
    -- allowed here and checked by the deferred trigger after the statement.
    -- An already-visible parent, however, must be live and top-level now.
    IF EXISTS (
      SELECT 1
      FROM tasks parent
      WHERE parent.id = NEW.parent_task_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM tasks parent
      WHERE parent.id = NEW.parent_task_id
        AND parent.church_id = NEW.church_id
        AND parent.deleted_at IS NULL
        AND parent.parent_task_id IS NULL
    ) THEN
      RAISE EXCEPTION 'A checklist item requires one live top-level parent in its plant'
        USING ERRCODE = '23514',
              CONSTRAINT = 'tasks_one_level_hierarchy_guard';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM tasks child
      WHERE child.church_id = NEW.church_id
        AND child.parent_task_id = NEW.id
        AND child.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'A Task with live checklist items cannot become a checklist item'
        USING ERRCODE = '23514',
              CONSTRAINT = 'tasks_one_level_hierarchy_guard';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_structure_guard
BEFORE INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW
EXECUTE FUNCTION tasks_guard_structure();

CREATE OR REPLACE FUNCTION tasks_validate_no_live_orphan_children()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  target_task_id uuid;
  target_church_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.id;
    target_church_id := OLD.church_id;
  ELSE
    target_task_id := NEW.id;
    target_church_id := NEW.church_id;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.deleted_at IS NULL
     AND NEW.parent_task_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM tasks parent
       WHERE parent.id = NEW.parent_task_id
         AND parent.church_id = NEW.church_id
         AND parent.deleted_at IS NULL
         AND parent.parent_task_id IS NULL
     ) THEN
    RAISE EXCEPTION 'A checklist item requires one live top-level parent in its plant'
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_one_level_hierarchy_guard';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tasks child
    WHERE child.church_id = target_church_id
      AND child.parent_task_id = target_task_id
      AND child.deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1
    FROM tasks parent
    WHERE parent.id = target_task_id
      AND parent.church_id = target_church_id
      AND parent.deleted_at IS NULL
      AND parent.parent_task_id IS NULL
  ) THEN
    RAISE EXCEPTION 'A live checklist item cannot outlive or nest beneath its parent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'tasks_no_live_orphan_children_guard';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tasks_no_live_orphan_children_guard
AFTER INSERT OR UPDATE OR DELETE ON tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tasks_validate_no_live_orphan_children();

CREATE OR REPLACE FUNCTION task_dependencies_guard_structure()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_edge_id uuid := NULL;
  closes_cycle boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.church_id <> OLD.church_id THEN
    RAISE EXCEPTION 'A Task dependency cannot move between plants'
      USING ERRCODE = '23514',
            CONSTRAINT = 'task_dependencies_church_immutable_guard';
  END IF;

  PERFORM lock_task_structure(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.church_id ELSE NEW.church_id END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_edge_id := OLD.id;
  END IF;

  WITH RECURSIVE reachable(prerequisite_task_id) AS (
    SELECT dependency.prerequisite_task_id
    FROM task_dependencies dependency
    INNER JOIN tasks dependent
      ON dependent.id = dependency.task_id
     AND dependent.church_id = dependency.church_id
     AND dependent.deleted_at IS NULL
    INNER JOIN tasks prerequisite
      ON prerequisite.id = dependency.prerequisite_task_id
     AND prerequisite.church_id = dependency.church_id
     AND prerequisite.deleted_at IS NULL
    WHERE dependency.church_id = NEW.church_id
      AND dependency.task_id = NEW.prerequisite_task_id
      AND dependency.id IS DISTINCT FROM previous_edge_id
    UNION
    SELECT dependency.prerequisite_task_id
    FROM reachable
    INNER JOIN task_dependencies dependency
      ON dependency.church_id = NEW.church_id
     AND dependency.task_id = reachable.prerequisite_task_id
     AND dependency.id IS DISTINCT FROM previous_edge_id
    INNER JOIN tasks prerequisite
      ON prerequisite.id = dependency.prerequisite_task_id
     AND prerequisite.church_id = dependency.church_id
     AND prerequisite.deleted_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM reachable
    WHERE prerequisite_task_id = NEW.task_id
  ) INTO closes_cycle;

  IF NEW.task_id = NEW.prerequisite_task_id OR closes_cycle THEN
    RAISE EXCEPTION 'A Task dependency cannot close a cycle'
      USING ERRCODE = '23514',
            CONSTRAINT = 'task_dependencies_cycle_guard';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER task_dependencies_structure_guard
BEFORE INSERT OR UPDATE OR DELETE ON task_dependencies
FOR EACH ROW
EXECUTE FUNCTION task_dependencies_guard_structure();
