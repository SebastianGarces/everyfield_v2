import type { LanguageModelUsage } from "ai";

import {
  evryNormalizedUsageSchema,
  type EvryNormalizedUsage,
} from "./contract";

function count(value: number | undefined): number {
  return value ?? 0;
}

/** Map AI SDK v6's mutually exclusive buckets without double-counting totals. */
export function normalizeEvryModelUsage(input: {
  model: string;
  usage: LanguageModelUsage;
  costUsd: number;
  timeToFirstTokenMs: number | null;
}): EvryNormalizedUsage {
  const cacheRead = count(input.usage.inputTokenDetails.cacheReadTokens);
  const cacheWrite = count(input.usage.inputTokenDetails.cacheWriteTokens);
  const inputUncached =
    input.usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, count(input.usage.inputTokens) - cacheRead - cacheWrite);
  const reasoning = count(input.usage.outputTokenDetails.reasoningTokens);
  const outputText =
    input.usage.outputTokenDetails.textTokens ??
    Math.max(0, count(input.usage.outputTokens) - reasoning);

  return evryNormalizedUsageSchema.parse({
    model: input.model,
    inputUncachedTokens: inputUncached,
    inputCacheReadTokens: cacheRead,
    inputCacheWriteTokens: cacheWrite,
    outputTextTokens: outputText,
    outputReasoningTokens: reasoning,
    inputTokens: inputUncached + cacheRead + cacheWrite,
    outputTokens: outputText + reasoning,
    totalTokens:
      inputUncached + cacheRead + cacheWrite + outputText + reasoning,
    costUsd: input.costUsd,
    timeToFirstTokenMs: input.timeToFirstTokenMs,
  });
}
