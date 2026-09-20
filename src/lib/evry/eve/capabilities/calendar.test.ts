import assert from "node:assert/strict";
import { test } from "node:test";
import { eveCalendarInputSchema, resolveEveCalendar } from "./calendar";

const context = {
  now: new Date("2026-09-20T14:00:00Z"),
  timeZone: "America/New_York",
};
const resolve = (input: unknown, at = context) =>
  resolveEveCalendar(eveCalendarInputSchema.parse(input), at);
const date = (input: unknown, at = context) => {
  const result = resolve(input, at);
  assert.equal(result.status, "resolved");
  return result.calendarDate;
};

test("next Sunday on Sunday resolves September 27 at 10 EDT without a year question", () => {
  const result = resolve({
    date: { kind: "weekday", weekday: 0, occurrence: "upcoming" },
    localTime: "10:00",
    durationMinutes: 120,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.calendarDate, "2026-09-27");
  assert.equal(
    "instantUtc" in result && result.instantUtc,
    "2026-09-27T14:00:00.000Z"
  );
  assert.equal(
    "endInstantUtc" in result && result.endInstantUtc,
    "2026-09-27T16:00:00.000Z"
  );
  assert.match("display" in result ? result.display : "", /10:00 AM.*EDT/);
});

test("weekday resolution distinguishes upcoming from a named calendar week", () => {
  const monday = { ...context, now: new Date("2026-09-21T14:00:00Z") };
  assert.equal(
    date(
      { date: { kind: "weekday", weekday: 0, occurrence: "upcoming" } },
      monday
    ),
    "2026-09-27"
  );
  assert.equal(
    date(
      { date: { kind: "weekday", weekday: 0, occurrence: "next_week" } },
      monday
    ),
    "2026-10-04"
  );
});

test("missing year uses the next calendar occurrence but preserves an explicit historical date", () => {
  const december = { ...context, now: new Date("2026-12-31T17:00:00Z") };
  assert.equal(
    date({ date: { kind: "month_day", month: 1, day: 3 } }, december),
    "2027-01-03"
  );
  assert.equal(
    date(
      { date: { kind: "month_day", month: 1, day: 3, year: 2026 } },
      december
    ),
    "2026-01-03"
  );
  assert.equal(
    resolve({ date: { kind: "month_day", month: 2, day: 30 } }).status,
    "needs_input"
  );
});

test("today follows the church calendar rather than UTC or the process timezone", () => {
  assert.equal(
    date(
      { date: { kind: "relative_day", daysFromToday: 0 } },
      { ...context, now: new Date("2026-09-21T02:30:00Z") }
    ),
    "2026-09-20"
  );
});

test("DST gaps and folds need an actual time choice, not silent normalization", () => {
  const gap = resolve({
    date: { kind: "absolute", date: "2027-03-14" },
    localTime: "02:30",
  });
  assert.equal(gap.status, "needs_input");
  assert.equal("reason" in gap && gap.reason, "daylight_saving_gap");
  const fold = resolve({
    date: { kind: "absolute", date: "2026-11-01" },
    localTime: "01:30",
  });
  assert.equal(fold.status, "needs_input");
  const earlier = resolve({
    date: { kind: "absolute", date: "2026-11-01" },
    localTime: "01:30",
    repeatedTime: "earlier",
  });
  const later = resolve({
    date: { kind: "absolute", date: "2026-11-01" },
    localTime: "01:30",
    repeatedTime: "later",
  });
  assert.equal(
    "instantUtc" in earlier && earlier.instantUtc,
    "2026-11-01T05:30:00.000Z"
  );
  assert.equal(
    "instantUtc" in later && later.instantUtc,
    "2026-11-01T06:30:00.000Z"
  );
});

test("model inputs cannot select clock or timezone and invalid calendars fail at the boundary", () => {
  for (const input of [
    { date: { kind: "absolute", date: "2026-02-30" } },
    { date: { kind: "relative_day", daysFromToday: 0 }, timeZone: "UTC" },
    { date: { kind: "relative_day", daysFromToday: 0 }, now: "2030-01-01" },
    { date: { kind: "relative_day", daysFromToday: 0 }, localTime: "25:00" },
  ])
    assert.equal(eveCalendarInputSchema.safeParse(input).success, false);
});
