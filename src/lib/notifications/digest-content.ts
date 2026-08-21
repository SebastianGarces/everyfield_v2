import type { DigestCadence } from "@/db/schema/notifications";
import {
  addCalendarDays,
  DEFAULT_CHURCH_TIME_ZONE,
  formatDate,
  instantAtZonedHour,
  isValidTimeZone,
  toCalendarDate,
} from "@/lib/datetime";

// ============================================================================
// WHAT THE PLANTER DIGEST SAYS — a db-free LEAF (N-013).
//
// WHAT IS HERE. The digest's identity (`PLANTER_DIGEST_TYPE`), its period
// arithmetic, its dedupe keys, its section vocabulary, and the body/title
// composer with the exact inverse that reads a stored body back. All pure: this
// module imports `@/lib/datetime` and one ERASED type, and nothing else.
//
// WHY IT IS NOT IN `./digest.ts`. Three modules need pieces of this and only one
// of them wants a database:
//
//   * `./dispatch.ts` needs `PLANTER_DIGEST_TYPE` — one string — to pick the
//     email template for a group. It used to take that constant from
//     `./digest.ts`, which opens with `@/db`, the schema barrel,
//     `@/lib/tasks/service`, drizzle's alias and five tables.
//   * `./channels/digest-email.ts` needs `digestLinesFromBody` to hang the
//     email's links off, and reached back into `./digest.ts` for it.
//   * `./digest.ts` itself needs all of it, plus the queries and the sweep.
//
// Those first two edges CLOSED A CYCLE: `./digest.ts` reaches `./dispatch.ts`
// transitively through the tasks feature's own F11 registration
// (`digest.ts` → `@/lib/tasks/service` → `@/lib/tasks/notifications` →
// `dispatch.ts`), and `dispatch.ts` reached back for the constant. The cost was
// paid in a coding restriction: a module-scope `Record` in `dispatch.ts` read
// `PLANTER_DIGEST_TYPE` during `./digest`'s initialisation and threw a TDZ
// `ReferenceError`, so the composer lookup had to stay a function and say so in
// a paragraph. A hazard held at bay by a rule somebody has to remember is not a
// solved hazard. With the constant in a leaf that imports nothing from the
// feature, the cycle is gone and so is the restriction.
//
// KEEP IT A LEAF, and that has a second half: `./digest.ts` re-exports NOTHING
// from here. A leaf whose contents are also served from the trunk is not a leaf
// — callers keep reaching for the trunk and the graph closes over again. This is
// the rule `./permanent-failure.ts` states for its own constant and the rule
// `src/lib/invitations/register-path.ts` states for the register link; every
// importer names THIS module.
//
// The `DigestCadence` import is TYPE-ONLY and must stay that way. It is erased
// at compile time, so it adds no edge to `@/db` — the same allowance
// `src/lib/meetings/response-card.ts` takes to be a db-free sibling of a service
// that opens with the schema barrel.
// ============================================================================

/** The `type` every planter digest row carries. One constant, four readers. */
export const PLANTER_DIGEST_TYPE = "digest.planter";

// ----------------------------------------------------------------------------
// WHEN A DIGEST LANDS — the church's anchor (N-013, ruled 2026-08-15)
// ----------------------------------------------------------------------------
//
// TWO OWNERS, and conflating them is the easy mistake. The RECIPIENT decides
// whether they get a digest and how often, through their own `digest` category
// preference; nothing in this section overrides that. The CHURCH decides what
// day and hour it lands on, and that is what an anchor is.
//
// The hour and the weekday had to change together. Before this, a period opened
// at midnight `APP_TIME_ZONE` and the 15-minute tick emitted on the first
// crossing, so the shipped behaviour was "Monday 00:00 UTC". Moving only the
// weekday to Sunday would have delivered Saturday 8 PM in the Americas — the
// precise failure the ruling exists to prevent.

/** 0 = Sunday. The ruled default day a WEEKLY digest lands on. */
export const DEFAULT_DIGEST_SEND_WEEKDAY = 0;

/**
 * 16:00 local. The ruled default hour BOTH cadences land at.
 *
 * WHOLE HOURS ONLY, and that is a decision rather than an oversight: the tick
 * is every fifteen minutes and would permit quarter-hour granularity, but an
 * hour is the unit a bivocational planter reasons about ("Sunday afternoon"),
 * and three quarters of a needless control is surface this product says no to.
 */
export const DEFAULT_DIGEST_SEND_HOUR = 16;

/**
 * The seven day names, indexed by the stored weekday. The settings control
 * renders these and `digestSendHourLabel` below; they live beside the constants
 * they name so a control cannot offer a day the arithmetic does not mean.
 */
