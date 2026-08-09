// ============================================================================
// Rate-limit signal parsing (#36).
//
// OpenAI answers EVERY chat completion with its current rate-limit state in the
// response headers, and answers a 429 with a hint about when to come back. This
// module is the pure translation layer between those wire formats and the two
// consumers that act on them:
//
//   - `TokenPacer` (token-pacer.ts) — paces the batch off the *live* remaining
//     token budget rather than a hardcoded sleep, so a tier change (30k TPM →
//     150k TPM) speeds the batch up on its own with no code change.
//   - `runPacedCall` (paced-call.ts) — honours the server's Retry-After hint
//     instead of guessing an exponential backoff.
//
// Nothing here does I/O, sleeps, or throws: it reads headers and errors and
// returns numbers or null. That is what makes the throttle unit-testable
// without a live provider.
//
// The headers of record (OpenAI, lowercased by fetch):
//   x-ratelimit-limit-tokens      "30000"   — the TPM ceiling for this key
//   x-ratelimit-remaining-tokens  "16500"   — what is left in the window
//   x-ratelimit-reset-tokens      "27s"     — when it returns to the ceiling
//   retry-after-ms                "6500"    — 429 only, milliseconds
//   retry-after                   "7"       — 429 only, seconds or an HTTP-date
// ============================================================================

import { APICallError } from "ai";

export const HEADER_LIMIT_TOKENS = "x-ratelimit-limit-tokens";
export const HEADER_REMAINING_TOKENS = "x-ratelimit-remaining-tokens";
export const HEADER_RESET_TOKENS = "x-ratelimit-reset-tokens";
export const HEADER_RETRY_AFTER_MS = "retry-after-ms";
export const HEADER_RETRY_AFTER = "retry-after";

/** Anything header-shaped: a plain record or a `Headers` instance. */
export type HeaderLike = Record<string, string | undefined> | Headers;

/** What the provider told us about the token budget on this response. */
export interface RateLimitSnapshot {
  /** The TPM ceiling for this key, when the provider stated it. */
  limitTokens: number | null;
  /** Tokens left in the current window, when the provider stated it. */
  remainingTokens: number | null;
  /** Milliseconds until the token budget returns to the ceiling. */
  resetTokensMs: number | null;
}

/** Lowercase a header bag so lookups do not depend on the provider's casing. */
export function normalizeHeaders(
  headers: HeaderLike | undefined | null
): Record<string, string> {
  if (!headers) return {};

  const out: Record<string, string> = {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

/** Parse a finite, non-negative number, or null. */
function finiteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse OpenAI's compound duration format into milliseconds.
 *
 * The reset headers are Go durations, not plain numbers: `"27s"`, `"6m0s"`,
 * `"1h2m3s"`, `"300ms"`, `"7.66s"`. A bare number is read as SECONDS, which is
 * what `Retry-After` means when it is not an HTTP-date.
 *
 * @returns milliseconds, or null when the value is not a duration at all
 */
export function parseDurationMs(
  value: string | undefined | null
): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // A bare number is seconds (the Retry-After spelling).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 1000;
  }

  // `ms` must be matched before `m`, or "300ms" reads as 300 minutes.
  const unit = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };

  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = unit.exec(trimmed)) !== null) {
    matched = true;
    total += Number.parseFloat(match[1]) * multipliers[match[2]];
  }

  return matched ? total : null;
}

/** Read the token-budget headers off a response (or a 429). */
export function readRateLimitSnapshot(
  headers: HeaderLike | undefined | null
): RateLimitSnapshot {
  const h = normalizeHeaders(headers);
  return {
    limitTokens: finiteNumber(h[HEADER_LIMIT_TOKENS]),
    remainingTokens: finiteNumber(h[HEADER_REMAINING_TOKENS]),
    resetTokensMs: parseDurationMs(h[HEADER_RESET_TOKENS]),
  };
}

/**
 * Walk an error and everything it wraps.
 *
 * The AI SDK nests: a `RetryError` carries `lastError`/`errors`, and a wrapped
 * provider failure carries `cause`. The 429 that actually matters can be any
 * depth down, so every classifier here walks rather than inspecting the top.
 */
