import assert from "node:assert/strict";
import { test } from "node:test";

import { APICallError } from "ai";

import {
  isRateLimitDeferral,
  RateLimitDeferralError,
  runPacedCall,
  type RateLimitEvent,
} from "./paced-call";
import { TokenPacer, type PacerClock } from "./token-pacer";

// ----------------------------------------------------------------------------
// #36: the retry policy that replaced the AI SDK's blind exponential backoff.
//
// The SDK retried a TPM 429 after 2s and 4s — both inside the same minute the
// budget was refused in — and then gave up. These tests pin the two things that
// fixes it: the provider's own Retry-After hint decides the delay, and running
// out of attempts against a rate limit is reported as a DEFERRAL, not a
// failure.
// ----------------------------------------------------------------------------

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

function setup(limitTokens?: number) {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock, limitTokens });
  const events: RateLimitEvent[] = [];
  return { clock, pacer, events };
}

// --- Happy path -------------------------------------------------------------

test("a successful call returns its value and feeds the pacer", async () => {
  const { clock, pacer } = setup();

  const value = await runPacedCall(
    async () => ({
      value: "assessment",
      headers: {
        "x-ratelimit-limit-tokens": "60000",
        "x-ratelimit-remaining-tokens": "40000",
      },
      totalTokens: 9_000,
    }),
    { pacer }
  );

  assert.equal(value, "assessment");
  assert.deepEqual(clock.sleeps, []);
  // The response, not a constant, set both numbers the next call is paced by.
  assert.equal(pacer.limitTokens, 60_000);
  assert.equal(pacer.estimatedTokensPerCall, 9_900); // 9000 + 10% headroom
});

// --- Retry-After (the headline AC) ------------------------------------------

test("Retry-After from the response headers decides the delay, not a backoff", async () => {
  const { clock, pacer, events } = setup();
  let attempts = 0;

  const value = await runPacedCall(
    async () => {
      attempts++;
      if (attempts === 1) {
        throw apiError(429, { "retry-after-ms": "45000" });
      }
      return { value: "ok", totalTokens: 13_500 };
    },
    { pacer, label: "church-1", onRateLimit: (e) => events.push(e) }
  );

  assert.equal(value, "ok");
  assert.equal(attempts, 2);
  // 45s, because the server said 45s. The SDK's default would have been 2s —
  // inside the very minute the token budget was refused in.
  assert.equal(clock.now(), 45_000);
  assert.equal(events.length, 1);
  assert.equal(events[0].retryAfterMs, 45_000);
  assert.equal(events[0].attempt, 1);
  assert.equal(events[0].exhausted, false);
  assert.equal(events[0].label, "church-1");
});

test("Retry-After is honoured when it arrives as retry-after seconds", async () => {
  const { clock, pacer } = setup();
  let attempts = 0;

  await runPacedCall(
    async () => {
      attempts++;
      if (attempts === 1) throw apiError(429, { "retry-after": "38" });
      return { value: "ok" };
    },
    { pacer }
  );

  assert.equal(clock.now(), 38_000);
});

test("Retry-After is honoured when only the message body states it", async () => {
  const { clock, pacer } = setup();
  let attempts = 0;

  await runPacedCall(
    async () => {
      attempts++;
      if (attempts === 1) {
        // A proxy stripped the headers; OpenAI still says it in the body.
        throw new Error("Rate limit reached. Please try again in 33s.");
      }
      return { value: "ok" };
    },
    { pacer }
  );

  assert.equal(clock.now(), 33_000);
});

test("with no hint at all the pacer's own refill decides the delay", async () => {
  const { clock, pacer, events } = setup();
  let attempts = 0;

  await runPacedCall(
    async () => {
      attempts++;
      if (attempts === 1) throw apiError(429);
      return { value: "ok" };
    },
    { pacer, onRateLimit: (e) => events.push(e) }
  );

  assert.equal(events[0].retryAfterMs, null);
  // 13500 tokens at 30000/60s = 27s. Still derived from the limit, never a
  // hardcoded sleep.
  assert.equal(clock.now(), 27_000);
});

// --- Exhaustion is a deferral, not a failure --------------------------------

test("exhausting the attempts against a 429 throws a deferral, not a failure", async () => {
  const { pacer, events } = setup();
  let attempts = 0;

  await assert.rejects(
    () =>
      runPacedCall(
        async () => {
          attempts++;
          throw apiError(429, { "retry-after-ms": "1000" });
        },
        {
          pacer,
          maxAttempts: 3,
          label: "church-9",
          onRateLimit: (e) => events.push(e),
        }
      ),
    (error: unknown) => {
      assert.ok(isRateLimitDeferral(error));
      assert.ok(RateLimitDeferralError.isInstance(error));
      const deferral = error as RateLimitDeferralError;
      assert.equal(deferral.attempts, 3);
      assert.equal(deferral.retryAfterMs, 1_000);
      assert.match(deferral.message, /Rate limited by the model provider/);
      assert.match(deferral.message, /church-9/);
      return true;
    }
  );

  assert.equal(attempts, 3);
  assert.equal(events.length, 3);
  assert.equal(events.at(-1)?.exhausted, true);
  assert.equal(pacer.stats.rateLimitHits, 3);
});

test("a deferral is distinguishable from an ordinary error object", () => {
  assert.equal(isRateLimitDeferral(new Error("openai exploded")), false);
  assert.equal(isRateLimitDeferral(null), false);
  assert.equal(
    isRateLimitDeferral(new RateLimitDeferralError("c", 3, 0, null, undefined)),
    true
  );
});

