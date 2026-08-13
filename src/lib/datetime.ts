/**
 * The one place the app turns a `Date` into text a person reads.
 *
 * ## Why this file exists
 *
 * `Intl.DateTimeFormat(locale, options)` with no `timeZone` resolves to the
 * *runtime's* zone. In a Next.js app the same component runs in two runtimes:
 * Node on the server (UTC on Vercel) and the visitor's browser (whatever zone
 * they are in). A component that formats a time without pinning a zone
 * therefore renders one string into the SSR HTML and a different one after
 * hydration — React #418 — and any sibling that renders server-only keeps the
 * server's string, so two parts of the same page disagree about when the same
 * event is.
 *
 * Pinning the zone here makes formatting a pure function of the `Date`, so
 * server markup and client markup are identical by construction.
 *
 * ## Why UTC
 *
 * There is no per-user or per-church timezone column, and scheduling forms use
 * `<input type="datetime-local">`, which yields a *naive* wall clock — the
 * literal "2026-07-30T19:00" the planter typed, with no zone attached. We store
 * that wall clock as UTC (see `parseDateTimeLocalValue`) and render it back as
 * UTC, so what is displayed is exactly what was entered, on every machine.
 * Introducing real per-user zones later means changing `APP_TIME_ZONE` (and
 * back-filling), not hunting down formatters again.
 */

/**
 * The single zone every rendered timestamp is expressed in.
 *
 * `relativeDayOffset()` assumes this is UTC — revisit it if that changes.
 */
export const APP_TIME_ZONE = "UTC";

const LOCALE = "en-US";

/** `"long"` for detail views, `"short"` for dense lists and cards. */
export type DateVariant = "long" | "short";

const dateFormatters: Record<DateVariant, Intl.DateTimeFormat> = {
  long: new Intl.DateTimeFormat(LOCALE, {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }),
  short: new Intl.DateTimeFormat(LOCALE, {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }),
};

// The long date without its weekday, for prose and merged documents
// ("September 14, 2026") — a place a weekday would read as clutter.
const dayLongFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Composed rather than a single formatter: `Intl` joins a weekday-less short
// date to a time with a comma ("Jul 30, 2026, 7:00 PM"), and " at " reads
// better next to the long variant, which `Intl` already joins with "at".
const shortDateWithoutWeekday = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const longDateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** `"Thursday, July 30, 2026"` (long) / `"Thu, Jul 30, 2026"` (short). */
export function formatDate(date: Date, variant: DateVariant = "long"): string {
  return dateFormatters[variant].format(date);
}

/**
 * `"July 30, 2026"` (long) / `"Jul 30, 2026"` (short) — `formatDate` without
 * the weekday, for dense cards and history rows where the weekday is noise.
 */
export function formatDateWithoutWeekday(
  date: Date,
  variant: DateVariant = "long"
): string {
  if (variant === "long") return dayLongFormatter.format(date);
  return shortDateWithoutWeekday.format(date);
}

/** `"September 14, 2026"` — the long date without its weekday. */
export function formatDayLong(date: Date): string {
  return formatDateWithoutWeekday(date, "long");
}

/** `"7:00 PM"`. */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

/**
 * `"Thursday, July 30, 2026 at 7:00 PM"` (long) /
 * `"Jul 30, 2026 at 7:00 PM"` (short).
 */
export function formatDateTime(
  date: Date,
  variant: DateVariant = "long"
): string {
  if (variant === "long") return longDateTimeFormatter.format(date);
  return `${shortDateWithoutWeekday.format(date)} at ${formatTime(date)}`;
}

// Month and day on their own, for the two-line calendar tile below. A separate
// formatter rather than a substring of `formatDate(date, "short")`: pulling
// "Jul 30" back out of "Thu, Jul 30, 2026" means splitting on the punctuation
// `Intl` chose, which is a locale detail, not a contract.
const tileFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/**
 * The two lines of a calendar tile — `["Jul", "30"]`.
 *
 * Lives here, beside the other formatters, for two reasons. It is zone-pinned
 * like everything else in this file, so a tile cannot roll onto the next day in
 * a browser east of UTC while the detail page it links to keeps the right one
 * (React #418 — memory/invariants.md → Date & Time Rendering). And this module
 * imports nothing, so a test can import the real helper instead of mirroring it;
 * the component that renders the tile pulls in server actions that open a
 * database connection at import time, and cannot be imported from a unit test.
 */
export function calendarTileParts(date: Date): [month: string, day: string] {
  const parts = tileFormatter.formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return [valueOf("month"), valueOf("day")];
}

/**
 * The value for an `<input type="datetime-local">`: `"2026-07-30T19:00"`.
 *
 * The inverse of `parseDateTimeLocalValue`, so opening the edit form shows the
 * same wall clock the detail page shows.
 */