function* unwrap(error: unknown, depth = 0): Generator<unknown> {
  if (error == null || depth > 5) return;
  yield error;

  if (typeof error !== "object") return;
  const candidate = error as {
    cause?: unknown;
    lastError?: unknown;
    errors?: unknown;
  };

  yield* unwrap(candidate.cause, depth + 1);
  yield* unwrap(candidate.lastError, depth + 1);
  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) yield* unwrap(nested, depth + 1);
  }
}

/** The 429 inside an error, if there is one. */
function findApiCallError(error: unknown): APICallError | null {
  for (const candidate of unwrap(error)) {
    if (APICallError.isInstance(candidate)) return candidate;
  }
  return null;
}

const RATE_LIMIT_MESSAGE =
  /rate.?limit|too many requests|tokens per min|\bTPM\b|429/i;

/**
 * True when the failure is the provider throttling us rather than a broken
 * judge. Prefers the status code; falls back to the message because a provider
 * wrapper can lose the typed error but never loses the text.
 */
export function isRateLimitError(error: unknown): boolean {
  const apiError = findApiCallError(error);
  if (apiError?.statusCode === 429) return true;
  if (apiError && apiError.statusCode !== undefined) return false;

  for (const candidate of unwrap(error)) {
    if (
      candidate instanceof Error &&
      RATE_LIMIT_MESSAGE.test(candidate.message)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when it is worth trying the same call again — a 5xx, a timeout, a
 * connection reset. A 4xx that is not a 429 is the judge's own fault (bad
 * request, bad key) and retrying it only burns the run's time budget.
 */
export function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  const apiError = findApiCallError(error);
  if (apiError) return apiError.isRetryable;
  // An unclassified error (network blip, aborted socket) gets one more try.
  return findStatusCode(error) === null;
}

function findStatusCode(error: unknown): number | null {
  for (const candidate of unwrap(error)) {
    const status = (candidate as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  return null;
}

/** The response headers carried by the 429 inside an error, if any. */
export function headersFromError(error: unknown): Record<string, string> {
  return normalizeHeaders(findApiCallError(error)?.responseHeaders);
}

/**
 * "Please try again in 6.5s." — OpenAI states the wait in the 429 body even
 * when a proxy has stripped the headers, so the message is a real fallback.
 */
const MESSAGE_HINT = /try again in\s+([\d.]+)\s*(ms|s|m|h)\b/i;

/**
 * How long the provider asked us to wait, in milliseconds, or null when it did
 * not say. Sources, in order of authority:
 *
 *   1. `retry-after-ms`            — exact, millisecond precision
 *   2. `retry-after`               — seconds, or an HTTP-date
 *   3. `x-ratelimit-reset-tokens`  — when the TOKEN budget (our binding limit)
 *                                    returns; a request-limit reset is not it
 *   4. the message hint            — survives header-stripping proxies
 *
 * A negative or absurd value is discarded rather than clamped to zero: a bad
 * hint must not turn into a hot retry loop against a limiter.
 */
export function retryAfterMsFromError(
  error: unknown,
  now: number = Date.now()
): number | null {
  const headers = headersFromError(error);

  const exact = finiteNumber(headers[HEADER_RETRY_AFTER_MS]);
  if (exact !== null) return sane(exact);

  const retryAfter = headers[HEADER_RETRY_AFTER];
  if (retryAfter !== undefined) {
    const asDuration = parseDurationMs(retryAfter);
    if (asDuration !== null) return sane(asDuration);
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) return sane(asDate - now);
  }

  const reset = parseDurationMs(headers[HEADER_RESET_TOKENS]);
  if (reset !== null) return sane(reset);

  for (const candidate of unwrap(error)) {
    if (!(candidate instanceof Error)) continue;
    const match = MESSAGE_HINT.exec(candidate.message);
    if (!match) continue;
    const parsed = parseDurationMs(`${match[1]}${match[2]}`);
    if (parsed !== null) return sane(parsed);
  }

  return null;
}

/** One hour is longer than any cron run; anything past it is a broken hint. */
const MAX_SANE_HINT_MS = 60 * 60 * 1000;

function sane(ms: number): number | null {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_SANE_HINT_MS) return null;
  return ms;
}
