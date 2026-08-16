import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { taskDependencies, tasks } from "@/db/schema/tasks";

import {
  DEPENDENCY_CYCLE_ERROR,
  buildAddDependencyStatement,
  hasCycle,
  wouldCreateCycle,
} from "./dependencies";

// ----------------------------------------------------------------------------
// Task dependencies (T-015) — cycle rejection and church-scoped insert.
//
// Cycles are an application rule (the CHECK only refuses a self-loop). The
// two-node case A→B→A is the one the issue names; longer chains use the
// same walk. Church scope is the INSERT: it selects from both task rows
// joined on church_id, so a foreign id inserts nothing.
// ----------------------------------------------------------------------------

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHURCH = "11111111-1111-4111-8111-111111111111";

test("A→B→A is a cycle", () => {
  assert.equal(
    wouldCreateCycle([{ taskId: A, prerequisiteTaskId: B }], B, A),
    true
  );
});

test("a longer chain A→B→C→A is a cycle", () => {
  assert.equal(
    wouldCreateCycle(
      [
        { taskId: A, prerequisiteTaskId: B },
        { taskId: B, prerequisiteTaskId: C },
      ],
      C,
      A
    ),
    true
  );
});

test("a task may not wait on itself", () => {
  assert.equal(wouldCreateCycle([], A, A), true);
});

test("an independent edge is not a cycle", () => {
  assert.equal(
    wouldCreateCycle([{ taskId: A, prerequisiteTaskId: B }], C, B),
    false
  );
});

test("a redundant edge along an existing chain is not a cycle", () => {
  // A already waits on B, B on C; A waiting on C directly is a shortcut.
  assert.equal(
    wouldCreateCycle(
      [
        { taskId: A, prerequisiteTaskId: B },
        { taskId: B, prerequisiteTaskId: C },
      ],
      A,
      C
    ),
    false
  );
});

test("hasCycle agrees with the two-node case the write path would store", () => {
  assert.equal(
    hasCycle([
      { taskId: A, prerequisiteTaskId: B },
      { taskId: B, prerequisiteTaskId: A },
    ]),
    true
  );
  assert.equal(hasCycle([{ taskId: A, prerequisiteTaskId: B }]), false);
});

test("the cycle refusal sentence is the one the action echoes", () => {
  assert.match(DEPENDENCY_CYCLE_ERROR, /cycle/i);
  assert.match(DEPENDENCY_CYCLE_ERROR, /cannot wait on itself/i);
});

const dialect = new PgDialect();

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

test("the edge INSERT selects from both task rows joined on church_id", () => {
  const sql = render(buildAddDependencyStatement(CHURCH, A, B));

  assert.match(sql, /insert into "task_dependencies"/i);
  assert.match(sql, /from "tasks" "dependent"/i);
  assert.match(sql, /inner join "tasks" "prerequisite"/i);
  assert.match(
    sql,
    /"prerequisite"\."church_id"\s*=\s*"dependent"\."church_id"/i
  );
  assert.match(sql, /"dependent"\."church_id"\s*=\s*\$\d+/i);
  assert.match(sql, /"dependent"\."deleted_at" is null/i);
  assert.match(sql, /"prerequisite"\."deleted_at" is null/i);
  assert.match(
    sql,
    /on conflict \("task_id","prerequisite_task_id"\) do nothing/i
  );
  assert.match(sql, /returning/i);
});

test("the join table unique-indexes the edge and checks against a self-loop", () => {
  const { indexes, checks, foreignKeys } = getTableConfig(taskDependencies);

  const unique = indexes.filter((index) => index.config.unique);
  assert.deepEqual(
    unique.map((index) => index.config.name),
    ["task_dependencies_edge_unique_idx"]
  );
  assert.deepEqual(
    unique[0]?.config.columns.map((column) =>
      "name" in column ? column.name : String(column)
    ),
    ["task_id", "prerequisite_task_id"]
  );

  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.name, "task_dependencies_no_self_check");

  assert.equal(foreignKeys.length, 3);
  const fkNames = foreignKeys.map((fk) => fk.getName()).toSorted();
  assert.deepEqual(fkNames, [
    "task_dependencies_church_id_churches_id_fk",
    "task_dependencies_prereq_church_fk",
    "task_dependencies_task_church_fk",
  ]);
});

test("tasks carries the (id, church_id) unique the composite FKs reference", () => {
  const { indexes } = getTableConfig(tasks);
  const pair = indexes.find(
    (index) => index.config.name === "tasks_id_church_id_unique_idx"
  );
  assert.ok(pair, "tasks_id_church_id_unique_idx is missing");
  assert.equal(pair.config.unique, true);
  assert.deepEqual(
    pair.config.columns.map((column) =>
      "name" in column ? column.name : String(column)
    ),
    ["id", "church_id"]
  );
});
