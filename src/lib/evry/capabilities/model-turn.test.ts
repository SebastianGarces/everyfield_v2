import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { generateEvryModelTurn, parseEvryModelTurn } from "./model-turn";
import {
  modelDecision,
  scriptedConversationModel,
} from "./model-test-fixtures";

test("the actual provider response schema requires every field for OpenAI strict output", async () => {
  const scripted = scriptedConversationModel(modelDecision());
  await generateEvryModelTurn({ context: {}, reads: [] }, () => scripted.model);
  const { responseFormat } = z
    .object({
      responseFormat: z.object({
        type: z.literal("json"),
        schema: z.object({
          type: z.literal("object"),
          properties: z.record(z.string(), z.unknown()),
          required: z.array(z.string()),
          additionalProperties: z.literal(false),
        }),
      }),
    })
    .parse(scripted.calls[0]);
  assert.deepEqual(
    [...responseFormat.schema.required].sort(),
    Object.keys(responseFormat.schema.properties).sort(),
    "Defaults make input fields optional, which OpenAI rejects before generation"
  );
});

test("help and arbitrary paraphrases reach a real model boundary with storage disabled", async () => {
  for (const latestRequest of [
    "what can you do for me?",
    "please give me a list of people that need follow up",
    "hey, where should I start with this app?",
    "¿En qué me puedes ayudar?",
  ]) {
    const scripted = scriptedConversationModel(
      modelDecision({ response: "A model-written answer." })
    );
    const result = await generateEvryModelTurn(
      { context: { latestRequest }, reads: [] },
      () => scripted.model
    );
    assert.deepEqual(result, {
      kind: "reply",
      body: "A model-written answer.",
    });
    assert.equal(scripted.calls.length, 1);
    const call = scripted.calls[0] as {
      prompt: unknown;
      providerOptions: unknown;
      tools: unknown;
    };
    assert.ok(JSON.stringify(call.prompt).includes(latestRequest));
    assert.deepEqual(call.providerOptions, {
      openai: { store: false, serviceTier: "default", reasoningEffort: "none" },
    });
    assert.equal(
      call.tools,
      undefined,
      "no executable tools before classification"
    );
  }
});

test("provider output only permits catalog tool names, not discovery keys or invented tools", async () => {
  const scripted = scriptedConversationModel(modelDecision());
  await generateEvryModelTurn(
    { context: {}, reads: [{ id: "people.query" }] },
    () => scripted.model
  );
  const call = z
    .object({
      responseFormat: z.object({
        schema: z.object({
          properties: z.object({ readId: z.unknown() }),
        }),
      }),
    })
    .parse(scripted.calls[0]);
  const property = JSON.stringify(call.responseFormat.schema.properties.readId);
  assert.ok(property.includes('"people.query"'));
  assert.ok(property.includes('"tools.describe"'));
  assert.ok(!property.includes('"read:people.query"'));
  for (const readId of ["read:people.query", "invented.read"]) {
    const invalid = scriptedConversationModel(
      modelDecision({ readId, readInputJson: "{}" })
    );
    await assert.rejects(
      generateEvryModelTurn(
        { context: {}, reads: [{ id: "people.query" }] },
        () => invalid.model
      )
    );
  }
});

test("a direct tool choice without its schema becomes discovery before arguments can run", async () => {
  const scripted = scriptedConversationModel(
    modelDecision({
      readId: "tasks.query",
      readInputJson: "{}",
      continueReading: true,
    })
  );
  const input = {
    context: { latestRequest: "My pending tasks due today" },
    reads: [{ id: "tasks.query" }],
  };
  assert.deepEqual(await generateEvryModelTurn(input, () => scripted.model), {
    kind: "describe",
    ids: ["read:tasks.query"],
  });
  for (const kind of ["read", "action"] as const) {
    const result = await generateEvryModelTurn(
      {
        ...input,
        context: {
          ...input.context,
          requestedContracts: [
            { kind, id: "tasks.query", schema: { type: "object" } },
          ],
        },
      },
      () => scripted.model
    );
    assert.equal(result.kind, kind === "read" ? "read" : "describe");
  }
});

