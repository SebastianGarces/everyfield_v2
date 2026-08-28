import { createHash, randomUUID } from "node:crypto";

import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText, type LanguageModelUsage } from "ai";

import type { EvryTraceDocument } from "@/lib/evry/observability/contract";
import { createEvryLangfuseSink } from "@/lib/evry/observability/langfuse";
import { evryTraceIdForCorrelation } from "@/lib/evry/observability/recorder";
import { normalizeEvryModelUsage } from "@/lib/evry/observability/usage";
import type { EvryNormalizedUsage } from "@/lib/evry/observability/contract";
import {
  calculateEvryModelCostUsd,
  evryPolicyProviderOptions,
  EVRY_MODEL_CANDIDATES,
  EVRY_POLICY_MAX_OUTPUT_TOKENS,
  EVRY_POLICY_TIMEOUT_MS,
  type EvryModelCandidate,
  type EvryModelCandidateId,
} from "@/lib/evry/models/candidates";
import {
  evryModelClearsReleaseThresholds,
  EVRY_MODEL_RELEASE_THRESHOLDS,
  selectCheapestQualifiedEvryModel,
} from "@/lib/evry/models/selection";
import { EVRY_POLICY_SYSTEM_PROMPT } from "@/lib/evry/policy/prompt";
import {
  evryPolicyDecisionFromProviderOutput,
  evryPolicyProviderOutputSchema,
} from "@/lib/evry/policy/schema";
import { fixtureDocument } from "@/lib/evry/plans/fixtures.test-helper";

import {
  EVRY_ABSOLUTE_SAFETY_GATES,
  EVRY_CAPABILITY_EVAL_LAYERS,
  EVRY_RECIPE_EVAL_LAYERS,
  type EvryEvalProofResult,
  type EvrySafetyGateResult,
} from "./contracts";
import {
  EVRY_POLICY_EVAL_FIXTURES,
  type EvryPolicyEvalFixture,
} from "./policy/fixtures";
import {
  EVRY_CAPABILITY_EVAL_FIXTURES,
  EVRY_EVAL_PROOFS,
  EVRY_RECIPE_EVAL_FIXTURES,
} from "./registry";
import { assertEvryEvalProofResults } from "./proofs";

const BENCHMARK_SCHEMA_VERSION = 2 as const;
const BENCHMARK_RUNNER_VERSION = "evry-model-benchmark-v2" as const;
type BenchmarkPolicyDecision = EvryPolicyEvalFixture["expected"];

const EMPTY_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  inputTokenDetails: {
    noCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 0,
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  totalTokens: 0,
};

export type EvryPolicyBenchmarkCaseResult = Readonly<{
  modelId: EvryModelCandidateId;
  fixtureId: string;
  expected: BenchmarkPolicyDecision;
  actual: BenchmarkPolicyDecision | null;
  passed: boolean;
  structuredOutput: boolean;
  prohibitedRequestSafety: boolean;
  successfulPlan: boolean;
  errorCode: "provider_or_shape_failure" | null;
  latencyMs: number;
  usage: EvryNormalizedUsage;
  correlationId: string;
  traceId: string;
}>;

export type EvryModelBenchmarkAggregate = Readonly<{
  modelId: EvryModelCandidateId;
  label: string;
  calls: number;
  passed: number;
  policyPassRate: number;
  structuredOutputRate: number;
  candidateSafetyPassRate: number;
  candidateSafety: Readonly<{
    passed: number;
    total: number;
    passRate: number;
  }>;
  successfulPlans: number;
  correctApplicationActionHandoffs: number;
  latencyMs: Readonly<{
    median: number;
    p95: number;
    mean: number;
  }>;
  timeToFirstTokenMs: Readonly<{
    median: number | null;
    p95: number | null;
    mean: number | null;
  }>;
  tokens: Readonly<{
    inputUncached: number;
    inputCacheRead: number;
    inputCacheWrite: number;
    outputText: number;
    outputReasoning: number;
    total: number;
  }>;
  totalCostUsd: number;
  costPerSuccessfulPlanUsd: number | null;
  allSafetyGatesPassed: boolean;
  qualifies: boolean;
}>;

export type EvryRegisteredEvalCaseResult = Readonly<{
  subjectIdentity: string;
  layer: string;
  caseId: string;
  proofId: string;
  passed: boolean;
}>;

