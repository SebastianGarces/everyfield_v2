import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TOKENS_PER_ASSESSMENT,
  DEFAULT_TPM_LIMIT,
  resolveTpmLimit,
  TokenPacer,
  type PacerClock,
} from "./token-pacer";

// ----------------------------------------------------------------------------
// #36: the token bucket that paces the cron batch.
//
// Every test runs on a VIRTUAL clock: `sleep` advances time instead of passing
// it, so a 27-second pacing wait is asserted in microseconds. That is also the
// point of injecting the clock — the throttle is otherwise untestable.
// ----------------------------------------------------------------------------

interface VirtualClock extends PacerClock {
  readonly sleeps: number[];
  advance(ms: number): void;
}

function virtualClock(start = 0): VirtualClock {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    async sleep(ms: number) {
      sleeps.push(ms);
      if (ms > 0) t += ms;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

// --- Bootstrap --------------------------------------------------------------

test("resolveTpmLimit reads PHASE_ENGINE_TPM_LIMIT and falls back safely", () => {
  assert.equal(resolveTpmLimit({}), DEFAULT_TPM_LIMIT);
  assert.equal(resolveTpmLimit({ PHASE_ENGINE_TPM_LIMIT: "150000" }), 150_000);
  // Garbage must not disable pacing altogether.
  assert.equal(resolveTpmLimit({ PHASE_ENGINE_TPM_LIMIT: "nope" }), 30_000);
  assert.equal(resolveTpmLimit({ PHASE_ENGINE_TPM_LIMIT: "0" }), 30_000);
  assert.equal(resolveTpmLimit({ PHASE_ENGINE_TPM_LIMIT: "-5" }), 30_000);
});

// --- Pacing -----------------------------------------------------------------

test("the first call never waits — a run starts against an unspent window", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });
  assert.equal(await pacer.acquire(), 0);
  assert.deepEqual(clock.sleeps, []);
});

test("the second call waits for the bucket to refill, not a fixed sleep", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  await pacer.acquire(); // 30000 -> 16500
  await pacer.acquire(); // 16500 -> 3000, still no wait
  const waited = await pacer.acquire();

  // 13500 tokens at 30000/60s = 500 tokens/s -> 10500 short -> 21s.
  assert.equal(waited, 21_000);
  assert.equal(clock.now(), 21_000);
});

test("sustained throughput matches the TPM ceiling, not a guess", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  for (let i = 0; i < 10; i++) await pacer.acquire();

  // 10 calls x 13500 = 135000 tokens. The first 30000 were already in the
  // bucket, so the run had to wait for 105000 at 500/s = 210s.
  assert.equal(clock.now(), 210_000);
  // Which is exactly the 30k TPM ceiling: 135000 tokens / (240s) is under 30k
  // in any 60-second slice.
  assert.ok(clock.now() >= (135_000 - 30_000) / (30_000 / 60_000));
});

test("projectedWaitMs answers without spending the budget", () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  const first = pacer.projectedWaitMs();
  const second = pacer.projectedWaitMs();

  assert.equal(first, 0);
  assert.equal(second, 0);
  assert.equal(pacer.stats.remainingTokens, DEFAULT_TPM_LIMIT);
});

// --- Self-tuning ------------------------------------------------------------

test("a tier upgrade in the response headers speeds the batch up immediately", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  // The key was moved to a 150k TPM tier between runs. Nothing in the code
  // knows that; the header does. This is the case a hardcoded 27-second sleep
  // gets wrong forever.
  pacer.observeResponse({
    "x-ratelimit-limit-tokens": "150000",
    "x-ratelimit-remaining-tokens": "150000",
  });
  assert.equal(pacer.limitTokens, 150_000);

  for (let i = 0; i < 10; i++) await pacer.acquire();

  // The same 10 calls cost 210s on the 30k tier (asserted above) and 42s here
  // — exactly the 5x the ceiling changed by, with no constant edited.
  assert.equal(clock.now(), 42_000);
});