export function toDateTimeLocalValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Parse what a scheduling form submits into the `Date` we store.
 *
 * `new Date("2026-07-30T19:00")` is specified to mean *local* time, so the same
 * submission becomes a different instant depending on the server's `TZ`. That
 * makes stored meeting times depend on where the code happens to run. Here a
 * naive wall clock is read as `APP_TIME_ZONE` instead, so "19:00" is stored —
 * and later rendered — as 7:00 PM everywhere.
 *
 * Strings that already carry a zone (`Z` or `±hh:mm`) are honoured as written.
 *
 * @returns the parsed `Date`, or `null` when the input is not a usable date.
 */
export function parseDateTimeLocalValue(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const iso = NAIVE_DATETIME.test(trimmed) ? `${trimmed}Z` : trimmed;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * One whole day, in milliseconds.
 *
 * Every "N days from here" in the app is this constant, and it lives beside
 * `APP_TIME_ZONE` because it is only correct while that zone is UTC — whose
 * days are exactly 24h and aligned to the epoch. A zone with DST would make day
 * arithmetic calendar-aware and this constant wrong, so the assumption and the
 * number belong in one file. Before #411 it was spelled five ways across the
 * tasks domain (`24 * 60 * 60 * 1000` four times, `86_400_000` once), which is
 * five places for a fix to miss.
 */
export const MS_PER_DAY = 86_400_000;

/**
 * The `APP_TIME_ZONE` calendar day of an instant, as `"YYYY-MM-DD"`.
 *
 * The app's one answer to "which day is this?" — `tasks.due_date` and
 * `launches.target_date` are `date` columns, calendar days rather than
 * instants, and every surface that renders one says which day it is in
 * `APP_TIME_ZONE`. So the day a write NAMES has to be measured in the same
 * zone the day is later read in (`memory/invariants.md` → Date & Time
 * Rendering); `getFullYear()/getMonth()/getDate()` is the runtime's calendar
 * and is how a planter far enough east pressed "Today" and got tomorrow.
 *
 * It lived in `lib/tasks/recurrence.ts` until #411 — a module about recurring
 * task chains — while client components and three other domains imported it.
 * It is a datetime primitive, so it lives with the datetime primitives, and
 * this module imports nothing, so a `"use client"` component may reach it.
 */
export function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The calendar day `days` whole days from `from`, as `"YYYY-MM-DD"`.
 *
 * `toCalendarDate(new Date(base.getTime() + n * MS_PER_DAY))` was written out
 * at six call sites; this is that shape, once. Whole days in, whole days out —
 * the hour of `from` never moves the answer by a day, because both ends are
 * measured on the same UTC-aligned grid.
 */
export function addCalendarDays(from: Date, days: number): string {
  return toCalendarDate(new Date(from.getTime() + days * MS_PER_DAY));
}

/**
 * Whole calendar days from `now` to `date`, counted in `APP_TIME_ZONE`.
 *
 * Calendar days, not 24-hour blocks: a meeting at 11:30 PM tonight is `0`
 * ("Today"), never `1` ("Tomorrow"), which is what a difference-in-milliseconds
 * calculation would say.
 *
 * Only safe to call where a re-render on the client is impossible (server
 * components), since it reads the clock.
 */
export function relativeDayOffset(date: Date, now: Date = new Date()): number {
  // Valid because APP_TIME_ZONE is UTC, whose days are exactly 24h and aligned
  // to the epoch. A zone with DST would need a calendar-aware difference.
  const dayOf = (d: Date) => Math.floor(d.getTime() / MS_PER_DAY);
  return dayOf(date) - dayOf(now);
}

/** `"Today"` / `"Tomorrow"` / `"In 3 days"` / `"Yesterday"` / `"3 days ago"`. */
export function formatRelativeDay(date: Date, now: Date = new Date()): string {
  const days = relativeDayOffset(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`;
}

const MS_PER_MINUTE = 60_000;

/**
 * A short, elapsed-time label for a feed: `"Just now"`, `"12m ago"`, `"5h ago"`,
 * `"3d ago"`, then an absolute short date once it stops being useful.
 *
 * Finer-grained than `formatRelativeDay`, which answers a scheduling question
 * ("is this meeting today?") in whole calendar days. A notification arriving
 * eleven minutes ago and one arriving eleven hours ago are both "Today", and
 * the difference is exactly what the reader of a feed wants.
 *
 * `now` is a parameter, not a call to the clock, and that is load-bearing:
 * memory/invariants.md → Date & Time Rendering. A client component that
 * recomputed this at hydration would render a different string than the server
 * did and trip React #418, so the caller passes ONE instant for the whole
 * render — and the fallback goes through `formatDate`, which is pinned to
 * `APP_TIME_ZONE`, rather than through a runtime-local formatter.
 *
 * Future instants are labelled too (`"In 5m"`), so a caller that hands this a
 * scheduled-ahead row gets something honest rather than "0m ago".
 */
export function formatRelativeTimestamp(
  date: Date,
  now: Date = new Date()
): string {
  const elapsedMs = now.getTime() - date.getTime();
  const isFuture = elapsedMs < 0;
  const minutes = Math.floor(Math.abs(elapsedMs) / MS_PER_MINUTE);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return isFuture ? `In ${minutes}m` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isFuture ? `In ${hours}h` : `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return isFuture ? `In ${days}d` : `${days}d ago`;

  return formatDate(date, "short");
}
