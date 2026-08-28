import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";

import naming from "../src/lib/evry/observability/naming.ts";

import {
  parseMetricsResponse,
  parseObservationsResponse,
  runEvryCostAudit,
} from "./evry-cost-audit.mjs";

const { evryObservationName } = naming;

const ENV = {
  LANGFUSE_BASE_URL: "http://127.0.0.1:3100",
  LANGFUSE_PUBLIC_KEY: "pk-lf-local-project",
  LANGFUSE_SECRET_KEY: "sk-lf-local-project",
  LANGFUSE_TRACING_ENVIRONMENT: "local-smoke",
};
const POLICY_OBSERVATION_NAME = evryObservationName({
  spanId: "1".repeat(16),
  parentSpanId: "0".repeat(16),
  stage: "policy",
  startedAt: "2026-08-28T00:00:00.000Z",
  endedAt: "2026-08-28T00:00:00.001Z",
  durationMs: 1,
  status: "succeeded",
  resultCode: "policy_allowed",
  capabilityIdentity: null,
  details: {
    kind: "generation",
    grouping: { kind: "request-policy" },
    usage: {
      model: "gpt-5.4-mini",
      inputUncachedTokens: 60,
      inputCacheReadTokens: 30,
      inputCacheWriteTokens: 10,
      outputTextTokens: 15,
      outputReasoningTokens: 5,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      costUsd: 0.001,
      timeToFirstTokenMs: 25,
    },
  },
});
const VALID_METRICS_ROW = Object.freeze({
  environment: "local-smoke",
  providedModelName: null,
  traceName: null,
  name: "evry.request",
  count_count: 1,
  sum_inputTokens: null,
  sum_outputTokens: null,
  sum_totalTokens: null,
  sum_totalCost: null,
  p50_timeToFirstToken: null,
  p95_timeToFirstToken: null,
  p50_latency: null,
  p95_latency: null,
});

function response(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

test("cost audit reads Metrics plus paged usage without requesting raw fields", async () => {
  const requests = [];
  const pages = [
    response({
      data: [
        {
          id: "obs-1",
          traceId: "a".repeat(32),
          name: POLICY_OBSERVATION_NAME,
          environment: "local-smoke",
          model: "gpt-5.4-mini",
          traceName: "evry.recipe.fixture:meeting.invitation",
          inputUsage: 100,
          outputUsage: 20,
          totalUsage: 120,
          inputCost: 0.0008,
          outputCost: 0.0002,
          usagePricingTierId: null,
          usageDetails: {
            input: 60,
            input_cached_tokens: 30,
            input_cache_creation: 10,
            output: 15,
            output_reasoning_tokens: 5,
            total: 120,
          },
        },
      ],
      meta: { cursor: "next-page" },
    }),
    response({ data: [], meta: {} }),
  ];
  const fetchImpl = async (url, init) => {
    requests.push({
      url: String(url),
      authorization: init.headers.authorization,
    });
    if (String(url).includes("/metrics?")) {
      return response({
        data: [
          {
            environment: "local-smoke",
            providedModelName: "gpt-5.4-mini",
            traceName: "evry.recipe.fixture:meeting.invitation",
            name: POLICY_OBSERVATION_NAME,
            count_count: 1,
            sum_inputTokens: 100,
            sum_outputTokens: 20,
            sum_totalTokens: 120,
            sum_totalCost: 0.001,
            p50_timeToFirstToken: 25,
            p95_timeToFirstToken: 25,
            p50_latency: 40,
            p95_latency: 40,
          },
        ],
      });
    }
    return pages.shift();
  };

  const summary = await runEvryCostAudit({
    argv: [
      "--from",
      "2026-08-28T00:00:00.000Z",
      "--to",
      "2026-08-29T00:00:00.000Z",
    ],
    env: ENV,
    fetchImpl,
  });

  assert.deepEqual(summary.totals, {
    observationCount: 1,
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 30,
    cacheWriteTokens: 10,
    costUsd: 0.001,
  });
  assert.equal(summary.groups[0]?.model, "gpt-5.4-mini");
  assert.equal(requests.length, 3);
  assert.ok(
    requests.every(({ authorization }) => authorization.startsWith("Basic "))
  );
  const observationUrl = new URL(requests[1].url);
  assert.equal(
    observationUrl.searchParams.get("fields"),
    "basic,time,model,usage,metrics,trace_context"
  );
  assert.equal(observationUrl.searchParams.has("expandMetadata"), false);
  assert.equal(observationUrl.searchParams.has("environment"), false);
  assert.equal(observationUrl.searchParams.has("fromStartTime"), false);
  assert.equal(observationUrl.searchParams.has("toStartTime"), false);
  assert.deepEqual(JSON.parse(observationUrl.searchParams.get("filter")), [
    {
      type: "string",
      column: "name",
      operator: "starts with",
      value: "evry.",
    },
    {
      type: "string",
      column: "environment",
      operator: "=",
      value: "local-smoke",
    },
    {
      type: "datetime",
      column: "startTime",
      operator: ">=",
      value: "2026-08-28T00:00:00.000Z",
    },
    {
      type: "datetime",
      column: "startTime",
      operator: "<",
      value: "2026-08-29T00:00:00.000Z",
    },
  ]);
  assert.equal(requests[2].url.includes("cursor=next-page"), true);
  assert.equal(
    JSON.stringify(summary).includes(ENV.LANGFUSE_SECRET_KEY),
    false
  );
});

test("recorded response parsers reject raw fields and metric schema drift", () => {
  assert.throws(
    () =>
      parseMetricsResponse({
        data: [
          {
            environment: "local-smoke",
            providedModelName: null,
            traceName: null,
            name: "evry.request",
            count_count: 1,
          },
        ],
      }),
    /aliases changed/
  );
  assert.throws(
    () =>
      parseMetricsResponse({
        data: [
          {
            environment: "local-smoke",
            providedModelName: null,
            traceName: null,
            name: "evry.request",
            count_count: 1,
            sum_inputTokens: null,
            sum_outputTokens: null,
            sum_totalTokens: null,
            sum_totalCost: null,
            p50_timeToFirstToken: null,
            p95_timeToFirstToken: null,
            p50_latency: null,
            p95_latency: null,
            unexpected_alias: 0,
          },
        ],
      }),
    /aliases changed/
  );
  assert.doesNotThrow(() =>
    parseMetricsResponse({ data: [VALID_METRICS_ROW] })
  );
  assert.throws(
    () =>
      parseObservationsResponse({
        data: [
          {
            id: "obs-1",
            traceId: "a".repeat(32),
            name: "evry.policy",
            input: "private prompt",
          },
        ],
        meta: {},
      }),
    /raw field/
  );
});

test("Metrics refuses a capped 1000-row page instead of undercounting", () => {
  assert.throws(
    () =>
      parseMetricsResponse({
        data: Array.from({ length: 1_000 }, () => VALID_METRICS_ROW),
      }),
    /row limit reached; narrow the requested period/
  );
});

test("configured request failures exit through the strict read boundary", async () => {
  await assert.rejects(
    runEvryCostAudit({
      argv: [
        "--from",
        "2026-08-28T00:00:00.000Z",
        "--to",
        "2026-08-29T00:00:00.000Z",
      ],
      env: ENV,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /HTTP 503/
  );
});
