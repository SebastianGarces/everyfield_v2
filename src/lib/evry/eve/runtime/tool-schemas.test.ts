import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createEveToolRegistry } from "../capabilities/registry";
import {
  evePreparationInputSchema,
  evePreparations,
  selectedEvePreparationSchema,
} from "../preparation";
import { eveRuntimeToolSchema } from "./tool-schemas";

test("every preparation is discoverable individually without carrying unrelated operation schemas", () => {
  for (const entry of evePreparations) {
    const selected = selectedEvePreparationSchema([entry.id]);
    const schema = z.toJSONSchema(selected, { io: "input" });
    assert.deepEqual(
      schema,
      z.toJSONSchema(eveRuntimeToolSchema("actions.prepare", [entry.id]), {
        io: "input",
      })
    );
    assert.equal(
      selected.safeParse({
        request: { operation: "actions.confirm", arguments: {} },
      }).success,
      false
    );
  }
  const fullBytes = Buffer.byteLength(
    JSON.stringify(z.toJSONSchema(evePreparationInputSchema, { io: "input" }))
  );
  const meetingBytes = Buffer.byteLength(
    JSON.stringify(
      z.toJSONSchema(selectedEvePreparationSchema(["recipe.meeting-invite"]), {
        io: "input",
      })
    )
  );
  assert.ok(
    meetingBytes < 12_000,
    `Meeting definition grew to ${meetingBytes} bytes`
  );
  assert.ok(meetingBytes < fullBytes / 5);
  assert.throws(() => selectedEvePreparationSchema([]), /Select/);
  assert.throws(
    () => selectedEvePreparationSchema(["actions.confirm"]),
    /Unknown/
  );
});

test("durable schema loader exposes exactly the same schemas as the invoked registry", () => {
  const registry = createEveToolRegistry({
    context: {
      actor: { userId: "schema-test", plantId: "schema-test" },
      literalUserText: "",
      pageContext: null,
      now: new Date(0),
    },
    authorizeRead: async () => null,
    readActionStatus: async () => ({ status: "unavailable" }),
    selectResult: () => ({ status: "unavailable" }),
    preparation: {
      inputSchema: evePreparationInputSchema,
      prepare: async () => null,
    },
  });
  for (const entry of registry.describe())
    assert.deepEqual(
      z.toJSONSchema(eveRuntimeToolSchema(entry.name), { io: "input" }),
      z.toJSONSchema(entry.inputSchema, { io: "input" }),
      entry.name
    );
  for (const [name, input] of [
    ["tasks.query", { resource: "templates" }],
    ["tasks.query", { resource: "phase_prompt" }],
    ["intelligence.query", { query: { resource: "checkins" } }],
    ["intelligence.query", { query: { resource: "feedback" } }],
    ["intelligence.query", { query: { resource: "signals" } }],
    ["communication.query", { query: { resource: "merge_context" } }],
    [
      "people.query",
      {
        cohort: { all: { tags: { names: ["Welcome"] } } },
        result: { mode: "list" },
      },
    ],
    [
      "people.get_many",
      {
        resource: "person",
        ids: ["00000000-0000-4000-8000-000000000001"],
        fields: ["tags", "skills"],
      },
    ],
  ] as const)
    assert.equal(
      eveRuntimeToolSchema(name).safeParse(input).success,
      true,
      name
    );
  assert.throws(() => eveRuntimeToolSchema("actions.confirm"), /Unknown/);
});
