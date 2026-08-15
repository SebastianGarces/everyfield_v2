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
//
// A 5xx is the other way round — it stays a FAILURE, because the provider
// answered and the answer was broken — but a 5xx ladder cut short by the run
// deadline is marked `isDeadlineTruncatedFailure` so the log can still say "we
// ran out of clock" rather than "the judge is broken" (ruled 2026-08-10).
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
  /**
   * Wall-clock instant (on the pacer's clock) past which this call must stop
   * retrying, whatever the attempt count says.
   *
   * Without it the retry ladder is invisible to the run's time budget: the
   * batch loop only projects the wait for the NEXT plant, but once a plant has
   * started, every extra attempt can add another full TPM-window hold INSIDE
   * that plant. Four attempts at a 30k-TPM window is up to three unguarded
   * minutes — enough to walk a 270s budget past the 300s platform ceiling and
   * be killed mid-plant, leaving the `pending` row the guard exists to prevent.
   *
   * It bounds BOTH retry branches, and that is not decoration (#375): the
   * 5xx/socket-reset branch clamped only its own backoff, so the
   * `pacer.acquire()` opening the next attempt — bounded by
   * `MAX_SINGLE_WAIT_MS` (120s) and by nothing else — kept sleeping after the
   * deadline had passed. Measured 47s past it.
   *
   * Stopping early is lossless: a deferral leaves the plant dirty, so it is
   * re-selected on the next run with its last good snapshot untouched.
   */
  deadlineAt?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

/** Why a throttled call stood down instead of trying again. */
export type RateLimitDeferralReason = "attempts_exhausted" | "run_budget";

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
  /**
   * Why the ladder stopped. `attempts_exhausted` = every attempt was refused;
   * `run_budget` = the next attempt's hold would have crossed the run deadline,
   * so we stood down rather than overrun the function timeout.
   */
  readonly reason: RateLimitDeferralReason;

  constructor(
    label: string,
    attempts: number,
    waitedMs: number,
    retryAfterMs: number | null,
    cause: unknown,
    reason: RateLimitDeferralReason = "attempts_exhausted"
  ) {
    super(
      (reason === "run_budget"
        ? `Rate limited by the model provider; the next retry would have crossed the run's time budget after ${attempts} attempt(s)`
        : `Rate limited by the model provider after ${attempts} attempt(s)`) +
        `${label ? ` for ${label}` : ""}; deferred to the next run.`,
      { cause }
    );
    this.attempts = attempts;
    this.waitedMs = waitedMs;
    this.retryAfterMs = retryAfterMs;
    this.reason = reason;
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
 * The failures whose retry ladder was cut short by the run deadline.
 *
 * A side table rather than a field on the error, and rather than a wrapper
 * error, because the 5xx is rethrown AS ITSELF on purpose: the provider
 * answered, the answer was broken, and the message a human reads must still be
 * the provider's own ("bad gateway"), not ours. Marking out-of-band records WHY
 * the ladder stopped without touching what the error says, what it serializes
 * to, or what `instanceof` reports.
 *
 * The cost of that choice is a contract on every frame between here and the
 * batch runner's `catch`: each one must rethrow the IDENTICAL object. A wrapper
 * — even `new Error(msg, { cause: error })` — is a different key in this set, no
 * type says so, and the failure mode is a clock problem paging someone as a
 * broken judge. `deadline-truncation-chain.test.ts` drives the whole chain and
 * is what fails if a link starts wrapping.
 */
const deadlineTruncatedFailures = new WeakSet<object>();

function markDeadlineTruncated(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    deadlineTruncatedFailures.add(error);
  }
}

