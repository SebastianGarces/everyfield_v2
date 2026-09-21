import assert from "node:assert/strict";
import { test } from "node:test";
import { observedTaskQueryFacts } from "./task-queries";

const call = (
  mode: string,
  by: string | undefined,
  total: number,
  counts: number[]
) => ({
  id: "task-query",
  name: "tasks.query",
  input: { query: { mode, by } },
  output: {
    kind: "read",
    counts: { matched: total },
    items: counts.map((count, index) => ({
      id: `group-${index}`,
      label: "Fixture",
      facts: [{ label: "Count", value: String(count) }],
    })),
  },
});
test("group coverage uses summed records, not the number of groups", () => {
  const result = observedTaskQueryFacts("tasks-05", [
    call("group", "assignee", 7, [3, 2, 2]),
  ]);
  assert.deepEqual(result.facts, {
    groups: ["group-0:3", "group-1:2", "group-2:2"],
    total: 7,
  });
  assert.deepEqual(result.evidence, ["complete-task-query"]);
});
test("partial, wrong dimension, and count-only responses do not prove group coverage", () => {
  for (const wrong of [
    call("group", "assignee", 7, [3, 2]),
    call("group", "priority", 7, [7]),
    call("count", undefined, 7, []),
  ])
    assert.deepEqual(observedTaskQueryFacts("tasks-05", [wrong]).evidence, []);
});
test("a later partial result cannot borrow completeness from an earlier query", () => {
  assert.deepEqual(
    observedTaskQueryFacts("tasks-05", [
      call("group", "assignee", 7, [3, 2, 2]),
      call("group", "assignee", 7, [3]),
    ]).evidence,
    []
  );
});
test("task list proof requires all matched rows, with no card requirement", () => {
  assert.deepEqual(
    observedTaskQueryFacts("tasks-03", [call("list", undefined, 2, [0, 0])]),
    {
      facts: { taskIds: ["group-0", "group-1"] },
      evidence: ["complete-task-query"],
    }
  );
  assert.deepEqual(
    observedTaskQueryFacts("tasks-03", [call("list", undefined, 3, [0, 0])])
      .evidence,
    []
  );
});

const listPage = (
  cursor: string,
  ids: string[],
  where = { status: "pending" }
) => ({
  ...call("list", undefined, 3, []),
  input: { where, query: { mode: "list", limit: 2, cursor } },
  output: {
    kind: "read",
    counts: { matched: 3 },
    items: ids.map((id) => ({ id, label: id })),
  },
});

test("contiguous identical-query list pages establish complete unique evidence", () => {
  const first = listPage("0", ["a", "b"]);
  const result = observedTaskQueryFacts("tasks-03", [
    first,
    first,
    listPage("2", ["c"]),
  ]);
  assert.deepEqual(result.facts, { taskIds: ["a", "b", "c"] });
  assert.deepEqual(result.evidence, ["complete-task-query"]);
});

test("missing, overlapping, duplicated, conflicting and different-filter pages cannot claim coverage", () => {
  const first = listPage("0", ["a", "b"]);
  for (const pages of [
    [listPage("2", ["c"])],
    [first, listPage("3", ["c"])],
    [first, listPage("1", ["c"])],
    [first, listPage("2", ["b"])],
    [first, listPage("0", ["a", "c"]), listPage("2", ["d"])],
    [first, listPage("2", ["c"], { status: "complete" })],
    [
      first,
      {
        ...listPage("2", ["c"]),
        output: { ...listPage("2", ["c"]).output, counts: { matched: 4 } },
      },
    ],
  ])
    assert.deepEqual(observedTaskQueryFacts("tasks-03", pages).evidence, []);
});

test("group pages require contiguous unique groups whose record counts match the population", () => {
  const first = {
    ...call("group", "assignee", 7, [3, 2]),
    input: { query: { mode: "group", by: "assignee", limit: 2, cursor: "0" } },
  };
  const last = {
    ...call("group", "assignee", 7, [2]),
    input: { query: { mode: "group", by: "assignee", limit: 2, cursor: "2" } },
  };
  last.output.items[0].id = "group-2";
  assert.deepEqual(observedTaskQueryFacts("tasks-05", [first, last]).evidence, [
    "complete-task-query",
  ]);
  last.output.items[0].id = "group-0";
  assert.deepEqual(
    observedTaskQueryFacts("tasks-05", [first, last]).evidence,
    []
  );
});

test("complete list evidence independently groups stable assignee IDs, including unassigned tasks", () => {
  const account = "8edb66fa-3918-4136-83bc-df22110cbd25";
  const records = ["a", "b", "c"].map((id, index) => ({
    id,
    label: id,
    facts: [
      { label: "Assignee", value: index < 2 ? "Same Name" : "Unassigned" },
      {
        label: "Assignee account ID",
        value: index < 2 ? account : "Not recorded",
      },
    ],
  }));
  const listed = {
    ...call("list", undefined, 3, []),
    output: { kind: "read", counts: { matched: 3 }, items: records },
  };
  const grouped = { ...call("group", "assignee", 3, [2, 1]) };
  grouped.output.items[0].id = `Same Name [${account}]`;
  grouped.output.items[1].id = "Unassigned";
  assert.deepEqual(
    observedTaskQueryFacts("tasks-05", [listed]),
    observedTaskQueryFacts("tasks-05", [grouped])
  );
  records[0].facts[1].value = "Unavailable account";
  assert.deepEqual(observedTaskQueryFacts("tasks-05", [listed]).evidence, []);
});

test("untyped related record labels do not prove ministry grouping", () => {
  const list = call("list", undefined, 1, [1]);
  list.output.items[0].facts = [
    {
      label: "Related record linkage",
      value: "Hospitality [8edb66fa-3918-4136-83bc-df22110cbd25]",
    },
  ];
  assert.deepEqual(observedTaskQueryFacts("tasks-06", [list]).evidence, []);
});
