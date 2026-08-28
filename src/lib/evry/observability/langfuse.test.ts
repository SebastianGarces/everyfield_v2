import assert from "node:assert/strict";
import test from "node:test";

import { langfuseUsageDetails } from "./langfuse";
import { normalizeEvryModelUsage } from "./usage";

test("Langfuse usage buckets remain exclusive and carry cache use", () => {
  const usage = normalizeEvryModelUsage({
    model: "gpt-5.4-mini",
    usage: {
      inputTokens: 100,
      inputTokenDetails: {
        noCacheTokens: 60,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
      },
      outputTokens: 20,
      outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
      totalTokens: 120,
    },
    costUsd: 0.001,
    timeToFirstTokenMs: 25,
  });
  assert.deepEqual(langfuseUsageDetails(usage), {
    input: 60,
    input_cached_tokens: 30,
    input_cache_creation: 10,
    output: 15,
    output_reasoning_tokens: 5,
    total: 120,
  });
});
