import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createCompactionPrompt } from "../../../../../node_modules/eve/dist/src/harness/compaction-prompt.js";
import {
  currentPresentationGuidance,
  presentationGuidanceMiddleware,
} from "./presentation-guidance";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

test("only current read references are offered; preparation and absent turn IDs never authorize cards", () => {
  const results = [
    { turnId: "old", reference: "old-card", capability: "tasks.query" },
    { turnId: "new", reference: "new-card", capability: "tasks.query" },
    { turnId: "new", reference: "review", capability: "actions.prepare" },
  ];
  const guidance = currentPresentationGuidance({ turnId: "new", results });
  assert.match(guidance, /references: \["new-card"\]/);
  assert.doesNotMatch(guidance, /old-card|"review"/);
  assert.match(guidance, /Choose cards only when helpful/);
  assert.match(
    currentPresentationGuidance({ turnId: null, results }),
    /references: \[\]/
  );
  assert.match(
    currentPresentationGuidance({ turnId: "next", results }),
    /answer from retained evidence in text when sufficient/
  );
});

test("actual generate and stream calls refresh the allowed set while preserving user text, facts, approvals and output", async () => {
  let turnId = "new";
  const results = [
    { turnId: "old", reference: "old-card", capability: "tasks.query" },
  ];
  const provider = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Retained answer" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-delta",
            id: "text",
            delta: "Current answer",
          });
          controller.close();
        },
      }),
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: presentationGuidanceMiddleware(() => ({ turnId, results })),
  });
  const prompt = [
    { role: "system" as const, content: "Original policy" },
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: "Keep my literal [[evry-result:old-card]] text unchanged.",
        },
      ],
    },
    {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Four tasks. [[evry-result:old-card]]" },
      ],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "original",
          toolName: "code_mode",
          output: {
            type: "json" as const,
            value: {
              card: "old-card",
              record: { id: "task-1", title: "Call Jordan" },
              approval: { planId: "plan-1", fingerprint: "unchanged" },
            },
          },
        },
      ],
    },
  ];
  const saved = structuredClone(prompt);
  const answer = await model.doGenerate({ prompt });
  assert.deepEqual(answer.content, [{ type: "text", text: "Retained answer" }]);
  assert.match(
    String(provider.doGenerateCalls[0].prompt[0].content),
    /references: \[\]/
  );
  assert.deepEqual(provider.doGenerateCalls[0].prompt.slice(1), saved);
  results.push({
    turnId: "new",
    reference: "current-card",
    capability: "tasks.query",
  });
  const stream = await model.doStream({ prompt });
  const reader = stream.stream.getReader();
  assert.deepEqual(await reader.read(), {
    value: { type: "text-delta", id: "text", delta: "Current answer" },
    done: false,
  });
  assert.equal((await reader.read()).done, true);
  assert.match(
    String(provider.doStreamCalls[0].prompt[0].content),
    /references: \["current-card"\]/
  );
  assert.deepEqual(provider.doStreamCalls[0].prompt.slice(1), saved);
  await model.doGenerate({ prompt });
  assert.match(
    String(provider.doGenerateCalls[1].prompt[0].content),
    /references: \["current-card"\]/
  );
  turnId = "next";
  await model.doStream({ prompt });
  assert.match(
    String(provider.doStreamCalls[1].prompt[0].content),
    /references: \[\]/
  );
  assert.deepEqual(prompt, saved);
});

test("installed Eve compaction prompt keeps aliased handles and facts intact but receives current-only presentation guidance", async () => {
  const compact = createCompactionPrompt({
    previousCheckpoint: undefined,
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "outer",
            toolName: "code_mode",
            input: {
              js: "return {card: result.resultReference, records: result.items};",
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "outer",
            toolName: "code_mode",
            output: {
              type: "json",
              value: {
                card: "old-alias",
                record: { id: "person-1", name: "Retained person" },
              },
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "[[evry-result:old-alias]]" }],
      },
    ],
  });
  const provider = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("captured compaction prompt");
    },
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: presentationGuidanceMiddleware(() => ({
      turnId: "new",
      results: [
        { turnId: "old", reference: "old-alias", capability: "people.query" },
      ],
    })),
  });
  const prompt = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: compact.prompt }],
    },
  ];
  await assert.rejects(
    async () => model.doGenerate({ prompt }),
    /captured compaction prompt/
  );
  assert.match(
    String(provider.doGenerateCalls[0].prompt[0].content),
    /references: \[\]/
  );
  assert.deepEqual(provider.doGenerateCalls[0].prompt.slice(1), prompt);
  assert.match(compact.prompt, /old-alias/);
  assert.match(compact.prompt, /Retained person/);
});
