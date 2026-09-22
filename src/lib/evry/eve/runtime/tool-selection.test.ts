import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveToolLoad,
  toolLoadSchema,
  toolSelectionSchema,
} from "./tool-selection";

const names = [
  "tasks.query",
  "meetings.query",
  "notifications.query",
  "context.get",
  "launch.query",
  "teams.query",
  "training.query",
  "people.query",
  "wiki.search",
  "actions.prepare",
];
const catalog = names.map((name) => ({ name }));
const preparations = [
  "recipe.meeting-invite",
  "tasks.bulk.reschedule",
  "tasks.bulk.complete",
  "communication.send",
];
const empty = { names: [], preparationOperations: [] };
const load = (current: Parameters<typeof resolveToolLoad>[0], input: unknown) =>
  resolveToolLoad(current, toolLoadSchema.parse(input), catalog, preparations);
const selection = (result: ReturnType<typeof load>) => {
  assert.equal(result.status, "loaded");
  return {
    names: result.loaded,
    preparationOperations: result.preparationOperations,
  };
};

test("the tool working set can switch modules without excluding any catalog capability", () => {
  for (const name of names.filter((name) => name !== "actions.prepare"))
    assert.deepEqual(selection(load(empty, { names: [name] })).names, [name]);
  assert.deepEqual(selection(load(empty, { names: [] })), empty);
  assert.deepEqual(
    selection(load(empty, { names: ["people.query", "people.query"] })).names,
    ["people.query"]
  );
  assert.equal(
    load(empty, { names: ["arbitrary.execute"] }).status,
    "rejected"
  );
  assert.equal(
    toolSelectionSchema.safeParse({ names: Array(9).fill("people.query") })
      .success,
    false
  );
});

test("weekly incremental loads retain exactly eight schemas, including repeated subsets", () => {
  const daily = selection(load(empty, { names: names.slice(0, 3) }));
  const combined = selection(load(daily, { names: names.slice(3, 8) }));
  assert.deepEqual(combined.names, names.slice(0, 8));
  assert.deepEqual(
    selection(load(combined, { names: names.slice(0, 3) })),
    combined
  );
  const before = structuredClone(combined);
  assert.deepEqual(load(combined, { names: ["wiki.search"] }), {
    status: "rejected",
    reason: "working_set_limit",
    current: combined,
    requested: {
      names: ["wiki.search"],
      preparationOperations: [],
      mode: "add",
    },
  });
  assert.deepEqual(combined, before);
  assert.deepEqual(
    selection(load(combined, { mode: "replace", names: ["wiki.search"] })),
    { names: ["wiki.search"], preparationOperations: [] }
  );
  assert.deepEqual(selection(load(combined, { names: [] })), empty);
});

test("read additions preserve exact preparation schemas and discovery never loads the full union", () => {
  const initial = selection(
    load(empty, {
      names: ["actions.prepare"],
      preparationOperations: [preparations[0]],
    })
  );
  const withRead = selection(load(initial, { names: ["tasks.query"] }));
  assert.deepEqual(withRead.preparationOperations, [preparations[0]]);
  const discovery = load(withRead, { names: ["actions.prepare"] });
  assert.deepEqual(selection(discovery), withRead);
  assert.ok("availablePreparationOperations" in discovery);
  assert.deepEqual(discovery.availablePreparationOperations, preparations);
  assert.deepEqual(
    selection(load(empty, { names: ["actions.prepare"] })),
    empty
  );
  const three = selection(
    load(withRead, {
      names: ["actions.prepare"],
      preparationOperations: preparations.slice(0, 3),
    })
  );
  assert.deepEqual(three.preparationOperations, preparations.slice(0, 3));
  for (const [operation, reason] of [
    [preparations[3], "working_set_limit"],
    ["arbitrary.execute", "unknown_preparation"],
  ]) {
    const before = structuredClone(three);
    const result = load(three, {
      names: ["actions.prepare", "people.query"],
      preparationOperations: [operation],
    });
    assert.equal(result.status, "rejected");
    assert.ok("reason" in result);
    assert.equal(result.reason, reason);
    assert.deepEqual(three, before);
  }
  assert.deepEqual(
    selection(load(three, { mode: "replace", names: ["tasks.query"] })),
    { names: ["tasks.query"], preparationOperations: [] }
  );
  assert.deepEqual(selection(load(three, { names: [] })), empty);
});

test("invalid requests leave caller state untouched and the command mode is not persisted selection", () => {
  const initial = selection(load(empty, { names: ["tasks.query"] }));
  const before = structuredClone(initial);
  for (const input of [
    { names: ["foreign.tool"] },
    { names: ["people.query"], preparationOperations: ["unknown.operation"] },
  ])
    assert.equal(load(initial, input).status, "rejected");
  assert.deepEqual(initial, before);
  assert.equal(
    toolSelectionSchema.safeParse({ ...initial, mode: "add" }).success,
    false
  );
  assert.equal(
    toolLoadSchema.safeParse({ names: ["tasks.query"], mode: "invented" })
      .success,
    false
  );
});
