#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

const REQUIRED_ENV = [
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_TRACING_ENVIRONMENT",
];
const NON_CONTENT_OBSERVATION_KEYS = new Set([
  "id",
  "traceId",
  "startTime",
  "endTime",
  "projectId",
  "parentObservationId",
  "type",
  "isRootObservation",
  "name",
  "level",
  "statusMessage",
  "version",
  "environment",
  "bookmarked",
  "public",
  "userId",
  "sessionId",
  "completionStartTime",
  "createdAt",
  "updatedAt",
  "providedModelName",
  "model",
  "internalModelId",
  "modelParameters",
  "usageDetails",
  "inputUsage",
  "outputUsage",
  "totalUsage",
  "costDetails",
  "inputCost",
  "outputCost",
  "totalCost",
  "usagePricingTierId",
  "usagePricingTierName",
  "latency",
  "timeToFirstToken",
  "modelId",
  "inputPrice",
  "outputPrice",
  "totalPrice",
  "traceName",
  "tags",
  "release",
]);
const METRICS_DIMENSION_KEYS = [
  "environment",
  "providedModelName",
  "traceName",
  "name",
];
const METRICS_VALUE_KEYS = [
  "count_count",
  "sum_inputTokens",
  "sum_outputTokens",
  "sum_totalTokens",
  "sum_totalCost",
  "p50_timeToFirstToken",
  "p95_timeToFirstToken",
  "p50_latency",
  "p95_latency",
];
const METRICS_ROW_KEYS = new Set([
  ...METRICS_DIMENSION_KEYS,
  ...METRICS_VALUE_KEYS,
]);

function configuredEnvironment(env) {
  if (env.NEXT_PUBLIC_LANGFUSE_SECRET_KEY) {
    throw new Error("Refusing browser-exposed Langfuse secret config");
  }
  for (const name of REQUIRED_ENV) {
    if (!env[name]) throw new Error(`Missing required environment: ${name}`);
  }
  const url = new URL(env.LANGFUSE_BASE_URL);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Langfuse base URL must use HTTPS or loopback HTTP");
  }
  if (
    env.LANGFUSE_TRACING_ENVIRONMENT.length > 40 ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(env.LANGFUSE_TRACING_ENVIRONMENT) ||
    env.LANGFUSE_TRACING_ENVIRONMENT.startsWith("langfuse")
  ) {
    throw new Error("Invalid Langfuse tracing environment");
  }
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    environment: env.LANGFUSE_TRACING_ENVIRONMENT,
  };
}

export function parseCostAuditArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--from", "--to", "--json"].includes(name) || !value) {
      throw new Error(
        "Usage: evry-cost-audit --from <ISO> --to <ISO> [--json <path>]"
      );
    }
    values.set(name, value);
  }
  const from = new Date(values.get("--from") ?? "");
  const to = new Date(values.get("--to") ?? "");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error("Cost audit range must use ISO timestamps");
  }
  if (from >= to) throw new Error("Cost audit --to must be after --from");
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    jsonPath: values.get("--json") ?? null,
  };
}

export function buildEvryMetricsQuery({ from, to, environment }) {
  return {
    view: "observations",
    dimensions: [
      { field: "environment" },
      { field: "providedModelName" },
      { field: "traceName" },
      { field: "name" },
    ],
    metrics: [
      { measure: "count", aggregation: "count" },
      { measure: "inputTokens", aggregation: "sum" },
      { measure: "outputTokens", aggregation: "sum" },
      { measure: "totalTokens", aggregation: "sum" },
      { measure: "totalCost", aggregation: "sum" },
      { measure: "timeToFirstToken", aggregation: "p50" },
      { measure: "timeToFirstToken", aggregation: "p95" },
      { measure: "latency", aggregation: "p50" },
      { measure: "latency", aggregation: "p95" },
    ],
    filters: [
      {
        column: "environment",
        operator: "=",
        value: environment,
        type: "string",
      },
      {
        column: "name",
        operator: "starts with",
        value: "evry.",
        type: "string",
      },
    ],
    fromTimestamp: from,
    toTimestamp: to,
    config: { row_limit: 1_000 },
  };
}

