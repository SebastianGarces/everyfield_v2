import assert from "node:assert/strict";
import test from "node:test";
import { evryDateRangeSchema, resolveEvryDateRange } from "./date-range";

test("due today excludes overdue and tomorrow using the church's calendar, not UTC", () => {
  const range = resolveEvryDateRange(
    { kind: "relative", period: "today" },
    new Date("2026-09-08T02:00:00Z"),
    "America/New_York"
  );
  assert.deepEqual(range, { from: "2026-09-07", through: "2026-09-07" });
  const tasks = ["2026-08-24", "2026-09-06", "2026-09-07", "2026-09-08"];
  assert.deepEqual(
    tasks.filter((date) => date >= range.from! && date <= range.through!),
    ["2026-09-07"]
  );
});
test("overdue ends yesterday and relative ranges preserve DST calendar days", () => {
  const now = new Date("2026-03-08T17:00:00Z");
  assert.deepEqual(
    resolveEvryDateRange(
      { kind: "relative", period: "overdue" },
      now,
      "America/New_York"
    ),
    { through: "2026-03-07" }
  );
  assert.deepEqual(
    resolveEvryDateRange(
      { kind: "relative", period: "tomorrow" },
      now,
      "America/New_York"
    ),
    { from: "2026-03-09", through: "2026-03-09" }
  );
  assert.deepEqual(
    resolveEvryDateRange(
      { kind: "relative", period: "next_week" },
      now,
      "America/New_York"
    ),
    { from: "2026-03-09", through: "2026-03-15" }
  );
});
test("range boundaries are inclusive, optional and reject reversed or invalid dates", () => {
  assert.equal(
    evryDateRangeSchema.safeParse({
      kind: "range",
      from: "2026-09-08",
      through: "2026-09-07",
    }).success,
    false
  );
  assert.equal(
    evryDateRangeSchema.safeParse({
      kind: "range",
      from: "2026-02-30",
      through: null,
    }).success,
    false
  );
  assert.deepEqual(
    resolveEvryDateRange(
      { kind: "relative", period: "this_month" },
      new Date("2028-02-15T12:00:00Z"),
      "America/New_York"
    ),
    { from: "2028-02-01", through: "2028-02-29" }
  );
});
