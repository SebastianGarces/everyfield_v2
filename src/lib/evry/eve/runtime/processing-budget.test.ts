import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { processingBudgetMiddleware } from "./processing-budget";
import {
  beginProcessingTurn,
  EVE_PROCESSING_LIMITS,
  EVE_PROCESSING_LIMIT_SENTINEL,
  freshProcessingBudget,
  reserveProcessingCall,
} from "./processing-budget-policy";

function budgetStore() {
  let state = freshProcessingBudget("turn-1");
  return {
    get: () => state,
    update: (change: (current: typeof state) => typeof state) => {
      state = change(state);
    },
  };
}
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

test("a processing allowance resets only for a different native turn, not restored or replayed state", () => {
  const used = { ...freshProcessingBudget("turn-1"), modelCalls: 24 };
  assert.deepEqual(
    beginProcessingTurn(JSON.parse(JSON.stringify(used)), "turn-1"),
    used
  );
  assert.throws(
    () => reserveProcessingCall(used),
    new RegExp(EVE_PROCESSING_LIMIT_SENTINEL)
  );
  assert.deepEqual(
    beginProcessingTurn(used, "turn-2"),
    freshProcessingBudget("turn-2")
  );
  for (const exceeded of [
    { ...used, modelCalls: 0, inputTokens: EVE_PROCESSING_LIMITS.inputTokens },
    {
      ...used,
      modelCalls: 0,
      outputTokens: EVE_PROCESSING_LIMITS.outputTokens,
    },
  ])
    assert.throws(
      () => reserveProcessingCall(exceeded),
      new RegExp(EVE_PROCESSING_LIMIT_SENTINEL)
    );
});

test("generate middleware counts actual model work and refuses the 25th call before invoking provider", async () => {
  const store = budgetStore();
  const provider = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Done" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: processingBudgetMiddleware(store),
  });
  for (let i = 0; i < 24; i++) await model.doGenerate({ prompt: [] });
  assert.deepEqual(store.get(), {
    turnId: "turn-1",
    modelCalls: 24,
    inputTokens: 240,
    outputTokens: 480,
  });
  await assert.rejects(
    async () => model.doGenerate({ prompt: [] }),
    new RegExp(EVE_PROCESSING_LIMIT_SENTINEL)
  );
  assert.equal(provider.doGenerateCalls.length, 24);
  assert.equal(provider.doGenerateCalls[0]?.maxOutputTokens, 8000);
  store.update((state) => beginProcessingTurn(state, "turn-2"));
  await model.doGenerate({ prompt: [] });
  assert.equal(provider.doGenerateCalls.length, 25);
});

test("stream finish records usage, preserves chunks, and reserves failed calls too", async () => {
  const store = budgetStore();
  store.update((state) => ({ ...state, outputTokens: 63990 }));
  const provider = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "text" });
          controller.enqueue({ type: "text-delta", id: "text", delta: "Done" });
          controller.enqueue({ type: "text-end", id: "text" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        },
      }),
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: processingBudgetMiddleware(store),
  });
  const response = await model.doStream({ prompt: [] });
  const chunks = [];
  const reader = response.stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  assert.equal(chunks.length, 5);
  assert.equal(store.get().inputTokens, 10);
  assert.equal(store.get().outputTokens, 64010);
  assert.equal(provider.doStreamCalls[0]?.maxOutputTokens, 10);
  await assert.rejects(
    async () => model.doStream({ prompt: [] }),
    new RegExp(EVE_PROCESSING_LIMIT_SENTINEL)
  );
  assert.equal(provider.doStreamCalls.length, 1);
  const failedStore = budgetStore();
  const failed = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("provider failed");
      },
    }),
    middleware: processingBudgetMiddleware(failedStore),
  });
  await assert.rejects(
    async () => failed.doGenerate({ prompt: [] }),
    /provider failed/
  );
  assert.equal(failedStore.get().modelCalls, 1);
});

test("missing provider usage consumes the output reservation and closes the input allowance", async () => {
  const store = budgetStore();
  const provider = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Done" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { ...usage.inputTokens, total: undefined },
        outputTokens: { ...usage.outputTokens, total: undefined },
      },
      warnings: [],
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: processingBudgetMiddleware(store),
  });
  await model.doGenerate({ prompt: [], maxOutputTokens: 1200 });
  assert.equal(store.get().inputTokens, EVE_PROCESSING_LIMITS.inputTokens);
  assert.equal(store.get().outputTokens, 1200);
  await assert.rejects(
    async () => model.doGenerate({ prompt: [] }),
    new RegExp(EVE_PROCESSING_LIMIT_SENTINEL)
  );
  assert.equal(provider.doGenerateCalls.length, 1);
});
