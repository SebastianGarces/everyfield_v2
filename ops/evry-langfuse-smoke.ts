#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { neonConfig } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";

import { mintEvryAuditRequest } from "@/lib/evry/audit/identity";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { evryObservationName } from "@/lib/evry/observability/naming";
import {
  evryTraceIdForCorrelation,
  type EvryStageRecord,
} from "@/lib/evry/observability/recorder";

const LOCAL_ENV_FILE = new URL("./langfuse/.env", import.meta.url);
const SCRATCH_EMAIL = "evry-langfuse-smoke@scratch.invalid";
const SCRATCH_NAME = "__evry langfuse smoke__";
const DISPOSABLE_DATABASE_NAME = "live_lib_evry_audit_audit_live";
const FORBIDDEN_PROVIDER_KEYS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "COHERE_API_KEY",
  "LANGFUSE_AI_API_KEY",
]);
const SAFE_OBSERVATION_FIELDS = "basic,time,model,usage,metrics,trace_context";
const SAFE_OBSERVATION_KEYS = new Set([
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

type LocalLangfuseConfig = Readonly<{
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  environment: "local-smoke";
}>;

function parseEnvFile(contents: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Invalid local Langfuse environment");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (values.has(key))
      throw new Error("Duplicate local Langfuse environment key");
    if (FORBIDDEN_PROVIDER_KEYS.has(key)) {
      throw new Error(
        "Provider credentials are forbidden in the Langfuse smoke"
      );
    }
    values.set(key, value);
  }
  return values;
}

export function parseLocalLangfuseConfig(
  contents: string
): LocalLangfuseConfig {
  const values = parseEnvFile(contents);
  const port = values.get("LANGFUSE_WEB_HOST_PORT") ?? "";
  const publicKey = values.get("LANGFUSE_INIT_PROJECT_PUBLIC_KEY") ?? "";
  const secretKey = values.get("LANGFUSE_INIT_PROJECT_SECRET_KEY") ?? "";
  if (
    !/^\d{4,5}$/.test(port) ||
    Number(port) < 1_024 ||
    Number(port) > 65_535
  ) {
    throw new Error("Invalid local Langfuse web port");
  }
  if (!/^pk-lf-[a-z0-9]+$/i.test(publicKey)) {
    throw new Error("Invalid local Langfuse public key");
  }
  if (!/^sk-lf-[a-z0-9]+$/i.test(secretKey)) {
    throw new Error("Invalid local Langfuse secret key");
  }
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}`,
    publicKey,
    secretKey,
    environment: "local-smoke",
  });
}

type DisposableSmokeDatabaseConfig = Readonly<{
  databaseUrl: string;
  proxyUrl: string;
}>;

function requiredUrl(value: string | undefined, name: string): URL {
  if (!value) throw new Error(`${name} is required for the disposable smoke`);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} is invalid for the disposable smoke`);
  }
}

/** Refuse every target except the exact disposable stack created by the repo. */
export function parseDisposableSmokeDatabaseConfig(env: {
  DATABASE_URL?: string;
  NEON_HTTP_PROXY_URL?: string;
}): DisposableSmokeDatabaseConfig {
  const database = requiredUrl(env.DATABASE_URL, "DATABASE_URL");
  if (
    database.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.port !== "55432" ||
    database.pathname !== `/${DISPOSABLE_DATABASE_NAME}` ||
    database.username !== "postgres" ||
    database.password !== "postgres" ||
    database.search ||
    database.hash
  ) {
    throw new Error("DATABASE_URL is not the repo disposable audit database");
  }

  const proxy = requiredUrl(env.NEON_HTTP_PROXY_URL, "NEON_HTTP_PROXY_URL");
  if (
    proxy.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(proxy.hostname) ||
    proxy.port !== "4444" ||
    proxy.pathname !== "/sql" ||
    proxy.username ||
    proxy.password ||
    proxy.search ||
    proxy.hash
  ) {
    throw new Error("NEON_HTTP_PROXY_URL is not the repo disposable proxy");
  }

  return Object.freeze({
    databaseUrl: database.toString(),
    proxyUrl: proxy.toString(),
  });
}

export function observationsUrlForCorrelation(
  baseUrl: string,
  correlationId: string
): URL {
  const url = new URL("/api/public/v2/observations", baseUrl);
  url.searchParams.set("traceId", evryTraceIdForCorrelation(correlationId));
  url.searchParams.set("fields", SAFE_OBSERVATION_FIELDS);
  url.searchParams.set("limit", "100");
  return url;
}

type NonContentObservation = Readonly<{
  name: string | null;
  traceId: string;
  traceName: string | null;
}>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNumericMap(value: unknown, kind: "cost" | "usage"): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw new Error(`Invalid ${kind} details`);
  for (const amount of Object.values(value)) {
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      (kind === "usage" && !Number.isInteger(amount))
    ) {
      throw new Error(`Invalid ${kind} detail value`);
    }
  }
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalNullableNumber(value: unknown, integer: boolean): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      (!integer || Number.isInteger(value)))
  );
}

