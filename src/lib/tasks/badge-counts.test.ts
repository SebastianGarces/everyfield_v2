/**
 * THE BADGES COUNT THE LIST'S OWN POPULATION (decision C on #370, #613).
 *
 * The header over `/tasks` reports "N active / M completed" above the list that
 * `listTasks` renders. The ruling on #370 is that those numbers describe the
 * rows on screen. It was settled twice, because the count query was written out
 * separately from the list query and drifted from it twice:
 *
 *   #370  `listTasks` filtered subtasks out and `getTaskCounts` did not, so the
 *         header read "3 completed" over a list with no completed rows.
 *   #613  `getTaskCounts` ignored every filter the URL carries, so
 *         `/tasks?category=follow_up` rendered
 *
 *             header: "1 active / 2 completed"    list: "No tasks found"
 *
 *         on a production preview — first paint, no caching involved. A header
 *         that promises a completed task the filter excludes is also what makes
 *         "Show Completed" read as a dead control: the planter clicks it, the
 *         list does not move, and the badge said there was something to see
 *         (#611).
 *
 * The badges are no longer built from a predicate list of their own, so the
 * drift has nowhere to happen. These render the SQL each reader would send and
 * compare it. No database.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { and, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  checklistCountQuery,
  taskCountConditions,
  taskListConditions,
  type TaskCountScope,
} from "./service";

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const PLANTER = "33333333-3333-4333-8333-333333333333";
const PARENT_ONLY = `"tasks"."parent_task_id" is null`;

const dialect = new PgDialect();

function renderConditions(conditions: SQL[]): string {
  return dialect.sqlToQuery(and(...conditions)!).sql;
}

// ----------------------------------------------------------------------------
// #613 — the badges narrow with the list.
// ----------------------------------------------------------------------------

/**
 * Every filter the URL can narrow the list by (`parseTaskListSearchParams`).
 * `includeCompleted` is deliberately absent: it is a display toggle over the
 * population rather than part of it, so `TaskCountScope` has no room for it and
 * the badges force it on. Without that the "N completed" badge would read 0 in
 * the one view where the number matters — the one whose toggle would reveal
 * them — and the toggle would be back to looking dead.
 */
const NARROWING_FILTERS: TaskCountScope[] = [
  { category: ["follow_up"] },
  { priority: ["urgent"] },
  { status: ["blocked"] },
  { assignedToId: PLANTER },
  { category: ["follow_up"], priority: ["high"], assignedToId: PLANTER },
];

for (const filters of NARROWING_FILTERS) {
  const name = Object.keys(filters).join("+");

  test(`the badges apply the list's ${name} filter`, () => {
    const listed = renderConditions(
      taskListConditions(CHURCH_ID, { ...filters, includeCompleted: true })
    );

    assert.equal(
      renderConditions(taskCountConditions(CHURCH_ID, filters)),
      listed,
      `the badges must count what the ${name} list renders`
    );
  });
}

test("an unfiltered page counts the whole unfiltered list", () => {
  // Also pins the one deliberate difference: the badges see completed rows the
  // list is hiding, and nothing else about the two readings differs.
  const listed = renderConditions(
    taskListConditions(CHURCH_ID, { includeCompleted: true })
  );

  assert.equal(renderConditions(taskCountConditions(CHURCH_ID)), listed);
});

// ----------------------------------------------------------------------------
// #370 — and they still count TASKS, not checklist items.
// ----------------------------------------------------------------------------

test("the count query excludes subtasks, exactly as the list does", () => {
  const listed = renderConditions(taskListConditions(CHURCH_ID));
  const counted = renderConditions(taskCountConditions(CHURCH_ID));

  assert.ok(
    listed.includes(PARENT_ONLY),
    `the list should exclude subtasks, got: ${listed}`
  );
  assert.ok(
    counted.includes(PARENT_ONLY),
    `the badges should exclude subtasks, got: ${counted}`
  );
});

test("the badges exclude subtasks in the completed view too", () => {
  // The view that exposed the contradiction: `?view=all&includeCompleted=true`.
  const listed = renderConditions(
    taskListConditions(CHURCH_ID, { includeCompleted: true })
  );

  assert.ok(listed.includes(PARENT_ONLY));
  assert.ok(
    renderConditions(taskCountConditions(CHURCH_ID)).includes(PARENT_ONLY)
  );
});

test("no option makes the badges count checklist items as tasks", () => {
  // `listTasks` has an `includeSubtasks` escape hatch for callers that really
  // want the rows. The badges have none, and since #613 that is a fact about
  // the TYPE rather than about this comment: `TaskCountScope` omits the option,
  // so the line below does not compile.
  const withSubtasks = renderConditions(
    taskListConditions(CHURCH_ID, { includeSubtasks: true })
  );
  assert.ok(!withSubtasks.includes(PARENT_ONLY));

  // The hatch is absent from the badges' TYPE, so the hole cannot be reopened
  // by a caller. `pnpm typecheck` is the half of CI that enforces it — tsx
  // strips types at run time, so the directive below, not an assertion, is what
  // fails the build if `TaskCountScope` ever grows the option back.
  // @ts-expect-error — `includeSubtasks` is not on `TaskCountScope`.
  const reopened: TaskCountScope = { includeSubtasks: true };
  void reopened;

  assert.ok(
    renderConditions(taskCountConditions(CHURCH_ID)).includes(PARENT_ONLY)
  );
});

// ----------------------------------------------------------------------------
// The checklist line follows its parent into and out of the filtered view.
//
// The half of #613 that is otherwise unreachable: the join turns on a private
// alias, so `checklistCountQuery` is handed back un-awaited and rendered here.
// The failure this guards is quiet — let `includeCompleted` default through
// onto the PARENT side and every completed task's checklist drops off the line,
// with nothing on screen to say so.
// ----------------------------------------------------------------------------

function renderChecklistWhere(options: TaskCountScope = {}): string {
  return checklistCountQuery(CHURCH_ID, options).toSQL().sql;
}

test("the checklist line narrows by the parent, under the page's filters", () => {
  const sql = renderChecklistWhere({
    category: ["follow_up"],
    assignedToId: PLANTER,
  });

  for (const predicate of [
    `"checklist_parent"."category" in`,
    `"checklist_parent"."assigned_to_id" =`,
    `"checklist_parent"."church_id" =`,
    `"checklist_parent"."deleted_at" is null`,
  ]) {
    assert.ok(sql.includes(predicate), `missing ${predicate}, got: ${sql}`);
  }
});

test("the checklist line still counts items under a COMPLETED parent", () => {
  // The regression that would zero the line: `status <> 'complete'` on the
  // parent. `taskCountConditions` forces `includeCompleted` on, so it cannot
  // appear — on either side of the join.
  const sql = renderChecklistWhere({ category: ["follow_up"] });

  assert.ok(
    !sql.includes(`"checklist_parent"."status" <>`),
    `the parent must not be filtered to incomplete tasks, got: ${sql}`
  );
});

test("the checklist line counts items, and the items are the child side", () => {
  const sql = renderChecklistWhere();

  // The child is what is being counted, so it is the side that must be a
  // subtask; the parent is the side that must not be one.
  assert.ok(sql.includes(`"tasks"."parent_task_id" is not null`));
  assert.ok(sql.includes(`"checklist_parent"."parent_task_id" is null`));
});
