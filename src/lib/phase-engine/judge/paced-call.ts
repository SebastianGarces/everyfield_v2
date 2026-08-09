// ============================================================================
// The paced, Retry-After-aware call wrapper (#36).
//
// One place owns "make the provider call, wait your turn, and come back when
// the provider says to". Both the judge (`run-assessment.ts`) and the throttle
// integration test drive the exact same function, so the test proves the real
// policy rather than a re-implementation of it.
//
// Why this replaces the AI SDK's own retry: the SDK retries with a 2s/4s
// exponential backoff inside the SAME TPM minute that just refused us. Against
// a token-per-minute limit those two retries are guaranteed to fail — the
// budget has not refilled — and the third attempt gives up. Retry-After is the
// only delay that can be right, and it must feed the shared bucket so the rest
// of the batch backs off too, not just this one call. `generateObject` is
// therefore called with `maxRetries: 0` and the policy lives here.
//
// The other half of the contract: exhausting the retries against a rate limit
// is NOT a judge failure. It throws `RateLimitDeferralError`, which the batch
// runner counts and logs separately, so a throttled run never reads as a broken
// judge. The plant stays dirty and is re-selected on the next run either way.
// ============================================================================

import {
  headersFromError,
  isRateLimitError,
  isRetryableError,
  retryAfterMsFromError,
  type HeaderLike,
} from "./rate-limit";
import { TokenPacer } from "./token-pacer";

/** What a paced call hands back: the value plus the metering signals. */
export interface PacedCallResult<T> {
  value: T;
  /** Response headers — the pacer re-syncs its budget from these. */
  headers?: HeaderLike | null;
  /** Total tokens the call actually spent, for cost re-learning. */
  totalTokens?: number | null;
}

/** Reported on every 429, so throttling is observable and not inferred. */
export interface RateLimitEvent {
  label: string;
  attempt: number;
  maxAttempts: number;
  /** The provider's own hint, or null when it gave none. */
  retryAfterMs: number | null;
  /** How long the pacer will actually hold before the next attempt. */
  waitMs: number;
  /** True when this was the last attempt and the call is being deferred. */
  exhausted: boolean;
}

export interface PacedCallOptions {
  pacer: TokenPacer;
  /** Total attempts including the first. Default 4. */
  maxAttempts?: number;
  /** Backoff base for retryable errors with no server hint. Default 1s. */
  baseBackoffMs?: number;
  /** Ceiling on a computed backoff. Default 60s. */
  maxBackoffMs?: number;
  /** Identifies the call in logs (the church id, in practice). */
  label?: string;
  /** Called on every rate-limit hit — the distinct-logging seam. */
  onRateLimit?: (event: RateLimitEvent) => void;
}

export const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

/**
 * Thrown when a call was throttled for every attempt.
 *
 * Distinct from a judge failure on purpose: the batch runner reports these as
 * DEFERRALS. Misreading a throttled run as a broken judge is the exact failure
 * mode #36 was filed about.
 */
export class RateLimitDeferralError extends Error {
  readonly name = "RateLimitDeferralError";
  readonly attempts: number;
  readonly waitedMs: number;
  readonly retryAfterMs: number | null;

  constructor(
    label: string,
    attempts: number,
    waitedMs: number,
    retryAfterMs: number | null,
    cause: unknown
  ) {
    super(
      `Rate limited by the model provider after ${attempts} attempt(s)` +
        `${label ? ` for ${label}` : ""}; deferred to the next run.`,
      { cause }
    );
    this.attempts = attempts;
    this.waitedMs = waitedMs;
    this.retryAfterMs = retryAfterMs;
  }

  static isInstance(error: unknown): error is RateLimitDeferralError {
    return error instanceof Error && error.name === "RateLimitDeferralError";
  }
}

/** True when this failure is throttling rather than a broken judge. */
export function isRateLimitDeferral(
  error: unknown
): error is RateLimitDeferralError {
  return RateLimitDeferralError.isInstance(error);
}

/**
 * Run one provider call under the shared token budget, honouring Retry-After.
 *
 * Sequence per attempt:
 *   1. `pacer.acquire()` — block until the token bucket can pay for the call,
 *      and until any Retry-After hold from a previous 429 has elapsed.
 *   2. run the call.
 *   3. on success, feed the response headers + usage back into the pacer.
 *   4. on a 429, hand the Retry-After hint to the pacer (which converts it into
 *      the hold that step 1 of the NEXT attempt observes) and loop.
 *   5. on another retryable error, back off exponentially; on anything else,
 *      rethrow immediately — a 400 will not fix itself.
 *
 * There is deliberately no separate sleep in step 4: the pacer owns all
 * waiting, so a 429 on one plant slows the whole batch instead of only the
 * call that hit it.
 */
export async function runPacedCall<T>(
  call: () => Promise<PacedCallResult<T>>,
  options: PacedCallOptions
): Promise<T> {
  const {
    pacer,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    label = "",
    onRateLimit,
  } = options;

  const attempts = Math.max(1, maxAttempts);
  let waitedMs = 0;

  for (let attempt = 1; ; attempt++) {
    waitedMs += await pacer.acquire();

    try {
      const result = await call();
      pacer.observeResponse(result.headers, {
        totalTokens: result.totalTokens,
      });
      return result.value;
    } catch (error) {
      const rateLimited = isRateLimitError(error);

      if (!rateLimited && !isRetryableError(error)) throw error;
      if (!rateLimited && attempt >= attempts) throw error;

      if (rateLimited) {
        const retryAfterMs = retryAfterMsFromError(error, pacer.clock.now());
        pacer.observeRateLimit(retryAfterMs, headersFromError(error));
        const exhausted = attempt >= attempts;

        onRateLimit?.({
          label,
          attempt,
          maxAttempts: attempts,
          retryAfterMs,
          waitMs: exhausted ? 0 : pacer.projectedWaitMs(),
          exhausted,
        });

        if (exhausted) {
          throw new RateLimitDeferralError(
            label,
            attempt,
            waitedMs,
            retryAfterMs,
            error
          );
        }
        // No sleep here: `pacer.acquire()` at the top of the next attempt
        // observes the hold that `observeRateLimit` just installed.
        continue;
      }

      // Retryable but not throttling (5xx, socket reset): the token budget is
      // untouched, so this is the one delay the pacer does not own.
      const backoff = Math.min(
        maxBackoffMs,
        baseBackoffMs * 2 ** (attempt - 1)
      );
      await pacer.clock.sleep(backoff);
      waitedMs += backoff;
    }
  }
}
