import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createEveToolRegistry } from "../capabilities/registry";
import { evePreparationInputSchema } from "../preparation";
import { eveRuntimeToolSchema } from "./tool-schemas";

test("durable schema loader exposes exactly the same schemas as the invoked registry", () => {
  const registry = createEveToolRegistry({
    context: {
      actor: { userId: "schema-test", plantId: "schema-test" },
      literalUserText: "",
      pageContext: null,
      now: new Date(0),
    },
    authorizeRead: async () => null,
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