// --- Non-rate-limit errors --------------------------------------------------

test("a non-retryable error is thrown on the first attempt", async () => {
  const { clock, pacer } = setup();
  let attempts = 0;

  await assert.rejects(
    () =>
      runPacedCall(
        async () => {
          attempts++;
          throw apiError(400, {}, "invalid schema", false);
        },
        { pacer }
      ),
    /invalid schema/
  );

  // No retry, no waiting: a 400 will not fix itself, and the run's remaining
  // plants need the wall clock.
  assert.equal(attempts, 1);
  assert.deepEqual(clock.sleeps, []);
});

test("a retryable server error backs off exponentially and then succeeds", async () => {
  // A limit far above the run's needs, so every sleep recorded here is the
  // backoff and none of it is pacing.
  const { clock, pacer } = setup(1_000_000);
  let attempts = 0;

  const value = await runPacedCall(
    async () => {
      attempts++;
      if (attempts < 3) throw apiError(500, {}, "upstream hiccup");
      return { value: "ok" };
    },
    { pacer }
  );

  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  // 1s then 2s — the token budget is untouched by a 5xx, so this is the one
  // delay the pacer does not own.
  assert.deepEqual(clock.sleeps, [1_000, 2_000]);
});

// --- The 5xx ladder answers to the run deadline too (#375) ------------------

test("a 5xx ladder stops AT an already-passed deadline, not a pacer hold past it", async () => {
  // The defect: only the rate-limit branch tested the deadline. A 502 clamped
  // its own backoff to the remaining time — zero, here — and then looped into
  // `pacer.acquire()`, whose hold is bounded by MAX_SINGLE_WAIT_MS (120s) and
  // by nothing else. Measured 47s past the deadline, on a budget that reserved
  // 30s for the whole tail of the run.
  const { clock, pacer } = setup(30_000);
  // The batch loop started this plant while the budget was still there; the
  // judge's own latency spent the rest of it.
  const deadlineAt = clock.now();
  let attempts = 0;

  await assert.rejects(
    () =>
      runPacedCall(
        async () => {
          attempts++;
          throw apiError(502, {}, "bad gateway");
        },
        { pacer, maxAttempts: 4, deadlineAt }
      ),
    // Still a failure and not a deferral: the provider answered, and the answer
    // was broken. Only throttling is a deferral.
    (error: unknown) => {
      assert.equal(isRateLimitDeferral(error), false);
      assert.match((error as Error).message, /bad gateway/);
      return true;
    }
  );

  assert.equal(attempts, 1, "the deadline had passed before the first retry");
  assert.equal(
    clock.now(),
    deadlineAt,
    `the ladder ran to ${clock.now()}ms against a ${deadlineAt}ms deadline`
  );
  assert.deepEqual(clock.sleeps, []);
});

test("a 5xx retry that would land past the deadline is not taken", async () => {
  // The backoff alone crosses it: 1s of backoff against 400ms of budget. The
  // old clamp shortened the sleep to 400ms and retried anyway, buying an
  // unbounded pacer hold with the deadline already spent.
  const { clock, pacer } = setup(30_000);
  const deadlineAt = clock.now() + 400;
  let attempts = 0;

  await assert.rejects(
    () =>
      runPacedCall(
        async () => {
          attempts++;
          throw apiError(503, {}, "still down");
        },
        { pacer, maxAttempts: 4, deadlineAt }
      ),
    /still down/
  );

  assert.equal(attempts, 1);
  assert.ok(
    clock.now() <= deadlineAt,
    `the ladder ran to ${clock.now()}ms against a ${deadlineAt}ms deadline`
  );
});

test("a 5xx ladder with budget to spare still retries normally", async () => {
  // The hoisted test must bound the ladder, not disable it: with the deadline
  // far out, the backoff schedule is the one the no-deadline test asserts.
  const { clock, pacer } = setup(1_000_000);
  const deadlineAt = clock.now() + 270_000;
  let attempts = 0;

  const value = await runPacedCall(
    async () => {
      attempts++;
      if (attempts < 3) throw apiError(500, {}, "upstream hiccup");
      return { value: "ok" };
    },
    { pacer, deadlineAt }
  );

  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(clock.sleeps, [1_000, 2_000]);
  assert.ok(clock.now() < deadlineAt);
});

test("a retryable error that never clears is rethrown as itself", async () => {
  const { pacer } = setup();
  let attempts = 0;

  await assert.rejects(
    () =>
      runPacedCall(
        async () => {
          attempts++;
          throw apiError(503, {}, "still down");
        },
        { pacer, maxAttempts: 2 }
      ),
    // NOT a deferral: the judge really did fail, and must be reported as such.
    (error: unknown) => {
      assert.equal(isRateLimitDeferral(error), false);
      assert.match((error as Error).message, /still down/);
      return true;
    }
  );

  assert.equal(attempts, 2);
});

// --- The shared budget ------------------------------------------------------

test("a 429 on one call slows the NEXT call too — the budget is shared", async () => {
  const { clock, pacer } = setup();

  await runPacedCall(
    async () => {
      throw apiError(429, { "retry-after-ms": "20000" });
    },
    { pacer, maxAttempts: 1 }
  ).catch(() => undefined);

  const before = clock.now();
  await runPacedCall(async () => ({ value: "ok" }), { pacer });

  // The second call inherits the hold rather than charging straight into the
  // same limiter — which is the whole reason the pacer is per-run, not
  // per-call.
  assert.ok(clock.now() - before >= 20_000);
});
