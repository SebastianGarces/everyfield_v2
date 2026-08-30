import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "src/db/migrations/0070_task_structure_serialization.sql"
  ),
  "utf8"
);
const service = readFileSync(
  path.join(process.cwd(), "src/lib/tasks/service.ts"),
  "utf8"
);
const dependencies = readFileSync(
  path.join(process.cwd(), "src/lib/tasks/dependencies.ts"),
  "utf8"
);
const evry = readFileSync(
  path.join(process.cwd(), "src/lib/evry/capabilities/tasks/atomic-effect.ts"),
  "utf8"
);

test("all Task hierarchy and dependency writers share the database lock", () => {
  assert.match(
    migration,
    /create or replace function lock_task_structure\(target_church_id uuid\)/i
  );
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(
    migration,
    /create trigger tasks_structure_guard[\s\S]*before insert or update or delete on tasks/i
  );
  assert.match(
    migration,
    /create trigger task_dependencies_structure_guard[\s\S]*before insert or update or delete on task_dependencies/i
  );
});

test("the Task hierarchy guard rejects nested and orphan checklist rows", () => {
  assert.match(
    migration,
    /parent\.deleted_at is null[\s\S]*parent\.parent_task_id is null/i
  );
  assert.match(
    migration,
    /create constraint trigger tasks_no_live_orphan_children_guard[\s\S]*deferrable initially deferred/i
  );
  assert.match(
    migration,
    /a live checklist item cannot outlive or nest beneath its parent/i
  );
});

test("the dependency guard walks the committed graph before accepting an edge", () => {
  assert.match(migration, /with recursive reachable\(prerequisite_task_id\)/i);
  assert.match(migration, /where prerequisite_task_id = new\.task_id/i);
  assert.match(migration, /a task dependency cannot close a cycle/i);
});

test("Evry and owning Task writers acquire the lock before mutating", () => {
  assert.equal(
    service.match(/taskStructureLockStatement\(churchId\)/g)?.length,
    3
  );
  assert.equal(
    service.match(/taskStructureLockStatement\(values(?:\[0\]!|)\.churchId\)/g)
      ?.length,
    2
  );
  assert.match(
    dependencies,
    /db\.batch\(\[\s*taskStructureLockStatement\(churchId\)/
  );
  assert.match(
    evry,
    /taskStructureLockStatement\(input\.execution\.plantId\)[\s\S]*db\.execute<CompletedEffectRow>\(statement\)/
  );
});
