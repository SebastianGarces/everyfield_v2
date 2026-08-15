import type { DigestCadence } from "@/db/schema/notifications";
import { formatDate, MS_PER_DAY, toCalendarDate } from "@/lib/datetime";

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

/**
 * THE DEFAULT DAY A WEEKLY DIGEST LANDS ON — **Monday**, in `APP_TIME_ZONE`.
 *
 * The FRD leaves this open (Open Question 2: "weekly-on-Monday,
 * weekly-on-Sunday or user-chosen at first send is unruled"), so this is a
 * choice made here and stated in the PR rather than assumed silently.
 *
 * MONDAY, for two reasons:
 *
 *   1. The digest is FORWARD-looking — "here is what needs your attention" —
 *      so it wants to arrive at the start of the working week the reader will
 *      act in, not at the end of the one they have finished.
 *   2. Sunday is the busiest ministry day a church planter has. A digest that
 *      lands on it competes with the gathering itself and is the one most
 *      likely to go unread, which is the precise failure this feature exists to
 *      avoid.
 *
 * `1` is `Date#getUTCDay()`'s Monday, and `APP_TIME_ZONE` is UTC — the app has
 * no per-user timezone (memory/invariants.md → Date & Time Rendering), and
 * send-time-of-day is N-018, deliberately out of scope until one exists.
 */
export const DEFAULT_WEEKLY_DIGEST_WEEKDAY = 1;

// ----------------------------------------------------------------------------
// The period
// ----------------------------------------------------------------------------

/**
 * The stretch of time ONE digest speaks for: it lands at `start` and covers
 * everything due before `end`, when the next one arrives.
 *
 * `key` is the period's IDENTITY — half of the dedupe key — so it is derived
 * the same way on every machine and never from the runtime's calendar.
 */
export interface DigestPeriod {
  cadence: DigestCadence;
  start: Date;
  end: Date;
  /** `YYYY-MM-DD` of `start`, in `APP_TIME_ZONE`. */
  key: string;
}

/** Whole days in one period of each cadence. */
const PERIOD_DAYS: Record<DigestCadence, number> = { daily: 1, weekly: 7 };

/** Midnight of the `APP_TIME_ZONE` day `at` falls in. */
function startOfDay(at: Date): Date {
  return new Date(`${toCalendarDate(at)}T00:00:00.000Z`);
}

/**
 * The period `at` falls inside, for one cadence.
 *
 * Daily periods are the calendar day. Weekly periods start on
 * `DEFAULT_WEEKLY_DIGEST_WEEKDAY` and run seven days, so every instant in a
 * week resolves to the same `key` — which is what makes "one per week" a
 * property of the key rather than of when the sweep happened to fire.
 *
 * UTC-day arithmetic is valid because `APP_TIME_ZONE` is UTC, whose days are
 * exactly 24h and aligned to the epoch. The same assumption `relativeDayOffset`
 * states in `src/lib/datetime.ts`; a zone with DST would need both changed
 * together.
 */
export function digestPeriodFor(
  cadence: DigestCadence,
  at: Date
): DigestPeriod {
  const today = startOfDay(at);

  const start =
    cadence === "daily"
      ? today
      : new Date(
          today.getTime() -
            ((today.getUTCDay() - DEFAULT_WEEKLY_DIGEST_WEEKDAY + 7) % 7) *
              MS_PER_DAY
        );

  return {
    cadence,
    start,
    end: new Date(start.getTime() + PERIOD_DAYS[cadence] * MS_PER_DAY),
    key: toCalendarDate(start),
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
 */
export function currentDigestDedupeKeys(at: Date): string[] {
  return (Object.keys(PERIOD_DAYS) as DigestCadence[]).map((cadence) =>
    planterDigestDedupeKey(digestPeriodFor(cadence, at))
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
export function widestPeriodEnd(at: Date): Date {
  return (Object.keys(PERIOD_DAYS) as DigestCadence[])
    .map((cadence) => digestPeriodFor(cadence, at).end)
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
 */
export function composePlanterDigestTitle(period: DigestPeriod): string {
  const day = formatDate(period.start, "short");
  return period.cadence === "weekly"
    ? `What needs your attention — week of ${day}`
    : `What needs your attention — ${day}`;
}
