import assert from "node:assert/strict";
import { test } from "node:test";

import { APICallError } from "ai";

import type { SelectedPlant } from "@/lib/phase-engine/assessment";
import {
  isRateLimitDeferral,
  runPacedCall,
  TokenPacer,
  type PacerClock,
} from "@/lib/phase-engine/judge";

import {
  MAX_ATTEMPTS_PER_PLANT,
  MAX_BATCH,
  maxDuration,
  runAssessmentBatch,
  RUN_BUDGET_MS,
  type RunAssessmentBatchDeps,
} from "./route";

// ============================================================================
// #36 — the cron batch against a simulated 30k TPM OpenAI key.
//
// No live DB and no live LLM: `generateAssessment` is replaced by a fake that
// drives the REAL throttle (`runPacedCall` + `TokenPacer`) against a fake
// OpenAI that meters tokens and answers 429 with real rate-limit headers when
// the budget is gone. The code under test is therefore the production pacing
// and retry policy, not a re-implementation of it.
//
// Everything runs on a virtual clock, so a batch that would take four minutes
// of wall time is asserted in milliseconds.
// ============================================================================

interface VirtualClock extends PacerClock {
  readonly sleeps: number[];
}

function virtualClock(): VirtualClock {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    async sleep(ms: number) {
      sleeps.push(ms);
      if (ms > 0) t += ms;
    },
  };
}

