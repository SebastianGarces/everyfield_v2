import assert from "node:assert/strict";
import test from "node:test";
import { trace } from "@opentelemetry/api";

import {
  initializeLangfuseTracing,
  maskLangfuseData,
  shutdownLangfuseTracing,
} from "./langfuse";

test("the exporter mask removes common secret and recipient shapes recursively", () => {
  const masked = maskLangfuseData({
    recipient: "jordan.private@example.com",
    nested: ["Bearer token-value", "sk-lf-very-secret"],
    safe: "policy_allowed",
  });
  assert.deepEqual(masked, {
    recipient: "[redacted-email]",
    nested: ["Bearer [redacted]", "[redacted-secret]"],
    safe: "policy_allowed",
  });
});

test("isolated Langfuse initialization leaves the global provider unchanged", async () => {
  const before = trace.getTracerProvider();
  const previous = {
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_TRACING_ENVIRONMENT: process.env.LANGFUSE_TRACING_ENVIRONMENT,
  };
  process.env.LANGFUSE_BASE_URL = "http://127.0.0.1:3100";
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-local-project";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-local-project";
  process.env.LANGFUSE_TRACING_ENVIRONMENT = "local-test";

  try {
    assert.equal(initializeLangfuseTracing().status, "configured");
    assert.equal(trace.getTracerProvider(), before);
  } finally {
    await shutdownLangfuseTracing();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
