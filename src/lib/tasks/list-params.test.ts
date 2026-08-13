import assert from "node:assert/strict";
import { test } from "node:test";

import { taskCategories, taskPriorities, taskStatuses } from "@/db/schema";

import { parseTaskListSearchParams } from "./list-params";

// ----------------------------------------------------------------------------
// `/tasks?…` — the URL is untrusted input, and the route it feeds has no error
// boundary.
//
// Every value here used to be cast: `[param].flat() as TaskStatus[]`. The array
// goes into `inArray(tasks.status, …)`, the column is guarded by a CHECK over
// the four legal values, and Postgres refuses anything else — so a typo in a
// shared link rendered the route's own failure instead of a task list.
// ----------------------------------------------------------------------------

test("the defaults are the ones the page shipped with", () => {
  assert.deepEqual(parseTaskListSearchParams({}), {
    view: "my_tasks",
    showCompleted: false,
    status: undefined,
    priority: undefined,
    category: undefined,
    cursor: undefined,
  });
});

test("a legal filter survives, in the order the URL gave it", () => {
  const parsed = parseTaskListSearchParams({
    view: "all",
    completed: "true",
    status: ["blocked", "not_started"],
    priority: "urgent",
    category: ["follow_up"],
    cursor: "cursor-id",
  });

  assert.equal(parsed.view, "all");
  assert.equal(parsed.showCompleted, true);
  assert.deepEqual(parsed.status, ["blocked", "not_started"]);
  assert.deepEqual(parsed.priority, ["urgent"]);
  assert.deepEqual(parsed.category, ["follow_up"]);
  assert.equal(parsed.cursor, "cursor-id");
});

test("a value the column would refuse never reaches the query", () => {
  // The whole point. Dropped rather than refused: a filter is a view of a list,
  // so the honest answer to a status that does not exist is the unfiltered
  // list — `undefined`, which `listTasks` reads as "no filter".
  const parsed = parseTaskListSearchParams({
    status: "bogus",
    priority: "'; drop table tasks; --",
    category: ["nope", "also-nope"],
  });

  assert.equal(parsed.status, undefined);
  assert.equal(parsed.priority, undefined);
  assert.equal(parsed.category, undefined);
});

test("the legal members are kept and the illegal ones dropped from one param", () => {
  const parsed = parseTaskListSearchParams({
    status: ["blocked", "bogus", "complete"],
  });

  assert.deepEqual(parsed.status, ["blocked", "complete"]);
});

test("a repeated value is one predicate", () => {
  assert.deepEqual(
    parseTaskListSearchParams({ status: ["blocked", "blocked"] }).status,
    ["blocked"]
  );
});

test("every value the schema defines is accepted", () => {
  // Driven off the schema tuples, so a new status/priority/category is covered
  // by existing rather than by remembering to add a case here.
  assert.deepEqual(
    parseTaskListSearchParams({ status: [...taskStatuses] }).status,
    [...taskStatuses]
  );
  assert.deepEqual(
    parseTaskListSearchParams({ priority: [...taskPriorities] }).priority,
    [...taskPriorities]
  );
  assert.deepEqual(
    parseTaskListSearchParams({ category: [...taskCategories] }).category,
    [...taskCategories]
  );
});

test("only the literal `all` and `true` switch a mode", () => {
  // `view` and `completed` were already compared rather than cast, and they
  // stay that way — anything else is the default, never a third state.
  assert.equal(parseTaskListSearchParams({ view: "ALL" }).view, "my_tasks");
  assert.equal(parseTaskListSearchParams({ view: ["all"] }).view, "my_tasks");
  assert.equal(
    parseTaskListSearchParams({ completed: "1" }).showCompleted,
    false
  );
});

test("a repeated cursor is no cursor", () => {
  // `?cursor=a&cursor=b` arrives as an array; there is one page position, so
  // the honest reading of two is none.
  assert.equal(
    parseTaskListSearchParams({ cursor: ["a", "b"] }).cursor,
    undefined
  );
});
