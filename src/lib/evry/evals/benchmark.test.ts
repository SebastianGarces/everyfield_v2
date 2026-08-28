import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelUsage } from "ai";

import type { EvryNormalizedUsage } from "@/lib/evry/observability/contract";

import {
  assertEvryBenchmarkRemainingBudget,
  assertEvryBenchmarkUsage,
  evryBenchmarkCallBudgets,
  evryPlanBenchmarkTraceDocument,
  evryBenchmarkTraceDocument,
  type EvryPlanBenchmarkCaseResult,
  type EvryPolicyBenchmarkCaseResult,
} from "./benchmark";
import { EVRY_POLICY_EVAL_FIXTURES } from "./policy/fixtures";
import { EVRY_MODEL_CANDIDATES } from "../models/candidates";
import {
  FIXTURE_RECIPE_VALUES,
  RECIPE_IDENTITY,
} from "../recipes/fixtures.test-helper";

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
    request: "fixture request",
    expected: classification ?? { classification: "ambiguous" },
    actual: classification,
    passed: classification !== null,
    structuredOutput: classification !== null,
    prohibitedRequestSafety: true,
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
    EVRY_MODEL_CANDIDATES.length * (EVRY_POLICY_EVAL_FIXTURES.length + 1)
  );
  assert.equal(
    budgets.filter(({ kind }) => kind === "plan_probe").length,
    EVRY_MODEL_CANDIDATES.length
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

  const wrongRefusal = evryBenchmarkTraceDocument({
    environment: "local-eval",
    result: {
      ...caseResult({ classification: "unrelated" }),
      expected: { classification: "application_action" },
      passed: false,
    },
    startedAt,
    endedAt,
  });
  assert.equal(
    wrongRefusal.spans.find(({ stage }) => stage === "policy")?.resultCode,
    "policy_refused",
    "runtime semantics come from actual output, not benchmark grading"
  );

  const wrongAllowance = evryBenchmarkTraceDocument({
    environment: "local-eval",
    result: {
      ...caseResult({ classification: "application_read" }),
      expected: { classification: "unrelated" },
      passed: false,
    },
    startedAt,
    endedAt,
  });
  assert.equal(
    wrongAllowance.spans.find(({ stage }) => stage === "policy")?.resultCode,
    "policy_allowed"
  );
  assert.match(
    wrongAllowance.spans.find(({ stage }) => stage === "reporting")?.observation
      ?.output ?? "",
    /"passed":false/
  );
});

test("Langfuse plan traces expose the model output and compiled plan result", () => {
  const result: EvryPlanBenchmarkCaseResult = {
    modelId: "gpt-5.6-luna",
    probeId: "meeting-invitation-reference",
    actual: {
      recipeIdentity: RECIPE_IDENTITY,
      meetingId: FIXTURE_RECIPE_VALUES.meeting_id,
      startsAt: FIXTURE_RECIPE_VALUES.starts_at,
      audience: FIXTURE_RECIPE_VALUES.person_ids,
      recipientIds: [FIXTURE_RECIPE_VALUES.recipient_ids[0]],
      subject: FIXTURE_RECIPE_VALUES.subject,
      body: FIXTURE_RECIPE_VALUES.body,
    },
    passed: true,
    structuredOutput: true,
    errorCode: null,
    latencyMs: 50,
    confirmationArtifactLatencyMs: 2,
    planSteps: 3,
    usage: NORMALIZED_USAGE,
    correlationId: "10000000-0000-4000-8000-000000000001",
    traceId: "0123456789abcdef0123456789abcdef",
  };
  const trace = evryPlanBenchmarkTraceDocument({
    environment: "local-eval",
    result,
    startedAt: new Date("2026-08-28T12:00:00.000Z"),
    endedAt: new Date("2026-08-28T12:00:00.050Z"),
  });
  assert.equal(trace.recipeIdentity, RECIPE_IDENTITY);
  const planning = trace.spans.find(({ stage }) => stage === "planning");
  assert.equal(planning?.details.kind, "generation");
  assert.match(planning?.observation?.output ?? "", /"steps":3/);
});