/**
 * True when a real provider failure's ladder was stopped by the run's clock
 * rather than by the attempt count.
 *
 * Ruled 2026-08-10 (#374/#375, PR #389): the outcome STAYS `failed` — a broken
 * answer is a failure whatever stopped the ladder — but the caller must be able
 * to tell "we ran out of clock" from "the judge is broken". Since #375 bounded
 * the 5xx branch by `deadlineAt`, a run truncated by its own budget can report
 * a failure after a SINGLE attempt, which on its own is indistinguishable from
 * a provider that is genuinely down. This predicate is that distinction, and it
 * is the 5xx counterpart of `RateLimitDeferralError.reason === "run_budget"`.
 *
 * Never true for a deferral: throttling has its own path and its own reason.
 */
export function isDeadlineTruncatedFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    deadlineTruncatedFailures.has(error)
  );
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
 *
 * Steps 4 and 5 share ONE budget test (`deadlineAt`), and share it on purpose:
 * both loop back into step 1, so both can sleep a capped TPM hold the caller's
 * deadline never sees (#375).
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
    deadlineAt,
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

      // Teach the pacer BEFORE the budget test below reads it: a 429's
      // Retry-After becomes the hold that `projectedWaitMs()` then reports, so
      // this line is what makes the test see the real cost of another attempt.
      const retryAfterMs = rateLimited
        ? retryAfterMsFromError(error, pacer.clock.now())
        : null;
      if (rateLimited) {
        pacer.observeRateLimit(retryAfterMs, headersFromError(error));
      }

      // Retryable but not throttling (5xx, socket reset): the token budget is
      // untouched, so this branch owns a backoff of its own. A 429 adds none —
      // the pacer owns all of that waiting, so a 429 on one plant slows the
      // whole batch instead of only the call that hit it.
      const backoffMs = rateLimited
        ? 0
        : Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));

      // What another attempt actually costs in wall clock, for BOTH branches:
      // this branch's backoff PLUS the `pacer.acquire()` every attempt opens
      // with. Testing it here rather than inside `if (rateLimited)` is the
      // #375 fix: that acquire is bounded by `MAX_SINGLE_WAIT_MS` (120s) and by
      // nothing else, so the 5xx branch used to clamp its own 1s backoff to the
      // deadline and then sleep a whole capped TPM hold past it — measured 47s
      // over — which is exactly what the deadline exists to prevent.
      const nextWaitMs = backoffMs + pacer.projectedWaitMs();
      const outOfBudget =
        deadlineAt !== undefined &&
        pacer.clock.now() + nextWaitMs >= deadlineAt;
      const exhausted = attempt >= attempts || outOfBudget;

      if (rateLimited) {
        onRateLimit?.({
          label,
          attempt,
          maxAttempts: attempts,
          retryAfterMs,
          waitMs: exhausted ? 0 : nextWaitMs,
          exhausted,
        });

        if (exhausted) {
          throw new RateLimitDeferralError(
            label,
            attempt,
            waitedMs,
            retryAfterMs,
            error,
            outOfBudget ? "run_budget" : "attempts_exhausted"
          );
        }
        // No sleep here: `pacer.acquire()` at the top of the next attempt
        // observes the hold that `observeRateLimit` just installed.
        continue;
      }

      // Out of attempts OR out of clock. Either way the 5xx is rethrown AS
      // ITSELF, never as a deferral: the provider answered and the answer was
      // broken, so the run must report a failed judge rather than a throttled
      // one. Standing down on the deadline costs nothing extra — the plant is
      // dirty either way and comes back on the next run.
      if (exhausted) {
        // ...but the two reasons for standing down do not read the same at
        // 07:00, so the clock-truncated one is marked (ruled 2026-08-10).
        // ONLY when the clock is what actually stopped us AND attempts were
        // still left: a ladder that spent its last attempt would have stopped
        // regardless, and calling that "truncated" would soften a genuinely
        // broken judge — the one property no direction was allowed to lose.
        if (outOfBudget && attempt < attempts) markDeadlineTruncated(error);
        throw error;
      }

      await pacer.clock.sleep(backoffMs);
      waitedMs += backoffMs;
    }
  }
}
