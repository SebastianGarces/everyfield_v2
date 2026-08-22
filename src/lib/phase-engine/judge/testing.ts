// ============================================================================
// Test support for the judge: the ONE virtual `PacerClock`, and the ONE schema
// a suite that is not about evidence should be holding drafts to.
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

import { makeEvidence } from "@/lib/phase-engine/signals/testing";

import { judgeOutputSchemaFor } from "./schema";
import type { PacerClock } from "./token-pacer";

/**
 * The judge schema for the fixture plant.
 *
 * There is no snapshot-free judge schema (#635) — the rules a draft is held to
 * include what each lens can possibly know — so every suite needs a profile to
 * build one from, and four suites reaching for their own is how they end up
 * describing four different plants. `makeEvidence()` derives it from the shared
 * snapshot fixture, so what these suites assert is what production would.
 */
export const FIXTURE_JUDGE_SCHEMA = judgeOutputSchemaFor(makeEvidence());

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
