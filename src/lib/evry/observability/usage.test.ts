import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelUsage } from "ai";

import { normalizeEvryModelUsage } from "./usage";

test("normalizes cached and uncached AI SDK usage without double counting", () => {
  const usage = {
    inputTokens: 1_000,
    inputTokenDetails: {
      noCacheTokens: 600,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
    },
    outputTokens: 250,
    outputTokenDetails: { textTokens: 200, reasoningTokens: 50 },
    totalTokens: 1_250,
  } satisfies LanguageModelUsage;
  assert.deepEqual(
    normalizeEvryModelUsage({
      model: "gpt-5.4-mini",
      usage,
      costUsd: 0.0125,
      timeToFirstTokenMs: 420,
    }),
    {
      model: "gpt-5.4-mini",
      inputUncachedTokens: 600,
      inputCacheReadTokens: 300,
      inputCacheWriteTokens: 100,
      outputTextTokens: 200,
      outputReasoningTokens: 50,
      inputTokens: 1_000,
      outputTokens: 250,
      totalTokens: 1_250,
      costUsd: 0.0125,
      timeToFirstTokenMs: 420,
    }
  );
});

test("derives exclusive buckets from provider totals when detail is absent", () => {
  assert.deepEqual(
    normalizeEvryModelUsage({
      model: "gpt-5.4-mini",
      usage: {
        inputTokens: 80,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 20,
          cacheWriteTokens: undefined,
        },
        outputTokens: 30,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: 5,
        },
        totalTokens: 110,
      },
      costUsd: 0,
      timeToFirstTokenMs: null,
    }),
    {
      model: "gpt-5.4-mini",
      inputUncachedTokens: 60,
      inputCacheReadTokens: 20,
      inputCacheWriteTokens: 0,
      outputTextTokens: 25,
      outputReasoningTokens: 5,
      inputTokens: 80,
      outputTokens: 30,
      totalTokens: 110,
      costUsd: 0,
      timeToFirstTokenMs: null,
    }
  );
});