export type EvryModelBenchmarkReport = Readonly<{
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  runnerVersion: typeof BENCHMARK_RUNNER_VERSION;
  generatedAt: string;
  gitSha: string;
  corpus: Readonly<{
    hash: string;
    policyCases: number;
    capabilityFixtures: number;
    capabilityCases: number;
    capabilityLayersPerFixture: number;
    recipeFixtures: number;
    recipeCases: number;
    recipeLayersPerFixture: number;
    executableProofs: number;
  }>;
  conditions: Readonly<{
    hash: string;
    provider: "openai-responses";
    retries: 0;
    store: false;
    serviceTier: "default";
    maxOutputTokens: number;
    timeoutMs: number;
    promptsIdenticalAcrossCandidates: true;
    toolsExposedDuringPolicy: 0;
    maximumSerializedInputBytes: number;
  }>;
  budget: Readonly<{
    maximumCostUsd: number;
    estimatedMaximumCostUsd: number;
    measuredCostUsd: number;
  }>;
  thresholds: typeof EVRY_MODEL_RELEASE_THRESHOLDS;
  proofResults: readonly EvryEvalProofResult[];
  capabilityResults: readonly EvryRegisteredEvalCaseResult[];
  recipeResults: readonly EvryRegisteredEvalCaseResult[];
  safetyGates: readonly EvrySafetyGateResult[];
  candidates: readonly EvryModelBenchmarkAggregate[];
  cases: readonly EvryPolicyBenchmarkCaseResult[];
  cheapestQualifiedModelId: EvryModelCandidateId | null;
  productionModelId: EvryModelCandidateId;
  productionSelectionMatches: boolean;
  caveat: string;
}>;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameDecision(
  expected: BenchmarkPolicyDecision,
  actual: BenchmarkPolicyDecision
): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function isProviderBoundaryRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode === 400
  ) {
    return true;
  }
  return "cause" in error && isProviderBoundaryRejection(error.cause);
}

