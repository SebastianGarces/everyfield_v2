import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { instantAtZonedHour, zonedHour } from "@/lib/datetime";

import {
  composePlanterDigestBody,
  composePlanterDigestTitle,
  currentDigestDedupeKeys,
  DEFAULT_DIGEST_ANCHOR,
  DEFAULT_DIGEST_SEND_HOUR,
  DEFAULT_DIGEST_SEND_WEEKDAY,
  digestAnchorFrom,
  digestLinesFromBody,
  digestPeriodFor,
  digestSendHourLabel,
  DIGEST_SECTION_KEYS,
  DIGEST_SECTIONS,
  DIGEST_SEND_WEEKDAYS,
  planterDigestDedupeKey,
  PLANTER_DIGEST_TYPE,
  totalOutstanding,
  widestPeriodEnd,
  type DigestAnchor,
  type DigestCounts,
} from "./digest-content";

// ============================================================================
// WHAT THE PLANTER DIGEST SAYS (N-013) — the pure half.
//
// These cases moved out of `digest.test.ts` with the code they cover. They need
// no database, no injected dependency and no environment variable: the period
// arithmetic, the dedupe keys and the body/title round trip are functions of
// their arguments alone, and the module under test imports `@/lib/datetime` and
// one erased type.
//
// That is the point of the split being visible here as well as in `src/`. A
// suite that has to set `UNSUBSCRIBE_TOKEN_SECRET` before its first import (see
// `digest.test.ts`) is testing something else.
// ============================================================================

/** The instant every case below is measured from. A Wednesday. */
const NOW = new Date("2026-08-19T09:00:00.000Z");

const BUSY: DigestCounts = {
  overdue_tasks: 2,
  tasks_due_soon: 3,
  upcoming_meetings: 1,
};

/** `America/New_York` at the ruled default — Sunday 16:00 Eastern. */
const EASTERN: DigestAnchor = {
  ...DEFAULT_DIGEST_ANCHOR,
  timeZone: "America/New_York",
};

/** A second church, a different zone AND a different configured time. */
const PACIFIC_WED_7AM: DigestAnchor = {
  timeZone: "America/Los_Angeles",
  weekday: 3,
  hour: 7,
};

/** Every fifteen minutes from `from`, for `days` days. The dispatcher's tick. */
function ticks(from: Date, days: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < days * 96; i += 1) {
    out.push(new Date(from.getTime() + i * 15 * 60_000));
  }
  return out;
}

// ----------------------------------------------------------------------------
// The anchor — the ruled default, and the fallback that must not throw
// ----------------------------------------------------------------------------

test("the default anchor is Sunday 16:00 in the church's zone", () => {
  assert.equal(DEFAULT_DIGEST_SEND_WEEKDAY, 0, "0 is Sunday");
  assert.equal(DEFAULT_DIGEST_SEND_HOUR, 16, "16:00 local");
  assert.equal(DIGEST_SEND_WEEKDAYS[DEFAULT_DIGEST_SEND_WEEKDAY], "Sunday");
  assert.equal(digestSendHourLabel(DEFAULT_DIGEST_SEND_HOUR), "4:00 PM");
  assert.equal(digestSendHourLabel(0), "12:00 AM");
  assert.equal(digestSendHourLabel(12), "12:00 PM");
});

test("a church row with nothing usable falls back rather than throwing", () => {
  // The sweep runs across every plant in the product. One unreadable row costs
  // that plant its configured time, never the tick.
  assert.deepEqual(digestAnchorFrom({}), DEFAULT_DIGEST_ANCHOR);
  assert.deepEqual(
    digestAnchorFrom({
      timeZone: null,
      digestSendWeekday: null,
      digestSendHour: null,
    }),
    DEFAULT_DIGEST_ANCHOR
  );
  assert.deepEqual(
    digestAnchorFrom({
      timeZone: "Not/AZone",
      digestSendWeekday: 7,
      digestSendHour: 24,
    }),
    DEFAULT_DIGEST_ANCHOR,
    "out of range folds into the default, one field at a time"
  );

  // ...and a good row is taken verbatim, including hour 0.
  assert.deepEqual(
    digestAnchorFrom({
      timeZone: "America/New_York",
      digestSendWeekday: 0,
      digestSendHour: 0,
    }),
    { timeZone: "America/New_York", weekday: 0, hour: 0 }
  );

  // A null zone still resolves to a formattable one — the failure this guards
  // is a period whose every instant is `Invalid Date`.
  assert.ok(
    !Number.isNaN(
      digestPeriodFor(
        "weekly",
        digestAnchorFrom({ timeZone: null }),
        NOW
      ).start.getTime()
    )
  );
});

