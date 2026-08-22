import assert from "node:assert/strict";
import { test } from "node:test";

import { taskCategories, taskPriorities, taskStatuses } from "@/db/schema";

import { parseTaskListSearchParams } from "./list-params";
import { TASK_LIST_VIEWS, taskListParamsWith } from "./list-url";

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

// ----------------------------------------------------------------------------
// #660 — the two halves of the URL, round-tripped against each other.
//
// The toggle WROTE `/tasks` for "All Tasks" (its builder dropped any value of
// `"all"`, a rule meant for the filter selects) and the parser READ that as the
// default. So the tab pushed the My Tasks URL, came back with My Tasks active,
// and could never be selected. Each half was self-consistent; only together
// were they wrong, which is why the assertion below composes them.
// ----------------------------------------------------------------------------

test("every view the toggle can write parses back to that same view", () => {
  for (const view of TASK_LIST_VIEWS) {
    const written = taskListParamsWith(new URLSearchParams(), "view", view);

    assert.equal(
      parseTaskListSearchParams(Object.fromEntries(written)).view,
      view,
      `pressing the ${view} tab produces "?${written.toString()}", which the page reads back as a different view — that tab is unreachable`
    );
  }
});

test("the three tabs produce three different URLs", () => {
  const urls = TASK_LIST_VIEWS.map((view) =>
    taskListParamsWith(new URLSearchParams(), "view", view).toString()
  );

  assert.equal(
    new Set(urls).size,
    TASK_LIST_VIEWS.length,
    `two tabs share a URL, so one of them cannot be selected: ${urls.join(" | ")}`
  );
});

test("a filter's own `all` still clears, because the select passes null", () => {
  // The sentinel belongs to the control that HAS an "All" option. Each select
  // maps it to `null` at the call site; the builder just clears on `null`.
  const withFilter = taskListParamsWith(
    new URLSearchParams("view=all&status=blocked"),
    "status",
    null
  );

  assert.equal(withFilter.get("status"), null);
  assert.equal(
    withFilter.get("view"),
    "all",
    "clearing a filter must not clear the view beside it"
  );
});

test("changing a view or a filter drops the cursor", () => {
  const next = taskListParamsWith(
    new URLSearchParams("view=my_tasks&cursor=abc123"),
    "view",
    "all"
  );

  assert.equal(
    next.get("cursor"),
    null,
    "a cursor names a position in the list being left"
  );
  assert.equal(next.get("view"), "all");
});
