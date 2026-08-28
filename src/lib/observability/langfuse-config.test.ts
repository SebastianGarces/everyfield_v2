import assert from "node:assert/strict";
import test from "node:test";

import { parseLangfuseConfig } from "./langfuse-config";

const CONFIGURED = {
  LANGFUSE_BASE_URL: "http://127.0.0.1:3100",
  LANGFUSE_PUBLIC_KEY: "pk-lf-local-project",
  LANGFUSE_SECRET_KEY: "sk-lf-local-project",
  LANGFUSE_TRACING_ENVIRONMENT: "local-smoke",
} as const;

test("Langfuse config distinguishes disabled from a complete explicit setup", () => {
  assert.deepEqual(parseLangfuseConfig({}), { status: "disabled" });
  assert.deepEqual(parseLangfuseConfig(CONFIGURED), {
    status: "configured",
    baseUrl: "http://127.0.0.1:3100",
    publicKey: "pk-lf-local-project",
    secretKey: "sk-lf-local-project",
    environment: "local-smoke",
  });
});

test("partial config refuses rather than falling back to Langfuse Cloud", () => {
  assert.deepEqual(
    parseLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: CONFIGURED.LANGFUSE_PUBLIC_KEY,
    }),
    { status: "refused", reason: "partial" }
  );
});

test("remote cleartext URLs and browser-exposed secrets are refused", () => {
  assert.deepEqual(
    parseLangfuseConfig({
      ...CONFIGURED,
      LANGFUSE_BASE_URL: "http://langfuse.internal",
    }),
    { status: "refused", reason: "invalid" }
  );
  assert.deepEqual(
    parseLangfuseConfig({
      ...CONFIGURED,
      NEXT_PUBLIC_LANGFUSE_SECRET_KEY: CONFIGURED.LANGFUSE_SECRET_KEY,
    }),
    { status: "refused", reason: "public_secret" }
  );
});

test("refusal states never echo secret values", () => {
  const secret = "sk-lf-secret-that-must-not-echo";
  assert.equal(
    JSON.stringify(
      parseLangfuseConfig({
        ...CONFIGURED,
        LANGFUSE_SECRET_KEY: secret,
        LANGFUSE_TRACING_ENVIRONMENT: "contains private spaces",
      })
    ).includes(secret),
    false
  );
});

test("environment follows the exact Langfuse SDK name boundary", () => {
  for (const environment of [
    "UPPERCASE",
    "contains.dot",
    "a".repeat(41),
    "langfuse-local",
  ]) {
    assert.deepEqual(
      parseLangfuseConfig({
        ...CONFIGURED,
        LANGFUSE_TRACING_ENVIRONMENT: environment,
      }),
      { status: "refused", reason: "invalid" }
    );
  }
});
