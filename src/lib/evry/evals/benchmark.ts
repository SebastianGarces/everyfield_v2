import { createHash, randomUUID } from "node:crypto";

import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText, type LanguageModelUsage } from "ai";

import { createEvryLangfuseSink } from "@/lib/evry/observability/langfuse";
import { evryTraceIdForCorrelation } from "@/lib/evry/observability/recorder";
import { normalizeEvryModelUsage } from "@/lib/evry/observability/usage";
import type { EvryNormalizedUsage } from "@/lib/evry/observability/contract";
import {
  calculateEvryModelCostUsd,
  EVRY_MODEL_CANDIDATES,
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

import {
  EVRY_ABSOLUTE_SAFETY_GATES,
  EVRY_CAPABILITY_EVAL_LAYERS,
  EVRY_RECIPE_EVAL_LAYERS,
  type EvrySafetyGateResult,
} from "./contracts";
import {
  EVRY_POLICY_EVAL_FIXTURES,
  type EvryPolicyEvalFixture,
} from "./policy/fixtures";
import {
  EVRY_CAPABILITY_EVAL_FIXTURES,
  EVRY_RECIPE_EVAL_FIXTURES,
} from "./registry";

const BENCHMARK_SCHEMA_VERSION = 1 as const;
const BENCHMARK_RUNNER_VERSION = "evry-model-benchmark-v1" as const;
const BENCHMARK_MAX_OUTPUT_TOKENS = 100;
const BENCHMARK_TIMEOUT_MS = 60_000;
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
  costPerSuccessfulPlanHandoffUsd: number | null;
  allSafetyGatesPassed: boolean;
  qualifies: boolean;
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
    capabilityLayersPerFixture: number;
    recipeFixtures: number;
    recipeLayersPerFixture: number;
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
  }>;
  thresholds: typeof EVRY_MODEL_RELEASE_THRESHOLDS;
  safetyGates: readonly EvrySafetyGateResult[];
  candidates: readonly EvryModelBenchmarkAggregate[];
  cases: readonly EvryPolicyBenchmarkCaseResult[];
  cheapestQualifiedModelId: EvryModelCandidateId | null;
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

function candidateProviderOptions(candidate: EvryModelCandidate) {
  return {
    openai: {
      store: false,
      serviceTier: "default",
      ...(candidate.reasoningEffort
        ? { reasoningEffort: candidate.reasoningEffort }
        : {}),
    },
  } as const;
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

async function captureBenchmarkTrace(input: {
  configuredSink: NonNullable<ReturnType<typeof createEvryLangfuseSink>>;
  candidate: EvryModelCandidate;
  result: EvryPolicyBenchmarkCaseResult;
  startedAt: Date;
  endedAt: Date;
}): Promise<void> {
  const status = input.result.passed ? "succeeded" : "failed";
  const reportInstant = input.endedAt.toISOString();
  await input.configuredSink.sink.capture({
    schemaVersion: 1,
    traceId: input.result.traceId,
    correlationId: input.result.correlationId,
    environment: input.configuredSink.environment,
    recipeIdentity: `eval.policy.${input.candidate.id}`,
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
        status,
        resultCode: input.result.passed ? "policy_allowed" : "request_failed",
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
        status,
        resultCode: input.result.passed ? "reported" : "request_failed",
        capabilityIdentity: null,
        details: { kind: "operation" },
      },
    ],
  });
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
    maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: BENCHMARK_TIMEOUT_MS,
    providerOptions: candidateProviderOptions(input.candidate),
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
    if ((usage.totalTokens ?? 0) === 0) {
      throw new Error(
        `Benchmark ${input.candidate.id} failed without usage (${closedErrorName(failure)}); aborting before the next call`
      );
    }
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
  const benchmarkResult: EvryPolicyBenchmarkCaseResult = Object.freeze({
    modelId: input.candidate.id,
    fixtureId: input.fixture.id,
    expected: input.fixture.expected,
    actual,
    passed: actual !== null && sameDecision(input.fixture.expected, actual),
    structuredOutput,
    errorCode: structuredOutput ? null : "provider_or_shape_failure",
    latencyMs: rounded(ended - started),
    usage: normalizedUsage,
    correlationId,
    traceId: evryTraceIdForCorrelation(correlationId),
  });
  await captureBenchmarkTrace({
    configuredSink: input.configuredSink,
    candidate: input.candidate,
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
    costPerSuccessfulPlanHandoffUsd:
      actionHandoffs === 0 ? null : rounded(totalCostUsd / actionHandoffs),
    allSafetyGatesPassed: input.allSafetyGatesPassed,
    qualifies: evryModelClearsReleaseThresholds(evidence),
  });
}