// ----------------------------------------------------------------------------
// The send time — the whole ruling, at the boundary that motivated it
// ----------------------------------------------------------------------------

test("a weekly digest lands at Sunday 16:00 Eastern, not at 00:00 UTC", () => {
  // 2026-08-16 is a Sunday. 16:00 EDT is 20:00 UTC.
  const period = digestPeriodFor(
    "weekly",
    EASTERN,
    new Date("2026-08-19T09:00:00.000Z")
  );

  assert.equal(period.key, "2026-08-16");
  assert.equal(period.start.toISOString(), "2026-08-16T20:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-08-23T20:00:00.000Z");

  // THE FAILURE THE RULING EXISTS TO PREVENT. Moving only the weekday to Sunday
  // and leaving the boundary at midnight would have opened this period at
  // 2026-08-16T00:00Z — Saturday 8 PM Eastern.
  assert.ok(
    period.start > new Date("2026-08-16T00:00:00.000Z"),
    "the period opens in Sunday afternoon, not Saturday evening"
  );

  // The first tick at or after the open is the one that emits, and the tick
  // fifteen minutes earlier still belongs to the week before.
  const before = digestPeriodFor(
    "weekly",
    EASTERN,
    new Date("2026-08-16T19:45:00.000Z")
  );
  assert.equal(before.key, "2026-08-09");
  assert.equal(
    digestPeriodFor("weekly", EASTERN, new Date("2026-08-16T20:00:00.000Z"))
      .key,
    "2026-08-16"
  );
});

test("the hour governs BOTH cadences; the weekday governs only the weekly one", () => {
  // 09:00 Eastern on a Wednesday, under a 16:00 anchor: today's daily period
  // has not opened yet, so the current one is yesterday's.
  const morning = new Date("2026-08-19T13:00:00.000Z");
  assert.equal(digestPeriodFor("daily", EASTERN, morning).key, "2026-08-18");
  // ...and seven hours later it has.
  const afternoon = new Date("2026-08-19T20:00:00.000Z");
  assert.equal(digestPeriodFor("daily", EASTERN, afternoon).key, "2026-08-19");

  // Every daily period opens at 16:00 Eastern, whatever the weekday is set to.
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const daily = digestPeriodFor("daily", { ...EASTERN, weekday }, afternoon);
    assert.equal(daily.key, "2026-08-19", "the weekday never moves a daily");
    assert.equal(daily.start.toISOString(), "2026-08-19T20:00:00.000Z");
  }

  // The weekly one walks back to the configured day, at the same hour.
  const wednesday = digestPeriodFor(
    "weekly",
    { ...EASTERN, weekday: 3 },
    afternoon
  );
  assert.equal(wednesday.key, "2026-08-19");
  assert.equal(wednesday.start.toISOString(), "2026-08-19T20:00:00.000Z");
});

test("two churches in two zones, at two configured times, hold different keys on the same instant", () => {
  const at = new Date("2026-08-19T15:30:00.000Z");

  const eastern = currentDigestDedupeKeys(EASTERN, at).sort();
  const pacific = currentDigestDedupeKeys(PACIFIC_WED_7AM, at).sort();

  // 11:30 EDT is before 16:00, so Eastern is still on Tuesday's daily and the
  // week that opened Sunday. 08:30 PDT is past 07:00, so Pacific has already
  // opened Wednesday's daily AND Wednesday's week.
  assert.deepEqual(eastern, [
    `${PLANTER_DIGEST_TYPE}:daily:2026-08-18`,
    `${PLANTER_DIGEST_TYPE}:weekly:2026-08-16`,
  ]);
  assert.deepEqual(pacific, [
    `${PLANTER_DIGEST_TYPE}:daily:2026-08-19`,
    `${PLANTER_DIGEST_TYPE}:weekly:2026-08-19`,
  ]);

  // THE INVARIANT THAT SURVIVES ALL OF THIS: the church id is still absent from
  // every key string, which is what keeps the sweep's owed test a two-literal
  // `IN` rather than a concatenated-uuid `LIKE`.
  for (const key of [...eastern, ...pacific]) {
    assert.match(key, /^digest\.planter:(daily|weekly):\d{4}-\d{2}-\d{2}$/);
  }
});