/** Format milliseconds the way OpenAI formats `x-ratelimit-reset-*`. */
function goDuration(ms: number): string {
  if (ms < 1000) return `${Math.ceil(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface FakeOpenAiOptions {
  limitTokens?: number;
  /** Tokens the fake starts the run with. Below the limit = a warm window. */
  startingTokens?: number;
  /** Per-call cost; a function so the cost can vary call to call. */
  costForCall?: (index: number) => number;
  /** Simulated round-trip latency of the judge call. */
  latencyMs?: number;
  /**
   * A SECOND consumer on the same OPENAI_API_KEY — RAG embeddings, the manual
   * trigger, or a second cron tick. It shares the TPM window with this run and
   * is invisible to the pacer until a response says so.
   */
  externalDrain?: { tokens: number; everyMs: number; fromMs: number };
  /**
   * Answer 429s with `x-ratelimit-reset-tokens` only, no `retry-after-ms`.
   * That is the header OpenAI always sends; the millisecond one is not
   * guaranteed, and the hint it yields is a whole window instead of a deficit.
   */
  omitRetryAfterMs?: boolean;
}

/**
 * A mocked OpenAI client with a real token-per-minute budget.
 *
 * Models the provider the way OpenAI documents it: a continuously refilling
 * token bucket, `x-ratelimit-*` on every answer, and a 429 with `retry-after-ms`
 * when a request would overdraw it.
 */
class FakeOpenAi {
  readonly limitTokens: number;
  readonly refillPerMs: number;
  readonly latencyMs: number;

  #available: number;
  #lastRefillAt: number;
  #calls = 0;
  #nextDrainAt: number;

  /** How many requests the fake refused. The number #36 needs to be zero-ish. */
  rateLimitedRequests = 0;
  /** How many requests the fake served. */
  servedRequests = 0;

  constructor(
    private readonly clock: PacerClock,
    private readonly options: FakeOpenAiOptions = {}
  ) {
    this.limitTokens = options.limitTokens ?? 30_000;
    this.refillPerMs = this.limitTokens / 60_000;
    this.latencyMs = options.latencyMs ?? 8_000;
    this.#available = options.startingTokens ?? this.limitTokens;
    this.#lastRefillAt = clock.now();
    this.#nextDrainAt =
      options.externalDrain?.fromMs ?? Number.POSITIVE_INFINITY;
  }

  #refillTo(at: number): void {
    this.#available = Math.min(
      this.limitTokens,
      this.#available + (at - this.#lastRefillAt) * this.refillPerMs
    );
    this.#lastRefillAt = at;
  }

  #refill(): void {
    const now = this.clock.now();
    const drain = this.options.externalDrain;
    while (drain && this.#nextDrainAt <= now) {
      this.#refillTo(this.#nextDrainAt);
      this.#available = Math.max(0, this.#available - drain.tokens);
      this.#nextDrainAt += drain.everyMs;
    }
    this.#refillTo(now);
  }

  #headers(): Record<string, string> {
    const missing = this.limitTokens - this.#available;
    return {
      "x-ratelimit-limit-tokens": String(this.limitTokens),
      "x-ratelimit-remaining-tokens": String(Math.floor(this.#available)),
      "x-ratelimit-reset-tokens": goDuration(missing / this.refillPerMs),
    };
  }

  async call(): Promise<{
    headers: Record<string, string>;
    totalTokens: number;
  }> {
    this.#refill();
    const cost = this.options.costForCall?.(this.#calls) ?? 13_500;
    this.#calls++;

    if (this.#available < cost) {
      this.rateLimitedRequests++;
      const deficitMs = Math.ceil((cost - this.#available) / this.refillPerMs);
      throw new APICallError({
        message: `Rate limit reached for gpt-4o. Limit ${this.limitTokens}, Requested ${cost} tokens per min.`,
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: this.options.omitRetryAfterMs
          ? this.#headers()
          : { ...this.#headers(), "retry-after-ms": String(deficitMs) },
        isRetryable: true,
      });
    }

    this.#available -= cost;
    this.servedRequests++;
    await this.clock.sleep(this.latencyMs);
    this.#refill();
    return { headers: this.#headers(), totalTokens: cost };
  }
}

function plants(count: number): SelectedPlant[] {
  return Array.from({ length: count }, (_, i) => ({
    churchId: `church-${i}`,
    reason: "never-assessed" as const,
  }));
}

/** Build batch deps whose `generateAssessment` runs the real paced call. */
function depsFor(
  selected: SelectedPlant[],
  pacer: TokenPacer,
  openai: FakeOpenAi,
  overrides: Partial<RunAssessmentBatchDeps> = {}
): RunAssessmentBatchDeps {
  return {
    maxBatch: selected.length,
    pacer,
    now: () => pacer.clock.now(),
    runBudgetMs: Number.MAX_SAFE_INTEGER,
    async selectPlantsForAssessment() {
      return selected;
    },
    async generateAssessment(churchId, _deps, run) {
      await runPacedCall(
        async () => {
          const response = await openai.call();
          return {
            value: churchId,
            headers: response.headers,
            totalTokens: response.totalTokens,
          };
        },
        {
          pacer: run?.pacer ?? pacer,
          maxAttempts: run?.maxAttempts,
          label: churchId,
          onRateLimit: run?.onRateLimit,
          // The real `generateAssessment` threads this through to the judge;
          // the fake must too, or the test would prove a policy nothing runs.
          deadlineAt: run?.deadlineAt,
        }
      );
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
    ...overrides,
  };
}

/** Capture console output so the log-shape assertions are real assertions. */
function captureConsole() {
  const warns: string[] = [];
  const errors: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => warns.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return {
    warns,
    errors,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

// ----------------------------------------------------------------------------
// AC 1: ≥25 plants, zero rate-limit failures against a 30k TPM ceiling.
// ----------------------------------------------------------------------------

test("25 plants complete with zero rate-limit failures at 30k TPM", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  // The judge's real cost varies run to run (rubric + facts + retrieved
  // passages), and the pacer bootstraps at a guess. It has to LEARN the cost.
  const openai = new FakeOpenAi(clock, {
    limitTokens: 30_000,
    costForCall: (i) => 12_000 + ((i * 719) % 3_001), // 12000..15000, deterministic
  });

  const summary = await runAssessmentBatch(depsFor(plants(25), pacer, openai));

  assert.equal(summary.selected, 25);
  assert.equal(summary.assessed, 25);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 0);
  assert.equal(summary.rateLimited, 0);
  // The fake never had to refuse a single request — the pacing kept the batch
  // inside the budget rather than discovering the ceiling by hitting it.
  assert.equal(openai.rateLimitedRequests, 0);
  assert.equal(openai.servedRequests, 25);
  // And it really did pace: a 25-plant run cannot be free at 30k TPM.
  assert.ok(summary.pacedWaitMs > 0);
});

test("the run's throughput is the TPM ceiling, not an arbitrary sleep", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock, { limitTokens: 30_000 });

  await runAssessmentBatch(depsFor(plants(25), pacer, openai));

  // 25 x 13500 = 337500 tokens. Minus the 30000 the window started with, that
  // is 307500 tokens at 500/s = 615s minimum for ANY scheme that respects the
  // limit. The run is close to that floor and never below it.
  const floorMs = (25 * 13_500 - 30_000) / (30_000 / 60_000);
  assert.ok(
    clock.now() >= floorMs,
    `run finished in ${clock.now()}ms, below the ${floorMs}ms the limit allows`
  );
  assert.ok(clock.now() < floorMs * 1.35, `run took ${clock.now()}ms`);
});

test("a tier upgrade is picked up from the headers mid-run", async () => {
  const clock = virtualClock();
  // The pacer bootstraps at the old 30k tier; the key is really on 150k.
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock, { limitTokens: 150_000 });

  const summary = await runAssessmentBatch(depsFor(plants(25), pacer, openai));

  assert.equal(summary.assessed, 25);
  assert.equal(openai.rateLimitedRequests, 0);
  assert.equal(summary.tpmLimit, 150_000);
  // Five times the ceiling, so nothing like the 615s floor of the 30k tier.
  assert.ok(clock.now() < 240_000, `run took ${clock.now()}ms`);
});

// ----------------------------------------------------------------------------
// AC: a 429 is absorbed, not lost.
// ----------------------------------------------------------------------------

test("a depleted window costs one 429 and then the batch converges", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  // The previous run (or another process on the same key) just spent the
  // window. The pacer starts optimistic and is wrong; the 429 corrects it.
  const openai = new FakeOpenAi(clock, {
    limitTokens: 30_000,
    startingTokens: 3_000,
  });

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(depsFor(plants(25), pacer, openai));
  } finally {
    capture.restore();
  }

  assert.equal(summary.assessed, 25);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 0);
  // It corrects, rather than trading 429s for the rest of the run.
  assert.ok(
    openai.rateLimitedRequests <= 2,
    `expected the pacer to converge after at most 2 refusals, got ${openai.rateLimitedRequests}`
  );
  // Throttling was announced on the warn channel, never as an error.
  assert.ok(capture.warns.some((line) => /rate limited on church/.test(line)));
  assert.deepEqual(capture.errors, []);
});

// ----------------------------------------------------------------------------
// AC: deferrals are logged and counted apart from genuine failures.
// ----------------------------------------------------------------------------

test("a throttled plant is a deferral, a broken judge is a failure", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock);

  const deps = depsFor(plants(3), pacer, openai, {
    async generateAssessment(churchId, _deps, run) {
      if (churchId === "church-1") {
        // A limiter that never lets up: every attempt is refused.
        return runPacedCall(
          async () => {
            throw new APICallError({
              message: "Rate limit reached for gpt-4o.",
              url: "https://api.openai.com/v1/responses",
              requestBodyValues: {},
              statusCode: 429,
              responseHeaders: { "retry-after-ms": "1000" },
              isRetryable: true,
            });
          },
          {
            pacer: run?.pacer ?? pacer,
            maxAttempts: run?.maxAttempts,
            label: churchId,
            onRateLimit: run?.onRateLimit,
          }
        ) as never;
      }
      if (churchId === "church-2") throw new Error("judge returned garbage");
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
  });

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(deps);
  } finally {
    capture.restore();
  }

  assert.equal(summary.assessed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.deferred, 1);
  assert.equal(summary.rateLimited, 1);

  const throttled = summary.outcomes.find((o) => o.churchId === "church-1");
  assert.equal(throttled?.status, "deferred");
  assert.equal(throttled?.deferralReason, "rate_limit");

  const broken = summary.outcomes.find((o) => o.churchId === "church-2");
  assert.equal(broken?.status, "failed");
  assert.equal(broken?.deferralReason, undefined);

  // The two are on different channels with different words, so a throttled run
  // is never read as a broken judge (#36).
  assert.ok(
    capture.warns.some((line) =>
      /rate-limit deferral for church church-1/.test(line)
    )
  );
  assert.ok(
    capture.errors.some((line) =>
      /assessment failed for church church-2/.test(line)
    )
  );
  assert.ok(
    !capture.errors.some((line) => /church-1/.test(line)),
    "a throttled plant must never reach the error channel"
  );
});

// ----------------------------------------------------------------------------
// AC (#374): the summary says which deferral cost tokens.
//
// `attempted` used to be `status !== "deferred"`, which filed a plant the
// provider refused four times and a plant the run never started under the same
// zero. The token bill of those two is not the same number, and the Actions log
// is the only place anyone reads it.
// ----------------------------------------------------------------------------

test("a throttled deferral counts as attempted; a stood-down one does not", async () => {
  const clock = virtualClock();
  // A ceiling far above what this run spends, so the only holds here are the
  // ones the 429s install. The arithmetic below is about the retry ladder and
  // the run budget, not about pacing.
  const pacer = new TokenPacer({ clock, limitTokens: 1_000_000 });
  const runBudgetMs = 60_000;
  /** Every call that actually left for the provider, in order. */
  const providerCalls: string[] = [];

  const deps: RunAssessmentBatchDeps = {
    maxBatch: 4,
    pacer,
    now: () => clock.now(),
    runBudgetMs,
    maxAttempts: MAX_ATTEMPTS_PER_PLANT,
    async selectPlantsForAssessment() {
      return plants(4);
    },
    async generateAssessment(churchId, _deps, run) {
      const paced = {
        pacer: run?.pacer ?? pacer,
        maxAttempts: run?.maxAttempts,
        label: churchId,
        onRateLimit: run?.onRateLimit,
        deadlineAt: run?.deadlineAt,
      };

      if (churchId === "church-1") {
        // A limiter that never lets up, with a small enough hint that all four
        // attempts fit inside the run budget: this deferral is
        // `attempts_exhausted`, and it spent four real provider calls.
        await runPacedCall(async () => {
          providerCalls.push(churchId);
          throw new APICallError({
            message: "Rate limit reached for gpt-4o.",
            url: "https://api.openai.com/v1/responses",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { "retry-after-ms": "1000" },
            isRetryable: true,
          });
        }, paced);
      }

      await runPacedCall(async () => {
        providerCalls.push(churchId);
        // church-2 is the slow judge that spends what is left of the budget,
        // so the run stands church-3 down before starting it.
        await clock.sleep(churchId === "church-2" ? 60_000 : 5_000);
        return { value: churchId };
      }, paced);

      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
  };

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(deps);
  } finally {
    capture.restore();
  }

  assert.equal(summary.selected, 4);
  assert.equal(summary.assessed, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 2);

  // The headline: two deferrals, and the counts tell them apart. Three plants
  // reached the provider — the throttled one among them — and exactly one
  // deferral cost nothing at all.
  assert.equal(summary.attempted, 3);
  assert.equal(summary.deferredUnattempted, 1);
  assert.equal(summary.rateLimited, 1);
  assert.equal(
    summary.selected,
    summary.skipped + summary.attempted + summary.deferredUnattempted
  );

  const throttled = summary.outcomes.find((o) => o.churchId === "church-1");
  assert.equal(throttled?.status, "deferred");
  assert.equal(throttled?.deferralReason, "rate_limit");
  assert.equal(throttled?.attempted, true);

  const stoodDown = summary.outcomes.find((o) => o.churchId === "church-3");
  assert.equal(stoodDown?.status, "deferred");
  assert.equal(stoodDown?.deferralReason, "time_budget");
  assert.equal(stoodDown?.attempted, false);

  // The provider's own view corroborates the counts rather than restating them.
  assert.equal(
    providerCalls.filter((id) => id === "church-1").length,
    MAX_ATTEMPTS_PER_PLANT
  );
  assert.ok(
    !providerCalls.includes("church-3"),
    "the stood-down plant must never reach the provider"
  );
  assert.deepEqual(capture.errors, []);
});

test("a ladder that stops on the run deadline is a time_budget deferral that still cost a call", async () => {
  // The case that makes `attempted` a stored flag instead of a derivation:
  // `runPacedCall` reports `run_budget`, the run labels it `time_budget`, and
  // `rateLimited` stays 0 — yet the provider was called. Only `attempted` says
  // so.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 1_000_000 });
  let providerCalls = 0;

  const deps: RunAssessmentBatchDeps = {
    maxBatch: 1,
    pacer,
    now: () => clock.now(),
    // Spent before the first plant even starts; the loop runs it anyway,
    // because a run that assesses nothing is worse than one that overshoots.
    runBudgetMs: 500,
    maxAttempts: MAX_ATTEMPTS_PER_PLANT,
    async selectPlantsForAssessment() {
      return plants(1);
    },
    async generateAssessment(churchId, _deps, run) {
      await runPacedCall(
        async () => {
          providerCalls++;
          throw new APICallError({
            message: "Rate limit reached for gpt-4o.",
            url: "https://api.openai.com/v1/responses",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { "retry-after-ms": "1000" },
            isRetryable: true,
          });
        },
        {
          pacer: run?.pacer ?? pacer,
          maxAttempts: run?.maxAttempts,
          label: churchId,
          onRateLimit: run?.onRateLimit,
          deadlineAt: run?.deadlineAt,
        }
      );
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
  };

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(deps);
  } finally {
    capture.restore();
  }

  assert.equal(providerCalls, 1);
  assert.equal(summary.deferred, 1);
  assert.equal(summary.rateLimited, 0);
  assert.equal(summary.outcomes[0]?.deferralReason, "time_budget");
  // Deferred, labelled by time, and still a token cost.
  assert.equal(summary.attempted, 1);
  assert.equal(summary.deferredUnattempted, 0);
  // The log says how many calls it took, so the count is checkable by hand.
  assert.ok(
    capture.warns.some((line) =>
      /rate-limit deferral for church church-0 .*after 1 provider call\(s\)/.test(
        line
      )
    )
  );
});

// ----------------------------------------------------------------------------
// AC (ruled 2026-08-10, PR #389): a 5xx ladder the run's clock cut short stays
// `failed`, but says so in different words.
//
// Since #375 bounded the 5xx branch by the run deadline, a truncated ladder can
// report a failure after ONE attempt. On main, `failed` only ever meant "the
// provider is broken", so a run truncated by its own budget could print ERROR
// lines that page someone for a clock problem. The status is unchanged — the
// provider answered and the answer was broken — and the flag plus the warn
// channel carry the difference.
// ----------------------------------------------------------------------------

/** One plant whose judge answers `502` on every attempt. */
function alwaysBadGatewayDeps(
  pacer: TokenPacer,
  runBudgetMs: number,
  maxAttempts: number,
  providerCalls: { count: number }
): RunAssessmentBatchDeps {
  return {
    maxBatch: 1,
    pacer,
    now: () => pacer.clock.now(),
    runBudgetMs,
    maxAttempts,
    async selectPlantsForAssessment() {
      return plants(1);
    },
    async generateAssessment(churchId, _deps, run) {
      await runPacedCall(
        async () => {
          providerCalls.count++;
          throw new APICallError({
            message: "bad gateway",
            url: "https://api.openai.com/v1/responses",
            requestBodyValues: {},
            statusCode: 502,
            responseHeaders: {},
            isRetryable: true,
          });
        },
        {
          pacer: run?.pacer ?? pacer,
          maxAttempts: run?.maxAttempts,
          label: churchId,
          onRateLimit: run?.onRateLimit,
          deadlineAt: run?.deadlineAt,
        }
      );
      return {} as Awaited<
        ReturnType<
          typeof import("@/lib/phase-engine/assessment").generateAssessment
        >
      >;
    },
  };
}

test("a 5xx ladder cut short by the run budget is a marked failure, on the warn channel", async () => {
  const clock = virtualClock();
  // A ceiling far above the run's needs: the only thing that can stop this
  // ladder is the run's own clock.
  const pacer = new TokenPacer({ clock, limitTokens: 1_000_000 });
  const providerCalls = { count: 0 };

  const capture = captureConsole();
  let summary;
  try {
    // Spent before the first plant starts; the loop runs it anyway, and the
    // first 1s backoff already lands past the deadline.
    summary = await runAssessmentBatch(
      alwaysBadGatewayDeps(pacer, 500, MAX_ATTEMPTS_PER_PLANT, providerCalls)
    );
  } finally {
    capture.restore();
  }

  // One attempt, out of four — the clock stopped this, not the provider.
  assert.equal(providerCalls.count, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.deferred, 0);

  const truncated = summary.outcomes[0];
  assert.equal(truncated?.status, "failed");
  assert.equal(truncated?.attempted, true);
  assert.equal(truncated?.truncatedByDeadline, true);
  // Still not a deferral, so the run's arithmetic is untouched.
  assert.equal(truncated?.deferralReason, undefined);
  assert.equal(
    summary.selected,
    summary.skipped + summary.attempted + summary.deferredUnattempted
  );

  // The whole point of the ruling: a run truncated by its own budget prints no
  // ERROR line, and the warn line says which of the two things happened.
  assert.deepEqual(capture.errors, []);
  assert.ok(
    capture.warns.some((line) =>
      /assessment truncated by the run budget for church church-0/.test(line)
    ),
    `warns were: ${JSON.stringify(capture.warns)}`
  );
});

test("a judge that is genuinely broken stays unmarked and stays loud", async () => {
  // The property no direction was allowed to lose. Same 502, same code path —
  // but with the clock out of the way the ladder spends every attempt, so this
  // is a broken judge and reads like one: no flag, no warn, an ERROR line.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 1_000_000 });
  const providerCalls = { count: 0 };

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(
      alwaysBadGatewayDeps(pacer, RUN_BUDGET_MS, 3, providerCalls)
    );
  } finally {
    capture.restore();
  }

  assert.equal(providerCalls.count, 3);
  assert.equal(summary.failed, 1);

  const broken = summary.outcomes[0];
  assert.equal(broken?.status, "failed");
  assert.equal(broken?.attempted, true);
  assert.equal(broken?.truncatedByDeadline, undefined);

  assert.ok(
    capture.errors.some((line) =>
      /assessment failed for church church-0/.test(line)
    ),
    `errors were: ${JSON.stringify(capture.errors)}`
  );
  assert.ok(
    !capture.warns.some((line) => /truncated by the run budget/.test(line)),
    "a broken judge must never read as a clock problem"
  );
});

// ----------------------------------------------------------------------------
// AC: the run stays inside the Vercel function timeout.
// ----------------------------------------------------------------------------

test("the run stops starting plants once the time budget is spent", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock, { limitTokens: 30_000 });

  const summary = await runAssessmentBatch(
    depsFor(plants(25), pacer, openai, {
      maxBatch: 25,
      runBudgetMs: 270_000, // the production soft budget
    })
  );

  // Nothing is lost — the tail is deferred, explicitly, with a reason.
  assert.equal(summary.selected, 25);
  assert.equal(summary.assessed + summary.deferred, 25);
  assert.ok(summary.deferred > 0);
  assert.ok(
    summary.outcomes
      .filter((o) => o.status === "deferred")
      .every((o) => o.deferralReason === "time_budget")
  );
  assert.equal(summary.failed, 0);
  assert.equal(summary.rateLimited, 0);

  // The whole point: the function returns rather than being killed at 300s.
  assert.ok(
    clock.now() < 300_000,
    `run reached ${clock.now()}ms against a 300s ceiling`
  );
});

test("a second consumer on the same key cannot push the run past 300s", async () => {
  // The regression this file exists for on the second pass (#36).
  //
  // The loop guard only projects the wait for the NEXT plant. Once a plant has
  // started, the retry ladder can add MAX_ATTEMPTS_PER_PLANT-1 more pacer holds
  // of up to a whole TPM window each — 180s at 30k — entirely outside a budget
  // that reserved 30s. Give the window a second consumer (RAG embeddings, the
  // manual trigger, a second cron tick) and the ladder becomes real: measured
  // 382s against a 300s ceiling before the deadline was threaded in.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock, {
    limitTokens: 30_000,
    latencyMs: 8_000,
    externalDrain: { tokens: 13_500, everyMs: 30_000, fromMs: 200_000 },
    omitRetryAfterMs: true,
  });

  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(
      depsFor(plants(MAX_BATCH), pacer, openai, {
        maxBatch: MAX_BATCH,
        runBudgetMs: RUN_BUDGET_MS, // the production constants, not friendly ones
        maxAttempts: MAX_ATTEMPTS_PER_PLANT,
      })
    );
  } finally {
    capture.restore();
  }

  assert.ok(
    clock.now() < maxDuration * 1000,
    `run reached ${clock.now()}ms against the ${maxDuration * 1000}ms platform ceiling`
  );

  // Nothing is lost: what did not fit is deferred, so it stays dirty and rolls
  // over. A killed run would instead leave a `pending` row nobody flips.
  assert.equal(summary.assessed + summary.deferred + summary.failed, MAX_BATCH);
  assert.equal(summary.failed, 0);
  assert.ok(summary.deferred > 0, "the tail must stand down, not overrun");
  const tail = summary.outcomes.at(-1);
  assert.equal(tail?.status, "deferred");
  assert.equal(tail?.deferralReason, "time_budget");
  assert.deepEqual(capture.errors, []);
});

test("an in-plant retry ladder never sleeps past the run deadline", async () => {
  // Same defect, isolated to `runPacedCall`: a limiter that never lets up, a
  // deadline 10s out, and a hint of a whole 60s window. Four attempts would
  // have slept ~180s; the ladder must stand down at the deadline instead.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const deadlineAt = clock.now() + 10_000;

  const rejected = await runPacedCall<never>(
    async () => {
      throw new APICallError({
        message: "Rate limit reached for gpt-4o.",
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {
          "x-ratelimit-limit-tokens": "30000",
          "x-ratelimit-remaining-tokens": "0",
          "x-ratelimit-reset-tokens": "60s",
        },
        isRetryable: true,
      });
    },
    { pacer, label: "church-x", maxAttempts: 4, deadlineAt }
  ).then(
    () => null,
    (error: unknown) => error
  );

  assert.ok(isRateLimitDeferral(rejected), "a throttled call is a deferral");
  assert.equal(rejected.reason, "run_budget");
  assert.ok(
    clock.now() < deadlineAt + 1,
    `the ladder slept to ${clock.now()}ms past a ${deadlineAt}ms deadline`
  );
});

test("at least one plant is always attempted, even on an exhausted budget", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock);

  const summary = await runAssessmentBatch(
    depsFor(plants(5), pacer, openai, { runBudgetMs: 0 })
  );

  assert.equal(summary.assessed, 1);
  assert.equal(summary.deferred, 4);
});

// ----------------------------------------------------------------------------
// AC: rollover behaviour is preserved.
// ----------------------------------------------------------------------------

test("plants past the cap are skipped, not attempted, and roll over", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens: 30_000 });
  const openai = new FakeOpenAi(clock);

  const summary = await runAssessmentBatch(
    depsFor(plants(25), pacer, openai, { maxBatch: 4 })
  );

  assert.equal(summary.selected, 25);
  assert.equal(summary.skipped, 21);
  assert.equal(summary.assessed, 4);
  assert.equal(openai.servedRequests, 4);
});
