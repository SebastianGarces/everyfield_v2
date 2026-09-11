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
