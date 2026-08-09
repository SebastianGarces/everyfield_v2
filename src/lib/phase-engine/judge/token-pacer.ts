// ============================================================================
// Token-bucket pacer for the assessment batch (#36).
//
// The problem: one assessment costs ~13.5k tokens (whole rubric + fact ledger +
// retrieved passages) against a 30k TPM key. That is ~2 sustainable assessments
// per minute. The cron batch used to fire them back-to-back, tripped the limit
// on plant 3, and lost the rest of the batch to 429s.
//
// The fix is a token bucket, NOT a hardcoded sleep:
//
//   - the bucket holds `limitTokens` and refills continuously at
//     `limitTokens / 60s`, which is exactly what a TPM window is;
//   - `acquire()` waits until the bucket can pay for the next call;
//   - `observeResponse()` re-syncs the bucket from the provider's OWN
//     `x-ratelimit-*` headers after every call, and re-learns the per-call cost
//     from the reported usage.
//
// That last point is the whole design. A hardcoded 27-second sleep is correct
// for exactly one tier and one rubric size; the moment the key is upgraded to
// 150k TPM it wastes four fifths of the window, and the moment the rubric grows
// it is too fast again. Because every number here is re-derived from the
// response headers, an upgraded tier speeds the batch up on the very next call
// with no code change — and a fatter prompt slows it down the same way.
//
// The bucket is per-RUN state, not a module singleton: the cron route creates
// one and threads it through `generateAssessment` into the judge, so the whole
// batch shares one budget. A one-off manual assessment gets its own throwaway
// bucket and simply never waits.
// ============================================================================

import {
  readRateLimitSnapshot,
  type HeaderLike,
  type RateLimitSnapshot,
} from "./rate-limit";

/** The TPM window OpenAI meters over. Not configurable — it is their unit. */
export const TPM_WINDOW_MS = 60_000;

/**
 * Bootstrap ceiling used until the first response states the real one.
 * Matches the free/entry OpenAI tier for `gpt-4o` as of #36.
 */
export const DEFAULT_TPM_LIMIT = 30_000;

/**
 * Bootstrap cost of one assessment, replaced by the first observed usage.
 * ~13.5k = whole rubric (system) + fact ledger + up to 8 methodology passages
 * + the structured output.
 */
export const DEFAULT_TOKENS_PER_ASSESSMENT = 13_500;

/** Headroom on the learned per-call cost: prompts vary run to run. */
const COST_HEADROOM = 1.1;

/** A single wait is never longer than this — past it, let the 429 teach us. */
export const MAX_SINGLE_WAIT_MS = 120_000;

/** Injected clock, so the throttle is testable without real time passing. */
export interface PacerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: PacerClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    ms <= 0
      ? Promise.resolve()
      : new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface TokenPacerOptions {
  /** Bootstrap TPM ceiling. Overwritten by the first `x-ratelimit-limit-tokens`. */
  limitTokens?: number;
  /** Bootstrap per-call cost. Overwritten by the first reported usage. */
  estimatedTokensPerCall?: number;
  clock?: PacerClock;
  /** Upper bound on any single wait. */
  maxSingleWaitMs?: number;
}

/** Everything the run summary needs to explain how it was paced. */
export interface PacerStats {
  limitTokens: number;
  remainingTokens: number;
  estimatedTokensPerCall: number;
  /** Total milliseconds spent waiting on the bucket across the run. */
  totalWaitMs: number;
  /** How many 429s the pacer was told about. */
  rateLimitHits: number;
  /** True once the provider's own headers have replaced the bootstrap numbers. */
  calibrated: boolean;
}

/**
 * Resolve the bootstrap TPM ceiling.
 *
 * `PHASE_ENGINE_TPM_LIMIT` exists for the window between an OpenAI tier upgrade
 * and the first response of the next run: without it the first batch after an
 * upgrade still paces at the old ceiling. Once a response lands, the header
 * wins over this value in every case.
 */
export function resolveTpmLimit(
  env: { readonly [key: string]: string | undefined } = process.env
): number {
  const raw = env.PHASE_ENGINE_TPM_LIMIT;
  if (!raw) return DEFAULT_TPM_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TPM_LIMIT;
}

export class TokenPacer {
  readonly clock: PacerClock;

  #limitTokens: number;
  #estimatedTokensPerCall: number;
  #available: number;
  #refillPerMs: number;
  #lastRefillAt: number;
  /** Nothing accrues before this instant — set from a 429's Retry-After. */
  #blockedUntilAt: number;
  #maxSingleWaitMs: number;
  #totalWaitMs = 0;
  #rateLimitHits = 0;
  #calibrated = false;

  constructor(options: TokenPacerOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.#limitTokens = positive(options.limitTokens) ?? resolveTpmLimit();
    this.#estimatedTokensPerCall =
      positive(options.estimatedTokensPerCall) ?? DEFAULT_TOKENS_PER_ASSESSMENT;
    this.#maxSingleWaitMs = options.maxSingleWaitMs ?? MAX_SINGLE_WAIT_MS;
    this.#refillPerMs = this.#limitTokens / TPM_WINDOW_MS;
    // A run starts against a window we have not spent yet, so the first call
    // never waits. If that assumption is wrong the first response's headers
    // correct it immediately.
    this.#available = this.#limitTokens;
    this.#lastRefillAt = this.clock.now();
    this.#blockedUntilAt = 0;
  }

