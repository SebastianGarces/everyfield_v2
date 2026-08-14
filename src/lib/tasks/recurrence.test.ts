import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_RECURRENCE,
  advanceDate,
  describeRecurrence,
  nextRecurrenceDueDate,
  parseRecurrenceForm,
  parseRecurrenceRule,
  seriesIdOf,
  type RecurrenceRule,
} from "./recurrence";

// ----------------------------------------------------------------------------
// Recurring tasks (T-017).
//
// Everything in this module is pure, so the interesting behaviour is testable
// without a database: the calendar maths, when a series stops, and how a form
// that says nothing about recurrence differs from one that says "off".
// ----------------------------------------------------------------------------

const SERIES_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";

// ----------------------------------------------------------------------------
// advanceDate
// ----------------------------------------------------------------------------

test("advanceDate steps fixed-length intervals", () => {
  assert.equal(advanceDate("2026-08-09", "daily"), "2026-08-10");
  assert.equal(advanceDate("2026-08-09", "weekly"), "2026-08-16");
  assert.equal(advanceDate("2026-08-09", "biweekly"), "2026-08-23");
});

test("advanceDate steps calendar intervals", () => {
  assert.equal(advanceDate("2026-08-09", "monthly"), "2026-09-09");
  assert.equal(advanceDate("2026-08-09", "quarterly"), "2026-11-09");
  assert.equal(advanceDate("2026-08-09", "yearly"), "2027-08-09");
});

test("advanceDate rolls a fixed-length step over a month boundary", () => {
  assert.equal(advanceDate("2026-08-31", "daily"), "2026-09-01");
  assert.equal(advanceDate("2026-12-28", "weekly"), "2027-01-04");
});

test("advanceDate CLAMPS a month step instead of rolling it over", () => {
  // The whole point: `Date.UTC(2026, 1, 31)` is March 3rd, which would walk a
  // monthly task off the end of the month it belongs to.
  assert.equal(advanceDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceDate("2024-01-31", "monthly"), "2024-02-29"); // leap year
  assert.equal(advanceDate("2026-03-31", "monthly"), "2026-04-30");
  assert.equal(advanceDate("2026-11-30", "quarterly"), "2027-02-28");
});

test("advanceDate crosses the year boundary on a month step", () => {
  assert.equal(advanceDate("2026-12-15", "monthly"), "2027-01-15");
  assert.equal(advanceDate("2026-11-15", "quarterly"), "2027-02-15");
});

test("advanceDate refuses a day that does not exist", () => {
  // `Date.parse` would happily roll 2026-02-31 to March 3rd.
  assert.equal(advanceDate("2026-02-31", "weekly"), null);
  assert.equal(advanceDate("not-a-date", "weekly"), null);
});

test("advanceDate is stable across a DST boundary", () => {
  // US DST starts 2026-03-08. A local-time implementation drops or gains an
  // hour here and can land a day early.
  assert.equal(advanceDate("2026-03-07", "daily"), "2026-03-08");
  assert.equal(advanceDate("2026-03-07", "weekly"), "2026-03-14");
});

// ----------------------------------------------------------------------------
// nextRecurrenceDueDate
// ----------------------------------------------------------------------------

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { interval: "weekly", endDate: null, seriesId: null, ...overrides };
}

test("nextRecurrenceDueDate steps from the previous due date, not from today", () => {
  // Completed five days late; the next one still lands on the original weekday.
  assert.equal(
    nextRecurrenceDueDate(rule(), "2026-08-03", "2026-08-08"),
    "2026-08-10"
  );
});

test("nextRecurrenceDueDate falls back to the completion day with no due date", () => {
  assert.equal(nextRecurrenceDueDate(rule(), null, "2026-08-08"), "2026-08-15");
});

test("nextRecurrenceDueDate falls back when the stored due date is unusable", () => {
  assert.equal(
    nextRecurrenceDueDate(rule(), "2026-02-31", "2026-08-08"),
    "2026-08-15"
  );
});

test("nextRecurrenceDueDate stops the series past its end date", () => {
  // 2026-08-03 + one week is 2026-08-10, which is past this end date.
  assert.equal(
    nextRecurrenceDueDate(
      rule({ endDate: "2026-08-09" }),
      "2026-08-03",
      "2026-08-03"
    ),
    null
  );
});

