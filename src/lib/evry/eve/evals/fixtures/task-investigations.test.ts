import assert from "node:assert/strict";
import { test } from "node:test";
import { observedTaskInvestigationFacts } from "./task-investigations";
import type { CapturedCall } from "./host-capture";

const parent = "00000000-0000-4000-8000-000000000001";
const child = "00000000-0000-4000-8000-000000000002";
const owner = "00000000-0000-4000-8000-000000000003";
const artifact = (
  items: {
    id: string;
    label: string;
    facts?: { label: string; value: string }[];
  }[],
  total = items.length
) => ({ kind: "read", counts: { matched: total }, items });
const query = (
  ids = [parent],
  total = ids.length,
  cursor = "0"
): CapturedCall => ({
  id: "q",
  name: "tasks.query",
  input: { query: { mode: "list", limit: 1, cursor } },
  output: artifact(
    ids.map((id) => ({ id, label: id })),
    total
  ),
});
const details = (
  section: "checklist" | "dependencies",
  offset = 0,
  total = 1,
  status = "Not Started",
  linked = child
): CapturedCall => {
  const label = section === "checklist" ? "Checklist item" : "Prerequisite";
  return {
    id: "d",
    name: "tasks.get_many",
    input: {
      ids: [parent],
      sections: [section],
      relatedLimit: 1,
      relatedOffset: offset,
    },
    output: artifact([
      {
        id: parent,
        label: parent,
        facts: [
          {
            label:
              section === "checklist"
                ? "Checklist total"
                : "Prerequisite total",
            value: String(total),
          },
          {
            label,
            value: `Child · ${status}${section === "dependencies" ? " · Alex" : ""}`,
          },
          {
            label: `${label} linkage`,
            value: `Child [${linked}]${section === "dependencies" ? ` account [${owner}]` : ""}`,
          },
        ],
      },
    ]),
  };
};

test("blocking evidence uses native linked prerequisite identity and account owner, not task status", () => {
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-04", [
      query(),
      details("dependencies"),
    ]),
    {
      facts: {
        taskIds: [parent],
        blockingEdges: [`${parent}:${child}:${owner}`],
      },
      evidence: ["complete-task-investigation"],
    }
  );
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-04", [query()]).evidence,
    []
  );
});
test("unfinished checklist evidence excludes completed children but requires every related page", () => {
  const open = details("checklist", 0, 2);
  const done = details("checklist", 1, 2, "Complete", owner);
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-09", [query(), open, done]),
    {
      facts: { taskIds: [parent], unfinishedChecklist: [`${parent}:${child}`] },
      evidence: ["complete-task-investigation"],
    }
  );
  for (const wrong of [
    [open],
    [done],
    [open, details("checklist", 2, 2, "Complete", owner)],
    [open, details("checklist", 1, 2)],
    [open, details("checklist", 0, 2, "Blocked")],
  ])
    assert.deepEqual(
      observedTaskInvestigationFacts("tasks-09", [query(), ...wrong]).evidence,
      []
    );
});
test("partial, overlapping, conflicting and cross-filter task pages cannot claim completeness", () => {
  for (const pages of [
    [query([parent], 2)],
    [query([parent], 2), query([child], 2, "2")],
    [query([parent], 2), query([parent], 2, "1")],
    [query([parent]), query([child])],
    [
      query([parent], 2),
      {
        ...query([child], 2, "1"),
        input: {
          where: { all: [{ status: ["complete"] }] },
          query: { mode: "list", limit: 1, cursor: "1" },
        },
      },
    ],
  ])
    assert.deepEqual(
      observedTaskInvestigationFacts("tasks-09", [
        ...pages,
        details("checklist"),
      ]).evidence,
      []
    );
});
test("checklist IDs without status or native linkage do not prove unfinished items", () => {
  const invalid = details("checklist");
  invalid.output = artifact([
    {
      id: parent,
      label: parent,
      facts: [
        { label: "Checklist total", value: "1" },
        { label: "Checklist item", value: "Child" },
        { label: "Checklist item linkage", value: `Child [${child}]` },
      ],
    },
  ]);
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-09", [query(), invalid]).evidence,
    []
  );
});
test("Sunday buckets do not leak next Monday into later this week", () => {
  const rows = ["Sep 19, 2026", "Sep 20, 2026", "Sep 21, 2026"].map(
    (date, index) => ({
      id: String(index),
      label: date,
      facts: [
        { label: "Due date", value: date },
        { label: "Status", value: "Not Started" },
      ],
    })
  );
  const q = { ...query(), output: artifact(rows) };
  assert.deepEqual(observedTaskInvestigationFacts("tasks-02", [q]).facts, {
    overdueIds: ["0"],
    todayIds: ["1"],
    laterThisWeekIds: [],
    unbucketedIds: ["2"],
  });
});
test("tasks for named people require eligible account discovery, not matching person IDs", () => {
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-11", [query()]).evidence,
    []
  );
  const account: CapturedCall = {
    id: "a",
    name: "tasks.assignees.search",
    input: { search: "Alex", limit: 50 },
    output: artifact([{ id: owner, label: "Alex Rivera" }]),
  };
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-11", [account, query()]).facts,
    { taskIds: [parent], resolvedAccounts: [owner] }
  );
});

test("malformed discovery and unrelated detail inputs cannot create investigation evidence", () => {
  for (const input of [null, [], "Alex", { cursor: "not-an-offset" }]) {
    const account: CapturedCall = {
      id: "a",
      name: "tasks.assignees.search",
      input,
      output: artifact([{ id: owner, label: "Alex Rivera" }]),
    };
    assert.deepEqual(
      observedTaskInvestigationFacts("tasks-11", [account, query()]).evidence,
      []
    );
  }
  const unrelated = details("checklist");
  unrelated.input = { ids: [owner], sections: ["checklist"] };
  assert.deepEqual(
    observedTaskInvestigationFacts("tasks-09", [query(), unrelated]).evidence,
    []
  );
});
