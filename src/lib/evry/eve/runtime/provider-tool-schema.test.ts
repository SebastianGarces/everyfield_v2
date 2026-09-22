import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateText,
  streamText,
  tool,
  wrapLanguageModel,
  asSchema,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { createOpenAI as createEveOpenAI } from "../../../../../node_modules/eve/dist/src/compiled/@ai-sdk/openai/index.js";
import { defineDurableSchema } from "../../../../../node_modules/eve/dist/src/tools/durable-schema.js";
import { serializeInputSchema } from "../../../../../node_modules/eve/dist/src/tools/schema.js";
import {
  compactProviderSchema,
  eveProviderToolSchema,
} from "./provider-tool-schema";
import { eveRuntimeToolSchema } from "./tool-schemas";
import { evryToolSchemaMiddleware } from "./model";
import { EVE_CAPABILITY_CATALOG } from "../capabilities/catalog";
import { evePreparations } from "../preparation";

/** Expand only the library's local references to compare the complete schemas. */
function expanded(schema: unknown) {
  const root = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(JSON.stringify(schema)));
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const record = z.record(z.string(), z.unknown()).parse(value);
    if (typeof record.$ref === "string") {
      assert.match(record.$ref, /^#\/(?:\$defs|definitions)\//);
      let resolved: unknown = root;
      for (const token of record.$ref.slice(2).split("/")) {
        resolved = z.record(z.string(), z.unknown()).parse(resolved)[
          token.replaceAll("~1", "/").replaceAll("~0", "~")
        ];
      }
      assert.ok(resolved);
      const { $ref: _reference, ...siblings } = record;
      assert.equal(
        Object.keys(siblings).length,
        0,
        "Draft-7 reference siblings must not hide assertions"
      );
      const target = z.record(z.string(), z.unknown()).parse(visit(resolved));
      return { ...target, ...visitObject(siblings) };
    }
    return visitObject(record);
  }
  function visitObject(
    value: Record<string, unknown>
  ): Record<string, unknown> {
    if (Array.isArray(value.allOf) && value.allOf.length === 1) {
      const { allOf, ...siblings } = value;
      const target = z.record(z.string(), z.unknown()).parse(visit(allOf[0]));
      for (const key of Object.keys(siblings))
        if (Object.hasOwn(target, key))
          assert.deepEqual(target[key], visit(siblings[key]));
      return { ...target, ...visitObject(siblings) };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "$defs" && key !== "definitions")
        .map(([key, child]) => [key, visit(child)])
    );
  }
  return visit(root);
}

const names = ["people.query", "people.history.query", "attendance.query"];

test("all capabilities and individually selected preparations preserve their expanded provider contract", async () => {
  const selections: { name: string; operations?: readonly string[] }[] = [
    ...EVE_CAPABILITY_CATALOG.filter(
      ([name]) => name !== "actions.prepare"
    ).map(([name]) => ({ name })),
    ...evePreparations.map(({ id }) => ({
      name: "actions.prepare",
      operations: [id],
    })),
  ];
  for (const { name, operations } of selections) {
    const original = eveRuntimeToolSchema(name, operations);
    const compact = compactProviderSchema(original);
    assert.equal(compact["~standard"].validate, original["~standard"].validate);
    assert.deepEqual(
      expanded(await asSchema(compact).jsonSchema),
      expanded(z.toJSONSchema(original, { target: "draft-7", io: "input" })),
      `${name}: ${operations?.join(",") ?? "read"}`
    );
    assert.deepEqual(
      expanded(
        await asSchema(eveProviderToolSchema(name, operations)).jsonSchema
      ),
      expanded(await asSchema(compact).jsonSchema)
    );
  }
  assert.ok(selections.length > 100);
});

test("equivalence proof resolves escaped local pointers and refuses assertion siblings", () => {
  assert.deepEqual(
    expanded({
      type: "object",
      properties: { first: { $ref: "#/definitions/a~1b~0c" } },
      definitions: { "a/b~c": { type: "string", minLength: 2 } },
    }),
    { type: "object", properties: { first: { type: "string", minLength: 2 } } }
  );
  assert.throws(
    () =>
      expanded({
        $ref: "#/definitions/entry",
        minLength: 2,
        definitions: { entry: { type: "string" } },
      }),
    /reference siblings/
  );
});

test("library references preserve every expanded input keyword and reduce loaded schemas", async () => {
  let before = 0;
  let after = 0;
  for (const name of names) {
    const schema = eveRuntimeToolSchema(name);
    const original = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
    const compact = await asSchema(eveProviderToolSchema(name)).jsonSchema;
    assert.deepEqual(expanded(compact), expanded(original), name);
    before += JSON.stringify(original).length;
    after += JSON.stringify(compact).length;
    assert.ok(JSON.stringify(compact).includes("#/definitions/"));
  }
  assert.ok(after < before * 0.6, `${before} -> ${after}`);
});

