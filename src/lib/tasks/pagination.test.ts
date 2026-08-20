import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { keysetPage, orderByKeyset } from "@/lib/testing/keyset";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import { TASK_SORT_KEYS, type TaskSortableRow } from "./service";

// ----------------------------------------------------------------------------
// "LOAD MORE" ON /tasks CANNOT SKIP OR REPEAT A ROW (#320, P-006a).
//
// The button was a disabled placeholder — "Load more (Pagination coming soon)"
// — and behind it sat a cursor that could not have worked. `listTasks` ordered
// by the SORT KEY (due date by default) and paged with a predicate over
// `created_at`:
//
//     .orderBy(orderFn(sortColumn), desc(tasks.id))
//     …
//     sql`(${tasks.createdAt}, ${tasks.id}) < (${cursorTask.createdAt}, …)`
//
// Two different orders. Page two would have been "every task created before the
// last one on page one", which for a due-date-ordered list is neither the rows
// after the boundary nor a subset of them: rows due later but created earlier
// come back twice, rows due later and created later never come back at all.
//
// The fix is `TASK_SORT_KEYS` — one entry per sort mode naming the SQL
// expression AND the same key in TypeScript. ORDER BY and the cursor predicate
// read the SQL half; the walk below reads the TypeScript half, so it is paging
// by the order the query actually applies.
//
// Two tests, because neither holds alone: the walk proves paging by ONE key is
// sound, and the source scan proves the query pages by the key it orders by.
// ----------------------------------------------------------------------------

const LIMIT = 5;

/** A fixture whose due dates and creation order deliberately DISAGREE. */
function fixture(): (TaskSortableRow & { id: string })[] {
  const rows: (TaskSortableRow & { id: string })[] = [];

  for (let index = 0; index < 20; index += 1) {
    // Due dates run forward, creation runs backward: a cursor over `created_at`
    // walking a due-date-ordered list gets this fixture wrong on page one.
    const day = String(index + 1).padStart(2, "0");
    rows.push({
      id: `task-${String(index).padStart(2, "0")}`,
      dueDate: index % 4 === 3 ? null : `2026-03-${day}`,
      priority: "medium",
      status: "not_started",
      title: `Task ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 20 - index)),
    });
  }

  return rows;
}

test("two sequential pages share zero ids and cover the first 2×limit rows", () => {
  const rows = fixture();
  const key = TASK_SORT_KEYS.due_date.of;

  const first = keysetPage(rows, key, LIMIT);
  assert.equal(first.rows.length, LIMIT);
  assert.ok(first.nextCursor, "the fixture has more than one page");

  const second = keysetPage(rows, key, LIMIT, first.nextCursor);
  assert.equal(second.rows.length, LIMIT);

  const firstIds = first.rows.map((row) => row.id);
  const secondIds = second.rows.map((row) => row.id);

  // No duplicates ACROSS the boundary…
  const shared = firstIds.filter((id) => secondIds.includes(id));
  assert.deepEqual(shared, [], "a row came back on both pages");

  // …and none skipped: the union IS the first 2×limit rows of the full order.
  const expected = orderByKeyset(rows, key)
    .slice(0, LIMIT * 2)
    .map((row) => row.id);
  assert.deepEqual([...firstIds, ...secondIds], expected);
});

test("walking to the end covers every row exactly once, then stops", () => {
  const rows = fixture();
  const key = TASK_SORT_KEYS.due_date.of;

  const seen: string[] = [];
  let cursor: string | null = null;

  do {
    const page: { rows: typeof rows; nextCursor: string | null } = keysetPage(
      rows,
      key,
      LIMIT,
      cursor
    );
    seen.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor;
  } while (cursor);

  assert.deepEqual(
    seen,
    orderByKeyset(rows, key).map((row) => row.id)
  );
  assert.equal(
    new Set(seen).size,
    rows.length,
    "every row exactly once, and the cursor ran out"
  );
});

test("a null due date sorts last, in SQL and in the key alike", () => {
  const dialect = new PgDialect();
  const { sql } = dialect.sqlToQuery(TASK_SORT_KEYS.due_date.sql);

  assert.match(sql, /COALESCE\("tasks"\."due_date", '9999-12-31'\)/);
  assert.equal(
    TASK_SORT_KEYS.due_date.of({
      id: "x",
      dueDate: null,
      priority: "low",
      status: "not_started",
      title: "x",
      createdAt: new Date(0),
    }),
    "9999-12-31"
  );
});

test("listTasks orders by the same expression it pages by", () => {
  const source = stripComments(
    readFileSync(path.join(process.cwd(), "src/lib/tasks/service.ts"), "utf8")
  );
  const listTasks = sourceReader(source, "tasks/service.ts (stripped)").span(
    "export async function listTasks(",
    "export function taskCountConditions("
  );

  // ORDER BY reads the registry entry, and the id tie-break goes the SAME
  // direction — a row-value comparison cannot walk a mixed order.
  assert.ok(
    listTasks.includes("orderBy(orderFn(sortKey.sql), orderFn(tasks.id))"),
    "listTasks must order by the sort key and break ties in the same direction"
  );

  // Both cursor predicates compare that same expression, never a column of
  // their own choosing.
  const predicates = listTasks.match(/\$\{sortKey\.sql\}, \$\{tasks\.id\}/g);
  assert.equal(
    predicates?.length,
    2,
    "both the asc and desc cursor predicates must compare (sort key, id)"
  );

  // The bug, named so it cannot come back quietly.
  assert.ok(
    !listTasks.includes("${tasks.createdAt}, ${tasks.id}"),
    "the cursor must not compare created_at while ORDER BY uses another key"
  );
});
