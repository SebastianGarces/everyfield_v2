import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { sourceReader } from "@/lib/testing/source-span";

import { LAUNCH_MILESTONE_AREA_ORDER } from "./milestone-areas";
import {
  completeLaunchMilestoneStatement,
  LAUNCH_MILESTONE_TEMPLATES,
  reopenLaunchMilestoneStatement,
  seedLaunchMilestonesStatement,
} from "./milestones";

// ============================================================================
// LS-003 — the Playbook milestones, the seed, and the completion guard.
//
// Same approach as `service.test.ts`: the rules this unit has to hold are
// properties of the STATEMENT and of the TEMPLATE, not of a return value, so
// they are asserted against generated SQL and against the data. A guard that
// lives only in a comment is a guard that comes back.
// ============================================================================

const LAUNCH_ID = "33333333-3333-4333-8333-333333333333";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "44444444-4444-4444-8444-444444444444";

const dialect = new PgDialect();

const SEED_ROWS = [
  {
    milestoneId: MILESTONE_ID,
    templateKey: "operations.equipment_on_site",
    area: "operations" as const,
    title: "Set-up equipment on site",
    description: "…",
    sortOrder: 10,
    tasks: [
      {
        taskId: "55555555-5555-4555-8555-555555555555",
        title: "Order the remaining set-up equipment",
        description: null,
      },
    ],
  },
];

