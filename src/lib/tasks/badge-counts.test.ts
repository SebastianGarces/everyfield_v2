/**
 * THE BADGES COUNT THE LIST'S OWN POPULATION (#613, discharging #370 decision C).
 *
 * The header over `/tasks` reports "N active / M completed" above the list that
 * `listTasks` renders. The ruling on #370 is that those numbers describe the
 * rows on screen — `topLevelTasksOnly` exists because they once did not.
 *
 * Subtasks were only half of it. `getTaskCounts` also ignored every filter the
 * URL carries, so `/tasks?category=follow_up` rendered
 *
 *     header: "1 active / 2 completed"      list: "No tasks found"
 *
 * on a production preview — first paint, no caching involved. A header that
 * promises a completed task the filter excludes is also what makes "Show
 * Completed" read as a dead control: the planter clicks it, the list does not
 * change, and the badge said there was something to see (#611).
 *
 * These render the SQL both readers would send and compare it. No database.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { and, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  taskCountConditions,
  taskListConditions,
  type ListTasksOptions,
} from "./service";

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const PLANTER = "33333333-3333-4333-8333-333333333333";

const dialect = new PgDialect();

function renderConditions(conditions: SQL[]): string {
  return dialect.sqlToQuery(and(...conditions)!).sql;
}

/**
 * Every filter the URL can narrow the list by (`parseTaskListSearchParams`).
 * `includeCompleted` is deliberately absent — it is the one option the badges
 * do not share, and the test below pins that difference on its own.
 */
const NARROWING_FILTERS: ListTasksOptions[] = [
  { category: ["follow_up"] },
  { priority: ["urgent"] },
  { status: ["blocked"] },
  { assignedToId: PLANTER },
  { category: ["follow_up"], priority: ["high"], assignedToId: PLANTER },
];

for (const filters of NARROWING_FILTERS) {
  const name = Object.keys(filters).join("+");

  test(`the badges apply the list's ${name} filter`, () => {
    // The list's own predicates, minus the completed toggle — the badges have
    // to see completed rows to count them, and that is the only difference.
    const listed = renderConditions(
      taskListConditions(CHURCH_ID, { ...filters, includeCompleted: true })
    );
    const counted = renderConditions(taskCountConditions(CHURCH_ID, filters));

    assert.equal(
      counted,
      listed,
      `the badges must count what the ${name} list renders`
    );
  });
}

test("the badges see completed rows even when the list hides them", () => {
  // `includeCompleted` is a display toggle over the population, not part of it.
  // If the badges inherited it, "N completed" would read 0 in the only view
  // where the number matters — the one whose toggle would reveal them.
  const counted = renderConditions(taskCountConditions(CHURCH_ID));

  assert.ok(
    !counted.includes(`"tasks"."status" <> $`),
    `the badges must not exclude completed tasks, got: ${counted}`
  );
});

test("an unfiltered page counts the whole unfiltered list", () => {
  const listed = renderConditions(
    taskListConditions(CHURCH_ID, { includeCompleted: true })
  );

  assert.equal(renderConditions(taskCountConditions(CHURCH_ID)), listed);
});
