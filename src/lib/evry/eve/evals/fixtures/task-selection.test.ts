import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import { fixtureMessageSchema } from "../http/transcript";
import {
  bindTaskSelectionTurns,
  taskSelectionDependencies,
  taskSelectionFixtureIds,
  taskSelectionRequest,
  taskSelectionSetup,
  taskSelectionVisibleIds,
} from "./task-selection";
const ids = Array.from(
  { length: 5 },
  (_, i) => `11111111-1111-4111-8111-11111111111${i}`
);
const prerequisite = "22222222-2222-4222-8222-222222222222";
const link = { label: "Tasks", href: "/tasks" };
const output = {
  kind: "read",
  title: "Tasks",
  counts: { matched: 5, returned: 5, excluded: 0 },
  filters: [],
  exclusions: [],
  sourceLinks: [link],
  items: ids.map((id) => ({
    id,
    label: `Task ${id.slice(-1)}`,
    facts: [],
    sourceLink: { ...link, href: `/tasks/${id}` },
  })),
};
const call: CapturedCall = {
  id: "selection",
  name: "tasks.query",
  input: { query: { mode: "list" } },
  output,
};
function transcript() {
  return [
    fixtureMessageSchema.parse({
      id: "u0",
      role: "user",
      parts: [{ type: "text", text: taskSelectionSetup }],
    }),
    fixtureMessageSchema.parse({
      id: "a0",
      role: "assistant",
      metadata: { turnId: "turn_0", status: "complete" },
      parts: [
        {
          type: "dynamic-tool",
          toolName: "tasks_query",
          toolCallId: "selection",
          state: "output-available",
          input: call.input,
          output: {
            data: output,
            presentation: {
              version: 1,
              turnId: "turn_0",
              results: [{ reference: "selection", artifacts: [output] }],
            },
          },
        },
        {
          type: "text",
          text: "Here are the five tasks. [[evry-result:selection]]",
        },
      ],
    }),
    fixtureMessageSchema.parse({
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: taskSelectionRequest }],
    }),
  ];
}
test("original tasks-10 question stays exact after a visible setup request without IDs", () => {
  assert.deepEqual(taskSelectionFixtureIds, ["tasks-10"]);
  const turns = questions.find((q) => q.id === "tasks-10")!.turns;
  assert.deepEqual(turns, [taskSelectionRequest]);
  assert.deepEqual(bindTaskSelectionTurns(turns), [
    taskSelectionSetup,
    taskSelectionRequest,
  ]);
  assert.throws(() => bindTaskSelectionTurns(["Complete these IDs"]));
  assert.doesNotMatch(
    bindTaskSelectionTurns(turns).join(" "),
    /[a-f\d]{8}-[a-f\d-]{27}/i
  );
});
test("five actual projected task records must precede the original user request", () => {
  const messages = transcript();
  assert.deepEqual(
    taskSelectionVisibleIds(messages, [call], new Set([call.id])),
    ids
  );
  assert.deepEqual(taskSelectionVisibleIds(messages, [call], new Set()), []);
  assert.deepEqual(
    taskSelectionVisibleIds(
      [messages[0], messages[2], messages[1]],
      [call],
      new Set([call.id])
    ),
    []
  );
  assert.deepEqual(
    taskSelectionVisibleIds(undefined, [call], new Set([call.id])),
    []
  );
  assert.deepEqual(
    taskSelectionVisibleIds(
      messages,
      [{ ...call, output: {} }],
      new Set([call.id])
    ),
    []
  );
  assert.deepEqual(
    taskSelectionVisibleIds(
      messages,
      [{ ...call, output: { ...output, items: output.items.slice(0, 4) } }],
      new Set([call.id])
    ),
    []
  );
  const noMarker = transcript();
  noMarker[1]!.parts = noMarker[1]!.parts.filter((p) => p.type !== "text");
  assert.deepEqual(
    taskSelectionVisibleIds(noMarker, [call], new Set([call.id])),
    []
  );
  const rawIds = transcript();
  rawIds[1]!.parts = [{ type: "text", text: ids.join(",") }];
  assert.deepEqual(
    taskSelectionVisibleIds(rawIds, [call], new Set([call.id])),
    []
  );
  const wrongTurn = transcript();
  wrongTurn[1]!.metadata = { turnId: "another", status: "complete" };
  assert.deepEqual(
    taskSelectionVisibleIds(wrongTurn, [call], new Set([call.id])),
    []
  );
});
function detail(offset = 0, total = 1, status = "Not Started"): CapturedCall {
  return {
    id: `detail-${offset}`,
    name: "tasks.get_many",
    input: {
      ids,
      sections: ["dependencies"],
      relatedLimit: 1,
      relatedOffset: offset,
    },
    output: {
      kind: "read",
      counts: { matched: 5 },
      items: ids.map((id, index) => ({
        id,
        label: "Task",
        facts: [
          {
            label: "Prerequisite total",
            value: index === 0 ? String(total) : "0",
          },
          ...(index === 0
            ? [
                {
                  label: "Prerequisite",
                  value: `Prerequisite · ${status} · Fixture Owner`,
                },
                {
                  label: "Prerequisite linkage",
                  value: `Prerequisite [${prerequisite}]`,
                },
              ]
            : []),
        ],
      })),
    },
  };
}
test("prerequisite evidence preserves actual identities and unfinished status without a completion veto", () => {
  assert.deepEqual(taskSelectionDependencies([detail()], ids), {
    dependencyTaskIds: ids,
    dependencies: [`${ids[0]}:${prerequisite}:Not Started`],
  });
  assert.deepEqual(
    taskSelectionDependencies([detail(0, 2)], ids).dependencyTaskIds,
    ids.slice(1)
  );
  assert.deepEqual(
    taskSelectionDependencies([detail(0, 2), detail(1, 2)], ids)
      .dependencyTaskIds,
    []
  );
  assert.deepEqual(
    taskSelectionDependencies([detail(), { ...detail(), output: {} }], ids)
      .dependencyTaskIds,
    []
  );
  const missing = detail();
  missing.output = {
    kind: "read",
    counts: { matched: 1 },
    items: [{ id: ids[0], label: "Task", facts: [] }],
  };
  assert.deepEqual(
    taskSelectionDependencies([missing], ids).dependencyTaskIds,
    []
  );
});
test("unrequested records cannot supply selected-task dependency evidence", () => {
  assert.deepEqual(
    taskSelectionDependencies(
      [
        {
          ...detail(),
          input: { ids: [prerequisite], sections: ["dependencies"] },
        },
      ],
      ids
    ),
    { dependencyTaskIds: [], dependencies: [] }
  );
});