function seedSql(): string {
  return dialect
    .sqlToQuery(
      seedLaunchMilestonesStatement({
        launchId: LAUNCH_ID,
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
        rows: SEED_ROWS,
      })
    )
    .sql.replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

test("template keys are unique — they are what seeding matches on", () => {
  // The unique index is on (launch_id, template_key). Two templates sharing a
  // key would make the seed insert one of them and silently drop the other.
  const keys = LAUNCH_MILESTONE_TEMPLATES.map((t) => t.templateKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("every milestone belongs to one of the Playbook's three areas", () => {
  for (const template of LAUNCH_MILESTONE_TEMPLATES) {
    assert.ok(
      LAUNCH_MILESTONE_AREA_ORDER.includes(template.area),
      `${template.templateKey} has area "${template.area}", which the schema CHECK refuses`
    );
  }
});

test("all three areas are represented, so no heading renders empty", () => {
  const areas = new Set(LAUNCH_MILESTONE_TEMPLATES.map((t) => t.area));
  for (const area of LAUNCH_MILESTONE_AREA_ORDER) {
    assert.ok(areas.has(area), `no milestone seeds the "${area}" area`);
  }
});

test("every milestone expands into at least one task (LS-003)", () => {
  // "Each milestone links tasks" is the requirement. A milestone with none is
  // immediately completable and teaches the planter nothing.
  for (const template of LAUNCH_MILESTONE_TEMPLATES) {
    assert.ok(
      template.tasks.length > 0,
      `${template.templateKey} seeds no tasks`
    );
  }
});

test("template titles fit the columns that store them", () => {
  // varchar(64) for the key, varchar(255) for the title, varchar(500) for a
  // task title. Postgres refuses an overflow; better to fail here.
  for (const template of LAUNCH_MILESTONE_TEMPLATES) {
    assert.ok(template.templateKey.length <= 64, template.templateKey);
    assert.ok(template.title.length <= 255, template.title);
    for (const task of template.tasks) {
      assert.ok(task.title.length <= 500, task.title);
    }
  }
});

// ---------------------------------------------------------------------------
// The seed, read off the statement
// ---------------------------------------------------------------------------

test("re-seeding cannot double a plant's milestones", () => {
  // The unique index is the guard, not a SELECT-then-INSERT: two concurrent
  // schedules both pass a count check (memory/invariants.md → Atomicity).
  assert.match(seedSql(), /on conflict \(launch_id, template_key\) do nothing/);
});

test("tasks are inserted only for milestones that were actually inserted", () => {
  // This is what makes the WHOLE seed idempotent. The milestone insert is
  // guarded by `on conflict`, and the task insert reads its RETURNING rows — so
  // a second seed inserts no milestones and therefore no tasks. An unconditional
  // task insert would hand the planter 22 duplicates on the second save.
  const sql = seedSql();
  assert.match(
    sql,
    /insert into tasks .* join seeded s on s\.id = tt\.milestone_id/
  );
  assert.match(
    sql,
    /insert into launch_milestone_tasks .* join seeded_tasks st on st\.id = tt\.id/
  );
});

test("seeded tasks are launch_prep tasks, created by the session's user", () => {
  const query = dialect.sqlToQuery(
    seedLaunchMilestonesStatement({
      launchId: LAUNCH_ID,
      churchId: CHURCH_ID,
      actorUserId: ACTOR_ID,
      rows: SEED_ROWS,
    })
  );
  assert.match(query.sql.replace(/\s+/g, " "), /'launch_prep'/);
  assert.ok(
    query.params.includes(ACTOR_ID),
    "created_by_id must reach the insert as a parameter"
  );
  assert.ok(
    !query.sql.includes(ACTOR_ID),
    "no id may be interpolated into the SQL text"
  );
});

test("seeded tasks carry NO due date", () => {
  // Ruled in the module header: derived due dates either go stale the moment
  // the launch moves, or the move rewrites tasks the planter has since edited.
  // The Playbook's timing lives in the milestone description instead.
  assert.doesNotMatch(seedSql(), /due_date/);
});

test("the seed is church-scoped on every table it writes", () => {
  const query = dialect.sqlToQuery(
    seedLaunchMilestonesStatement({
      launchId: LAUNCH_ID,
      churchId: CHURCH_ID,
      actorUserId: ACTOR_ID,
      rows: SEED_ROWS,
    })
  );
  // milestones, tasks and the join rows all carry the tenant (invariants →
  // Multi-Tenancy), so the church id appears once per insert.
  assert.ok(
    query.params.filter((param) => param === CHURCH_ID).length >= 3,
    "every inserted row must carry church_id"
  );
});

// ---------------------------------------------------------------------------
// Completion — the hybrid model's one real guard
// ---------------------------------------------------------------------------

test("a milestone with an open task cannot be completed", () => {
  // THE rule of the 2026-08-04 hybrid ruling, and it lives in the WHERE. A
  // disabled button cannot see a teammate reopening the last task between the
  // render and the write.
  const sql = dialect
    .sqlToQuery(
      completeLaunchMilestoneStatement({
        milestoneId: MILESTONE_ID,
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
      })
    )
    .sql.replace(/\s+/g, " ");

  assert.match(sql, /and not exists \( select 1 from launch_milestone_tasks/);
  assert.match(sql, /t\.status <> 'complete'/);
});

test("a deleted task does not keep its milestone open forever", () => {
  const sql = dialect
    .sqlToQuery(
      completeLaunchMilestoneStatement({
        milestoneId: MILESTONE_ID,
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
      })
    )
    .sql.replace(/\s+/g, " ");
  assert.match(sql, /t\.deleted_at is null/);
});

test("completing is a compare-and-set, and it is tenant-scoped", () => {
  const sql = dialect
    .sqlToQuery(
      completeLaunchMilestoneStatement({
        milestoneId: MILESTONE_ID,
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
      })
    )
    .sql.replace(/\s+/g, " ");
  // `completed_at is null` makes a double-click complete exactly once, and the
  // second request honestly reports it changed nothing.
  assert.match(sql, /m\.completed_at is null/);
  assert.match(sql, /m\.church_id = /);
});

test("reopening is tenant-scoped and clears who completed it", () => {
  const sql = dialect
    .sqlToQuery(
      reopenLaunchMilestoneStatement({
        milestoneId: MILESTONE_ID,
        churchId: CHURCH_ID,
      })
    )
    .sql.replace(/\s+/g, " ");
  assert.match(sql, /completed_at = null/);
  assert.match(sql, /completed_by_user_id = null/);
  assert.match(sql, /m\.church_id = /);
  assert.match(sql, /m\.completed_at is not null/);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("milestone completion follows TASK rules, not the planter-only rule", () => {
  // LS-007 splits them deliberately: the planter owns the DATE and the OUTCOME;
  // "milestone/task completion follows normal task rules", so a team member who
  // may tick a task may close the milestone it belongs to. What must NOT happen
  // is oversight ticking a plant's readiness — `CHURCH_LEVEL_ROLES` is the line.
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "milestones.ts"),
    "utf8"
  );
  assert.match(source, /requireChurchLevel\(user\)/);
  assert.match(source, /await requireChurchAccess\(user, churchId\)/);
  assert.ok(
    !/requirePlantOwner\(user\)/.test(source),
    "milestone completion must not be planter-only (LS-007)"
  );
});

test("the seeded tasks take the one description door, like every other writer", () => {
  // `seedLaunchMilestones` is the FOURTH writer of `tasks.description`, beside
  // `createTask`, `updateTask` and `importTaskTemplate` — a live path, run on
  // every launch schedule, not a dev seed. T-021 says every write goes through
  // `normalizeTaskDescription` (`src/lib/tasks/descriptions.ts`), and this one wrote
  // the template's raw string straight into the column. Read off the source
  // because `planSeedRows` is private and the statement builder is handed rows
  // the test itself made up — the gate lives in the planner, not in the SQL.
  const read = sourceReader(
    readFileSync(
      path.join(process.cwd(), "src", "lib", "launch", "milestones.ts"),
      "utf8"
    ),
    "milestones.ts"
  );

  assert.match(
    read.code,
    /import \{ normalizeTaskDescription \} from "@\/lib\/tasks\/descriptions"/
  );

  const planner = read.span("function planSeedRows", "* Seed the Playbook set");
  assert.match(
    planner,
    /description: normalizeTaskDescription\(task\.description\)/,
    "a seeded task's description must pass the T-021 write gate"
  );
  // The MILESTONE's own description is a different column on a different table,
  // rendered as plain text — it must NOT be routed through the task door.
  assert.match(planner, /^\s*description: template\.description,$/m);
});

test("the milestone history is a READ of the row, church-scoped, losing nobody", () => {
  // The History tab's source. Three properties, and each one is a bug if it
  // goes: it must be scoped by church as well as launch (a launch id is a uuid
  // a caller could hold from anywhere); it must return only CLOSED milestones,
  // because an open one has no completion to report; and the actor join must be
  // LEFT, or a milestone whose closer was since deleted would vanish from the
  // history it belongs to.
  const code = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "milestones.ts"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const read = code.slice(
    code.indexOf("export async function getLaunchMilestoneHistory")
  );
  assert.ok(read.length > 0, "getLaunchMilestoneHistory is gone");
  assert.match(read, /eq\(launchMilestones\.launchId, launchId\)/);
  assert.match(read, /eq\(launchMilestones\.churchId, churchId\)/);
  assert.match(read, /isNotNull\(launchMilestones\.completedAt\)/);
  assert.match(
    read,
    /leftJoin\(\s*users,\s*eq\(users\.id, launchMilestones\.completedByUserId\)\s*\)/
  );
});

test("the history read adds no journal — it reads what the row already stores", () => {
  // The ruling for this pass was explicit: read-time only, no schema change and
  // no new journalling. A milestone completion is `completed_at` +
  // `completed_by_user_id`, which the write path already sets.
  const code = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "milestones.ts"),
    "utf8"
  );
  assert.ok(
    !/launchEvents/.test(code),
    "milestones.ts writes or reads launch_events — the milestone row is the record"
  );
});

test("the milestone modules are not endpoints (#265)", () => {
  for (const file of ["milestones.ts", "milestone-areas.ts", "journal.ts"]) {
    const code = readFileSync(
      path.join(process.cwd(), "src", "lib", "launch", file),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(
      !/["']use server["']/.test(code),
      `${file} declares "use server"`
    );
  }
});