function closedErrorName(error: unknown): string {
  if (
    typeof error === "string" &&
    /^text part [A-Za-z0-9_-]+ not found$/.test(error)
  ) {
    return "TextPartNotFound";
  }
  if (typeof error === "string") return "StringError";
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if ("error" in record && record.error !== error) {
      return `Object_${closedErrorName(record.error)}`;
    }
    const tags = [record.type, record.code].filter(
      (value): value is string =>
        typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value)
    );
    const keys = Object.keys(record)
      .filter((key) => /^[A-Za-z0-9_]{1,32}$/.test(key))
      .toSorted()
      .slice(0, 8);
    if (tags.length > 0 || keys.length > 0) {
      return `Object_${[...tags, ...keys].join("_")}`;
    }
  }
  return error instanceof Error && /^[A-Za-z0-9_]+$/.test(error.name)
    ? error.name
    : error &&
        typeof error === "object" &&
        "constructor" in error &&
        typeof error.constructor === "function" &&
        /^[A-Za-z0-9_]+$/.test(error.constructor.name)
      ? error.constructor.name
      : "UnknownError";
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(proportion * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function exactCount(value: number | undefined, subject: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Benchmark usage has invalid ${subject}`);
  }
  return value;
}

/** A priced benchmark call must carry complete, internally reconciled usage. */
export function assertEvryBenchmarkUsage(usage: LanguageModelUsage): void {
  const input = exactCount(usage.inputTokens, "input tokens");
  const output = exactCount(usage.outputTokens, "output tokens");
  const total = exactCount(usage.totalTokens, "total tokens");
  const inputParts =
    exactCount(usage.inputTokenDetails.noCacheTokens, "uncached input tokens") +
    exactCount(usage.inputTokenDetails.cacheReadTokens, "cache read tokens") +
    exactCount(usage.inputTokenDetails.cacheWriteTokens, "cache write tokens");
  const outputParts =
    exactCount(usage.outputTokenDetails.textTokens, "output text tokens") +
    exactCount(
      usage.outputTokenDetails.reasoningTokens,
      "output reasoning tokens"
    );
  if (
    total === 0 ||
    input !== inputParts ||
    output !== outputParts ||
    total !== input + output
  ) {
    throw new Error("Benchmark usage is missing or does not reconcile");
  }
}

function policyTraceSemantics(result: EvryPolicyBenchmarkCaseResult): Readonly<{
  status: "succeeded" | "refused" | "failed";
  resultCode: "policy_allowed" | "policy_refused" | "request_failed";
}> {
  if (!result.passed || result.actual === null) {
    return { status: "failed", resultCode: "request_failed" };
  }
  if (
    result.actual.classification === "application_read" ||
    result.actual.classification === "application_action"
  ) {
    return { status: "succeeded", resultCode: "policy_allowed" };
  }
  return { status: "refused", resultCode: "policy_refused" };
}

export function evryBenchmarkTraceDocument(input: {
  environment: string;
  result: EvryPolicyBenchmarkCaseResult;
  startedAt: Date;
  endedAt: Date;
}): EvryTraceDocument {
  const policy = policyTraceSemantics(input.result);
  const reportStatus = input.result.passed ? "succeeded" : "failed";
  const reportInstant = input.endedAt.toISOString();
  return {
    schemaVersion: 1,
    traceId: input.result.traceId,
    correlationId: input.result.correlationId,
    environment: input.environment,
    recipeIdentity: null,
    startedAt: input.startedAt.toISOString(),
    endedAt: reportInstant,
    durationMs: input.result.latencyMs,
    auditRecordCount: 0,
    spans: [
      {
        spanId: "0000000000000002",
        parentSpanId: null,
        stage: "request",
        startedAt: input.startedAt.toISOString(),
        endedAt: reportInstant,
        durationMs: input.result.latencyMs,
        status: "succeeded",
        resultCode: "request_received",
        capabilityIdentity: null,
        details: { kind: "operation" },
      },
      {
        spanId: "0000000000000003",
        parentSpanId: "0000000000000002",
        stage: "policy",
        startedAt: input.startedAt.toISOString(),
        endedAt: reportInstant,
        durationMs: input.result.latencyMs,
        status: policy.status,
        resultCode: policy.resultCode,
        capabilityIdentity: null,
        details: {
          kind: "generation",
          grouping: { kind: "request-policy" },
          usage: input.result.usage,
        },
      },
      {
        spanId: "0000000000000004",
        parentSpanId: "0000000000000002",
        stage: "reporting",
        startedAt: reportInstant,
        endedAt: reportInstant,
        durationMs: 0,
        status: reportStatus,
        resultCode: input.result.passed ? "reported" : "request_failed",
        capabilityIdentity: null,
        details: { kind: "operation" },
      },
    ],
  };
}

async function captureBenchmarkTrace(input: {
  configuredSink: NonNullable<ReturnType<typeof createEvryLangfuseSink>>;
  result: EvryPolicyBenchmarkCaseResult;
  startedAt: Date;
  endedAt: Date;
}): Promise<void> {
  await input.configuredSink.sink.capture(
    evryBenchmarkTraceDocument({
      environment: input.configuredSink.environment,
      result: input.result,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    })
  );
}

export type EvryBenchmarkCallBudget = Readonly<{
  modelId: EvryModelCandidateId;
  fixtureId: string;
  requestHash: string;
  maximumInputTokens: number;
  maximumCostUsd: number;
}>;

async function serializedPolicyRequestBody(input: {
  candidate: EvryModelCandidate;
  fixture: EvryPolicyEvalFixture;
}): Promise<string> {
  let requestBody: string | null = null;
  const captureFetch = async (
    _request: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (typeof init?.body !== "string") {
      throw new Error("Benchmark preflight could not serialize the request");
    }
    requestBody = init.body;
    throw new Error("Evry benchmark preflight capture complete");
  };
  const provider = createOpenAI({
    apiKey: "benchmark-preflight-not-sent",
    fetch: captureFetch,
  });
  const result = streamText({
    model: provider(input.candidate.id),
    output: Output.object({ schema: evryPolicyProviderOutputSchema }),
    system: EVRY_POLICY_SYSTEM_PROMPT,
    prompt: input.fixture.request,
    maxOutputTokens: EVRY_POLICY_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: EVRY_POLICY_TIMEOUT_MS,
    providerOptions: evryPolicyProviderOptions(input.candidate),
    onError() {
      // The capture fetch intentionally ends before a response exists.
    },
  });
  await Promise.allSettled([result.output, result.usage]);
  if (requestBody === null) {
    throw new Error("Benchmark preflight did not capture a request body");
  }
  return requestBody;
}

/**
 * Capture the exact SDK request JSON without network access. UTF-8 byte length
 * is a conservative token ceiling because each billed input token consumes at
 * least one byte from this body, which also includes unbilled JSON framing.
 */
export async function evryBenchmarkCallBudgets(): Promise<
  readonly EvryBenchmarkCallBudget[]
> {
  const budgets: EvryBenchmarkCallBudget[] = [];
  for (const candidate of EVRY_MODEL_CANDIDATES) {
    for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
      const requestBody = await serializedPolicyRequestBody({
        candidate,
        fixture,
      });
      const maximumInputTokens = Buffer.byteLength(requestBody, "utf8");
      budgets.push(
        Object.freeze({
          modelId: candidate.id,
          fixtureId: fixture.id,
          requestHash: stableHash(requestBody),
          maximumInputTokens,
          maximumCostUsd: calculateEvryModelCostUsd({
            candidate,
            inputUncachedTokens: maximumInputTokens,
            inputCacheReadTokens: 0,
            inputCacheWriteTokens: 0,
            outputTokens: EVRY_POLICY_MAX_OUTPUT_TOKENS,
          }),
        })
      );
    }
  }
  return Object.freeze(budgets);
}

export function assertEvryBenchmarkRemainingBudget(input: {
  maximumCostUsd: number;
  measuredCostUsd: number;
  remainingMaximumCostUsd: number;
}): void {
  if (
    !Number.isFinite(input.maximumCostUsd) ||
    input.maximumCostUsd <= 0 ||
    !Number.isFinite(input.measuredCostUsd) ||
    input.measuredCostUsd < 0 ||
    !Number.isFinite(input.remainingMaximumCostUsd) ||
    input.remainingMaximumCostUsd < 0 ||
    input.measuredCostUsd + input.remainingMaximumCostUsd >
      input.maximumCostUsd + Number.EPSILON
  ) {
    throw new Error(
      "Benchmark remaining worst-case cost exceeds the authorized budget"
    );
  }
}

async function runPolicyCase(input: {
  apiKey: string;
  candidate: EvryModelCandidate;
  fixture: (typeof EVRY_POLICY_EVAL_FIXTURES)[number];
  configuredSink: NonNullable<ReturnType<typeof createEvryLangfuseSink>>;
}): Promise<EvryPolicyBenchmarkCaseResult> {
  const startedAt = new Date();
  const started = performance.now();
  let firstTokenAt: number | null = null;
  let streamError: unknown;
  const provider = createOpenAI({ apiKey: input.apiKey });
  const result = streamText({
    model: provider(input.candidate.id),
    output: Output.object({ schema: evryPolicyProviderOutputSchema }),
    system: EVRY_POLICY_SYSTEM_PROMPT,
    prompt: input.fixture.request,
    maxOutputTokens: EVRY_POLICY_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: EVRY_POLICY_TIMEOUT_MS,
    providerOptions: evryPolicyProviderOptions(input.candidate),
    onChunk({ chunk }) {
      if (
        firstTokenAt === null &&
        ((chunk.type === "text-delta" && chunk.text.length > 0) ||
          (chunk.type === "reasoning-delta" && chunk.text.length > 0))
      ) {
        firstTokenAt = performance.now();
      }
    },
    onError({ error }) {
      // Results receive a closed error code. Provider bodies stay out of logs
      // and out of Langfuse metadata.
      streamError = error;
    },
  });

  let actual: BenchmarkPolicyDecision | null = null;
  let usage = EMPTY_USAGE;
  let structuredOutput = false;
  try {
    const [output, measuredUsage] = await Promise.all([
      result.output,
      result.usage,
    ]);
    actual = evryPolicyDecisionFromProviderOutput(output);
    usage = measuredUsage;
    structuredOutput = true;
  } catch (error) {
    const failure = streamError ?? error;
    if (isProviderBoundaryRejection(failure)) {
      throw new Error(
        `Benchmark provider boundary rejected ${input.candidate.id}; aborting before the next call`
      );
    }
    try {
      usage = await result.usage;
    } catch {
      usage = EMPTY_USAGE;
    }
  }

  try {
    assertEvryBenchmarkUsage(usage);
  } catch {
    throw new Error(
      `Benchmark ${input.candidate.id} returned invalid usage (${closedErrorName(streamError)}); aborting before the next call`
    );
  }

  const ended = performance.now();
  const endedAt = new Date();
  const exclusiveInput =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(
      0,
      (usage.inputTokens ?? 0) -
        (usage.inputTokenDetails.cacheReadTokens ?? 0) -
        (usage.inputTokenDetails.cacheWriteTokens ?? 0)
    );
  const costUsd = calculateEvryModelCostUsd({
    candidate: input.candidate,
    inputUncachedTokens: exclusiveInput,
    inputCacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
    inputCacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });
  const normalizedUsage = normalizeEvryModelUsage({
    model: input.candidate.id,
    usage,
    costUsd,
    timeToFirstTokenMs:
      firstTokenAt === null ? null : rounded(firstTokenAt - started),
  });
  const correlationId = randomUUID();
  const passed =
    actual !== null && sameDecision(input.fixture.expected, actual);
  let successfulPlan = false;
  if (passed && input.fixture.planProbe === "meeting_invitation_reference") {
    const document = fixtureDocument();
    successfulPlan = document.steps.length > 0;
  }
  const benchmarkResult: EvryPolicyBenchmarkCaseResult = Object.freeze({
    modelId: input.candidate.id,
    fixtureId: input.fixture.id,
    expected: input.fixture.expected,
    actual,
    passed,
    structuredOutput,
    prohibitedRequestSafety: input.fixture.prohibitedRequestSafety,
    successfulPlan,
    errorCode: structuredOutput ? null : "provider_or_shape_failure",
    latencyMs: rounded(ended - started),
    usage: normalizedUsage,
    correlationId,
    traceId: evryTraceIdForCorrelation(correlationId),
  });
  await captureBenchmarkTrace({
    configuredSink: input.configuredSink,
    result: benchmarkResult,
    startedAt,
    endedAt,
  });
  return benchmarkResult;
}

function aggregateCandidate(input: {
  candidate: EvryModelCandidate;
  cases: readonly EvryPolicyBenchmarkCaseResult[];
  allSafetyGatesPassed: boolean;
}): EvryModelBenchmarkAggregate {
  const passing = input.cases.filter(({ passed }) => passed);
  const firstTokens = input.cases.flatMap(({ usage }) =>
    usage.timeToFirstTokenMs === null ? [] : [usage.timeToFirstTokenMs]
  );
  const actionHandoffs = input.cases.filter(
    ({ passed, expected }) =>
      passed && expected.classification === "application_action"
  ).length;
  const candidateSafetyCases = input.cases.filter(
    ({ prohibitedRequestSafety }) => prohibitedRequestSafety
  );
  const candidateSafetyPassed = candidateSafetyCases.filter(
    ({ passed }) => passed
  ).length;
  const successfulPlans = input.cases.filter(
    ({ successfulPlan }) => successfulPlan
  ).length;
  const totalCostUsd = input.cases.reduce(
    (total, result) => total + result.usage.costUsd,
    0
  );
  const evidence = {
    modelId: input.candidate.id,
    policyPassRate: passing.length / input.cases.length,
    structuredOutputRate:
      input.cases.filter(({ structuredOutput }) => structuredOutput).length /
      input.cases.length,
    candidateSafetyPassRate:
      candidateSafetyPassed / candidateSafetyCases.length,
    successfulPlans,
    allSafetyGatesPassed: input.allSafetyGatesPassed,
    totalCostUsd,
  };
  return Object.freeze({
    modelId: input.candidate.id,
    label: input.candidate.label,
    calls: input.cases.length,
    passed: passing.length,
    policyPassRate: evidence.policyPassRate,
    structuredOutputRate: evidence.structuredOutputRate,
    candidateSafetyPassRate: evidence.candidateSafetyPassRate,
    candidateSafety: {
      passed: candidateSafetyPassed,
      total: candidateSafetyCases.length,
      passRate: evidence.candidateSafetyPassRate,
    },
    successfulPlans,
    correctApplicationActionHandoffs: actionHandoffs,
    latencyMs: {
      median: rounded(
        percentile(
          input.cases.map(({ latencyMs }) => latencyMs),
          0.5
        )
      ),
      p95: rounded(
        percentile(
          input.cases.map(({ latencyMs }) => latencyMs),
          0.95
        )
      ),
      mean: rounded(mean(input.cases.map(({ latencyMs }) => latencyMs))),
    },
    timeToFirstTokenMs: {
      median: firstTokens.length ? rounded(percentile(firstTokens, 0.5)) : null,
      p95: firstTokens.length ? rounded(percentile(firstTokens, 0.95)) : null,
      mean: firstTokens.length ? rounded(mean(firstTokens)) : null,
    },
    tokens: {
      inputUncached: input.cases.reduce(
        (total, result) => total + result.usage.inputUncachedTokens,
        0
      ),
      inputCacheRead: input.cases.reduce(
        (total, result) => total + result.usage.inputCacheReadTokens,
        0
      ),
      inputCacheWrite: input.cases.reduce(
        (total, result) => total + result.usage.inputCacheWriteTokens,
        0
      ),
      outputText: input.cases.reduce(
        (total, result) => total + result.usage.outputTextTokens,
        0
      ),
      outputReasoning: input.cases.reduce(
        (total, result) => total + result.usage.outputReasoningTokens,
        0
      ),
      total: input.cases.reduce(
        (total, result) => total + result.usage.totalTokens,
        0
      ),
    },
    totalCostUsd: rounded(totalCostUsd),
    costPerSuccessfulPlanUsd:
      successfulPlans === 0 ? null : rounded(totalCostUsd / successfulPlans),
    allSafetyGatesPassed: input.allSafetyGatesPassed,
    qualifies: evryModelClearsReleaseThresholds(evidence),
  });
}

export async function runEvryModelBenchmark(input: {
  apiKey: string;
  gitSha: string;
  productionModelId: EvryModelCandidateId;
  maximumCostUsd: number;
  callBudgets: readonly EvryBenchmarkCallBudget[];
  proofResults: readonly EvryEvalProofResult[];
  safetyGates: readonly EvrySafetyGateResult[];
  onCaseComplete?: (progress: {
    completed: number;
    total: number;
    result: EvryPolicyBenchmarkCaseResult;
  }) => void;
}): Promise<EvryModelBenchmarkReport> {
  const configuredSink = createEvryLangfuseSink();
  if (!configuredSink) {
    throw new Error("Langfuse must be configured before a live benchmark");
  }
  assertEvryEvalProofResults(EVRY_EVAL_PROOFS, input.proofResults);
  const allSafetyGatesPassed = EVRY_ABSOLUTE_SAFETY_GATES.every(
    (gate) => input.safetyGates.find((result) => result.gate === gate)?.passed
  );
  const cases: EvryPolicyBenchmarkCaseResult[] = [];
  const total = EVRY_MODEL_CANDIDATES.length * EVRY_POLICY_EVAL_FIXTURES.length;
  if (input.callBudgets.length !== total) {
    throw new Error("Benchmark budget matrix does not match the call matrix");
  }
  const estimatedMaximumCostUsd = input.callBudgets.reduce(
    (sum, budget) => sum + budget.maximumCostUsd,
    0
  );

  for (const candidate of EVRY_MODEL_CANDIDATES) {
    for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
      const callIndex = cases.length;
      const budget = input.callBudgets[callIndex];
      if (budget?.modelId !== candidate.id || budget.fixtureId !== fixture.id) {
        throw new Error(
          "Benchmark budget order does not match the call matrix"
        );
      }
      assertEvryBenchmarkRemainingBudget({
        maximumCostUsd: input.maximumCostUsd,
        measuredCostUsd: cases.reduce(
          (sum, result) => sum + result.usage.costUsd,
          0
        ),
        remainingMaximumCostUsd: input.callBudgets
          .slice(callIndex)
          .reduce((sum, remaining) => sum + remaining.maximumCostUsd, 0),
      });
      const result = await runPolicyCase({
        apiKey: input.apiKey,
        candidate,
        fixture,
        configuredSink,
      });
      cases.push(result);
      assertEvryBenchmarkRemainingBudget({
        maximumCostUsd: input.maximumCostUsd,
        measuredCostUsd: cases.reduce(
          (sum, completed) => sum + completed.usage.costUsd,
          0
        ),
        remainingMaximumCostUsd: input.callBudgets
          .slice(callIndex + 1)
          .reduce((sum, remaining) => sum + remaining.maximumCostUsd, 0),
      });
      input.onCaseComplete?.({ completed: cases.length, total, result });
    }
  }

  const candidates = EVRY_MODEL_CANDIDATES.map((candidate) =>
    aggregateCandidate({
      candidate,
      cases: cases.filter(({ modelId }) => modelId === candidate.id),
      allSafetyGatesPassed,
    })
  );
  const selected = selectCheapestQualifiedEvryModel(candidates);
  const corpusIdentity = {
    policy: EVRY_POLICY_EVAL_FIXTURES.map((fixture) => ({
      id: fixture.id,
      family: fixture.family,
      request: fixture.request,
      expected: fixture.expected,
      prohibitedRequestSafety: fixture.prohibitedRequestSafety,
      planProbe: fixture.planProbe,
    })),
    capabilities: EVRY_CAPABILITY_EVAL_FIXTURES,
    recipes: EVRY_RECIPE_EVAL_FIXTURES,
    proofs: EVRY_EVAL_PROOFS,
  };
  const maximumSerializedInputBytes = Math.max(
    ...input.callBudgets.map(({ maximumInputTokens }) => maximumInputTokens)
  );
  const conditions = {
    provider: "openai-responses" as const,
    retries: 0 as const,
    store: false as const,
    serviceTier: "default" as const,
    maxOutputTokens: EVRY_POLICY_MAX_OUTPUT_TOKENS,
    timeoutMs: EVRY_POLICY_TIMEOUT_MS,
    promptsIdenticalAcrossCandidates: true as const,
    toolsExposedDuringPolicy: 0 as const,
    maximumSerializedInputBytes,
  };
  const capabilityCases = EVRY_CAPABILITY_EVAL_FIXTURES.reduce(
    (totalCases, fixture) =>
      totalCases +
      Object.values(fixture.cases).reduce(
        (fixtureCases, casesForLayer) => fixtureCases + casesForLayer.length,
        0
      ),
    0
  );
  const recipeCases = EVRY_RECIPE_EVAL_FIXTURES.reduce(
    (totalCases, fixture) =>
      totalCases +
      Object.values(fixture.cases).reduce(
        (fixtureCases, casesForLayer) => fixtureCases + casesForLayer.length,
        0
      ),
    0
  );
  const measuredCostUsd = candidates.reduce(
    (sum, candidate) => sum + candidate.totalCostUsd,
    0
  );
  const proofResultById = new Map(
    input.proofResults.map((result) => [result.proofId, result])
  );
  const capabilityResults = EVRY_CAPABILITY_EVAL_FIXTURES.flatMap((fixture) =>
    Object.entries(fixture.cases).flatMap(([layer, evalCases]) =>
      evalCases.map(
        (evalCase): EvryRegisteredEvalCaseResult => ({
          subjectIdentity: fixture.capabilityIdentity,
          layer,
          caseId: evalCase.id,
          proofId: evalCase.proofId,
          passed: proofResultById.get(evalCase.proofId)?.passed === true,
        })
      )
    )
  );
  const recipeResults = EVRY_RECIPE_EVAL_FIXTURES.flatMap((fixture) =>
    Object.entries(fixture.cases).flatMap(([layer, evalCases]) =>
      evalCases.map(
        (evalCase): EvryRegisteredEvalCaseResult => ({
          subjectIdentity: fixture.recipeIdentity,
          layer,
          caseId: evalCase.id,
          proofId: evalCase.proofId,
          passed: proofResultById.get(evalCase.proofId)?.passed === true,
        })
      )
    )
  );
  return Object.freeze({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runnerVersion: BENCHMARK_RUNNER_VERSION,
    generatedAt: new Date().toISOString(),
    gitSha: input.gitSha,
    corpus: {
      hash: stableHash(corpusIdentity),
      policyCases: EVRY_POLICY_EVAL_FIXTURES.length,
      capabilityFixtures: EVRY_CAPABILITY_EVAL_FIXTURES.length,
      capabilityCases,
      capabilityLayersPerFixture: EVRY_CAPABILITY_EVAL_LAYERS.length,
      recipeFixtures: EVRY_RECIPE_EVAL_FIXTURES.length,
      recipeCases,
      recipeLayersPerFixture: EVRY_RECIPE_EVAL_LAYERS.length,
      executableProofs: EVRY_EVAL_PROOFS.length,
    },
    conditions: {
      hash: stableHash({
        ...conditions,
        EVRY_POLICY_SYSTEM_PROMPT,
        requests: input.callBudgets.map(
          ({ modelId, fixtureId, requestHash }) => ({
            modelId,
            fixtureId,
            requestHash,
          })
        ),
      }),
      ...conditions,
    },
    budget: {
      maximumCostUsd: rounded(input.maximumCostUsd),
      estimatedMaximumCostUsd: rounded(estimatedMaximumCostUsd),
      measuredCostUsd: rounded(measuredCostUsd),
    },
    thresholds: EVRY_MODEL_RELEASE_THRESHOLDS,
    proofResults: input.proofResults,
    capabilityResults,
    recipeResults,
    safetyGates: input.safetyGates,
    candidates,
    cases,
    cheapestQualifiedModelId: selected?.modelId ?? null,
    productionModelId: input.productionModelId,
    productionSelectionMatches: selected?.modelId === input.productionModelId,
    caveat:
      "The candidate model owns only request-policy classification. Capability, argument, tenancy, confirmation, execution, and recipe gates are shared deterministic proofs. Cost per successful plan divides the candidate's full policy-corpus cost by its successful reference meeting-invitation plan probe.",
  });
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(6)}`;
}

function duration(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value)} ms`;
}

export function evryModelBenchmarkMarkdown(
  report: EvryModelBenchmarkReport
): string {
  const rows = report.candidates
    .map(
      (candidate) =>
        `| ${candidate.label} | ${candidate.passed}/${candidate.calls} (${percent(candidate.policyPassRate)}) | ${candidate.candidateSafety.passed}/${candidate.candidateSafety.total} (${percent(candidate.candidateSafety.passRate)}) | ${percent(candidate.structuredOutputRate)} | ${candidate.successfulPlans} | ${duration(candidate.timeToFirstTokenMs.median)} | ${duration(candidate.latencyMs.median)} | ${candidate.tokens.total.toLocaleString("en-US")} | ${candidate.tokens.inputCacheRead.toLocaleString("en-US")} | ${money(candidate.totalCostUsd)} | ${money(candidate.costPerSuccessfulPlanUsd)} | ${candidate.qualifies ? "Yes" : "No"} |`
    )
    .join("\n");
  const failures = report.cases
    .filter(({ passed }) => !passed)
    .map(
      ({ modelId, fixtureId, expected, actual, errorCode }) =>
        `- ${modelId} / ${fixtureId}: expected ${expected.classification}, got ${actual?.classification ?? errorCode ?? "unknown"}`
    )
    .join("\n");
  return `# Evry model benchmark\n\nGenerated ${report.generatedAt} from \`${report.gitSha}\`. Corpus \`${report.corpus.hash.slice(0, 12)}\`, conditions \`${report.conditions.hash.slice(0, 12)}\`.\n\n## Decision table\n\n| Candidate | Policy | Candidate safety | Structured | Successful plans | Median TTFT | Median latency | Tokens | Cache reads | Total cost | Cost / successful plan | Qualifies |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\nCheapest qualifying candidate: **${report.cheapestQualifiedModelId ?? "none"}**. Production is configured to **${report.productionModelId}** (${report.productionSelectionMatches ? "match" : "MISMATCH"}).\n\n## Release gates\n\n- Executable proofs: ${report.proofResults.filter(({ passed }) => passed).length}/${report.corpus.executableProofs} passed, zero skips required\n- Capability fixtures: ${report.corpus.capabilityFixtures} fixtures, ${report.corpus.capabilityCases} executable-linked cases across ${report.corpus.capabilityLayersPerFixture} required layers\n- Recipe fixtures: ${report.corpus.recipeFixtures} fixtures, ${report.corpus.recipeCases} executable-linked cases across ${report.corpus.recipeLayersPerFixture} required layers\n- Absolute safety: ${report.safetyGates.map(({ gate, passed }) => `${gate}=${passed ? "pass" : "FAIL"}`).join(", ")}\n- Candidate prohibited-request safety: ${percent(report.thresholds.minimumCandidateSafetyPassRate)} required\n- Minimum policy pass rate: ${percent(report.thresholds.minimumPolicyPassRate)}\n- Required structured-output rate: ${percent(report.thresholds.minimumStructuredOutputRate)}\n- Cost authorization: ${money(report.budget.measuredCostUsd)} measured / ${money(report.budget.maximumCostUsd)} authorized; ${money(report.budget.estimatedMaximumCostUsd)} conservative ceiling\n\n## Failed policy cases\n\n${failures || "None."}\n\n## Interpretation limit\n\n${report.caveat}\n`;
}
