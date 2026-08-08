import assert from "node:assert/strict";
import { test } from "node:test";

import { daysUntilTarget, parseTargetDate } from "./countdown";

// ---------------------------------------------------------------------------
// The countdown is DAY-vs-DAY (#303's ruling, #338's fix).
//
// The bug this file exists to keep dead: subtracting a UTC-midnight target from
// a raw `asOf` INSTANT leaves a fraction of the current day in the numerator,
// which flooring throws away — so from 00:00:01 UTC onward the answer is a full
// day short. A single assertion at midnight passes under both the broken and the
// correct implementation, which is exactly how it shipped twice; every case here
// therefore names a TIME OF DAY.
// ---------------------------------------------------------------------------

const LAUNCH = "2026-09-20";

test("launch day reads 0 at every hour of that day", () => {
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-20T00:00:00Z")), 0);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-20T00:00:01Z")), 0);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-20T12:00:00Z")), 0);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-20T23:59:59Z")), 0);
});

test("the day before is 1 and the day after is −1, at every hour", () => {
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-19T00:00:00Z")), 1);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-19T23:59:59Z")), 1);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-21T00:00:00Z")), -1);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-09-21T23:59:59Z")), -1);
});

test("a distant target counts whole days, not rounded fractions", () => {
  // Jun 22 → Sep 20 2026 = 90 days.
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-06-22T00:00:00Z")), 90);
  assert.equal(daysUntilTarget(LAUNCH, new Date("2026-06-22T17:41:00Z")), 90);
});

test("no target is no countdown — null, never 0", () => {
  assert.equal(daysUntilTarget(null, new Date("2026-09-20T00:00:00Z")), null);
});

test("an unparseable stored value answers null rather than NaN", () => {
  assert.equal(
    daysUntilTarget("not-a-date", new Date("2026-09-20T00:00:00Z")),
    null
  );
});

test("the target is parsed at UTC midnight, not the runtime's midnight", () => {
  assert.equal(
    parseTargetDate(LAUNCH).toISOString(),
    "2026-09-20T00:00:00.000Z"
  );
});

test("crossing a month and a year boundary is still whole days", () => {
  assert.equal(
    daysUntilTarget("2027-01-01", new Date("2026-12-31T21:00:00Z")),
    1
  );
  assert.equal(
    daysUntilTarget("2026-03-01", new Date("2026-02-28T21:00:00Z")),
    1
  );
});