test("a tier downgrade slows it down the same way", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  pacer.observeResponse({
    "x-ratelimit-limit-tokens": "10000",
    "x-ratelimit-remaining-tokens": "0",
    "x-ratelimit-reset-tokens": "60s",
  });

  assert.equal(pacer.limitTokens, 10_000);
  // The call now costs more than the entire window, so it is priced at the
  // window — otherwise `acquire` could never succeed at all.
  const waited = await pacer.acquire();
  assert.equal(waited, 60_000);
});

test("the per-call cost is re-learned from reported usage, in both directions", () => {
  const pacer = new TokenPacer({ clock: virtualClock() });
  assert.equal(pacer.estimatedTokensPerCall, DEFAULT_TOKENS_PER_ASSESSMENT);

  // A fatter rubric.
  pacer.observeResponse({}, { totalTokens: 20_000 });
  assert.equal(pacer.estimatedTokensPerCall, 22_000); // +10% headroom

  // A leaner one. No constant is edited for either.
  pacer.observeResponse({}, { totalTokens: 4_000 });
  assert.equal(pacer.estimatedTokensPerCall, 4_400);
});

test("the server's remaining count is trusted only when it is stricter", () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  // The provider says less is left than our local accounting believes: take it.
  pacer.observeResponse({ "x-ratelimit-remaining-tokens": "5000" });
  assert.equal(pacer.stats.remainingTokens, 5_000);

  // The provider reports the budget BEFORE metering our in-flight call, so a
  // naive assignment would hand back budget we have already spent.
  pacer.observeResponse({ "x-ratelimit-remaining-tokens": "29000" });
  assert.equal(pacer.stats.remainingTokens, 5_000);
});

test("the refill rate is derived from the provider's own reset window", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  // 20000 tokens missing, back in 100s -> 200 tokens/s, not the 500/s that a
  // 30k ceiling would imply. The provider is the authority.
  pacer.observeResponse({
    "x-ratelimit-limit-tokens": "30000",
    "x-ratelimit-remaining-tokens": "10000",
    "x-ratelimit-reset-tokens": "100s",
  });

  // Needs 3500 more at 200/s = 17.5s.
  assert.equal(await pacer.acquire(), 17_500);
});

// --- Rate-limit penalty -----------------------------------------------------

test("Retry-After becomes a hold nothing accrues through", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  pacer.observeRateLimit(30_000);

  // The bucket is emptied and held shut for the full 30s the provider asked
  // for. It does refill during the hold — the TPM window keeps ticking — so
  // 15000 tokens are back by the time the hold lifts and no extra wait is
  // added on top.
  const waited = await pacer.acquire();
  assert.equal(waited, 30_000);
  assert.equal(clock.now(), 30_000);
  assert.equal(pacer.stats.rateLimitHits, 1);
});

test("with no Retry-After the penalty is one call's worth of refill", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  pacer.observeRateLimit(null);

  // 13500 tokens at 500/s = 27s of hold, then the bucket is full enough.
  assert.equal(await pacer.acquire(), 27_000);
});

test("a 429's headers still recalibrate the ceiling", () => {
  const pacer = new TokenPacer({ clock: virtualClock() });
  pacer.observeRateLimit(1_000, {
    "x-ratelimit-limit-tokens": "90000",
    "x-ratelimit-remaining-tokens": "0",
  });
  assert.equal(pacer.limitTokens, 90_000);
  assert.equal(pacer.stats.remainingTokens, 0);
});

test("stats report what the run was actually paced against", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  await pacer.acquire();
  await pacer.acquire();
  await pacer.acquire();

  const stats = pacer.stats;
  assert.equal(stats.limitTokens, 30_000);
  assert.equal(stats.totalWaitMs, 21_000);
  assert.equal(stats.rateLimitHits, 0);
  assert.equal(stats.calibrated, false);

  pacer.observeResponse({ "x-ratelimit-limit-tokens": "30000" });
  assert.equal(pacer.stats.calibrated, true);
});