test("the two cadences never share a key, whatever the anchor", () => {
  // A Wednesday under a Wednesday anchor is both the DAY 2026-08-19 and the
  // WEEK of 2026-08-19, so only the cadence in the key keeps a cadence switch
  // from swallowing a digest.
  const at = new Date("2026-08-19T15:30:00.000Z");
  assert.notEqual(
    planterDigestDedupeKey(digestPeriodFor("daily", PACIFIC_WED_7AM, at)),
    planterDigestDedupeKey(digestPeriodFor("weekly", PACIFIC_WED_7AM, at))
  );
});

test("the sweep's lookahead is the widest any cadence could ask for", () => {
  for (const anchor of [EASTERN, PACIFIC_WED_7AM, DEFAULT_DIGEST_ANCHOR]) {
    for (const at of [
      new Date("2026-08-17T00:00:00.000Z"),
      NOW,
      new Date("2026-08-23T23:59:59.000Z"),
    ]) {
      const widest = widestPeriodEnd(anchor, at);
      assert.ok(widest >= digestPeriodFor("daily", anchor, at).end);
      assert.ok(widest >= digestPeriodFor("weekly", anchor, at).end);
    }
  }
});

// ----------------------------------------------------------------------------
// THE PARTITION PROPERTY — what makes "once per period" mean anything
// ----------------------------------------------------------------------------
//
// Every instant belongs to exactly one period of each cadence, the periods
// abut with no gap and no overlap, and the key changes exactly once per period.
// Everything else in the digest — the dedupe key, the sweep's owed set, "one
// email per recipient per period" — rests on this and nothing else.

test("every tick lands inside its own period, in every zone tested", () => {
  for (const anchor of [EASTERN, PACIFIC_WED_7AM, DEFAULT_DIGEST_ANCHOR]) {
    for (const at of ticks(new Date("2026-08-12T00:00:00.000Z"), 21)) {
      for (const cadence of ["daily", "weekly"] as const) {
        const period = digestPeriodFor(cadence, anchor, at);
        assert.ok(
          period.start <= at && at < period.end,
          `${cadence} ${anchor.timeZone}: ${at.toISOString()} fell outside [${period.start.toISOString()}, ${period.end.toISOString()})`
        );
      }
    }
  }
});

/**
 * Sixteen zones, every hour of the day, every DST window of the year.
 *
 * THIS SWEEP EXISTS BECAUSE THE ONE ABOVE WAS NOT ENOUGH. It only walked
 * `America/*` anchors, and the partition held there while being false in seven
 * (zone, hour) pairs — Berlin at 02:00, London and Dublin at 01:00, Sydney and
 * Auckland at 02:00, Chatham at 03:00, Beirut at 23:00. Every one of them is
 * EAST of UTC, where a fall-back day puts the naive UTC reading of the wall
 * clock on the far side of the transition. `digestPeriodFor` classified those
 * instants by `zonedHour` and the boundary by instant, and on a day when the
 * wall clock is not monotonic those two disagree.
 *
 * The cost of getting this wrong is not theoretical: `[start, end)` being a
 * partition is what "one digest per recipient per period" reduces to, and the
 * lookahead a plant is selected on comes off a period that has not opened.
 */
