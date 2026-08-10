import assert from "node:assert/strict";
import { test } from "node:test";

import { APICallError } from "ai";

import {
  headersFromError,
  isRateLimitError,
  isRetryableError,
  normalizeHeaders,
  parseDurationMs,
  readRateLimitSnapshot,
  retryAfterMsFromError,
} from "./rate-limit";

// ----------------------------------------------------------------------------
// #36: the pure translation between OpenAI's wire formats and the throttle.
// No provider, no clock, no sleeping — everything here is a parse.
// ----------------------------------------------------------------------------

function apiError(
  statusCode: number,
  responseHeaders: Record<string, string> = {},
  message = "boom",
  isRetryable = statusCode >= 500 || statusCode === 429
): APICallError {
  return new APICallError({
    message,
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode,
    responseHeaders,
    isRetryable,
  });
}

// --- Duration parsing -------------------------------------------------------

test("parseDurationMs reads OpenAI's compound Go durations", () => {
  assert.equal(parseDurationMs("27s"), 27_000);
  assert.equal(parseDurationMs("6m0s"), 360_000);
  assert.equal(parseDurationMs("1h2m3s"), 3_723_000);
  assert.equal(parseDurationMs("7.66s"), 7_660);
});

test("parseDurationMs reads ms before m, so 300ms is not 300 minutes", () => {
  assert.equal(parseDurationMs("300ms"), 300);
  assert.equal(parseDurationMs("1m500ms"), 60_500);
});

test("parseDurationMs treats a bare number as seconds (the Retry-After spelling)", () => {
  assert.equal(parseDurationMs("7"), 7_000);
  assert.equal(parseDurationMs("0.5"), 500);
});

test("parseDurationMs returns null for a non-duration", () => {
  assert.equal(parseDurationMs(""), null);
  assert.equal(parseDurationMs("   "), null);
  assert.equal(parseDurationMs("soon"), null);
  assert.equal(parseDurationMs(null), null);
  assert.equal(parseDurationMs(undefined), null);
});

// --- Header reading ---------------------------------------------------------

test("normalizeHeaders lowercases keys from a record and from Headers", () => {
  assert.deepEqual(normalizeHeaders({ "X-RateLimit-Limit-Tokens": "30000" }), {
    "x-ratelimit-limit-tokens": "30000",
  });
  const headers = new Headers({ "X-RateLimit-Remaining-Tokens": "16500" });
  assert.equal(
    normalizeHeaders(headers)["x-ratelimit-remaining-tokens"],
    "16500"
  );
  assert.deepEqual(normalizeHeaders(undefined), {});
});

test("readRateLimitSnapshot pulls the token budget off a response", () => {
  const snapshot = readRateLimitSnapshot({
    "x-ratelimit-limit-tokens": "30000",
    "x-ratelimit-remaining-tokens": "16500",
    "x-ratelimit-reset-tokens": "27s",
    // Request-limit headers are deliberately ignored: tokens are the binding
    // limit for the judge, requests are not.
    "x-ratelimit-remaining-requests": "499",
  });
  assert.deepEqual(snapshot, {
    limitTokens: 30_000,
    remainingTokens: 16_500,
    resetTokensMs: 27_000,
  });
});

test("readRateLimitSnapshot is all-nulls when the provider said nothing", () => {
  assert.deepEqual(readRateLimitSnapshot({}), {
    limitTokens: null,
    remainingTokens: null,
    resetTokensMs: null,
  });
});

// --- Classification ---------------------------------------------------------

test("isRateLimitError is true for a 429 and false for other statuses", () => {
  assert.equal(isRateLimitError(apiError(429)), true);
  assert.equal(isRateLimitError(apiError(500)), false);
  assert.equal(isRateLimitError(apiError(400)), false);
});

