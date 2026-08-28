import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelUsage } from "ai";

import type { EvryNormalizedUsage } from "@/lib/evry/observability/contract";

import {
  assertEvryBenchmarkRemainingBudget,
  assertEvryBenchmarkUsage,
  evryBenchmarkCallBudgets,
  evryBenchmarkTraceDocument,
  type EvryPolicyBenchmarkCaseResult,
} from "./benchmark";
import { EVRY_POLICY_EVAL_FIXTURES } from "./policy/fixtures";
import { EVRY_MODEL_CANDIDATES } from "../models/candidates";

const COMPLETE_USAGE: LanguageModelUsage = {
  inputTokens: 10,
  inputTokenDetails: {
    noCacheTokens: 7,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
  },
  outputTokens: 4,
  outputTokenDetails: { textTokens: 3, reasoningTokens: 1 },
  totalTokens: 14,
};

const NORMALIZED_USAGE: EvryNormalizedUsage = {
  model: "gpt-5.6-luna",
  inputUncachedTokens: 7,
  inputCacheReadTokens: 2,
  inputCacheWriteTokens: 1,
  outputTextTokens: 3,
  outputReasoningTokens: 1,
  inputTokens: 10,
  outputTokens: 4,
  totalTokens: 14,
  costUsd: 0.001,
  timeToFirstTokenMs: 10,
};

function caseResult(
  classification: EvryPolicyBenchmarkCaseResult["actual"]
): EvryPolicyBenchmarkCaseResult {
  return {
    modelId: "gpt-5.6-luna",
    fixtureId: "fixture",
    expected: classification ?? { classification: "ambiguous" },
    actual: classification,
    passed: classification !== null,
    structuredOutput: classification !== null,
    prohibitedRequestSafety: true,
    successfulPlan: false,
    errorCode: classification === null ? "provider_or_shape_failure" : null,
    latencyMs: 25,
    usage: NORMALIZED_USAGE,
    correlationId: "10000000-0000-4000-8000-000000000001",
    traceId: "0123456789abcdef0123456789abcdef",
  };
}

test("benchmark usage must be nonzero and reconcile every bucket", () => {
  assert.doesNotThrow(() => assertEvryBenchmarkUsage(COMPLETE_USAGE));
  assert.throws(
    () =>
      assertEvryBenchmarkUsage({
        ...COMPLETE_USAGE,
        totalTokens: 0,
      }),
    /does not reconcile/
  );
  assert.throws(
    () =>
      assertEvryBenchmarkUsage({
        ...COMPLETE_USAGE,
        inputTokenDetails: {
          ...COMPLETE_USAGE.inputTokenDetails,
          noCacheTokens: 6,
        },
      }),
    /does not reconcile/
  );
});

test("the cost fuse checks every remaining worst-case call", () => {
  assert.doesNotThrow(() =>
    assertEvryBenchmarkRemainingBudget({
      maximumCostUsd: 1,
      measuredCostUsd: 0.25,
      remainingMaximumCostUsd: 0.75,
    })
  );
  assert.throws(
    () =>
      assertEvryBenchmarkRemainingBudget({
        maximumCostUsd: 1,
        measuredCostUsd: 0.26,
        remainingMaximumCostUsd: 0.75,
      }),
    /authorized budget/
  );
});

test("preflight captures the exact SDK request envelope without network access", async () => {
  const budgets = await evryBenchmarkCallBudgets();
  assert.equal(
    budgets.length,
    EVRY_MODEL_CANDIDATES.length * EVRY_POLICY_EVAL_FIXTURES.length
  );
  assert.equal(
    budgets.every(
      ({ maximumInputTokens, maximumCostUsd }) =>
        maximumInputTokens > 0 && maximumCostUsd > 0
    ),
    true
  );
});

test("Langfuse policy traces retain production refusal semantics", () => {
  const startedAt = new Date("2026-08-28T12:00:00.000Z");
  const endedAt = new Date("2026-08-28T12:00:00.025Z");
  const stopped = evryBenchmarkTraceDocument({
    environment: "local-eval",
    result: caseResult({ classification: "unrelated" }),
    startedAt,
    endedAt,
  });
  assert.equal(stopped.recipeIdentity, null);
  assert.deepEqual(
    stopped.spans.find(({ stage }) => stage === "policy") && {
      status: stopped.spans.find(({ stage }) => stage === "policy")?.status,
      resultCode: stopped.spans.find(({ stage }) => stage === "policy")
        ?.resultCode,
    },
    { status: "refused", resultCode: "policy_refused" }
  );

  const allowed = evryBenchmarkTraceDocument({
    environment: "local-eval",
    result: caseResult({ classification: "application_read" }),
    startedAt,
    endedAt,
  });
  assert.equal(
    allowed.spans.find(({ stage }) => stage === "policy")?.resultCode,
    "policy_allowed"
  );
});
