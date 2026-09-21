import assert from "node:assert/strict";
import { test } from "node:test";
import { hasForeignFixtureRecords, observedFixtureFacts } from "./adapter";
import type { CapturedCall } from "./host-capture";

test("launch evidence accepts actual team vacancy totals and server-clock upcoming reads", () => {
  const calls: CapturedCall[] = [
    {
      id: "teams",
      name: "teams.query",
      input: {
        request: {
          resource: "teams",
          where: { all: [{ hasVacancies: true }] },
        },
      },
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [
          {
            id: "team",
            label: "Hospitality",
            facts: [{ label: "Open role slots", value: "1" }],
          },
        ],
      },
    },
    {
      id: "meetings",
      name: "meetings.query",
      input: { where: { all: [{ timing: "upcoming" }] } },
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [{ id: "meeting", label: "Orientation" }],
      },
    },
  ];
  const observe = (records: CapturedCall[]) =>
    observedFixtureFacts("regression-launch-overview", records, new Set())
      .evidence;
  assert.deepEqual(observe(calls), ["open-roles", "upcoming-meetings"]);
  assert.deepEqual(observe(calls.map((call) => ({ ...call, input: {} }))), []);
  assert.deepEqual(
    observe([{ ...calls[1], input: { where: { all: [{ timing: "past" }] } } }]),
    []
  );
  assert.deepEqual(
    observe([
      { ...calls[1], input: { where: { any: [{ timing: "upcoming" }, {}] } } },
    ]),
    []
  );
  for (const value of ["0", "Not recorded", "-1"]) {
    assert.deepEqual(
      observe([
        {
          ...calls[0],
          output: {
            kind: "read",
            counts: { matched: 1 },
            items: [
              {
                id: "team",
                label: "Hospitality",
                facts: [{ label: "Open role slots", value }],
              },
            ],
          },
        },
      ]),
      []
    );
  }
});

test("retrieved evidence and tenant isolation include unpresented reads; card exposure stays separate", () => {
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
  assert.deepEqual(observed.facts.taskIds, ["foreign-task"]);
  assert.equal(observed.facts.total, 1);
  assert.deepEqual(observed.exposedRecordIds, ["permitted-task"]);
  const textOnly = observedFixtureFacts("regression-today", calls, new Set());
  assert.deepEqual(textOnly.facts, observed.facts);
  assert.deepEqual(textOnly.evidence, observed.evidence);
  assert.deepEqual(textOnly.exposedRecordIds, []);
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
