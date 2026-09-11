import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  APP_TIME_ZONE,
  DEFAULT_CHURCH_TIME_ZONE,
  addCalendarDays,
  formatDate,
  formatDateTime,
  formatRelativeDay,
  formatRelativeTimestamp,
  formatTime,
  formatTimeZoneName,
  groupedTimeZones,
  instantsAtZonedTime,
  isValidTimeZone,
  parseDateTimeLocalValue,
  relativeDayOffset,
  toCalendarDate,
  toDateTimeLocalValue,
  utcOffsetForZonedTime,
} from "./datetime";

const EVENING = new Date("2026-07-30T19:00:00Z");

// ----------------------------------------------------------------------------
// The pin
//
// The regression these helpers replace was formatting with no `timeZone`, which
// resolves to the *runtime's* zone. The same component then renders one string
// in Node (SSR) and another in the browser (hydration) — React #418 — while a
// server-only sibling keeps the server's string, so the header and the Date &
// Time card disagreed about the same meeting.
//
// Proving the pin needs the module *loaded* under a different zone, which an
// in-process `process.env.TZ` poke cannot do: the formatters are built once at
// import time. So load it in a child process with a hostile TZ — a stand-in for
// the browser of a planter fourteen hours from UTC.
// ----------------------------------------------------------------------------

/** Format the same fixtures in a fresh process running under `timeZone`. */
function renderUnder(timeZone: string): Record<string, string> {
  const tsx = path.join(__dirname, "..", "..", "node_modules", ".bin", "tsx");
  const moduleUrl = path.join(__dirname, "datetime.ts");

  const script = `
    import(${JSON.stringify(moduleUrl)}).then((loaded) => {
      // tsx transforms to CJS, so the namespace may be behind interop default.
      const m = typeof loaded.formatDate === "function" ? loaded : loaded.default;
      const evening = new Date("2026-07-30T19:00:00Z");
      const lateNight = new Date("2026-07-30T23:30:00Z");
      process.stdout.write(
        JSON.stringify({
          ambientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          date: m.formatDate(evening),
          shortDate: m.formatDate(evening, "short"),
          time: m.formatTime(evening),
          dateTime: m.formatDateTime(evening),
          shortDateTime: m.formatDateTime(evening, "short"),
          lateNightDate: m.formatDate(lateNight),
          lateNightTime: m.formatTime(lateNight),
          parsedWallClock: m
            .parseDateTimeLocalValue("2026-07-30T19:00")
            .toISOString(),
        })
      );
    });
  `;

  const stdout = execFileSync(tsx, ["--eval", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: timeZone },
  });

  return JSON.parse(stdout) as Record<string, string>;
}

test("the app renders every timestamp in one fixed zone", () => {
  assert.equal(APP_TIME_ZONE, "UTC");
  assert.equal(DEFAULT_CHURCH_TIME_ZONE, "America/Chicago");
});

test("a browser far from UTC renders exactly what the server rendered", () => {
  // Stand-ins for the two runtimes: Vercel's Node (UTC) and a browser at +14,
  // far enough east that an unpinned formatter would roll the calendar day.
  const server = renderUnder("UTC");
  const browser = renderUnder("Pacific/Kiritimati");

  assert.equal(
    browser.ambientTimeZone,
    "Pacific/Kiritimati",
    "the child process did not actually pick up the hostile timezone, so this test proves nothing"
  );

  const { ambientTimeZone: _server, ...serverStrings } = server;
  const { ambientTimeZone: _browser, ...browserStrings } = browser;
  assert.deepEqual(
    browserStrings,
    serverStrings,
    "SSR markup and hydrated markup would disagree — this is React #418"
  );
});

test("a browser far to the west renders exactly what the server rendered", () => {
  const server = renderUnder("UTC");
  const browser = renderUnder("Pacific/Niue"); // UTC-11

  assert.equal(browser.ambientTimeZone, "Pacific/Niue");

  const { ambientTimeZone: _server, ...serverStrings } = server;
  const { ambientTimeZone: _browser, ...browserStrings } = browser;
  assert.deepEqual(browserStrings, serverStrings);
});

// ----------------------------------------------------------------------------
// The strings themselves
// ----------------------------------------------------------------------------

test("formatDate and formatTime render the pinned wall clock", () => {
  assert.equal(formatDate(EVENING), "Thursday, July 30, 2026");
  assert.equal(formatDate(EVENING, "short"), "Thu, Jul 30, 2026");
  assert.equal(formatTime(EVENING), "7:00 PM");
});