test("isRateLimitError finds the 429 through a wrapper", () => {
  const wrapped = new Error("model call failed", { cause: apiError(429) });
  assert.equal(isRateLimitError(wrapped), true);

  // The AI SDK's RetryError shape: the real failure hangs off `lastError`.
  const retryError = Object.assign(new Error("maxRetriesExceeded"), {
    lastError: apiError(429),
    errors: [apiError(429)],
  });
  assert.equal(isRateLimitError(retryError), true);
});

test("isRateLimitError falls back to the message when the type was lost", () => {
  assert.equal(
    isRateLimitError(
      new Error("Rate limit reached for gpt-4o in organization")
    ),
    true
  );
  assert.equal(
    isRateLimitError(new Error("Limit 30000, Requested 13500 tokens per min")),
    true
  );
  assert.equal(isRateLimitError(new Error("invalid schema")), false);
  assert.equal(isRateLimitError(undefined), false);
});

test("a typed non-429 is never rescued by its message text", () => {
  // A 400 whose body happens to mention the rate limit docs must stay a 400 —
  // retrying it would burn the run's budget on something that cannot succeed.
  assert.equal(
    isRateLimitError(apiError(400, {}, "see the rate limit guide")),
    false
  );
});

test("isRetryableError follows the provider's own verdict", () => {
  assert.equal(isRetryableError(apiError(500)), true);
  assert.equal(isRetryableError(apiError(429)), true);
  assert.equal(
    isRetryableError(apiError(400, {}, "bad request", false)),
    false
  );
  // An untyped failure (socket reset, DNS) gets the benefit of the doubt.
  assert.equal(isRetryableError(new Error("ECONNRESET")), true);
});

// --- Retry-After ------------------------------------------------------------

test("retryAfterMsFromError prefers retry-after-ms", () => {
  const error = apiError(429, {
    "retry-after-ms": "6500",
    "retry-after": "60",
    "x-ratelimit-reset-tokens": "6m0s",
  });
  assert.equal(retryAfterMsFromError(error), 6_500);
});

test("retryAfterMsFromError reads retry-after in seconds", () => {
  assert.equal(
    retryAfterMsFromError(apiError(429, { "retry-after": "7" })),
    7_000
  );
});

test("retryAfterMsFromError reads retry-after as an HTTP-date", () => {
  const now = Date.parse("2026-08-09T12:00:00.000Z");
  const error = apiError(429, {
    "retry-after": "Sun, 09 Aug 2026 12:00:30 GMT",
  });
  assert.equal(retryAfterMsFromError(error, now), 30_000);
});

test("retryAfterMsFromError falls back to the token reset header", () => {
  const error = apiError(429, { "x-ratelimit-reset-tokens": "27s" });
  assert.equal(retryAfterMsFromError(error), 27_000);
});

test("retryAfterMsFromError reads the hint out of the message body", () => {
  // Survives a proxy that strips headers — OpenAI states the wait in the body.
  const error = new Error(
    "Rate limit reached for gpt-4o. Please try again in 6.5s. Visit the docs."
  );
  assert.equal(retryAfterMsFromError(error), 6_500);
  assert.equal(
    retryAfterMsFromError(new Error("rate limit; please try again in 300ms")),
    300
  );
});

test("retryAfterMsFromError returns null when nothing was stated", () => {
  assert.equal(retryAfterMsFromError(apiError(429)), null);
});

test("retryAfterMsFromError discards a nonsense hint rather than clamping it", () => {
  // A negative or absurd hint must not become a zero-delay hot loop against a
  // limiter, and must not park the run past its own function timeout.
  assert.equal(
    retryAfterMsFromError(apiError(429, { "retry-after-ms": "-5" })),
    null
  );
  assert.equal(
    retryAfterMsFromError(apiError(429, { "retry-after-ms": "7200000" })),
    null
  );
});

test("headersFromError surfaces the 429's headers, lowercased", () => {
  const error = new Error("wrapped", {
    cause: apiError(429, { "Retry-After-Ms": "1200" }),
  });
  assert.equal(headersFromError(error)["retry-after-ms"], "1200");
  assert.deepEqual(headersFromError(new Error("plain")), {});
});
