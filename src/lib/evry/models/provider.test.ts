import assert from "node:assert/strict";
import { test } from "node:test";
import { generateText, streamText, Output, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  EVRY_POLICY_MODEL_ID,
  getEvryPolicyModel,
  evryStructuredOutputMiddleware,
} from "./provider";

test("the benchmark-selected Evry policy model is the production model", () => {
  assert.equal(EVRY_POLICY_MODEL_ID, "gpt-5.6-luna");
});

test("the provider resolves lazily and fails explicitly without a key", () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => getEvryPolicyModel(), /OPENAI_API_KEY is not set/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("the provider returns the selected model when configured", () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  try {
    const model = getEvryPolicyModel();
    assert.notEqual(typeof model, "string");
    if (typeof model !== "string") {
      assert.equal(model.modelId, EVRY_POLICY_MODEL_ID);
    }
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

const usage = {
  inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

test("structured generation parses only final output while counting commentary tokens", async () => {
  for (const phase of ["final_answer", undefined]) {
    const model = wrapLanguageModel({
      middleware: evryStructuredOutputMiddleware,
      model: new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [
            {
              type: "text",
              text: '{"value":"intermediate"}',
              providerMetadata: { openai: { phase: "commentary" } },
            },
            {
              type: "text",
              text: '{"value":"final"}',
              ...(phase ? { providerMetadata: { openai: { phase } } } : {}),
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        }),
      }),
    });
    const result = await generateText({
      model,
      prompt: "Test",
      output: Output.object({ schema: z.object({ value: z.string() }) }),
    });
    assert.deepEqual(result.output, { value: "final" });
    assert.equal(result.usage.outputTokens, 20);
  }
});

test("streamed commentary never becomes a structured preview and usage is preserved", async () => {
  const model = wrapLanguageModel({
    middleware: evryStructuredOutputMiddleware,
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const [id, phase, text] of [
              ["update", "commentary", '{"value":"intermediate"}'],
              ["answer", "final_answer", '{"value":"final"}'],
            ]) {
              controller.enqueue({
                type: "text-start",
                id,
                providerMetadata: { openai: { phase } },
              });
              controller.enqueue({ type: "text-delta", id, delta: text });
              controller.enqueue({ type: "text-end", id });
            }
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            });
            controller.close();
          },
        }),
      }),
    }),
  });
  const result = streamText({
    model,
    prompt: "Test",
    output: Output.object({ schema: z.object({ value: z.string() }) }),
  });
  const previews = [];
  for await (const partial of result.partialOutputStream)
    previews.push(partial);
  assert.ok(previews.length);
  assert.ok(!JSON.stringify(previews).includes("intermediate"));
  assert.deepEqual(await result.output, { value: "final" });
  assert.equal((await result.usage).outputTokens, 20);
});

test("plain-text consumers retain commentary", async () => {
  const model = wrapLanguageModel({
    middleware: evryStructuredOutputMiddleware,
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: "Working on it.",
            providerMetadata: { openai: { phase: "commentary" } },
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    }),
  });
  assert.equal(
    (await generateText({ model, prompt: "Test" })).text,
    "Working on it."
  );
});

test("commentary cannot substitute for a missing or malformed final decision", async () => {
  for (const finalText of [null, "not JSON"]) {
    const model = wrapLanguageModel({
      middleware: evryStructuredOutputMiddleware,
      model: new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [
            {
              type: "text",
              text: '{"value":"must not run"}',
              providerMetadata: { openai: { phase: "commentary" } },
            },
            ...(finalText === null
              ? []
              : [
                  {
                    type: "text" as const,
                    text: finalText,
                    providerMetadata: { openai: { phase: "final_answer" } },
                  },
                ]),
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        }),
      }),
    });
    await assert.rejects(
      generateText({
        model,
        prompt: "Test",
        output: Output.object({ schema: z.object({ value: z.string() }) }),
      })
    );
  }
});

test("a phase arriving at text-end cannot leak commentary into structured previews", async () => {
  for (const finalPhase of [undefined, "final_answer"]) {
    const model = wrapLanguageModel({
      middleware: evryStructuredOutputMiddleware,
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "update" });
              controller.enqueue({
                type: "text-delta",
                id: "update",
                delta: '{"value":"intermediate"}',
              });
              controller.enqueue({
                type: "text-end",
                id: "update",
                providerMetadata: { openai: { phase: "commentary" } },
              });
              controller.enqueue({
                type: "text-start",
                id: "answer",
                ...(finalPhase
                  ? { providerMetadata: { openai: { phase: finalPhase } } }
                  : {}),
              });
              controller.enqueue({
                type: "text-delta",
                id: "answer",
                delta: '{"value":"final"}',
              });
              controller.enqueue({ type: "text-end", id: "answer" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              });
              controller.close();
            },
          }),
        }),
      }),
    });
    const result = streamText({
      model,
      prompt: "Test",
      output: Output.object({ schema: z.object({ value: z.string() }) }),
    });
    const previews = [];
    for await (const partial of result.partialOutputStream)
      previews.push(partial);
    assert.ok(previews.length);
    assert.ok(!JSON.stringify(previews).includes("intermediate"));
    assert.deepEqual(await result.output, { value: "final" });
    assert.equal((await result.usage).outputTokens, 20);
  }
});