test("original Zod validator, defaults, nullable values and refinements remain authoritative", async () => {
  const range = z
    .strictObject({ from: z.number(), through: z.number() })
    .refine((value) => value.from <= value.through, "Ordered range required");
  const original = z.strictObject({
    first: range,
    second: range.optional(),
    optional: z.string().optional(),
    nullable: z.string().nullable(),
    limit: z.number().int().min(1).max(50).default(20),
  });
  const compact = compactProviderSchema(original);
  assert.equal(compact["~standard"].validate, original["~standard"].validate);
  assert.equal(
    compact["~standard"].jsonSchema.output,
    original["~standard"].jsonSchema.output
  );
  const inputs = [
    { first: { from: 1, through: 2 }, nullable: null },
    { first: { from: 1, through: 2 }, nullable: "x", optional: "", limit: 50 },
    { first: { from: 3, through: 2 }, nullable: null },
    { first: { from: 1, through: 2 }, nullable: null, limit: 51 },
    { first: { from: 1, through: 2 }, nullable: null, limit: 1.5 },
    { first: { from: 1, through: 2 } },
    { first: { from: 1, through: 2 }, nullable: null, surprise: true },
  ];
  for (const input of inputs) {
    assert.deepEqual(
      await compact["~standard"].validate(input),
      await original["~standard"].validate(input)
    );
  }
  assert.deepEqual(await compact["~standard"].validate(inputs[0]), {
    value: { first: { from: 1, through: 2 }, nullable: null, limit: 20 },
  });
  assert.deepEqual(
    expanded(compact["~standard"].jsonSchema.input()),
    expanded(z.toJSONSchema(original, { target: "draft-7", io: "input" }))
  );
});

test("Eve durable schema restoration calls the factory with scalar selections and retains validation", async () => {
  const closure = {
    name: "people.history.query",
    preparations: [] as string[],
  };
  const restored = defineDurableSchema({
    closure,
    schema: ({ name, preparations }) =>
      eveProviderToolSchema(name, preparations),
  });
  const serialized = serializeInputSchema(restored);
  assert.ok(JSON.stringify(serialized).includes("#/definitions/"));
  const input = { resource: { kind: "assessments" }, result: { mode: "list" } };
  assert.deepEqual(
    await restored["~standard"].validate(input),
    await eveRuntimeToolSchema(closure.name)["~standard"].validate(input)
  );
  const failed = await restored["~standard"].validate({
    ...input,
    contentOffset: -1,
  });
  assert.ok(failed.issues);
});

for (const [adapter, create] of [
  ["direct installed OpenAI", createOpenAI],
  ["Eve bundled OpenAI", createEveOpenAI],
] as const) {
  for (const mode of ["generate", "stream"] as const) {
    test(`${adapter} ${mode} preserves local references in the actual outbound request`, async () => {
      let captured: unknown;
      let requests = 0;
      const boundary = new Error("Captured fixture request; network disabled");
      const provider = create({
        apiKey: "fixture-not-a-key",
        fetch: async (_url, options) => {
          requests++;
          const body = options?.body;
          assert.equal(typeof body, "string");
          if (typeof body !== "string")
            assert.fail("Expected a JSON request body");
          captured = JSON.parse(body);
          throw boundary;
        },
      });
      const model = wrapLanguageModel({
        model: provider.responses("gpt-5.6-luna"),
        middleware: evryToolSchemaMiddleware,
      });
      const compact = eveProviderToolSchema("people.history.query");
      const options = {
        model,
        prompt: "Schema transport fixture only.",
        maxRetries: 0,
        onError: () => {},
        tools: { people_history_query: tool({ inputSchema: compact }) },
      };
      await assert.rejects(
        async () => {
          if (mode === "generate") await generateText(options);
          else {
            const result = streamText(options);
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error;
            }
          }
        },
        (error) => {
          const seen = new Set<unknown>();
          while (error instanceof Error && !seen.has(error)) {
            if (error === boundary) return true;
            seen.add(error);
            error = error.cause;
          }
          return false;
        }
      );
      assert.equal(requests, 1);
      const request = z
        .object({
          tools: z.array(
            z.object({
              type: z.literal("function"),
              name: z.string(),
              strict: z.boolean(),
              parameters: z.record(z.string(), z.unknown()),
            })
          ),
        })
        .parse(captured);
      assert.equal(request.tools.length, 1);
      assert.equal(request.tools[0].name, "people_history_query");
      assert.equal(request.tools[0].strict, false);
      const sent = request.tools[0].parameters;
      assert.ok(JSON.stringify(sent).includes("#/definitions/"));
      assert.deepEqual(
        expanded(sent),
        expanded(await asSchema(compact).jsonSchema)
      );
      assert.deepEqual(
        sent,
        JSON.parse(JSON.stringify(await asSchema(compact).jsonSchema))
      );
    });
  }
}