export const DIGEST_SEND_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** `16` → `"4:00 PM"`. A wall clock, so no zone and no `Date` is involved. */
export function digestSendHourLabel(hour: number): string {
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  return `${clock}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * WHEN one church's digests land: a wall-clock time in that church's own zone.
 *
 * Every period below is a function of this and an instant, and of nothing else
 * — no module state, no runtime calendar, no clock read.
 */
export interface DigestAnchor {
  /** The church's IANA zone. Never `APP_TIME_ZONE`; never the runtime's. */
  timeZone: string;
  /** 0–6, Sunday first. Governs the WEEKLY cadence only. */
  weekday: number;
  /** 0–23, on the wall clock in `timeZone`. Governs BOTH cadences. */
  hour: number;
}

/** Sunday 16:00 in the zone a church is born with. */
export const DEFAULT_DIGEST_ANCHOR: DigestAnchor = {
  timeZone: DEFAULT_CHURCH_TIME_ZONE,
  weekday: DEFAULT_DIGEST_SEND_WEEKDAY,
  hour: DEFAULT_DIGEST_SEND_HOUR,
};

function inRange(value: number | null | undefined, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

/**
 * One church row's three columns, read as an anchor.
 *
 * FALLS BACK RATHER THAN THROWING, per field. All three columns are `NOT NULL`
 * with the ruled defaults and the two integers carry `CHECK` constraints, so
 * none of these branches should ever be reachable from live data — but this
 * runs inside a sweep across every plant in the product, and one unreadable row
 * must cost that plant its digest at worst, never the whole tick's.
 */
export function digestAnchorFrom(row: {
  timeZone?: string | null;
  digestSendWeekday?: number | null;
  digestSendHour?: number | null;
}): DigestAnchor {
  return {
    timeZone:
      row.timeZone && isValidTimeZone(row.timeZone)
        ? row.timeZone
        : DEFAULT_DIGEST_ANCHOR.timeZone,
    weekday: inRange(row.digestSendWeekday, 6)
      ? (row.digestSendWeekday as number)
      : DEFAULT_DIGEST_ANCHOR.weekday,
    hour: inRange(row.digestSendHour, 23)
      ? (row.digestSendHour as number)
      : DEFAULT_DIGEST_ANCHOR.hour,
  };
}

// ----------------------------------------------------------------------------
// The period
// ----------------------------------------------------------------------------

/**
 * The stretch of time ONE digest speaks for: it lands at `start` and covers
 * everything due before `end`, when the next one arrives.
 *
 * `key` is the period's IDENTITY — half of the dedupe key — so it is derived
 * the same way on every machine and never from the runtime's calendar. The
 * church is deliberately absent from the key STRING (see `./digest.ts`); making
 * the anchor per-church makes its VALUE church-dependent, which is a different
 * thing and is the whole reason `currentDigestDedupeKeys` takes an anchor.
 */
export interface DigestPeriod {
  cadence: DigestCadence;
  /** The anchor this period was computed from. Carried so the title can say the church's date. */
  anchor: DigestAnchor;
  start: Date;
  end: Date;
  /** `YYYY-MM-DD` of `start`, on the wall clock in `anchor.timeZone`. */
  key: string;
}

/** Whole days in one period of each cadence. */
const PERIOD_DAYS: Record<DigestCadence, number> = { daily: 1, weekly: 7 };

/** `days` whole calendar days from a `YYYY-MM-DD`, still as `YYYY-MM-DD`. */
function shiftCalendarDate(calendarDate: string, days: number): string {
  return addCalendarDays(new Date(`${calendarDate}T00:00:00.000Z`), days);
}

/** The 0–6 weekday of a `YYYY-MM-DD`. Civil arithmetic — no zone involved. */
function weekdayOf(calendarDate: string): number {
  return new Date(`${calendarDate}T00:00:00.000Z`).getUTCDay();
}

/**
 * The period `at` falls inside, for one cadence and one church's anchor.
 *
 * The send hour OPENS the day, so it is the day boundary and midnight is not:
 * at 09:00 local under a 16:00 anchor the current daily period is still
 * yesterday's, and today's opens seven hours later. Weekly periods then walk
 * back from that day to the anchor weekday and run seven days, so every instant
 * in a week resolves to the same `key` — which is what makes "one per week" a
 * property of the key rather than of when the sweep happened to fire.
 *
 * NO 24-HOUR ARITHMETIC ANYWHERE. Both ends are the wall clock resolved in the
 * church's zone (`instantAtZonedHour`), so a period containing a DST transition
 * is 23 or 25 hours long and still contains exactly the instants between one
 * send and the next. The days tile the timeline with no gap and no overlap;
 * `digest-content.test.ts` sweeps 15-minute ticks across both transitions and
 * asserts that every one lands in exactly one period.
 */
export function digestPeriodFor(
  cadence: DigestCadence,
  anchor: DigestAnchor,
  at: Date
): DigestPeriod {
  // "Has today's period opened yet?" asked as an INSTANT comparison against the
  // very boundary being classified, never as `zonedHour(at) >= anchor.hour`.
  // The hour form looks equivalent and is not: on a fall-back day the wall
  // clock is not monotonic, so an instant before the boundary can read an hour
  // at or after it, and the period computed for that instant would not contain
  // it. That put 52 instants outside their own period across seven zones — all
  // of them east of UTC, which is why an `America/*`-only sweep stayed green.
  const localDay = toCalendarDate(at, anchor.timeZone);
  const openedOn =
    at >= instantAtZonedHour(localDay, anchor.hour, anchor.timeZone)
      ? localDay
      : shiftCalendarDate(localDay, -1);

  const startDay =
    cadence === "daily"
      ? openedOn
      : shiftCalendarDate(
          openedOn,
          -((weekdayOf(openedOn) - anchor.weekday + 7) % 7)
        );

  return {
    cadence,
    anchor,
    start: instantAtZonedHour(startDay, anchor.hour, anchor.timeZone),
    end: instantAtZonedHour(
      shiftCalendarDate(startDay, PERIOD_DAYS[cadence]),
      anchor.hour,
      anchor.timeZone
    ),
    key: startDay,
  };
}

/**
 * The digest's identity, per recipient.
 *
 * Church-free on purpose — see the header of `./digest.ts`. Carries the cadence
 * because the two cadences name different periods that can share a calendar
 * date.
 */
export function planterDigestDedupeKey(period: DigestPeriod): string {
  return `${PLANTER_DIGEST_TYPE}:${period.cadence}:${period.key}`;
}

/**
 * Every dedupe key a digest could legitimately carry at instant `at` — one per
 * cadence, so exactly two.
 *
 * The sweep's owed-set test is "this recipient holds none of these", and it is
 * a two-element `IN` rather than a per-user lookup because the cadence lives in
 * a preference row the selection query would otherwise have to join.
 *
 * IT TAKES AN ANCHOR, and that is the load-bearing half of making the send time
 * a church setting. "The current keys" is no longer a question the product has
 * ONE answer to: two churches an hour apart hold different keys at the same
 * instant. A caller that computed a single current key set across churches
 * would be asking a question that no longer exists, so there is no signature
 * here that lets it.
 */
export function currentDigestDedupeKeys(
  anchor: DigestAnchor,
  at: Date
): string[] {
  return (Object.keys(PERIOD_DAYS) as DigestCadence[]).map((cadence) =>
    planterDigestDedupeKey(digestPeriodFor(cadence, anchor, at))
  );
}

/**
 * The WIDEST period end of any cadence at `at`.
 *
 * The sweep cannot know a recipient's cadence without joining their preference
 * rows, so its "is anything outstanding?" probe uses the widest lookahead any
 * cadence could ask for. That can only make the selection OVER-offer a plant,
 * which costs one wasted summary; under-offering would cost a digest. The
 * per-recipient summary remains the authority for what is actually reported.
 */
export function widestPeriodEnd(anchor: DigestAnchor, at: Date): Date {
  return (Object.keys(PERIOD_DAYS) as DigestCadence[])
    .map((cadence) => digestPeriodFor(cadence, anchor, at).end)
    .reduce((widest, end) => (end > widest ? end : widest));
}

// ----------------------------------------------------------------------------
// What the digest says — ONE table, read by the composer AND its inverse
// ----------------------------------------------------------------------------

export const DIGEST_SECTION_KEYS = [
  "overdue_tasks",
  "tasks_due_soon",
  "upcoming_meetings",
] as const;

export type DigestSectionKey = (typeof DIGEST_SECTION_KEYS)[number];

/** The counts one digest reports. Every field is a non-negative integer. */
export type DigestCounts = Record<DigestSectionKey, number>;

export interface DigestSectionDefinition {
  /** Phrase for exactly one item. */
  one: string;
  /** Phrase for none or several. */
  many: string;
  /** Where in the app the reader goes to act on it. App-relative. */
  path: string;
  /** The link's own words, in the email. */
  linkLabel: string;
}

/**
 * THE DIGEST'S VOCABULARY, DECLARED ONCE.
 *
 * Three things read this table and they must agree, which is the whole reason
 * it exists: `composePlanterDigestBody` writes the body from it,
 * `digestLinesFromBody` reads that body back through it to hang the email's
 * links off, and `./digest.ts`'s outstanding conditions name one SQL condition
 * per key. A `Record` keyed on the union makes a new section a compile error in
 * all three places rather than a silently missing line.
 *
 * The phrases are what the body literally contains, so they are the parse
 * table too — see `digestLinesFromBody`, which is the exact inverse and is
 * pinned by a round-trip test rather than by this sentence.
 */
export const DIGEST_SECTIONS: Record<
  DigestSectionKey,
  DigestSectionDefinition
> = {
  overdue_tasks: {
    one: "task is overdue",
    many: "tasks are overdue",
    path: "/tasks",
    linkLabel: "Open your tasks",
  },
  tasks_due_soon: {
    one: "task is due before your next digest",
    many: "tasks are due before your next digest",
    path: "/tasks",
    linkLabel: "Open your tasks",
  },
  upcoming_meetings: {
    one: "meeting is coming up",
    many: "meetings are coming up",
    path: "/meetings",
    linkLabel: "Open your meetings",
  },
};

/** Total outstanding items — the "is anything owed?" answer. */
export function totalOutstanding(counts: DigestCounts): number {
  return DIGEST_SECTION_KEYS.reduce((sum, key) => sum + counts[key], 0);
}

/** The one line a section renders as, e.g. `3 tasks are overdue`. */
function sectionLine(key: DigestSectionKey, n: number): string {
  const section = DIGEST_SECTIONS[key];
  return `${n} ${n === 1 ? section.one : section.many}`;
}

/**
 * The digest body: one line per NON-ZERO section, in table order.
 *
 * Zero counts are omitted rather than printed as "0 meetings are coming up" —
 * a reader skimming an inbox wants the two things that need them, not the one
 * that does and the two that do not. A digest with every count at zero is never
 * composed at all (`runPlanterDigest` returns before this is called).
 *
 * Newline-separated because the body is stored on `notifications.body` and read
 * back by BOTH the in-app feed and `digestLinesFromBody`; a line is the unit
 * both of them work in.
 */
export function composePlanterDigestBody(counts: DigestCounts): string {
  return DIGEST_SECTION_KEYS.filter((key) => counts[key] > 0)
    .map((key) => sectionLine(key, counts[key]))
    .join("\n");
}

/** One rendered line, resolved back onto the section that wrote it. */
export interface DigestLine {
  section: DigestSectionKey;
  count: number;
  /** The line verbatim, as it is stored and as the feed shows it. */
  text: string;
  path: string;
  linkLabel: string;
}

/**
 * THE EXACT INVERSE of `composePlanterDigestBody`.
 *
 * The digest's structure has to survive the trip through `notifications.body`,
 * because that column is where the enqueued row keeps it and the dispatcher's
 * email composer runs long afterwards with nothing else to go on. There is no
 * JSON column on `notifications` and inventing one would be a migration for a
 * projection the feed already renders as text.
 *
 * So the round trip is made SAFE rather than avoided: both directions read
 * `DIGEST_SECTIONS`, the match is an exact equality against the phrase this
 * module itself wrote (never a substring or a regex over free text), and
 * `digest-content.test.ts` drives the pair over every combination of counts. A
 * line this module did not write matches nothing and is dropped, so a body from
 * an older shape of this code degrades to an email with no link — never to a
 * wrong one.
 */
export function digestLinesFromBody(body: string): DigestLine[] {
  const lines: DigestLine[] = [];

  for (const raw of body.split("\n")) {
    const text = raw.trim();
    if (!text) continue;

    const separator = text.indexOf(" ");
    if (separator <= 0) continue;

    const count = Number(text.slice(0, separator));
    if (!Number.isInteger(count) || count < 0) continue;

    const phrase = text.slice(separator + 1);
    const key = DIGEST_SECTION_KEYS.find(
      (candidate) => sectionLine(candidate, count) === `${count} ${phrase}`
    );
    if (!key) continue;

    lines.push({
      section: key,
      count,
      text,
      path: DIGEST_SECTIONS[key].path,
      linkLabel: DIGEST_SECTIONS[key].linkLabel,
    });
  }

  return lines;
}

/**
 * The digest's title.
 *
 * It NAMES THE PERIOD, and it names it the same way in every case: the digest
 * may be retried, may be composed hours after the period opened, and a reader
 * with two in the inbox has no other way to tell them apart. "Today" would be
 * wrong in each of those.
 *
 * In the CHURCH'S zone, not `APP_TIME_ZONE`: the period now opens at a wall
 * clock in that zone, and a title naming the UTC day of a 16:00 Eastern send
 * would name the next day for every church west of the meridian.
 */
export function composePlanterDigestTitle(period: DigestPeriod): string {
  const day = formatDate(period.start, "short", period.anchor.timeZone);
  return period.cadence === "weekly"
    ? `What needs your attention — week of ${day}`
    : `What needs your attention — ${day}`;
}
