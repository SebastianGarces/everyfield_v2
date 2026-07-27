import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatRelativeDay,
  formatTime,
  parseDateTimeLocalValue,
  relativeDayOffset,
  toDateTimeLocalValue,
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
