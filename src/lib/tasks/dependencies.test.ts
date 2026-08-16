import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { prerequisiteTaskIdsSchema } from "@/lib/validations/tasks";
import { assertBatchedWrites } from "@/lib/testing/db-atomicity";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

import {
  DEPENDENCY_CYCLE_ERROR,
  blockedTaskIdsQuery,
  buildAddDependencyStatement,
  hasCycle,
  wouldCreateCycle,
} from "./dependencies";

// ----------------------------------------------------------------------------
// Task dependencies (T-015).
//
// Three facts, and each is pinned where it actually lives:
//
//   1. A cycle is refused at write time. The CHECK only sees a self-loop;
//      A→B→A and longer chains are `wouldCreateCycle`, which is pure, so the
//      two-node case the AC names needs no database.
//   2. Church scope is the INSERT. `insert … select` joining both task rows
//      on church_id inserts zero rows for a forged or cross-church id, and
//      ON CONFLICT DO NOTHING against `task_dependencies_edge_unique_idx` is
//      the duplicate-edge arbiter — a SELECT-then-INSERT is not a guard.
//   3. Blocked-ness is derived: the list query asks the edge table for live
//      incomplete prerequisites, and nothing writes `tasks.status = 'blocked'`.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const TASK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

// ----------------------------------------------------------------------------
// Cycles
// ----------------------------------------------------------------------------

test("A→B→A is a cycle", () => {
  // THE AC. A waits on B; proposing B waits on A closes the loop.
  assert.equal(
    wouldCreateCycle(
      [{ taskId: TASK_A, prerequisiteTaskId: TASK_B }],
      TASK_B,
      TASK_A
    ),
    true
  );
});

test("a task waiting on itself is a cycle", () => {
  assert.equal(wouldCreateCycle([], TASK_A, TASK_A), true);
});

test("A→B→C→A is a cycle", () => {
  assert.equal(
    wouldCreateCycle(
      [
        { taskId: TASK_A, prerequisiteTaskId: TASK_B },
        { taskId: TASK_B, prerequisiteTaskId: TASK_C },
      ],
      TASK_C,
      TASK_A
    ),
    true
  );
});

test("a tree of prerequisites is not a cycle", () => {
  assert.equal(
    wouldCreateCycle(
      [{ taskId: TASK_A, prerequisiteTaskId: TASK_B }],
      TASK_A,
      TASK_C
    ),
    false
  );
  assert.equal(
    hasCycle([
      { taskId: TASK_A, prerequisiteTaskId: TASK_B },
      { taskId: TASK_A, prerequisiteTaskId: TASK_C },
    ]),
    false
  );
});

test("the cycle refusal sentence is the one the action echoes", () => {
  assert.match(DEPENDENCY_CYCLE_ERROR, /cycle/i);
});

// ----------------------------------------------------------------------------
// The INSERT — church scope and the unique-index arbiter
// ----------------------------------------------------------------------------

test("the edge INSERT selects FROM both task rows joined on church_id", () => {
  const sql = render(buildAddDependencyStatement(CHURCH_ID, TASK_A, TASK_B));

  assert.match(sql, /insert into "task_dependencies"/i);
  assert.match(sql, /select [\s\S]* from "tasks"/i);
  // Both ends of the edge are the same church as the row that names them.
  // A forged id that names no live row in this church inserts zero rows.
  assert.match(
    sql,
    /"prerequisite"\."church_id"\s*=\s*"dependent"\."church_id"/i
  );
  assert.match(sql, /"dependent"\."church_id"\s*=\s*\$\d+/i);
  assert.match(sql, /"dependent"\."deleted_at" is null/i);
  assert.match(sql, /"prerequisite"\."deleted_at" is null/i);
  assert.match(sql, /returning/i);
});

test("ON CONFLICT DO NOTHING targets the edge unique index", () => {
  const sql = render(buildAddDependencyStatement(CHURCH_ID, TASK_A, TASK_B));

  assert.match(
    sql,
    /on conflict \("task_id","prerequisite_task_id"\) do nothing/i,
    "the unique index is the duplicate-edge arbiter — a SELECT-then-INSERT is not a concurrency guard"
  );
});

test("blocked-ness is a query over incomplete live prerequisites, not a stored status", () => {
  const sql = render(blockedTaskIdsQuery(CHURCH_ID, [TASK_A, TASK_B]));

  assert.match(sql, /from "task_dependencies"/i);
  assert.match(
    sql,
    /"tasks"\."church_id"\s*=\s*"task_dependencies"\."church_id"/i,
    "church_id belongs in the JOIN, not only the WHERE"
  );
  assert.match(sql, /"tasks"\."deleted_at" is null/i);
  assert.match(sql, /"tasks"\."status"\s*<>\s*\$\d+/i);
  assert.doesNotMatch(
    sql,
    /update "tasks"/i,
    "nothing writes tasks.status = blocked on the planter's behalf"
  );
});

// ----------------------------------------------------------------------------
// Schema — the join table, the composite FKs, the unique index
// ----------------------------------------------------------------------------

const snapshot = JSON.parse(
  read("src/db/migrations/meta/0043_snapshot.json")
) as {
  tables: Record<
    string,
    {
      indexes: Record<
        string,
        { columns: { expression: string }[]; isUnique: boolean }
      >;
      foreignKeys: Record<
        string,
        { columnsFrom: string[]; columnsTo: string[]; onDelete: string }
      >;
      checkConstraints?: Record<string, { value: string }>;
    }
  >;
};

