import assert from "node:assert/strict";
import { test } from "node:test";
import { hasForeignFixtureRecords, observedFixtureFacts } from "./adapter";

test("tenant isolation checks unpresented reads while answer facts use selected results", () => {
  const read = (id: string, recordId: string) => ({
    id,
    name: "tasks.query",
    input: {},
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [{ id: recordId, label: "Task" }],
    },
  });
  const calls = [
    read("shown", "permitted-task"),
    read("hidden", "foreign-task"),
  ];
  const observed = observedFixtureFacts(
    "regression-today",
    calls,
    new Set(["shown"])
  );
  assert.deepEqual(observed.facts.taskIds, ["permitted-task"]);
  assert.equal(observed.facts.total, 1);
  assert.deepEqual(observed.exposedRecordIds, ["permitted-task"]);
  assert.equal(hasForeignFixtureRecords(calls, ["foreign-task"]), true);
  assert.equal(
    hasForeignFixtureRecords(calls, ["different-foreign-task"]),
    false
  );
  assert.equal(
    hasForeignFixtureRecords(
      [read("chunk", "foreign-page:0")],
      ["foreign-page"]
    ),
    true
  );
  assert.equal(
    hasForeignFixtureRecords(
      [read("link", "person:foreign-person")],
      ["foreign-person"]
    ),
    true
  );
});