test("nextRecurrenceDueDate treats the end date as inclusive", () => {
  assert.equal(
    nextRecurrenceDueDate(
      rule({ endDate: "2026-08-10" }),
      "2026-08-03",
      "2026-08-03"
    ),
    "2026-08-10"
  );
});

// ----------------------------------------------------------------------------
// parseRecurrenceRule / seriesIdOf
// ----------------------------------------------------------------------------

test("parseRecurrenceRule reads a stored rule", () => {
  const parsed = parseRecurrenceRule({
    interval: "monthly",
    endDate: "2027-01-01",
    seriesId: SERIES_ID,
  });

  assert.deepEqual(parsed, {
    interval: "monthly",
    endDate: "2027-01-01",
    seriesId: SERIES_ID,
  });
});

test("parseRecurrenceRule returns null for anything unreadable", () => {
  assert.equal(parseRecurrenceRule(null), null);
  assert.equal(parseRecurrenceRule(undefined), null);
  assert.equal(parseRecurrenceRule({}), null);
  assert.equal(parseRecurrenceRule({ interval: "fortnightly" }), null);
  assert.equal(parseRecurrenceRule("weekly"), null);
  // An impossible end date is not a rule we will act on.
  assert.equal(
    parseRecurrenceRule({ interval: "weekly", endDate: "2026-02-31" }),
    null
  );
});

test("seriesIdOf falls back to the task's own id for the head of a chain", () => {
  assert.equal(
    seriesIdOf({ id: TASK_ID, recurrenceRule: { interval: "weekly" } }),
    TASK_ID
  );
  assert.equal(seriesIdOf({ id: TASK_ID, recurrenceRule: null }), TASK_ID);
  assert.equal(
    seriesIdOf({
      id: TASK_ID,
      recurrenceRule: { interval: "weekly", seriesId: SERIES_ID },
    }),
    SERIES_ID
  );
});

// ----------------------------------------------------------------------------
// parseRecurrenceForm
// ----------------------------------------------------------------------------

test("parseRecurrenceForm distinguishes 'said nothing' from 'off'", () => {
  // Quick-add posts no recurrence control at all — an existing schedule must
  // survive that.
  assert.equal(parseRecurrenceForm({ title: "Book the room" }), null);

  assert.deepEqual(parseRecurrenceForm({ recurrenceInterval: NO_RECURRENCE }), {
    isRecurring: false,
    recurrenceRule: null,
  });
});

test("parseRecurrenceForm builds a rule from the two form fields", () => {
  assert.deepEqual(
    parseRecurrenceForm({
      recurrenceInterval: "monthly",
      recurrenceEndDate: "2027-01-31",
    }),
    {
      isRecurring: true,
      recurrenceRule: { interval: "monthly", endDate: "2027-01-31" },
    }
  );

  assert.deepEqual(parseRecurrenceForm({ recurrenceInterval: "daily" }), {
    isRecurring: true,
    recurrenceRule: { interval: "daily", endDate: null },
  });
});

test("parseRecurrenceForm treats a malformed field as saying nothing", () => {
  // Never silently switch a task's schedule on a value we cannot read.
  assert.equal(parseRecurrenceForm({ recurrenceInterval: "hourly" }), null);
  assert.equal(
    parseRecurrenceForm({
      recurrenceInterval: "weekly",
      recurrenceEndDate: "2026-02-31",
    }),
    null
  );
});

// ----------------------------------------------------------------------------
// Presentation helpers
// ----------------------------------------------------------------------------

// `toCalendarDate` was tested here while it lived in this module. It is a
// datetime primitive and moved to `@/lib/datetime` in #411; its test moved with
// it (`src/lib/datetime.test.ts`).

test("describeRecurrence summarises a rule", () => {
  assert.equal(describeRecurrence(null), null);
  assert.equal(describeRecurrence(rule()), "Every week");
  assert.equal(
    describeRecurrence(rule({ endDate: "2027-01-01" })),
    "Every week, until 2027-01-01"
  );
});