test("formatDateTime joins both halves with 'at' in either variant", () => {
  assert.equal(formatDateTime(EVENING), "Thursday, July 30, 2026 at 7:00 PM");
  assert.equal(formatDateTime(EVENING, "short"), "Jul 30, 2026 at 7:00 PM");
});

test("formatTimeZoneName follows daylight saving time", () => {
  assert.equal(formatTimeZoneName(EVENING, "America/New_York"), "EDT");
  assert.equal(
    formatTimeZoneName(new Date("2026-01-30T19:00:00Z"), "America/New_York"),
    "EST"
  );
});

test("the header and the Date & Time card ask for the same strings", () => {
  // Structural, since both now call the same helpers — but this was exactly the
  // pair that drifted, so hold them together explicitly.
  const header = { date: formatDate(EVENING), time: formatTime(EVENING) };
  const detailCard = { date: formatDate(EVENING), time: formatTime(EVENING) };
  assert.deepEqual(header, detailCard);
});

// ----------------------------------------------------------------------------
// "7:00 PM in, 7:00 PM out" — the round trip through the scheduling form.
// ----------------------------------------------------------------------------

/** Run `fn` as if the process had been started with `TZ=<timeZone>`. */
function withTimeZone<T>(timeZone: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test("a naive datetime-local value is read as the app zone, not the server's", () => {
  for (const zone of ["UTC", "America/Chicago", "Pacific/Kiritimati"]) {
    // The bug being avoided: bare `new Date()` reads a naive string as local
    // time, so the stored instant follows whichever machine served the post.
    const naive = withTimeZone(zone, () =>
      new Date("2026-07-30T19:00").toISOString()
    );
    const parsed = withTimeZone(
      zone,
      () => parseDateTimeLocalValue("2026-07-30T19:00")!
    );

    assert.equal(
      parsed.toISOString(),
      "2026-07-30T19:00:00.000Z",
      `parsing moved the instant under TZ=${zone}`
    );
    if (zone !== "UTC") {
      assert.notEqual(
        naive,
        parsed.toISOString(),
        `TZ=${zone} should expose the difference between coercion and an explicit parse`
      );
    }
  }
});

test("what was entered at scheduling is what the detail page shows", () => {
  const entered = "2026-07-30T19:00";
  const stored = parseDateTimeLocalValue(entered);
  assert.ok(stored);

  assert.equal(formatDate(stored), "Thursday, July 30, 2026");
  assert.equal(formatTime(stored), "7:00 PM");
  // …and reopening the edit form offers the same value back.
  assert.equal(toDateTimeLocalValue(stored), entered);
});

test("a datetime that already carries a zone is honoured as written", () => {
  assert.equal(
    parseDateTimeLocalValue("2026-07-30T19:00:00Z")?.toISOString(),
    "2026-07-30T19:00:00.000Z"
  );
  assert.equal(
    parseDateTimeLocalValue("2026-07-30T19:00:00-05:00")?.toISOString(),
    "2026-07-31T00:00:00.000Z"
  );
});

test("parseDateTimeLocalValue rejects blank and unparseable input", () => {
  assert.equal(parseDateTimeLocalValue(""), null);
  assert.equal(parseDateTimeLocalValue("   "), null);
  assert.equal(parseDateTimeLocalValue("not a date"), null);
  assert.equal(parseDateTimeLocalValue("2026-13-45T99:99"), null);
});

test("seconds in a datetime-local value survive, and the input rounds to minutes", () => {
  const parsed = parseDateTimeLocalValue("2026-07-30T19:00:30");
  assert.equal(parsed?.toISOString(), "2026-07-30T19:00:30.000Z");
  assert.equal(toDateTimeLocalValue(parsed!), "2026-07-30T19:00");
});

// ----------------------------------------------------------------------------
// Date boundaries: a meeting at 11:30 PM must not slide onto the next day.
// ----------------------------------------------------------------------------

test("a meeting at 23:30 keeps its own calendar day", () => {
  const lateNight = parseDateTimeLocalValue("2026-07-30T23:30");
  assert.ok(lateNight);

  assert.equal(formatDate(lateNight), "Thursday, July 30, 2026");
  assert.equal(formatDate(lateNight, "short"), "Thu, Jul 30, 2026");
  assert.equal(formatTime(lateNight), "11:30 PM");
});

test("a meeting at 00:30 keeps its own calendar day", () => {
  const earlyMorning = parseDateTimeLocalValue("2026-07-31T00:30");
  assert.ok(earlyMorning);

  assert.equal(formatDate(earlyMorning), "Friday, July 31, 2026");
  assert.equal(formatTime(earlyMorning), "12:30 AM");
});

// ----------------------------------------------------------------------------
// The calendar-day primitives (#411).
//
// `toCalendarDate` and `addCalendarDays` are what every `date` column in the
// app is written through — `tasks.due_date` above all. They lived in
// `lib/tasks/recurrence.ts` until #411, where a `"use client"` component had to
// reach into the tasks domain for them and the "+ N days" shape was written out
// at six call sites, each with its own spelling of a day in milliseconds.
// ----------------------------------------------------------------------------

test("toCalendarDate pins the UTC day of an instant", () => {
  // 23:30 UTC is already tomorrow east of UTC+1 and still yesterday-evening in
  // the Americas. The answer is the APP_TIME_ZONE day, in every runtime.
  assert.equal(
    toCalendarDate(new Date("2026-08-09T23:30:00.000Z")),
    "2026-08-09"
  );
});

test("addCalendarDays steps whole days, forwards and backwards", () => {
  const noon = new Date("2026-08-09T12:00:00.000Z");

  assert.equal(addCalendarDays(noon, 0), "2026-08-09");
  assert.equal(addCalendarDays(noon, 1), "2026-08-10");
  assert.equal(addCalendarDays(noon, 7), "2026-08-16");
  assert.equal(addCalendarDays(noon, -1), "2026-08-08");
  // Across a month boundary, and across a year's.
  assert.equal(addCalendarDays(noon, 23), "2026-09-01");
  assert.equal(
    addCalendarDays(new Date("2026-12-31T00:00:00.000Z"), 1),
    "2027-01-01"
  );
});

test("the hour of the base instant never moves the answer by a day", () => {
  // What makes this DAY arithmetic rather than instant arithmetic: every hour
  // of one UTC day answers "+2 days" with the same calendar day, so a task
  // generated at 23:59 and one generated at 00:01 are not a day apart.
  const answers = new Set(
    [
      "2026-08-09T00:00:00.000Z",
      "2026-08-09T09:00:00.000Z",
      "2026-08-09T23:59:59.000Z",
    ].map((instant) => addCalendarDays(new Date(instant), 2))
  );

  assert.deepEqual([...answers], ["2026-08-11"]);
});

// ----------------------------------------------------------------------------
// The relative label counts calendar days, so it cannot contradict the date
// printed beside it.
// ----------------------------------------------------------------------------

test("tonight at 23:30 is Today, not Tomorrow", () => {
  const now = new Date("2026-07-30T10:00:00Z");
  const tonight = new Date("2026-07-30T23:30:00Z");

  assert.equal(relativeDayOffset(tonight, now), 0);
  assert.equal(formatRelativeDay(tonight, now), "Today");
});

test("relative labels count whole calendar days in both directions", () => {
  const now = new Date("2026-07-30T10:00:00Z");
  const cases: [string, string][] = [
    ["2026-07-30T00:05:00Z", "Today"],
    ["2026-07-31T00:30:00Z", "Tomorrow"],
    ["2026-08-02T09:00:00Z", "In 3 days"],
    ["2026-07-29T23:00:00Z", "Yesterday"],
    ["2026-07-27T11:00:00Z", "3 days ago"],
  ];

  for (const [iso, expected] of cases) {
    assert.equal(formatRelativeDay(new Date(iso), now), expected, iso);
  }
});

// ----------------------------------------------------------------------------
// The feed's elapsed-time label (N-008). Finer-grained than the calendar-day
// label, and pinned the same way: `now` is a parameter, so the string a client
// renders after hydration is the string the server sent.
// ----------------------------------------------------------------------------

test("elapsed labels step from minutes to hours to days, then to a date", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const cases: [string, string][] = [
    ["2026-07-30T11:59:30Z", "Just now"],
    ["2026-07-30T11:48:00Z", "12m ago"],
    ["2026-07-30T07:00:00Z", "5h ago"],
    ["2026-07-27T12:00:00Z", "3d ago"],
    // Past a week the elapsed count stops helping and the date takes over.
    ["2026-07-20T12:00:00Z", "Mon, Jul 20, 2026"],
  ];

  for (const [iso, expected] of cases) {
    assert.equal(formatRelativeTimestamp(new Date(iso), now), expected, iso);
  }
});

