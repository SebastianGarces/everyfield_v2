import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapLanguageModel, zodSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { evryLunaModel, evryToolSchemaMiddleware } from "./model";

test("Luna tool adapter explicitly disables provider strict normalization but preserves input schema", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("captured test invocation");
    },
  });
  const wrapped = wrapLanguageModel({
    model,
    middleware: evryToolSchemaMiddleware,
  });
  const schema = {
    type: "object" as const,
    properties: { optionalFilter: { type: "string" as const } },
    additionalProperties: false,
  };
  await assert.rejects(
    async () =>
      wrapped.doGenerate({
        prompt: [],
        tools: [
          {
            type: "function",
            name: "query",
            inputSchema: schema,
            strict: true,
          },
        ],
      }),
    /captured test invocation/
  );
  const actual = model.doGenerateCalls[0].tools?.[0];
  assert.equal(actual?.type, "function");
  if (actual?.type !== "function") assert.fail("Missing tool call");
  assert.equal(actual.strict, false);
  assert.deepEqual(actual.inputSchema, schema);
  assert.equal(evryLunaModel.modelId, "gpt-5.6-luna");
  assert.equal(evryLunaModel.provider.startsWith("openai"), true);
});

test("every discovered capability has an OpenAI object-root schema and disables provider normalization", async () => {
  const { describeEveRuntimeTools } = await import("./registry");
  const descriptions = describeEveRuntimeTools({
    userId: "test-user",
    plantId: "test-plant",
    appSessionId: "0".repeat(64),
  });
  assert.ok(descriptions.length >= 23);
  const tools = await Promise.all(
    descriptions.map(async (tool) => {
      const inputSchema = await zodSchema(tool.inputSchema).jsonSchema;
      assert.equal(
        inputSchema.type,
        "object",
        `${tool.name} must have an object root`
      );
      return {
        type: "function" as const,
        name: tool.name.replaceAll(".", "_"),
        inputSchema,
        strict: true,
      };
    })
  );
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("captured test invocation");
    },
  });
  const wrapped = wrapLanguageModel({
    model,
    middleware: evryToolSchemaMiddleware,
  });
  await assert.rejects(
    async () => wrapped.doGenerate({ prompt: [], tools }),
    /captured test invocation/
  );
  for (const actual of model.doGenerateCalls[0].tools ?? []) {
    assert.equal(actual.type, "function");
    if (actual.type !== "function") assert.fail("Unexpected provider tool");
    assert.equal(actual.strict, false, actual.name);
  }
});