function isEmptyModelParameters(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}

function isAbsentIdentity(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Parse exactly the non-content field groups requested by the smoke. */
export function parseNonContentObservationsResponse(
  value: unknown
): readonly NonContentObservation[] {
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((key) => !["data", "meta"].includes(key)) ||
    !Array.isArray(value.data) ||
    !isPlainObject(value.meta)
  ) {
    throw new Error("Invalid Langfuse observations response");
  }

  return value.data.map((row) => {
    if (
      !isPlainObject(row) ||
      Object.keys(row).some((key) => !SAFE_OBSERVATION_KEYS.has(key)) ||
      typeof row.id !== "string" ||
      typeof row.traceId !== "string" ||
      typeof row.startTime !== "string" ||
      !(typeof row.endTime === "string" || row.endTime === null) ||
      typeof row.projectId !== "string" ||
      !(
        typeof row.parentObservationId === "string" ||
        row.parentObservationId === null
      ) ||
      typeof row.type !== "string" ||
      !(
        row.name === undefined ||
        row.name === null ||
        typeof row.name === "string"
      ) ||
      !isOptionalNullableString(row.model) ||
      !isOptionalNullableNumber(row.inputUsage, true) ||
      !isOptionalNullableNumber(row.outputUsage, true) ||
      !isOptionalNullableNumber(row.totalUsage, true) ||
      !isOptionalNullableNumber(row.inputCost, false) ||
      !isOptionalNullableNumber(row.outputCost, false) ||
      !isOptionalNullableString(row.usagePricingTierId) ||
      !isOptionalNullableString(row.traceName)
    ) {
      throw new Error("Invalid or widened Langfuse observation");
    }
    if (
      !isAbsentIdentity(row.userId) ||
      !isAbsentIdentity(row.sessionId) ||
      !isEmptyModelParameters(row.modelParameters)
    ) {
      throw new Error(
        "Langfuse smoke returned unnecessary person or model data"
      );
    }
    assertNumericMap(row.usageDetails, "usage");
    assertNumericMap(row.costDetails, "cost");
    return Object.freeze({
      name: row.name ?? null,
      traceId: row.traceId,
      traceName: typeof row.traceName === "string" ? row.traceName : null,
    });
  });
}

function stage(
  origin: number,
  stageName: EvryStageRecord["stage"],
  start: number,
  end: number,
  resultCode: EvryStageRecord["resultCode"],
  usage: EvryStageRecord["details"]
): EvryStageRecord {
  return {
    stage: stageName,
    startedAt: new Date(origin + start),
    endedAt: new Date(origin + end),
    status: stageName === "confirmation_wait" ? "waiting" : "succeeded",
    resultCode,
    capabilityIdentity:
      stageName === "read" ||
      stageName === "planning" ||
      stageName.startsWith("execution")
        ? "meeting:read"
        : null,
    details: usage,
  };
}