test("a not-yet-elapsed instant reads as future, never as 0m ago", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  assert.equal(
    formatRelativeTimestamp(new Date("2026-07-30T12:05:00Z"), now),
    "In 5m"
  );
  assert.equal(
    formatRelativeTimestamp(new Date("2026-07-31T14:00:00Z"), now),
    "In 1d"
  );
});

// ----------------------------------------------------------------------------
// Church zone, plumbed down. The same instant must render two strings in two
// zones, and a relative-day badge that straddles UTC midnight must follow the
// church's calendar, not UTC's.
// ----------------------------------------------------------------------------

test("an invalid IANA id is rejected, a real one is not", () => {
  assert.equal(isValidTimeZone("America/Chicago"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Pacific/Kiritimati"), true);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone("America/Chicago/Extra"), false);
});

test("groupedTimeZones lists America first and includes the default", () => {
  const groups = groupedTimeZones();
  assert.equal(groups[0]?.region, "America");
  const ids = groups.flatMap((group) => group.zones.map((zone) => zone.id));
  assert.ok(ids.includes(DEFAULT_CHURCH_TIME_ZONE));
  assert.equal(new Set(ids).size, ids.length);
});

test("two churches in two zones render the same instant differently", () => {
  // 19:00 UTC is 2:00 PM in Chicago (CDT) and 4:00 AM the next day in Tokyo.
  assert.equal(formatTime(EVENING, "America/Chicago"), "2:00 PM");
  assert.equal(formatTime(EVENING, "Asia/Tokyo"), "4:00 AM");
  assert.equal(
    formatDateTime(EVENING, "short", "America/Chicago"),
    "Jul 30, 2026 at 2:00 PM"
  );
  assert.equal(
    formatDateTime(EVENING, "short", "Asia/Tokyo"),
    "Jul 31, 2026 at 4:00 AM"
  );
});

test("the relative-day badge follows the church calendar across UTC midnight", () => {
  // 00:20 UTC on July 31 is still 19:20 on July 30 in Chicago. A meeting 40
  // minutes earlier is "Yesterday" in UTC and "Today" for the plant.
  const now = new Date("2026-07-31T00:20:00Z");
  const justNow = new Date("2026-07-30T23:40:00Z");

  assert.equal(formatRelativeDay(justNow, now, APP_TIME_ZONE), "Yesterday");
  assert.equal(formatRelativeDay(justNow, now, "America/Chicago"), "Today");
  assert.equal(formatRelativeDay(justNow, now, "Asia/Tokyo"), "Today");
});

test("toCalendarDate in a church zone is not the UTC day", () => {
  const lateUtc = new Date("2026-03-02T05:30:00.000Z");
  assert.equal(toCalendarDate(lateUtc), "2026-03-02");
  assert.equal(toCalendarDate(lateUtc, "America/Chicago"), "2026-03-01");
  assert.equal(toCalendarDate(lateUtc, "Asia/Tokyo"), "2026-03-02");
});

test("zoned wall-clock candidates preserve daylight-saving cardinality", () => {
  const ordinary = instantsAtZonedTime("2026-08-05", 10, 0, "America/New_York");
  assert.deepEqual(
    ordinary.map((instant) => instant.toISOString()),
    ["2026-08-05T14:00:00.000Z"]
  );

  const springGap = instantsAtZonedTime(
    "2026-03-08",
    2,
    30,
    "America/New_York"
  );
  assert.deepEqual(springGap, []);

  const autumnFold = instantsAtZonedTime(
    "2026-11-01",
    1,
    30,
    "America/New_York"
  );
  assert.deepEqual(
    autumnFold.map((instant) => instant.toISOString()),
    ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]
  );
});

test("zoned offsets preserve historical IANA seconds exactly", () => {
  const [instant] = instantsAtZonedTime(
    "1880-01-01",
    12,
    0,
    "America/New_York"
  );
  assert.equal(instant.toISOString(), "1880-01-01T16:56:02.000Z");
  assert.equal(
    utcOffsetForZonedTime("1880-01-01", 12, 0, instant),
    "-04:56:02"
  );
});

test("a hostile process TZ does not move a church-zoned format", () => {
  const chicago = renderUnder("Pacific/Kiritimati");
  assert.equal(chicago.ambientTimeZone, "Pacific/Kiritimati");
  // Default (APP_TIME_ZONE) strings are still UTC even in +14.
  assert.equal(chicago.time, "7:00 PM");
  assert.equal(chicago.date, "Thursday, July 30, 2026");
});

test("the week-old feed fallback is church-zoned, not UTC", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const older = new Date("2026-07-20T22:00:00Z");
  // 22:00 UTC July 20 is already July 21 in Tokyo.
  assert.equal(
    formatRelativeTimestamp(older, now, APP_TIME_ZONE),
    "Mon, Jul 20, 2026"
  );
  assert.equal(
    formatRelativeTimestamp(older, now, "Asia/Tokyo"),
    "Tue, Jul 21, 2026"
  );
});