test("the partition holds in every zone, at every hour, across every transition", () => {
  const zones = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "America/St_Johns", // -03:30 — a half-hour offset
    "Europe/London",
    "Europe/Dublin", // negative DST in the tz database
    "Europe/Berlin",
    "Asia/Beirut", // a midnight transition
    "Asia/Tehran",
    "Asia/Kathmandu", // +05:45
    "Asia/Tokyo", // no DST at all
    "Australia/Eucla", // +08:45
    "Australia/Lord_Howe", // a THIRTY-MINUTE DST shift
    "Australia/Sydney", // southern hemisphere
    "Pacific/Chatham", // +12:45, southern hemisphere
  ];
  // Two-day windows straddling every transition either hemisphere has in 2026.
  const windows = [
    "2026-03-07",
    "2026-03-28",
    "2026-04-03",
    "2026-09-26",
    "2026-10-24",
    "2026-10-31",
    "2026-11-01",
  ];

  // DAILY only, and that is not a gap: a weekly period's boundaries are a
  // SUBSET of the daily ones — both are `instantAtZonedHour(day, hour)` — so a
  // weekly boundary that misplaced an instant would have to misplace it as a
  // daily one first. The 21-day sweep above walks both cadences. Halving the
  // matrix here is what keeps a 2.6-million-instant property under a minute.
  const failures: string[] = [];
  for (const timeZone of zones) {
    for (let hour = 0; hour < 24; hour += 1) {
      const anchor: DigestAnchor = { timeZone, weekday: 0, hour };
      for (const window of windows) {
        for (const at of ticks(new Date(`${window}T00:00:00.000Z`), 2)) {
          const period = digestPeriodFor("daily", anchor, at);
          if (period.start <= at && at < period.end) continue;
          failures.push(
            `${timeZone} h=${hour} ${at.toISOString()} outside [${period.start.toISOString()}, ${period.end.toISOString()})`
          );
        }
      }
    }
  }

  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} in total`);
});

test("an ambiguous wall clock resolves to its FIRST occurrence, east of UTC too", () => {
  // The specific regression. 02:00 happens twice in Berlin on 2026-10-25:
  // 00:00Z (CEST) and 01:00Z (CET). The rule is the earlier one, and the
  // two-probe version of `instantAtZonedHour` returned the later.
  assert.equal(
    instantAtZonedHour("2026-10-25", 2, "Europe/Berlin").toISOString(),
    "2026-10-25T00:00:00.000Z"
  );
  // ...and the US case it always got right, so the fix did not trade one for
  // the other: 01:00 happens twice on 2026-11-01 in New York.
  assert.equal(
    instantAtZonedHour("2026-11-01", 1, "America/New_York").toISOString(),
    "2026-11-01T05:00:00.000Z"
  );
  // A wall clock that never happens resolves to the instant the clock jumps to.
  const gap = instantAtZonedHour("2026-03-08", 2, "America/New_York");
  assert.equal(gap.toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(zonedHour(gap, "America/New_York"), 3);
});

test("a DST transition produces neither two digests nor zero", () => {
  // The 23-hour day (2026-03-08, US spring forward) and the 25-hour one
  // (2026-11-01, US fall back). Under a 2:00 anchor, 02:00 does not exist on
  // one of them and 01:00 happens twice on the other — the two hours that break
  // 24-hour arithmetic.
  for (const hour of [1, 2, 3, 16]) {
    const anchor: DigestAnchor = { ...EASTERN, hour };

    for (const [label, from] of [
      ["spring forward", "2026-03-06T00:00:00.000Z"],
      ["fall back", "2026-10-30T00:00:00.000Z"],
    ] as const) {
      const window = ticks(new Date(from), 5);
      const keys = window.map((at) => digestPeriodFor("daily", anchor, at).key);

      // Exactly one period opens per calendar day: the key changes on a day
      // boundary and never returns to a value it has left. Two digests would
      // show as a key repeating after a change; zero would show as a day with
      // no key of its own.
      const runs = keys.filter((key, i) => i === 0 || key !== keys[i - 1]);
      assert.deepEqual(
        runs,
        [...new Set(runs)],
        `${label} @${hour}: a key came back after changing — that is a second digest`
      );
      assert.equal(
        new Set(keys).size,
        runs.length,
        `${label} @${hour}: a day was skipped entirely`
      );

      // And the transition day is genuinely 23 or 25 hours, not 24 — which is
      // the proof the arithmetic is the zone's and not the epoch's.
      for (const at of window) {
        const period = digestPeriodFor("daily", anchor, at);
        assert.ok(period.start <= at && at < period.end, `${label} @${hour}`);
      }
    }
  }

  // The 23-hour and the 25-hour period, named outright. Note WHICH period each
  // is: under a 16:00 anchor the day that loses an hour runs from Saturday
  // 16:00 EST to Sunday 16:00 EDT, because the 02:00 transition falls inside
  // it. Saying "the DST day is short" without naming the anchor is the mistake
  // this pair of cases pins.
  const springPeriod = digestPeriodFor(
    "daily",
    { ...EASTERN, hour: 16 },
    new Date("2026-03-07T22:00:00.000Z")
  );
  assert.equal(springPeriod.key, "2026-03-07");
  assert.equal(springPeriod.start.toISOString(), "2026-03-07T21:00:00.000Z");
  assert.equal(springPeriod.end.toISOString(), "2026-03-08T20:00:00.000Z");
  assert.equal(
    springPeriod.end.getTime() - springPeriod.start.getTime(),
    23 * 3_600_000
  );

  const fallPeriod = digestPeriodFor(
    "daily",
    { ...EASTERN, hour: 16 },
    new Date("2026-10-31T22:00:00.000Z")
  );
  assert.equal(fallPeriod.key, "2026-10-31");
  assert.equal(fallPeriod.start.toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(fallPeriod.end.toISOString(), "2026-11-01T21:00:00.000Z");
  assert.equal(
    fallPeriod.end.getTime() - fallPeriod.start.getTime(),
    25 * 3_600_000
  );

  // Both still land at 16:00 on the church's own wall clock, which is the point
  // of doing any of this — the send time does not drift by an hour twice a year.
  for (const period of [springPeriod, fallPeriod]) {
    assert.equal(zonedHour(period.start, EASTERN.timeZone), 16);
    assert.equal(zonedHour(period.end, EASTERN.timeZone), 16);
  }
});

test("changing the setting mid-period reopens the period, and never twice", () => {
  // THE CHOSEN BEHAVIOUR (stated in the PR): a change takes effect at once.
  // The period is recomputed from the new anchor and the dedupe key arbitrates,
  // so the transition costs AT MOST one extra digest — never two rows for one
  // key, and never a period that goes unserved.
  const at = new Date("2026-08-19T15:30:00.000Z");

  // Moving the hour only, within a week already served: the weekly key does not
  // move, so the row that exists still covers it and nothing is sent again.
  const before = planterDigestDedupeKey(digestPeriodFor("weekly", EASTERN, at));
  const laterSameDay = planterDigestDedupeKey(
    digestPeriodFor("weekly", { ...EASTERN, hour: 20 }, at)
  );
  assert.equal(laterSameDay, before, "same week, same key, no second send");

  // Moving to a day already past this week opens a period the recipient has no
  // row for, so one digest lands now and the next falls on the new day.
  const moved = digestPeriodFor("weekly", { ...EASTERN, weekday: 2 }, at);
  assert.notEqual(planterDigestDedupeKey(moved), before);
  assert.equal(moved.key, "2026-08-18", "the Tuesday just gone");

  // ...and from there the schedule is simply the new one. No period is skipped
  // and none repeats: consecutive keys are exactly seven days apart.
  const after = ticks(at, 28).map(
    (tick) => digestPeriodFor("weekly", { ...EASTERN, weekday: 2 }, tick).key
  );
  const distinct = [...new Set(after)];
  assert.equal(distinct[0], "2026-08-18");
  for (let i = 1; i < distinct.length; i += 1) {
    assert.equal(
      Date.parse(`${distinct[i]}T00:00:00Z`) -
        Date.parse(`${distinct[i - 1]}T00:00:00Z`),
      7 * 86_400_000,
      `${distinct[i - 1]} → ${distinct[i]} is not one week`
    );
  }
});

// ----------------------------------------------------------------------------
// AC — content and links
// ----------------------------------------------------------------------------

test("the body summarises the outstanding work, and omits what is zero", () => {
  assert.equal(
    composePlanterDigestBody(BUSY),
    [
      "2 tasks are overdue",
      "3 tasks are due before your next digest",
      "1 meeting is coming up",
    ].join("\n")
  );

  assert.equal(
    composePlanterDigestBody({
      overdue_tasks: 0,
      tasks_due_soon: 0,
      upcoming_meetings: 1,
    }),
    "1 meeting is coming up",
    "a zero section is omitted, never printed as 0"
  );
});

test("the title names the period, in the church's zone, never 'today'", () => {
  const weekly = composePlanterDigestTitle(
    digestPeriodFor("weekly", EASTERN, NOW)
  );
  const daily = composePlanterDigestTitle(
    digestPeriodFor("daily", EASTERN, NOW)
  );

  assert.match(weekly, /^What needs your attention — week of /);
  assert.match(daily, /^What needs your attention — /);
  assert.doesNotMatch(weekly, /today/i);
  assert.doesNotMatch(daily, /today/i);

  // A 16:00 Eastern period opens at 20:00 UTC, so a title formatted in
  // `APP_TIME_ZONE` names the same day here — but one at 20:00 Eastern opens at
  // 00:00 the NEXT UTC day, and that is the case that catches the wrong pin.
  const evening = composePlanterDigestTitle(
    digestPeriodFor("daily", { ...EASTERN, hour: 20 }, NOW)
  );
  assert.match(
    evening,
    /Aug 18, 2026$/,
    "the church's Tuesday, not UTC's Wednesday"
  );
});

test("composing and re-reading a body is a lossless round trip", () => {
  // Every combination of "present / absent" across the three sections, with a
  // singular and a plural count so both phrases are exercised.
  for (const overdue of [0, 1, 7]) {
    for (const dueSoon of [0, 1, 4]) {
      for (const meetings of [0, 1, 2]) {
        const counts: DigestCounts = {
          overdue_tasks: overdue,
          tasks_due_soon: dueSoon,
          upcoming_meetings: meetings,
        };
        if (totalOutstanding(counts) === 0) continue;

        const lines = digestLinesFromBody(composePlanterDigestBody(counts));

        assert.deepEqual(
          Object.fromEntries(lines.map((line) => [line.section, line.count])),
          Object.fromEntries(
            DIGEST_SECTION_KEYS.filter((key) => counts[key] > 0).map((key) => [
              key,
              counts[key],
            ])
          ),
          `round trip failed for ${JSON.stringify(counts)}`
        );

        for (const line of lines) {
          assert.equal(line.path, DIGEST_SECTIONS[line.section].path);
          assert.equal(line.linkLabel, DIGEST_SECTIONS[line.section].linkLabel);
        }
      }
    }
  }
});

test("a line this module did not write resolves to nothing, never to a wrong link", () => {
  assert.deepEqual(digestLinesFromBody("3 widgets need polishing"), []);
  assert.deepEqual(digestLinesFromBody("tasks are overdue"), []);
  assert.deepEqual(digestLinesFromBody(""), []);
  assert.deepEqual(digestLinesFromBody("constructor"), []);
  // A count that does not match the phrase's grammar is not that section.
  assert.deepEqual(digestLinesFromBody("2 task is overdue"), []);
});

// ============================================================================
// THE LEAF RULE — the property that makes the split worth anything
// ============================================================================

const NOTIFICATIONS_DIR = path.join(process.cwd(), "src/lib/notifications");

function read(file: string): string {
  return readFileSync(path.join(NOTIFICATIONS_DIR, file), "utf8");
}

test("the content module imports nothing but datetime and erased types", () => {
  // A leaf that grows a `@/db` edge stops being one, and the modules that
  // depend on it — `dispatch.ts` for one string constant, `channels/digest-
  // email.ts` for one parser — silently get the whole schema graph back.
  const source = read("digest-content.ts");
  const specifiers = [
    ...source.matchAll(/^import\s+([\s\S]*?)from\s+"([^"]+)"/gm),
  ];

  assert.ok(specifiers.length > 0, "no imports found — check the path");

  for (const [, clause, specifier] of specifiers) {
    if (clause.trimStart().startsWith("type ")) continue;
    assert.equal(
      specifier,
      "@/lib/datetime",
      `digest-content.ts imports ${specifier} as a VALUE — the leaf is closed to everything but @/lib/datetime`
    );
  }

  assert.doesNotMatch(
    source.replace(/^import type[\s\S]*?from "[^"]+";$/gm, ""),
    /from "@\/db/,
    "a value edge to the database reached the leaf"
  );
});

