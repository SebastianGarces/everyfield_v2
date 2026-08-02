import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { isPhaseAdvance, phaseAdvanceCondition } from "./oversight-events";

// ----------------------------------------------------------------------------
// One rule about phase transitions, in two places that must not disagree.
//
// The milestone emitter judges ONE event with `isPhaseAdvance`; the digest
// COUNTS rows with `phaseAdvanceCondition`. They diverged once — the emitter
// deliberately withheld a regression while the digest counted it as "1 new
// stage", so the correction a planter made to their own record reached their
// oversight partner anyway, labelled as its opposite. These tests pin both
// expressions to the same table of pairs.
//
// DATABASE_URL is present in this environment because the module under test
// pulls in `@/db` for its handler; nothing below opens a connection.
// ----------------------------------------------------------------------------

/** `[fromPhase, toPhase, isAdvance]`. */
const CASES: [number, number, boolean][] = [
  [1, 2, true], // the ordinary advance
  [2, 5, true], // a skip is still an advance, announced once for the stage reached
  [3, 2, false], // THE CORRECTION — the case that shipped wrong
  [5, 1, false], // a large correction is still a correction
  [2, 2, false], // a no-op is not an event
];

test("isPhaseAdvance counts advances and only advances", () => {
  for (const [fromPhase, toPhase, expected] of CASES) {
    assert.equal(
      isPhaseAdvance(fromPhase, toPhase),
      expected,
      `${fromPhase} → ${toPhase}`
    );
  }
});

test("the SQL predicate says exactly what isPhaseAdvance says", () => {
  // Rendered rather than executed: this asserts the DIRECTION of the comparison
  // and the pair of columns it is between, which is the whole content of the
  // rule and the part that a careless edit reverses. A regression (3 → 2) fails
  // `to_phase > from_phase` for the same reason `isPhaseAdvance(3, 2)` is
  // false — and the real-database half of this is
  // `scripts/g3-oversight-model.ts` §6, which seeds a 3 → 2 row and asserts the
  // digest counts zero stages for it.
  const { sql, params } = new PgDialect().sqlToQuery(phaseAdvanceCondition());

  assert.equal(
    sql,
    '"phase_transitions"."to_phase" > "phase_transitions"."from_phase"'
  );
  assert.deepEqual(params, []);
});
