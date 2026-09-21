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
  assert.ok("calendarDate" in result);
  return result.calendarDate;
};

test("next Sunday on Sunday resolves September 27 at 10 EDT without a year question", () => {
  const result = resolve({
    date: { kind: "weekday", weekday: 0, occurrence: "upcoming" },
    localTime: "10:00",
    durationMinutes: 120,
  });
  assert.equal(result.status, "resolved");
  assert.ok("calendarDate" in result);
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
    { date: { kind: "trailing_days", days: 0 } },
    { date: { kind: "trailing_days", days: 1.5 } },
    { date: { kind: "trailing_days", days: 7 }, localTime: "10:00" },
    { date: { kind: "trailing_days", days: 7 }, durationMinutes: 60 },
  ])
    assert.equal(eveCalendarInputSchema.safeParse(input).success, false);
});

test("trailing calendar days include exactly N dates, including today by default", () => {
  const window = (days: number, includeToday?: boolean) => {
    const result = resolve({
      date: {
        kind: "trailing_days",
        days,
        ...(includeToday === undefined ? {} : { includeToday }),
      },
    });
    assert.equal(result.status, "resolved");
    assert.ok("dateWindow" in result);
    return result.dateWindow;
  };
  assert.deepEqual(window(90), { from: "2026-06-23", through: "2026-09-20" });
  assert.deepEqual(window(90, false), {
    from: "2026-06-22",
    through: "2026-09-19",
  });
  assert.deepEqual(window(1), { from: "2026-09-20", through: "2026-09-20" });
  assert.deepEqual(window(1, false), {
    from: "2026-09-19",
    through: "2026-09-19",
  });
});

test("calendar windows use local dates across midnight, both DST changes, leap days and years", () => {
  for (const [now, from, through] of [
    ["2026-09-21T02:30:00Z", "2026-09-19", "2026-09-20"],
    ["2027-03-15T01:30:00Z", "2027-03-13", "2027-03-14"],
    ["2026-11-02T01:30:00Z", "2026-10-31", "2026-11-01"],
    ["2028-03-01T15:00:00Z", "2028-02-29", "2028-03-01"],
    ["2027-01-01T15:00:00Z", "2026-12-31", "2027-01-01"],
  ]) {
    const result = resolve(
      { date: { kind: "trailing_days", days: 2 } },
      { ...context, now: new Date(now) }
    );
    assert.ok("dateWindow" in result);
    assert.deepEqual(result.dateWindow, { from, through });
    assert.equal(result.timeZone, "America/New_York");
  }
});

test("named periods return local inclusive dates and exact exclusive timestamp boundaries", () => {
  for (const [period, from, through, start, end] of [
    [
      "this_month",
      "2026-09-01",
      "2026-09-30",
      "2026-09-01T04:00:00.000Z",
      "2026-10-01T04:00:00.000Z",
    ],
    [
      "last_month",
      "2026-08-01",
      "2026-08-31",
      "2026-08-01T04:00:00.000Z",
      "2026-09-01T04:00:00.000Z",
    ],
    [
      "this_week",
      "2026-09-14",
      "2026-09-20",
      "2026-09-14T04:00:00.000Z",
      "2026-09-21T04:00:00.000Z",
    ],
    [
      "last_week",
      "2026-09-07",
      "2026-09-13",
      "2026-09-07T04:00:00.000Z",
      "2026-09-14T04:00:00.000Z",
    ],
  ]) {
    const result = resolve({ date: { kind: "period", period } });
    assert.equal(result.status, "resolved");
    assert.ok("timestampWindow" in result);
    assert.deepEqual(result.timestampWindow, { from: start, until: end });
    assert.deepEqual(result.dateWindow, { from, through });
  }
});

test("period timestamp edges follow DST independently and roll back across years", () => {
  for (const [now, period, start, end] of [
    [
      "2027-03-14T14:00:00Z",
      "this_week",
      "2027-03-08T05:00:00.000Z",
      "2027-03-15T04:00:00.000Z",
    ],
    [
      "2026-11-01T15:00:00Z",
      "this_week",
      "2026-10-26T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ],
    [
      "2027-01-01T15:00:00Z",
      "last_month",
      "2026-12-01T05:00:00.000Z",
      "2027-01-01T05:00:00.000Z",
    ],
    [
      "2028-03-01T15:00:00Z",
      "last_month",
      "2028-02-01T05:00:00.000Z",
      "2028-03-01T05:00:00.000Z",
    ],
  ]) {
    const result = resolve(
      { date: { kind: "period", period } },
      { ...context, now: new Date(now) }
    );
    assert.ok("timestampWindow" in result);
    assert.deepEqual(result.timestampWindow, { from: start, until: end });
  }
});

test("periods cannot silently normalize midnight gaps or accept meeting times", () => {
  assert.equal(
    eveCalendarInputSchema.safeParse({
      date: { kind: "period", period: "last_month" },
      localTime: "10:00",
    }).success,
    false
  );
  const result = resolve(
    { date: { kind: "period", period: "this_month" } },
    { now: new Date("2014-08-15T12:00:00Z"), timeZone: "Africa/Cairo" }
  );
  assert.equal(result.status, "needs_input");
  assert.ok(
    "reason" in result && result.reason === "ambiguous_period_boundary"
  );
});