async function readBackTrace(input: {
  config: LocalLangfuseConfig;
  correlationId: string;
  expectedNames: readonly string[];
  expectedTraceName: string;
}): Promise<number> {
  const authorization = `Basic ${Buffer.from(
    `${input.config.publicKey}:${input.config.secretKey}`
  ).toString("base64")}`;
  const url = observationsUrlForCorrelation(
    input.config.baseUrl,
    input.correlationId
  );
  const traceId = evryTraceIdForCorrelation(input.correlationId);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json", authorization },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      const observations = parseNonContentObservationsResponse(payload);
      const names = new Set(
        observations.flatMap(({ name }) => (name ? [name] : []))
      );
      if (input.expectedNames.every((name) => names.has(name))) {
        assert.ok(observations.every((row) => row.traceId === traceId));
        assert.ok(
          observations.every((row) => row.traceName === input.expectedTraceName)
        );
        return observations.length;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Application trace was not readable within 120 seconds");
}

async function runApplicationSmoke(): Promise<void> {
  const database = parseDisposableSmokeDatabaseConfig({
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_HTTP_PROXY_URL: process.env.NEON_HTTP_PROXY_URL,
  });
  neonConfig.fetchEndpoint = database.proxyUrl;

  const config = parseLocalLangfuseConfig(
    await readFile(LOCAL_ENV_FILE, "utf8")
  );
  process.env.LANGFUSE_BASE_URL = config.baseUrl;
  process.env.LANGFUSE_PUBLIC_KEY = config.publicKey;
  process.env.LANGFUSE_SECRET_KEY = config.secretKey;
  process.env.LANGFUSE_TRACING_ENVIRONMENT = config.environment;

  const [
    { createEvryLangfuseSink },
    { createAuditedEvryTraceRecorder },
    { normalizeEvryModelUsage },
    { shutdownLangfuseTracing },
    { recordEvryRequestAudit },
    { db },
    { churches, users },
  ] = await Promise.all([
    import("@/lib/evry/observability/langfuse"),
    import("@/lib/evry/observability/audited-recorder"),
    import("@/lib/evry/observability/usage"),
    import("@/lib/observability/langfuse"),
    import("@/lib/evry/audit/repository"),
    import("@/db"),
    import("@/db/schema"),
  ]);

  const configured = createEvryLangfuseSink();
  if (!configured)
    throw new Error("Application Langfuse sink refused local config");
  const request = mintEvryAuditRequest();
  const [existingActor] = await db
    .select({ id: users.id, plantId: users.churchId, seat: users.seat })
    .from(users)
    .where(eq(users.email, SCRATCH_EMAIL))
    .limit(1);
  let actorFields = existingActor;
  if (!actorFields) {
    const [plant] = await db
      .insert(churches)
      .values({ name: SCRATCH_NAME })
      .returning({ id: churches.id });
    if (!plant) throw new Error("Langfuse smoke scratch plant was not created");
    const [user] = await db
      .insert(users)
      .values({
        email: SCRATCH_EMAIL,
        passwordHash: "scratch-not-a-login",
        name: SCRATCH_NAME,
        seat: "owner",
        churchId: plant.id,
      })
      .returning({ id: users.id, plantId: users.churchId, seat: users.seat });
    actorFields = user;
  }
  if (!actorFields?.plantId || actorFields.seat !== "owner") {
    throw new Error("Langfuse smoke scratch actor has an invalid plant seat");
  }
  const actor = Object.freeze({
    userId: actorFields.id,
    plantId: actorFields.plantId,
    seat: actorFields.seat,
  }) as unknown as EvryPlantActor;
  await recordEvryRequestAudit({
    actor,
    request,
    result: {
      eventType: "request_read_completed",
      resultCode: "read_completed",
    },
  });

  const origin = Date.now();
  const zeroUsage = normalizeEvryModelUsage({
    model: "zero-provider-fixture",
    usage: {
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    },
    costUsd: 0,
    timeToFirstTokenMs: null,
  });
  const requestPolicyGeneration = {
    kind: "generation" as const,
    grouping: { kind: "request-policy" as const },
    usage: zeroUsage,
  };
  const selectedCapabilityGeneration = {
    kind: "generation" as const,
    grouping: {
      kind: "selected-capability" as const,
      capabilityIdentity: "meeting:read",
    },
    usage: zeroUsage,
  };
  const operation = { kind: "operation" as const };
  const recorder = createAuditedEvryTraceRecorder({
    correlationId: request.correlationId,
    environment: configured.environment,
    recipeIdentity: "smoke:meeting.proposal",
    sink: configured.sink,
  });
  const stages: readonly EvryStageRecord[] = [
    stage(origin, "request", 0, 100, "request_received", operation),
    stage(origin, "policy", 1, 10, "policy_allowed", requestPolicyGeneration),
    stage(origin, "eligibility", 11, 12, "eligibility_allowed", operation),
    stage(origin, "handoff", 13, 14, "handoff_selected", operation),
    stage(origin, "read", 15, 25, "read_completed", operation),
    stage(
      origin,
      "planning",
      26,
      45,
      "plan_proposed",
      selectedCapabilityGeneration
    ),
    stage(
      origin,
      "confirmation_wait",
      46,
      70,
      "confirmation_pending",
      operation
    ),
    stage(origin, "execution_attempt", 71, 72, "execution_started", operation),
    stage(
      origin,
      "execution_outcome",
      73,
      90,
      "execution_completed",
      operation
    ),
    stage(origin, "reporting", 91, 99, "reported", operation),
  ];
  for (const record of stages) assert.equal(recorder.record(record), true);

  try {
    const result = await recorder.finish();
    assert.equal(result.status, "captured");
    if (result.status !== "captured") return;
    const expectedNames = [
      "evry.recipe.smoke:meeting.proposal",
      ...result.trace.spans.map(evryObservationName),
    ];
    const observationCount = await readBackTrace({
      config,
      correlationId: request.correlationId,
      expectedNames,
      expectedTraceName: "evry.recipe.smoke:meeting.proposal",
    });
    process.stdout.write(
      `Evry application Langfuse smoke passed (correlation_id=${request.correlationId} trace_id=${result.trace.traceId} observations=${observationCount} provider_calls=0).\n`
    );
  } finally {
    await shutdownLangfuseTracing();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runApplicationSmoke().catch((error: unknown) => {
    const cause =
      error instanceof Error && isPlainObject(error.cause) ? error.cause : null;
    const code = cause && typeof cause.code === "string" ? cause.code : null;
    const constraint =
      cause && typeof cause.constraint === "string" ? cause.constraint : null;
    process.stderr.write(
      `Evry Langfuse smoke failed${code ? ` (database_code=${code}` : ""}${constraint ? ` constraint=${constraint}` : ""}${code ? ")" : ""}.\n`
    );
    process.exitCode = 1;
  });
}
