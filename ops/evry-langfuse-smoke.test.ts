import assert from "node:assert/strict";
import test from "node:test";

import {
  observationsUrlForCorrelation,
  parseDisposableSmokeDatabaseConfig,
  parseLocalLangfuseConfig,
  parseNonContentObservationsResponse,
} from "./evry-langfuse-smoke";

const LOCAL_ENV = `
LANGFUSE_WEB_HOST_PORT=3210
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local
LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local
`;

test("application smoke maps generated local credentials to a loopback app config", () => {
  assert.deepEqual(parseLocalLangfuseConfig(LOCAL_ENV), {
    baseUrl: "http://127.0.0.1:3210",
    publicKey: "pk-lf-local",
    secretKey: "sk-lf-local",
    environment: "local-smoke",
  });
  assert.throws(
    () => parseLocalLangfuseConfig(`${LOCAL_ENV}OPENAI_API_KEY=forbidden\n`),
    /forbidden/
  );
});

test("application smoke accepts only the repo disposable audit database", () => {
  const valid = {
    DATABASE_URL:
      "postgresql://postgres:postgres@127.0.0.1:55432/live_lib_evry_audit_audit_live",
    NEON_HTTP_PROXY_URL: "http://localhost:4444/sql",
  };
  assert.deepEqual(parseDisposableSmokeDatabaseConfig(valid), {
    databaseUrl: valid.DATABASE_URL,
    proxyUrl: valid.NEON_HTTP_PROXY_URL,
  });

  for (const env of [
    { ...valid, DATABASE_URL: undefined },
    { ...valid, NEON_HTTP_PROXY_URL: undefined },
    {
      ...valid,
      DATABASE_URL:
        "postgresql://postgres:postgres@db.example.com:55432/live_lib_evry_audit_audit_live",
    },
    {
      ...valid,
      DATABASE_URL:
        "postgres://postgres:postgres@127.0.0.1:55432/live_lib_evry_audit_audit_live",
    },
    {
      ...valid,
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/live_lib_evry_audit_audit_live",
    },
    {
      ...valid,
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/everyfield",
    },
    {
      ...valid,
      DATABASE_URL:
        "postgresql://app:secret@127.0.0.1:55432/live_lib_evry_audit_audit_live",
    },
    { ...valid, NEON_HTTP_PROXY_URL: "https://proxy.example.com:4444/sql" },
    { ...valid, NEON_HTTP_PROXY_URL: "http://127.0.0.1:4445/sql" },
    { ...valid, NEON_HTTP_PROXY_URL: "http://127.0.0.1:4444/other" },
  ]) {
    assert.throws(() => parseDisposableSmokeDatabaseConfig(env));
  }
});

test("application smoke read-back derives a non-content observations request", () => {
  const correlationId = "11111111-1111-4111-8111-111111111111";
  const url = observationsUrlForCorrelation(
    "http://127.0.0.1:3210",
    correlationId
  );
  assert.match(url.searchParams.get("traceId") ?? "", /^[0-9a-f]{32}$/);
  assert.notEqual(url.searchParams.get("traceId"), correlationId);
  assert.equal(
    url.searchParams.get("fields"),
    "basic,time,model,usage,metrics,trace_context"
  );
  assert.equal(url.searchParams.has("input"), false);
  assert.equal(url.searchParams.has("output"), false);
  assert.equal(url.searchParams.has("metadata"), false);

  const observation = {
    id: "observation-1",
    traceId: url.searchParams.get("traceId"),
    startTime: "2026-08-28T10:00:00.000Z",
    endTime: "2026-08-28T10:00:00.001Z",
    projectId: "local-project",
    parentObservationId: null,
    type: "GENERATION",
    name: "evry.policy.request-policy",
    userId: null,
    sessionId: null,
    model: "zero-provider-fixture",
    modelParameters: {},
    usageDetails: { input: 0, output: 0, total: 0 },
    inputUsage: 0,
    outputUsage: 0,
    totalUsage: 0,
    costDetails: { input: 0, output: 0, total: 0 },
    inputCost: 0,
    outputCost: 0,
    usagePricingTierId: null,
    traceName: "evry.recipe.smoke:meeting.proposal",
  };
  assert.equal(
    parseNonContentObservationsResponse({ data: [observation], meta: {} })[0]
      ?.name,
    "evry.policy.request-policy"
  );
  assert.equal(
    parseNonContentObservationsResponse({ data: [observation], meta: {} })[0]
      ?.traceName,
    "evry.recipe.smoke:meeting.proposal"
  );
  assert.throws(
    () =>
      parseNonContentObservationsResponse({
        data: [{ ...observation, metadata: { rawBody: "private" } }],
        meta: {},
      }),
    /widened/
  );
  assert.throws(
    () =>
      parseNonContentObservationsResponse({
        data: [{ ...observation, rawBody: "private" }],
        meta: {},
      }),
    /widened/
  );
  assert.throws(
    () =>
      parseNonContentObservationsResponse({
        data: [
          {
            ...observation,
            userId: "person-1",
            modelParameters: { private: "unexpected" },
          },
        ],
        meta: {},
      }),
    /unnecessary person or model data/
  );
});
