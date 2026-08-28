import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLanguageModelV3 } from "ai/test";

import { classifyEvryRequest } from "./classify";
import { EVRY_POLICY_SYSTEM_PROMPT } from "./prompt";

function stringsInside(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsInside);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(stringsInside);
  }
  return [];
}

function scriptedModel(output: unknown) {
  let calls = 0;
  let providerOptions: unknown;
  let tools: unknown;
  let prompt: unknown;
  let responseFormat: unknown;

  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls++;
      providerOptions = options.providerOptions;
      tools = options.tools;
      prompt = options.prompt;
      responseFormat = options.responseFormat;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  return {
    model,
    get calls() {
      return calls;
    },
    get providerOptions() {
      return providerOptions;
    },
    get tools() {
      return tools;
    },
    get prompt() {
      return prompt;
    },
    get responseFormat() {
      return responseFormat;
    },
  };
}

test("one stored-output-disabled model call is the policy decision", async () => {
  const scripted = scriptedModel({
    decision: {
      classification: "application_action",
      settingsSectionId: null,
    },
  });
  const literalUserText =
    "  Create a task named ‘Pray for the launch’.\r\nKeep spacing.  ";

  const result = await classifyEvryRequest({
    literalUserText,
    getModel: () => scripted.model,
  });

  assert.equal(
    scripted.calls,
    1,
    "there is no supervisor or second model call"
  );
  assert.deepEqual(scripted.providerOptions, {
    openai: {
      store: false,
      serviceTier: "default",
      reasoningEffort: "none",
    },
  });
  const responseFormat = scripted.responseFormat;
  assert.ok(responseFormat && typeof responseFormat === "object");
  assert.ok("type" in responseFormat);
  assert.equal(
    responseFormat.type,
    "json",
    "Output.object sends the strict schema as structured JSON output"
  );
  assert.equal(
    scripted.tools,
    undefined,
    "no tool is eligible at classification"
  );
  assert.ok(
    stringsInside(scripted.prompt).includes(literalUserText),
    "the provider receives the untrimmed request"
  );
  assert.equal(result.classification, "application_action");
  assert.equal(result.continuation.literalUserText, literalUserText);
});

test("schema rejection fails closed after one draft", async () => {
  const scripted = scriptedModel({
    decision: {
      classification: "application_read",
      settingsSectionId: null,
      literalUserText: "provider-tampered text",
    },
  });

  const result = await classifyEvryRequest({
    literalUserText: "Show overdue tasks.",
    getModel: () => scripted.model,
  });

  assert.equal(scripted.calls, 1, "SDK retries are disabled");
  assert.equal(result.classification, "ambiguous");
  assert.equal("continuation" in result, false);
});

test("provider failure uses the same fixed ambiguity artifact", async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      calls++;
      throw new Error("provider details must not escape");
    },
  });

  const result = await classifyEvryRequest({
    literalUserText: "Show overdue tasks.",
    getModel: () => model,
  });

  assert.equal(calls, 1);
  assert.equal(result.classification, "ambiguous");
  assert.doesNotMatch(JSON.stringify(result), /provider details/i);
});

test("the prompt is generated from application and Settings inventory", () => {
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /\/tasks/);
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /plant-intelligence/);
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /notifications \(Notifications\)/);
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /unsubscribe/);
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /timezone/);
  assert.match(
    EVRY_POLICY_SYSTEM_PROMPT,
    /Create a task named ‘Pray for the launch’[\s\S]*application_action/
  );
  assert.match(EVRY_POLICY_SYSTEM_PROMPT, /Write a launch prayer/);
});
