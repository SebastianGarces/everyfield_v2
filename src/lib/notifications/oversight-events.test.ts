import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  INITIAL_DECLARATION_KIND,
  TRANSITION_KIND,
} from "@/lib/phase-engine/transitions";
import { isPhaseAdvance, phaseAdvanceCondition } from "./oversight-events";

// ----------------------------------------------------------------------------
// One rule about phase transitions, in two places that must not disagree.
//
// The milestone emitter judges ONE event with `isPhaseAdvance`; the digest
// COUNTS rows with `phaseAdvanceCondition`. They diverged once — the emitter
// deliberately withheld a regression while the digest counted it as "1 new
// phase", so the correction a planter made to their own record reached their
// oversight partner anyway, labelled as its opposite. These tests pin both
// expressions to the same table of pairs.
//
// DATABASE_URL is present in this environment because the module under test
// pulls in `@/db` for its handler; nothing below opens a connection.
// ----------------------------------------------------------------------------

/** `[fromPhase, toPhase, isAdvance]`. */
const CASES: [number, number, boolean][] = [
  [1, 2, true], // the ordinary advance
  [2, 5, true], // a skip is still an advance, announced once for the phase reached
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
  // digest counts zero phases for it.
  const { sql, params } = new PgDialect().sqlToQuery(phaseAdvanceCondition());

  assert.equal(
    sql,
    '("phase_transitions"."to_phase" > "phase_transitions"."from_phase" and "phase_transitions"."kind" = $1)'
  );
  // The `kind` clause is bound, not inlined, and it binds the TRANSITION kind —
  // an initial declaration is not an advance (#306). Asserted on the parameter
  // rather than on the rendered string because that is where the value lives.
  assert.deepEqual(params, [TRANSITION_KIND]);
  assert.equal(TRANSITION_KIND, "transition");
});

// ----------------------------------------------------------------------------
// The second population: `phase_transitions` stopped being one table of one
// thing when OB-005 added the initial declaration (#306).
//
// A declaration is a 0 → N row: it satisfies `to_phase > from_phase` and reached
// no phase whatsoever. Two readers depended on that predicate — the digest's
// `phasesReached` count and, worse, `hasActivityCondition`, the "was there
// activity at all?" gate that decides whether a digest is sent on a given day.
// Left uncorrected, a brand-new plant that had only said where it already stood
// both counted "1 new phase" and triggered a digest on a day nothing happened.
// ----------------------------------------------------------------------------

test("an initial declaration is not an advance, and contributes nothing", () => {
  const rendered = new PgDialect().sqlToQuery(phaseAdvanceCondition());

  // The predicate the digest counts rows with admits ONE kind, and it is not
  // the declaration's. A 0 → 3 declaration row therefore contributes 0 to
  // `phasesReached` — and, because `hasActivityCondition` is built from the
  // very same condition (`phaseReachedCondition` in `./oversight-digest.ts`),
  // does not satisfy the activity gate either. One clause fixes both because
  // both call this function.
  assert.deepEqual(rendered.params, [TRANSITION_KIND]);
  assert.notEqual(TRANSITION_KIND, INITIAL_DECLARATION_KIND);
  assert.match(rendered.sql, /"phase_transitions"\."kind" = \$1/);

  // And the direction rule is still there: this clause NARROWED the predicate,
  // it did not replace it. A transition row that regresses is still not an
  // advance.
  assert.match(
    rendered.sql,
    /"phase_transitions"\."to_phase" > "phase_transitions"\."from_phase"/
  );
  assert.equal(isPhaseAdvance(3, 2), false);
});

test("both digest readers ask this one function, so neither can drift", () => {
  // `phaseReachedCondition` counts; `hasActivityCondition` gates. They are the
  // same rule and must stay one call — the bug this fixes was two readers of
  // `phase_transitions` disagreeing about what counts.
  const digest = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/oversight-digest.ts"),
    "utf8"
  );

  assert.match(
    digest,
    /function phaseReachedCondition[\s\S]*?phaseAdvanceCondition\(\)/
  );
  assert.match(
    digest,
    /function hasActivityCondition[\s\S]*?phaseReachedCondition\(/
  );
  // No second, hand-rolled copy of the direction test anywhere in the file.
  assert.equal(/gt\(\s*phaseTransitions\.toPhase/.test(digest), false);
});