test("task_dependencies unique-indexes the edge pair", () => {
  const edge =
    snapshot.tables["public.task_dependencies"]?.indexes[
      "task_dependencies_edge_unique_idx"
    ];
  assert.ok(
    edge,
    "task_dependencies_edge_unique_idx missing from the 0043 snapshot"
  );
  assert.equal(edge.isUnique, true);
  assert.deepEqual(
    edge.columns.map((column) => column.expression),
    ["task_id", "prerequisite_task_id"]
  );
});

test("both task FKs are composite onto (id, church_id) and CASCADE", () => {
  const table = snapshot.tables["public.task_dependencies"];
  assert.ok(table, "public.task_dependencies missing from the 0043 snapshot");

  for (const name of [
    "task_dependencies_task_church_fk",
    "task_dependencies_prereq_church_fk",
  ] as const) {
    const fk = table.foreignKeys[name];
    assert.ok(fk, `${name} missing from the 0043 snapshot`);
    assert.deepEqual(fk.columnsFrom.slice(1), ["church_id"]);
    assert.deepEqual(fk.columnsTo, ["id", "church_id"]);
    assert.equal(fk.onDelete, "cascade");
  }

  assert.deepEqual(
    table.foreignKeys["task_dependencies_task_church_fk"]?.columnsFrom,
    ["task_id", "church_id"]
  );
  assert.deepEqual(
    table.foreignKeys["task_dependencies_prereq_church_fk"]?.columnsFrom,
    ["prerequisite_task_id", "church_id"]
  );
});

test("tasks carries the (id, church_id) unique index the composite FKs need", () => {
  const index =
    snapshot.tables["public.tasks"]?.indexes["tasks_id_church_id_unique_idx"];
  assert.ok(
    index,
    "tasks_id_church_id_unique_idx missing from the 0043 snapshot"
  );
  assert.equal(index.isUnique, true);
  assert.deepEqual(
    index.columns.map((column) => column.expression),
    ["id", "church_id"]
  );
});

test("a self-loop is a CHECK", () => {
  const check =
    snapshot.tables["public.task_dependencies"]?.checkConstraints?.[
      "task_dependencies_no_self_check"
    ];
  assert.ok(
    check,
    "task_dependencies_no_self_check missing from the 0043 snapshot"
  );
  assert.match(check.value, /task_id.+<>.+prerequisite_task_id/i);
});

test("the migration builds the unique index on tasks BEFORE the composite FKs", () => {
  const migration = read("src/db/migrations/0043_task_dependencies.sql");
  assertInOrder(
    migration,
    "0043_task_dependencies.sql",
    [
      'CREATE UNIQUE INDEX "tasks_id_church_id_unique_idx"',
      'ADD CONSTRAINT "task_dependencies_task_church_fk"',
      'ADD CONSTRAINT "task_dependencies_prereq_church_fk"',
    ],
    "Postgres cannot spell a composite FK onto (id, church_id) until that pair is unique"
  );
});

// ----------------------------------------------------------------------------
// The write path — batch, no db.transaction, unique index as the guard
// ----------------------------------------------------------------------------

test("setTaskPrerequisites writes in one db.batch and never calls db.transaction", () => {
  const source = stripComments(read("src/lib/tasks/dependencies.ts"));
  const body = sourceReader(source, "dependencies.ts").span(
    "export async function setTaskPrerequisites",
    "export async function listTaskPrerequisites"
  );

  assertBatchedWrites(body, "setTaskPrerequisites");
  assert.match(
    body,
    /buildAddDependencyStatement\(/,
    "the replace path uses the church-scoped insert…select, not a values() insert"
  );
});

test("create and update parse prerequisite ids BEFORE they write the task", () => {
  const source = read("src/app/(dashboard)/tasks/actions.ts");
  const reader = sourceReader(source, "actions.ts");

  assertInOrder(
    reader.span(
      "export async function createTaskAction",
      "export async function quickAddTaskAction"
    ),
    "createTaskAction",
    [
      "parsePostedPrerequisiteIds(rawData)",
      "await createTask(",
      "await setTaskPrerequisites(",
    ],
    "a malformed id list must not create a task and then report validation failed"
  );

  assertInOrder(
    reader.span(
      "export async function updateTaskAction",
      "export async function completeTaskAction"
    ),
    "updateTaskAction",
    [
      "parsePostedPrerequisiteIds(rawData)",
      "await updateTask(",
      "await setTaskPrerequisites(",
    ]
  );
});

test("completing a task refresh()es the page the planter is standing on", () => {
  const source = read("src/app/(dashboard)/tasks/actions.ts");
  const body = sourceReader(source, "actions.ts").span(
    "export async function completeTaskAction",
    "export async function reopenTaskAction"
  );

  assertInOrder(
    body,
    "completeTaskAction",
    ["await completeTask(", "refresh()"],
    "completing the last prerequisite must clear the dependent's blocked badge without a full navigation"
  );
});

// ----------------------------------------------------------------------------
// Form payload
// ----------------------------------------------------------------------------

test("prerequisiteTaskIdsSchema reads a comma-separated list of uuids", () => {
  assert.deepEqual(prerequisiteTaskIdsSchema.parse(`${TASK_A},${TASK_B}`), [
    TASK_A,
    TASK_B,
  ]);
  assert.deepEqual(prerequisiteTaskIdsSchema.parse(""), []);
  assert.deepEqual(prerequisiteTaskIdsSchema.parse(undefined), []);
  assert.deepEqual(prerequisiteTaskIdsSchema.parse(`${TASK_A},${TASK_A}`), [
    TASK_A,
  ]);
});

test("prerequisiteTaskIdsSchema refuses a non-uuid", () => {
  assert.equal(
    prerequisiteTaskIdsSchema.safeParse("not-a-uuid").success,
    false
  );
});
