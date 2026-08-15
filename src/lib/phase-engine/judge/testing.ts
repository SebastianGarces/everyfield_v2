// ============================================================================
// Test support for the judge's throttle — the ONE virtual `PacerClock`.
//
// Every throttle suite runs on a clock whose `sleep` ADVANCES time instead of
// passing it, so a 27-second pacing wait is asserted in microseconds. That is
// also the point of `PacerClock` being injected at all (`token-pacer.ts`): the
// throttle is otherwise untestable.
//
// `sleeps` is the record of what was ASKED FOR, which is how a suite asserts
// the ladder itself (`[1000, 2000]`) rather than merely the elapsed total. A
// suite that only cares about the outcome ignores it; it stays on the shared
// shape so the two kinds of suite share one clock.
//
// This sits beside `token-pacer.ts` rather than in `src/lib/testing/` because
// it is ABOUT a phase-engine concept: it returns a `PacerClock`, and that type
// is this module's. It is imported by tests only, never by application code —
// which is why it is deliberately NOT re-exported from `index.ts`.
// ============================================================================

import type { PacerClock } from "./token-pacer";

export interface VirtualClock extends PacerClock {
  /** Every `sleep` the code under test asked for, in order, in ms. */
  readonly sleeps: number[];
}

export function virtualClock(start = 0): VirtualClock {
  let t = start;
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