export async function runEvryModelBenchmark(input: {
  apiKey: string;
  gitSha: string;
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
  const allSafetyGatesPassed = EVRY_ABSOLUTE_SAFETY_GATES.every(
    (gate) => input.safetyGates.find((result) => result.gate === gate)?.passed
  );
  const cases: EvryPolicyBenchmarkCaseResult[] = [];
  const total = EVRY_MODEL_CANDIDATES.length * EVRY_POLICY_EVAL_FIXTURES.length;

  for (const candidate of EVRY_MODEL_CANDIDATES) {
    for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
      const result = await runPolicyCase({
        apiKey: input.apiKey,
        candidate,
        fixture,
        configuredSink,
      });
      cases.push(result);
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
  const corpusIdentity = EVRY_POLICY_EVAL_FIXTURES.map((fixture) => ({
    id: fixture.id,
    family: fixture.family,
    request: fixture.request,
    expected: fixture.expected,
  }));
  const conditions = {
    provider: "openai-responses" as const,
    retries: 0 as const,
    store: false as const,
    serviceTier: "default" as const,
    maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
    timeoutMs: BENCHMARK_TIMEOUT_MS,
    promptsIdenticalAcrossCandidates: true as const,
    toolsExposedDuringPolicy: 0 as const,
  };
  return Object.freeze({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runnerVersion: BENCHMARK_RUNNER_VERSION,
    generatedAt: new Date().toISOString(),
    gitSha: input.gitSha,
    corpus: {
      hash: stableHash(corpusIdentity),
      policyCases: EVRY_POLICY_EVAL_FIXTURES.length,
      capabilityFixtures: EVRY_CAPABILITY_EVAL_FIXTURES.length,
      capabilityLayersPerFixture: EVRY_CAPABILITY_EVAL_LAYERS.length,
      recipeFixtures: EVRY_RECIPE_EVAL_FIXTURES.length,
      recipeLayersPerFixture: EVRY_RECIPE_EVAL_LAYERS.length,
    },
    conditions: {
      hash: stableHash({ ...conditions, EVRY_POLICY_SYSTEM_PROMPT }),
      ...conditions,
    },
    thresholds: EVRY_MODEL_RELEASE_THRESHOLDS,
    safetyGates: input.safetyGates,
    candidates,
    cases,
    cheapestQualifiedModelId: selected?.modelId ?? null,
    caveat:
      "This live corpus measures the policy gate. Cost per successful plan handoff means cost divided by correct application-action continuations; it is not a generated-plan or argument-quality score.",
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
        `| ${candidate.label} | ${candidate.passed}/${candidate.calls} (${percent(candidate.policyPassRate)}) | ${percent(candidate.structuredOutputRate)} | ${duration(candidate.timeToFirstTokenMs.median)} | ${duration(candidate.latencyMs.median)} | ${candidate.tokens.total.toLocaleString("en-US")} | ${candidate.tokens.inputCacheRead.toLocaleString("en-US")} | ${money(candidate.totalCostUsd)} | ${money(candidate.costPerSuccessfulPlanHandoffUsd)} | ${candidate.qualifies ? "Yes" : "No"} |`
    )
    .join("\n");
  const failures = report.cases
    .filter(({ passed }) => !passed)
    .map(
      ({ modelId, fixtureId, expected, actual, errorCode }) =>
        `- ${modelId} / ${fixtureId}: expected ${expected.classification}, got ${actual?.classification ?? errorCode ?? "unknown"}`
    )
    .join("\n");
  return `# Evry model benchmark\n\nGenerated ${report.generatedAt} from \`${report.gitSha}\`. Corpus \`${report.corpus.hash.slice(0, 12)}\`, conditions \`${report.conditions.hash.slice(0, 12)}\`.\n\n## Decision table\n\n| Candidate | Policy | Structured | Median TTFT | Median latency | Tokens | Cache reads | Total cost | Cost / successful plan handoff | Qualifies |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\nConfigured cheapest qualifying candidate: **${report.cheapestQualifiedModelId ?? "none"}**. This is benchmark output, not a production model change.\n\n## Release gates\n\n- Capability fixtures: ${report.corpus.capabilityFixtures} × ${report.corpus.capabilityLayersPerFixture} required layers\n- Recipe fixtures: ${report.corpus.recipeFixtures} × ${report.corpus.recipeLayersPerFixture} required layers\n- Absolute safety: ${report.safetyGates.map(({ gate, passed }) => `${gate}=${passed ? "pass" : "FAIL"}`).join(", ")}\n- Minimum policy pass rate: ${percent(report.thresholds.minimumPolicyPassRate)}\n- Required structured-output rate: ${percent(report.thresholds.minimumStructuredOutputRate)}\n\n## Failed policy cases\n\n${failures || "None."}\n\n## Interpretation limit\n\n${report.caveat}\n`;
}