  get limitTokens(): number {
    return this.#limitTokens;
  }

  get estimatedTokensPerCall(): number {
    return this.#estimatedTokensPerCall;
  }

  get stats(): PacerStats {
    return {
      limitTokens: this.#limitTokens,
      remainingTokens: Math.floor(this.#available),
      estimatedTokensPerCall: this.#estimatedTokensPerCall,
      totalWaitMs: this.#totalWaitMs,
      rateLimitHits: this.#rateLimitHits,
      calibrated: this.#calibrated,
    };
  }

  /**
   * Milliseconds `acquire(cost)` would wait if called right now — read-only, so
   * the batch runner can decide whether the next plant still fits in the
   * function's time budget WITHOUT spending any of it.
   */
  projectedWaitMs(cost: number = this.#estimatedTokensPerCall): number {
    const now = this.clock.now();
    const price = this.#price(cost);
    const blockWait = Math.max(0, this.#blockedUntilAt - now);
    const availableThen = this.#projectAvailable(now + blockWait);
    if (availableThen >= price) return blockWait;
    const refillWait = Math.ceil((price - availableThen) / this.#refillPerMs);
    return Math.min(blockWait + refillWait, this.#maxSingleWaitMs);
  }

  /**
   * Wait until the bucket can pay for one call, then debit it.
   *
   * @returns the milliseconds actually waited (0 when the budget was ready)
   */
  async acquire(cost: number = this.#estimatedTokensPerCall): Promise<number> {
    const wait = this.projectedWaitMs(cost);
    if (wait > 0) {
      await this.clock.sleep(wait);
      this.#totalWaitMs += wait;
    }
    this.#refill(this.clock.now());
    // Debit even when the wait was capped: a call that goes out under-funded
    // must still leave the bucket in deficit so the NEXT one waits longer.
    this.#available -= this.#price(cost);
    return wait;
  }

  /**
   * Re-sync from a successful response. This is what makes the pacer
   * self-tuning rather than a sleep with extra steps.
   */
  observeResponse(
    headers: HeaderLike | undefined | null,
    usage?: { totalTokens?: number | null }
  ): void {
    const snapshot = readRateLimitSnapshot(headers);
    this.#applySnapshot(snapshot);

    const total = usage?.totalTokens;
    if (typeof total === "number" && Number.isFinite(total) && total > 0) {
      // Re-learn the per-call cost in BOTH directions: a fatter rubric slows
      // the batch down, a leaner one speeds it up, with no constant to edit.
      this.#estimatedTokensPerCall = Math.max(
        1,
        Math.ceil(total * COST_HEADROOM)
      );
    }
  }

  /**
   * Record a 429. The bucket is emptied and held shut until the provider's own
   * Retry-After hint elapses; with no hint, until one call's worth of budget
   * could have refilled.
   */
  observeRateLimit(
    retryAfterMs: number | null,
    headers?: HeaderLike | null
  ): void {
    this.#rateLimitHits += 1;
    // Header state on a 429 is authoritative about the limit itself, but its
    // "remaining" is 0 by definition — apply the limit/reset, then zero out.
    this.#applySnapshot({
      ...readRateLimitSnapshot(headers),
      remainingTokens: null,
    });

    const now = this.clock.now();
    this.#available = 0;
    this.#lastRefillAt = now;

    const penalty =
      retryAfterMs ??
      Math.min(
        this.#maxSingleWaitMs,
        Math.ceil(this.#estimatedTokensPerCall / this.#refillPerMs)
      );
    this.#blockedUntilAt = Math.max(this.#blockedUntilAt, now + penalty);
  }

  // -- internals -------------------------------------------------------------

  /** Never price a call above the whole window, or `acquire` could never win. */
  #price(cost: number): number {
    const requested =
      Number.isFinite(cost) && cost > 0 ? cost : this.#estimatedTokensPerCall;
    return Math.min(requested, this.#limitTokens);
  }

  #projectAvailable(at: number): number {
    const elapsed = Math.max(0, at - this.#lastRefillAt);
    return Math.min(
      this.#limitTokens,
      this.#available + elapsed * this.#refillPerMs
    );
  }

  #refill(now: number): void {
    this.#available = this.#projectAvailable(now);
    this.#lastRefillAt = now;
  }

  #applySnapshot(snapshot: RateLimitSnapshot): void {
    const { limitTokens, remainingTokens, resetTokensMs } = snapshot;

    if (limitTokens !== null && limitTokens > 0) {
      this.#limitTokens = limitTokens;
      this.#refillPerMs = limitTokens / TPM_WINDOW_MS;
      this.#calibrated = true;
    }

    const now = this.clock.now();

    if (remainingTokens !== null && remainingTokens >= 0) {
      this.#refill(now);
      // Trust the server only when it is STRICTER than our own accounting.
      // OpenAI reports the header before our in-flight call is metered, so a
      // naive assignment would hand back budget we have already spent.
      this.#available = Math.min(this.#available, remainingTokens);
      this.#lastRefillAt = now;
      this.#calibrated = true;

      // The truest refill rate available: the provider states both what is
      // missing and how long until it is back.
      if (
        resetTokensMs !== null &&
        resetTokensMs > 0 &&
        this.#limitTokens > remainingTokens
      ) {
        const observed = (this.#limitTokens - remainingTokens) / resetTokensMs;
        if (Number.isFinite(observed) && observed > 0) {
          this.#refillPerMs = observed;
        }
      }
    }
  }
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