test("preparation discovery preserves action intent and never discovers unlisted tools", async () => {
  const scripted = scriptedConversationModel(
    modelDecision({
      classification: "application_action",
      readId: "actions.prepare",
      readInputJson: JSON.stringify({
        operation: "tasks.create",
        arguments: {},
      }),
    })
  );
  assert.deepEqual(
    await generateEvryModelTurn(
      { context: {}, reads: [], preparations: [{ id: "tasks.create" }] },
      () => scripted.model
    ),
    {
      kind: "describe",
      ids: ["action:tasks.create"],
      actionIntent: true,
    }
  );
  const unknown = await generateEvryModelTurn(
    { context: {}, reads: [] },
    () => scripted.model
  );
  assert.equal(
    unknown.kind,
    "prepare_action",
    "Unlisted operations stay on the runtime's refusal path."
  );
});

test("an inline schema does not add a redundant discovery round trip", async () => {
  const scripted = scriptedConversationModel(
    modelDecision({ readId: "tasks.query", readInputJson: "{}" })
  );
  const result = await generateEvryModelTurn(
    { context: {}, reads: [{ id: "tasks.query", schema: { type: "object" } }] },
    () => scripted.model
  );
  assert.equal(result.kind, "read");
});

test("policy refusals cannot carry a read or preparation across the boundary", () => {
  for (const classification of [
    "mixed",
    "unrelated",
    "theology_or_spiritual_guidance",
    "ambiguous",
  ]) {
    assert.deepEqual(
      parseEvryModelTurn(
        modelDecision({
          classification,
          response: "Please separate the application request.",
          readId: "tasks.follow-up-ownership",
          readInputJson: "{}",
          prepareOriginalRequest: true,
        })
      ),
      { kind: "reply", body: "Please separate the application request." }
    );
  }
});

test("read input stays structured, not a rewritten user phrase", () => {
  assert.deepEqual(
    parseEvryModelTurn(
      modelDecision({
        readId: "tasks.follow-up-ownership",
        readInputJson: '{"section":"contacts","cursor":null}',
      })
    ),
    {
      kind: "read",
      id: "tasks.follow-up-ownership",
      input: { section: "contacts", cursor: null },
    }
  );
});

test("conflicting or malformed model output fails without an operation", () => {
  for (const overrides of [
    { readId: "tasks.list", readInputJson: "not json" },
    { prepareOriginalRequest: true },
    { readId: "tasks.list", readInputJson: "{}", prepareOriginalRequest: true },
    {
      readId: "actions.prepare",
      readInputJson: '{"operation":"tasks.create","arguments":{}}',
    },
    { readInputJson: "{}" },
    { response: "" },
  ])
    assert.throws(() => parseEvryModelTurn(modelDecision(overrides)));
});

test("an action may resolve targets then prepare typed intent, never a read-authorized write", () => {
  assert.deepEqual(
    parseEvryModelTurn(
      modelDecision({
        classification: "application_action",
        readId: "people.query",
        readInputJson: "{}",
        continueReading: true,
      })
    ),
    {
      kind: "read",
      id: "people.query",
      input: {},
      continueReading: true,
      actionIntent: true,
    }
  );
  assert.deepEqual(
    parseEvryModelTurn(
      modelDecision({
        classification: "application_action",
        readId: "actions.prepare",
        readInputJson: JSON.stringify({
          operation: "tasks.create",
          arguments: { title: "Call Alex; do not alter this text" },
        }),
      })
    ),
    {
      kind: "prepare_action",
      operation: "tasks.create",
      input: { title: "Call Alex; do not alter this text" },
    }
  );
  for (const classification of [
    "mixed",
    "unrelated",
    "theology_or_spiritual_guidance",
    "ambiguous",
  ])
    assert.equal(
      parseEvryModelTurn(
        modelDecision({
          classification,
          readId: "actions.prepare",
          readInputJson: "{}",
        })
      ).kind,
      "reply"
    );
});

test("provider failure remains retryable rather than becoming a durable misunderstanding", async () => {
  await assert.rejects(
    () =>
      generateEvryModelTurn({ context: {}, reads: [] }, () => {
        throw new Error("provider unavailable");
      }),
    /provider unavailable/
  );
});
