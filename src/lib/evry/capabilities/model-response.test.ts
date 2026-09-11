import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { generateEvryModelResponse } from "./model-response";
import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";
import { EVRY_READ_BUDGET } from "./read-budget";

test("provider text is presented before the model finishes, not replayed after generation", async () => {
  const firstPreview = Promise.withResolvers<string>();
  const finishProvider = Promise.withResolvers<void>();
  let providerFinished = false;
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      calls++;
      return {
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "answer" });
            controller.enqueue({
              type: "text-delta",
              id: "answer",
              delta: '{"parts":[{"kind":"text","text":"I checked',
            });
            await finishProvider.promise;
            controller.enqueue({
              type: "text-delta",
              id: "answer",
              delta: ' the due dates.","resultIndex":null}]}',
            });
            controller.enqueue({ type: "text-end", id: "answer" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 10, text: 10, reasoning: 0 },
              },
            });
            providerFinished = true;
            controller.close();
          },
        }),
      };
    },
  });
  const response = generateEvryModelResponse(
    {
      context: {},
      draft: "Explain the due-date filter.",
      results: [],
      onPreview: ({ body }) => {
        firstPreview.resolve(body);
      },
    },
    () => model
  );
  assert.equal(await firstPreview.promise, "I checked");
  assert.equal(providerFinished, false);
  finishProvider.resolve();
  assert.equal((await response).body, "I checked the due dates.");
  assert.equal(calls, 1);
});

for (const count of [5, EVRY_READ_BUDGET.calls]) {
  test(`model composition previews and final output include all ${count} results`, async () => {
    const results = Array.from({ length: count }, (_, i) =>
      buildEvryReadArtifact({
        title: `Result ${i + 1}`,
        filters: [],
        exclusions: [],
        items: [],
        sourceLinks: [],
      })
    );
    const parts = results.flatMap((_, index) => [
      { kind: "text", text: `Evidence ${index + 1}.\n\n`, resultIndex: null },
      { kind: "result", text: "", resultIndex: index },
    ]);
    parts.push({
      kind: "text",
      text: "The review is complete.",
      resultIndex: null,
    });
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "answer" });
            controller.enqueue({
              type: "text-delta",
              id: "answer",
              delta: JSON.stringify({ parts }),
            });
            controller.enqueue({ type: "text-end", id: "answer" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 10, text: 10, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      }),
    });
    const previewCounts: number[] = [];
    const output = await generateEvryModelResponse(
      {
        context: {},
        draft: "Explain the review.",
        results,
        onPreview: (preview) => {
          previewCounts.push(preview.artifacts.length);
        },
      },
      () => model
    );
    assert.equal(output.artifacts.length, count);
    assert.ok(
      previewCounts.includes(count),
      `Expected ${count} live cards; saw ${previewCounts.join(",")}`
    );
    assert.deepEqual(
      output.artifacts.map((artifact) => artifact.title),
      results.map((result) => result.title)
    );
    assert.match(output.body, /The review is complete\.$/);
  });
}