test("digest.ts re-exports nothing from the leaf — every importer names it", () => {
  // `permanent-failure.ts`'s own rule: a leaf whose contents are also served
  // from the trunk is not a leaf, because callers keep reaching for the trunk
  // and the graph closes over again.
  assert.doesNotMatch(
    read("digest.ts"),
    /^export\s[\s\S]*?from "\.\/digest-content"/m,
    "digest.ts re-exports the leaf — import it directly instead"
  );
});

test("the dispatcher takes the digest type from the leaf, not from the trunk", () => {
  // The cycle this split cut: `digest.ts` reaches `dispatch.ts` transitively
  // through the tasks feature's F11 registration, and `dispatch.ts` reached
  // back into `digest.ts` for one string. That is what made a module-scope
  // composer table throw a TDZ ReferenceError.
  const dispatch = read("dispatch.ts");

  assert.match(
    dispatch,
    /import \{ PLANTER_DIGEST_TYPE \} from "\.\/digest-content";/
  );
  assert.doesNotMatch(
    dispatch,
    /from "\.\/digest"/,
    "dispatch.ts imports the digest trunk again — the cycle is back"
  );
  assert.doesNotMatch(
    read("channels/digest-email.ts"),
    /from "\.\.\/digest"/,
    "the email composer imports the digest trunk again"
  );
});