function basicAuth(config) {
  return `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function parseMetricsResponse(value) {
  if (!plainObject(value) || !Array.isArray(value.data)) {
    throw new Error("Langfuse Metrics API returned an invalid response");
  }
  if (value.data.length >= 1_000) {
    throw new Error(
      "Langfuse Metrics row limit reached; narrow the requested period"
    );
  }
  for (const row of value.data) {
    if (!plainObject(row)) throw new Error("Langfuse Metrics row is invalid");
    const keys = Object.keys(row);
    if (
      keys.length !== METRICS_ROW_KEYS.size ||
      keys.some((key) => !METRICS_ROW_KEYS.has(key))
    ) {
      throw new Error("Langfuse Metrics row aliases changed");
    }
    if (
      typeof row.environment !== "string" ||
      row.environment.length === 0 ||
      typeof row.name !== "string" ||
      row.name.length === 0 ||
      !(
        row.providedModelName === null ||
        (typeof row.providedModelName === "string" &&
          row.providedModelName.length > 0)
      ) ||
      !(
        row.traceName === null ||
        (typeof row.traceName === "string" && row.traceName.length > 0)
      )
    ) {
      throw new Error("Langfuse Metrics dimensions are invalid");
    }
    if (
      typeof row.count_count !== "number" ||
      !Number.isFinite(row.count_count) ||
      row.count_count < 0
    ) {
      throw new Error("Langfuse Metrics count is invalid");
    }
    for (const key of METRICS_VALUE_KEYS.slice(1)) {
      const item = row[key];
      if (
        item !== null &&
        (typeof item !== "number" || !Number.isFinite(item) || item < 0)
      ) {
        throw new Error(`Langfuse Metrics ${key} is invalid`);
      }
    }
  }
  return value.data;
}

export function parseObservationsResponse(value) {
  if (
    !plainObject(value) ||
    Object.keys(value).some((key) => !["data", "meta"].includes(key)) ||
    !Array.isArray(value.data) ||
    !plainObject(value.meta)
  ) {
    throw new Error("Langfuse Observations API returned an invalid response");
  }
  if (
    value.meta.cursor !== undefined &&
    value.meta.cursor !== null &&
    typeof value.meta.cursor !== "string"
  ) {
    throw new Error("Langfuse Observations cursor is invalid");
  }
  for (const observation of value.data) {
    if (!plainObject(observation)) {
      throw new Error("Langfuse observation is invalid");
    }
    if (
      "input" in observation ||
      "output" in observation ||
      "metadata" in observation
    ) {
      throw new Error(
        "Langfuse returned a raw field the cost audit did not request"
      );
    }
    if (
      Object.keys(observation).some(
        (key) => !NON_CONTENT_OBSERVATION_KEYS.has(key)
      ) ||
      typeof observation.id !== "string" ||
      typeof observation.traceId !== "string" ||
      typeof observation.name !== "string" ||
      !(
        observation.model === undefined ||
        observation.model === null ||
        typeof observation.model === "string"
      )
    ) {
      throw new Error("Langfuse observation is invalid");
    }
    if (observation.usageDetails !== undefined) {
      if (!plainObject(observation.usageDetails)) {
        throw new Error("Langfuse observation usage is invalid");
      }
      for (const count of Object.values(observation.usageDetails)) {
        if (!Number.isInteger(count) || count < 0) {
          throw new Error("Langfuse observation token count is invalid");
        }
      }
    }
  }
  return { data: value.data, cursor: value.meta.cursor ?? null };
}

function dimension(row, key, fallback) {
  const value = row[key];
  return typeof value === "string" && value ? value : fallback;
}

function number(row, key) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function groupKey(row) {
  return JSON.stringify([
    row.environment,
    row.model,
    row.recipe,
    row.capability,
  ]);
}

export function summarizeEvryCostAudit({
  from,
  to,
  environment,
  metricRows,
  observations,
}) {
  const groups = new Map();
  for (const row of metricRows) {
    const group = {
      environment: dimension(row, "environment", environment),
      model: dimension(row, "providedModelName", "none"),
      recipe: dimension(row, "traceName", "evry.recipe.single"),
      capability: dimension(row, "name", "evry.unknown"),
      observationCount: number(row, "count_count"),
      inputTokens: number(row, "sum_inputTokens"),
      outputTokens: number(row, "sum_outputTokens"),
      totalTokens: number(row, "sum_totalTokens"),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: number(row, "sum_totalCost"),
      p50TimeToFirstTokenMs: number(row, "p50_timeToFirstToken"),
      p95TimeToFirstTokenMs: number(row, "p95_timeToFirstToken"),
      p50LatencyMs: number(row, "p50_latency"),
      p95LatencyMs: number(row, "p95_latency"),
    };
    groups.set(groupKey(group), group);
  }

  for (const observation of observations) {
    const usage = observation.usageDetails ?? {};
    const cacheReadTokens = number(usage, "input_cached_tokens");
    const cacheWriteTokens = number(usage, "input_cache_creation");
    if (cacheReadTokens === 0 && cacheWriteTokens === 0) continue;
    const identity = {
      environment: observation.environment ?? environment,
      model: observation.providedModelName ?? observation.model ?? "none",
      recipe: observation.traceName ?? "evry.recipe.single",
      capability: observation.name,
    };
    const key = groupKey(identity);
    const group = groups.get(key) ?? {
      ...identity,
      observationCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      p50TimeToFirstTokenMs: 0,
      p95TimeToFirstTokenMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
    };
    group.cacheReadTokens += cacheReadTokens;
    group.cacheWriteTokens += cacheWriteTokens;
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((left, right) =>
    groupKey(left).localeCompare(groupKey(right))
  );
  return {
    schemaVersion: 1,
    period: { from, to },
    totals: ordered.reduce(
      (total, group) => ({
        observationCount: total.observationCount + group.observationCount,
        inputTokens: total.inputTokens + group.inputTokens,
        outputTokens: total.outputTokens + group.outputTokens,
        totalTokens: total.totalTokens + group.totalTokens,
        cacheReadTokens: total.cacheReadTokens + group.cacheReadTokens,
        cacheWriteTokens: total.cacheWriteTokens + group.cacheWriteTokens,
        costUsd: total.costUsd + group.costUsd,
      }),
      {
        observationCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      }
    ),
    groups: ordered,
  };
}

async function fetchJson(url, authorization, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { authorization, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Langfuse read failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function runEvryCostAudit({
  argv,
  env,
  fetchImpl = globalThis.fetch,
  writeJson = writeFile,
}) {
  const range = parseCostAuditArgs(argv);
  const config = configuredEnvironment(env);
  const authorization = basicAuth(config);
  const metricsUrl = new URL("/api/public/v2/metrics", config.baseUrl);
  metricsUrl.searchParams.set(
    "query",
    JSON.stringify(
      buildEvryMetricsQuery({
        ...range,
        environment: config.environment,
      })
    )
  );
  const metricRows = parseMetricsResponse(
    await fetchJson(metricsUrl, authorization, fetchImpl)
  );

  const observations = [];
  let cursor = null;
  do {
    const url = new URL("/api/public/v2/observations", config.baseUrl);
    url.searchParams.set(
      "fields",
      "basic,time,model,usage,metrics,trace_context"
    );
    url.searchParams.set("limit", "1000");
    url.searchParams.set(
      "filter",
      JSON.stringify([
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
          value: config.environment,
        },
        {
          type: "datetime",
          column: "startTime",
          operator: ">=",
          value: range.from,
        },
        {
          type: "datetime",
          column: "startTime",
          operator: "<",
          value: range.to,
        },
      ])
    );
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = parseObservationsResponse(
      await fetchJson(url, authorization, fetchImpl)
    );
    observations.push(...page.data);
    cursor = page.cursor;
  } while (cursor);

  const summary = summarizeEvryCostAudit({
    ...range,
    environment: config.environment,
    metricRows,
    observations,
  });
  if (range.jsonPath) {
    await writeJson(
      range.jsonPath,
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8"
    );
  }
  return summary;
}

function terminalSummary(summary) {
  return [
    `Evry cost audit ${summary.period.from} to ${summary.period.to}`,
    `Observations: ${summary.totals.observationCount}`,
    `Tokens: ${summary.totals.totalTokens} (${summary.totals.cacheReadTokens} cache read, ${summary.totals.cacheWriteTokens} cache write)`,
    `Cost: $${summary.totals.costUsd.toFixed(6)}`,
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const summary = await runEvryCostAudit({
      argv: process.argv.slice(2),
      env: process.env,
    });
    process.stderr.write(`${terminalSummary(summary)}\n`);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Evry cost audit failed"}\n`
    );
    process.exitCode = 1;
  }
}
