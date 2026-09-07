import assert from "node:assert/strict";
import test from "node:test";
import { generateEvryModelTurn, parseEvryModelTurn } from "./model-turn";
import {
  modelDecision,
  scriptedConversationModel,
} from "./model-test-fixtures";

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
      classification: "application_action",
      readId: "tasks.list",
      readInputJson: "{}",
    },
    { readInputJson: "{}" },
    { response: "" },
  ])
    assert.throws(() => parseEvryModelTurn(modelDecision(overrides)));
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
