export const EVRY_MODEL_CANDIDATES = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    reasoningEffort: null,
    pricePerMillionTokens: {
      input: 0.15,
      cachedInput: 0.075,
      output: 0.6,
    },
    documentationUrl:
      "https://developers.openai.com/api/docs/models/gpt-4o-mini",
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    reasoningEffort: "none",
    pricePerMillionTokens: {
      input: 0.2,
      cachedInput: 0.02,
      output: 1.2,
    },
    documentationUrl:
      "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    reasoningEffort: "none",
    pricePerMillionTokens: {
      input: 0.75,
      cachedInput: 0.075,
      output: 4.5,
    },
    documentationUrl:
      "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    reasoningEffort: null,
    pricePerMillionTokens: {
      input: 2.5,
      cachedInput: 1.25,
      output: 10,
    },
    documentationUrl: "https://developers.openai.com/api/docs/models/gpt-4o",
  },
] as const;

export type EvryModelCandidate = (typeof EVRY_MODEL_CANDIDATES)[number];
export type EvryModelCandidateId = EvryModelCandidate["id"];

export function evryModelCandidate(id: string): EvryModelCandidate | null {
  return EVRY_MODEL_CANDIDATES.find((candidate) => candidate.id === id) ?? null;
}

export function calculateEvryModelCostUsd(input: {
  candidate: EvryModelCandidate;
  inputUncachedTokens: number;
  inputCacheReadTokens: number;
  inputCacheWriteTokens: number;
  outputTokens: number;
}): number {
  const prices = input.candidate.pricePerMillionTokens;
  return (
    ((input.inputUncachedTokens + input.inputCacheWriteTokens) * prices.input +
      input.inputCacheReadTokens * prices.cachedInput +
      input.outputTokens * prices.output) /
    1_000_000
  );
}

/** A conservative preflight ceiling. It intentionally ignores cache savings. */
export function estimateEvryBenchmarkCostUsd(input: {
  callsPerCandidate: number;
  maximumInputTokensPerCall: number;
  maximumOutputTokensPerCall: number;
}): number {
  return EVRY_MODEL_CANDIDATES.reduce((total, candidate) => {
    const prices = candidate.pricePerMillionTokens;
    const perCall =
      (input.maximumInputTokensPerCall * prices.input +
        input.maximumOutputTokensPerCall * prices.output) /
      1_000_000;
    return total + perCall * input.callsPerCandidate;
  }, 0);
}
