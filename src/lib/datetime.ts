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
 * Pinning the zone here makes formatting a pure function of the `Date` and the
 * zone argument, so server markup and client markup are identical by
 * construction. The zone is an argument, never a process global and never
 * read out of a module-level church pointer.
 *
 * ## Two pins, not one
 *
 * Church-scoped surfaces (a relative-day badge, a training completion, a
 * message's `sentAt`) take the church's IANA zone, plumbed down from the row.
 * Meeting `datetime` is still a naive wall clock: scheduling forms use
 * `<input type="datetime-local">`, we store that literal as UTC (see
 * `parseDateTimeLocalValue`) and render it back as UTC, so what is displayed
 * is exactly what was entered. `APP_TIME_ZONE` is that wall-clock pin, and
 * the default for any caller that has not been handed a church.
 */

/**
 * The pin for meeting wall clocks and for any surface that has not been
 * handed a church zone. Church-scoped instants take the church's IANA zone
 * as an argument instead — they do not read this constant.
 */
export const APP_TIME_ZONE = "UTC";

/**
 * The IANA zone a new church is born with, and the backfill for every church
 * that predates the column. Changed in church settings; never inferred from
 * the address.
 */
export const DEFAULT_CHURCH_TIME_ZONE = "America/Chicago";

const LOCALE = "en-US";

/** `"long"` for detail views, `"short"` for dense lists and cards. */
export type DateVariant = "long" | "short";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  key: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(LOCALE, options);
  formatterCache.set(key, created);
  return created;
}

/**
 * Whether `id` is an IANA time zone `Intl` will accept.
 *
 * The write path is the only caller that must reject: a stored invalid id
 * would throw from every formatter on the next render. `Intl` is the
 * authority — a hand-maintained list would drift from the runtime.
 */
export function isValidTimeZone(id: string): boolean {
  if (id === "") return false;
  try {
    formatter(`valid:${id}`, { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * IANA zones grouped by region, America first, for the church-settings
 * control. Labels keep the id (underscores as spaces) so the stored value
 * and the shown value are the same name.
 */
export function groupedTimeZones(): {
  region: string;
  zones: { id: string; label: string }[];
}[] {
  const groups = new Map<string, { id: string; label: string }[]>();
  for (const id of Intl.supportedValuesOf("timeZone")) {
    const region = id.split("/")[0] ?? id;
    const list = groups.get(region) ?? [];
    list.push({ id, label: id.replaceAll("_", " ") });
    groups.set(region, list);
  }

  const preferred = [
    "America",
    "Pacific",
    "Europe",
    "Africa",
    "Asia",
    "Australia",
    "Atlantic",
    "Indian",
    "Etc",
  ];
  const regions = [
    ...preferred.filter((region) => groups.has(region)),
    ...[...groups.keys()]
      .filter((region) => !preferred.includes(region))
      .sort((a, b) => a.localeCompare(b, "en")),
  ];

  return regions.map((region) => ({
    region,
    zones: groups.get(region) ?? [],
  }));
}

function dateFormatter(variant: DateVariant, timeZone: string) {
  if (variant === "long") {
    return formatter(`date:long:${timeZone}`, {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  return formatter(`date:short:${timeZone}`, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dayLongFormatter(timeZone: string) {
  return formatter(`dayLong:${timeZone}`, {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function timeFormatter(timeZone: string) {
  return formatter(`time:${timeZone}`, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function shortDateWithoutWeekday(timeZone: string) {
  return formatter(`shortDate:${timeZone}`, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function longDateTimeFormatter(timeZone: string) {
  return formatter(`dateTime:long:${timeZone}`, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function tileFormatter(timeZone: string) {
  return formatter(`tile:${timeZone}`, {
    timeZone,
    month: "short",
    day: "numeric",
  });
}

/** `"Thursday, July 30, 2026"` (long) / `"Thu, Jul 30, 2026"` (short). */
export function formatDate(
  date: Date,
  variant: DateVariant = "long",
  timeZone: string = APP_TIME_ZONE
): string {
  return dateFormatter(variant, timeZone).format(date);
}

/**
 * `"July 30, 2026"` (long) / `"Jul 30, 2026"` (short) — `formatDate` without
 * the weekday, for dense cards and history rows where the weekday is noise.
 */
export function formatDateWithoutWeekday(
  date: Date,
  variant: DateVariant = "long",
  timeZone: string = APP_TIME_ZONE
): string {
  if (variant === "long") return dayLongFormatter(timeZone).format(date);
  return shortDateWithoutWeekday(timeZone).format(date);
}

/** `"September 14, 2026"` — the long date without its weekday. */
export function formatDayLong(
  date: Date,
  timeZone: string = APP_TIME_ZONE
): string {
  return formatDateWithoutWeekday(date, "long", timeZone);
}

/** `"7:00 PM"`. */
export function formatTime(
  date: Date,
  timeZone: string = APP_TIME_ZONE
): string {
  return timeFormatter(timeZone).format(date);
}

/**
 * `"Thursday, July 30, 2026 at 7:00 PM"` (long) /
 * `"Jul 30, 2026 at 7:00 PM"` (short).
 */
export function formatDateTime(
  date: Date,
  variant: DateVariant = "long",
  timeZone: string = APP_TIME_ZONE
): string {
  if (variant === "long") return longDateTimeFormatter(timeZone).format(date);
  return `${shortDateWithoutWeekday(timeZone).format(date)} at ${formatTime(date, timeZone)}`;
}

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
export function calendarTileParts(
  date: Date,
  timeZone: string = APP_TIME_ZONE
): [month: string, day: string] {
  const parts = tileFormatter(timeZone).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return [valueOf("month"), valueOf("day")];
}

/**
 * The value for an `<input type="datetime-local">`: `"2026-07-30T19:00"`.
 *
 * The inverse of `parseDateTimeLocalValue`, so opening the edit form shows the
 * same wall clock the detail page shows. Meeting datetimes are wall clocks
 * stored as UTC, so this stays on `APP_TIME_ZONE`.
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
 * `APP_TIME_ZONE` because UTC days are exactly 24h and aligned to the epoch.
 * Church-zoned *labels* (`relativeDayOffset` with a zone argument) compare
 * calendar dates in that zone rather than adding this number. A NEW local
 * copy of this constant is the mistake the calendar-day rule stops.
 *
 * THE LINE THIS CONSTANT MAY NOT CROSS. Adding it to an INSTANT means "24
 * hours later", which is a different day in any zone that observes DST: the
 * spring-forward day is 23 hours long and the autumn one 25. So
 * `addCalendarDays` stays on the UTC grid, where the two are the same thing,
 * and anything that needs a wall clock in a real zone goes through
 * `instantAtZonedHour` below instead of arithmetic on this number. Applying it
 * to a CALENDAR DATE STRING is safe and is what `relativeDayOffset` does —
 * `YYYY-MM-DD` parsed as UTC midnight is a day INDEX, not an instant.
 */
export const MS_PER_DAY = 86_400_000;

function calendarDateFormatter(timeZone: string) {
  return formatter(`calendar:${timeZone}`, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * The calendar day of an instant in `timeZone`, as `"YYYY-MM-DD"`.
 *
 * The app's one answer to "which day is this?" — `tasks.due_date` and
 * `launches.target_date` are `date` columns, calendar days rather than
 * instants. Write paths that have not been handed a church still name the
 * `APP_TIME_ZONE` day; church-scoped reads pass the church's zone so a
 * completion at 23:30 in Chicago is Chicago's day, not UTC's.
 *
 * `getFullYear()/getMonth()/getDate()` is the runtime's calendar and is how a
 * planter far enough east pressed "Today" and got tomorrow.
 */
export function toCalendarDate(
  date: Date,
  timeZone: string = APP_TIME_ZONE
): string {
  if (timeZone === APP_TIME_ZONE) return date.toISOString().slice(0, 10);

  const parts = calendarDateFormatter(timeZone).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

/**
 * The calendar day `days` whole days from `from`, as `"YYYY-MM-DD"`.
 *
 * `toCalendarDate(new Date(base.getTime() + n * MS_PER_DAY))` was written out
 * at six call sites; this is that shape, once. Whole days in, whole days out —
 * the hour of `from` never moves the answer by a day, because both ends are
 * measured on the same UTC-aligned grid. Write paths stay on that grid;
 * church-zoned *display* goes through `toCalendarDate(date, churchZone)`.
 */
export function addCalendarDays(from: Date, days: number): string {
  return toCalendarDate(new Date(from.getTime() + days * MS_PER_DAY));
}

// ----------------------------------------------------------------------------
// WALL CLOCKS IN A REAL ZONE — the two primitives, and the only two
// ----------------------------------------------------------------------------
//
// `toCalendarDate` answers "which day is this instant?" in a zone. These answer
// the other two halves: "what hour does this instant read?" and, the inverse,
// "which instant reads this hour on this day?".
//
// They exist because the church-configurable digest send time (N-013) needs a
// period that OPENS at 16:00 in the church's own zone. UTC-grid arithmetic
// cannot express that: `America/New_York` is five or four hours behind
// depending on the date, so "Sunday 16:00 there" is two different UTC instants
// six months apart, and the two DST days each have one hour that either does
// not exist or happens twice.
//
// `Intl` is the only tz database in the runtime, so both are built on it:
// format an instant into the zone's civil fields, and read the offset back off
// the difference. Nothing here hand-maintains a rule about any zone.

function zonedPartsFormatter(timeZone: string) {
  return formatter(`parts:${timeZone}`, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // Without this, `en-US` renders midnight as hour `12` and the whole
    // calculation is off by twelve hours for one hour a day.
    hourCycle: "h23",
  });
}

/** The civil fields `date` shows on the wall clock in `timeZone`. */
function zonedParts(date: Date, timeZone: string) {
  const parts = zonedPartsFormatter(timeZone).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: valueOf("year"),
    month: valueOf("month"),
    day: valueOf("day"),
    hour: valueOf("hour"),
    minute: valueOf("minute"),
    second: valueOf("second"),
  };
}

/**
 * The wall clock `date` shows in `timeZone`, re-encoded as the UTC instant with
 * those same civil fields. The difference from `date` is the zone's offset.
 */
function wallClockOf(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function offsetMsAt(date: Date, timeZone: string): number {
  // `formatToParts` has no milliseconds, so the comparison drops them on both
  // sides rather than reading a whole second of offset that is not there.
  return (
    wallClockOf(date, timeZone) - (date.getTime() - date.getUTCMilliseconds())
  );
}

/** The hour (0–23) `date` reads on the wall clock in `timeZone`. */
export function zonedHour(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).hour;
}

/**
 * The instant at which `calendarDate` (`YYYY-MM-DD`) reads `hour`:00:00 on the
 * wall clock in `timeZone`. The inverse of `toCalendarDate` + `zonedHour`.
 *
 * The offset depends on the answer, so the answer is proposed and checked. Each
 * PROBE instant yields an offset, subtracting it from the naive UTC reading
 * yields a candidate, and a candidate is REAL when re-formatting it in the zone
 * reads back the wall clock asked for.
 *
 * THREE PROBES, one per DST regime the day could sit in: the naive reading
 * itself, and a day either side of it. Two would be enough on the ~364 ordinary
 * days, and were what this function first shipped with — but on a fall-back day
 * in any zone EAST of UTC the naive reading already sits after the transition,
 * so both probes land in the same regime and converge on the SECOND occurrence.
 * The day either side is always in the other regime, so the candidate set
 * contains both occurrences and the rules below can actually choose between
 * them.
 *
 * THE TWO DAYS A YEAR the probes disagree are the whole reason this is a
 * function and not two lines at a call site, and each gets a stated rule:
 *
 *   * **The hour that happens twice** (autumn, the 25-hour day). Several
 *     candidates really do read `hour`, so the EARLIEST is taken — the first
 *     occurrence.
 *   * **The hour that never happens** (spring, the 23-hour day). None of them
 *     reads `hour`, so the LATEST is taken, which is exactly the instant the
 *     clock jumps to. 02:00 on a US spring-forward morning resolves to 03:00.
 *
 * Both rules are chosen so that consecutive days tile the timeline with no gap
 * and no overlap, which is what lets a caller treat `[start, end)` as a
 * partition — see `digestPeriodFor`, whose 15-minute sweep across both
 * transitions in sixteen zones asserts exactly that.
 */
export function instantAtZonedHour(
  calendarDate: string,
  hour: number,
  timeZone: string
): Date {
  const [year, month, day] = calendarDate.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour);

  const candidates = [wall - MS_PER_DAY, wall, wall + MS_PER_DAY].map(
    (probe) => wall - offsetMsAt(new Date(probe), timeZone)
  );
  const real = candidates.filter(
    (candidate) => wallClockOf(new Date(candidate), timeZone) === wall
  );

  return new Date(
    real.length > 0 ? Math.min(...real) : Math.max(...candidates)
  );
}

/**
 * Whole calendar days from `now` to `date`, counted in `timeZone`.
 *
 * Calendar days, not 24-hour blocks: a meeting at 11:30 PM tonight is `0`
 * ("Today"), never `1` ("Tomorrow"), which is what a difference-in-milliseconds
 * calculation would say. Two churches in two zones can disagree about the
 * same pair of instants when they straddle that zone's midnight.
 *
 * DST-safe in any zone, and it is worth naming why, because it looks like the
 * 24-hour arithmetic `MS_PER_DAY` warns about. Both operands are already
 * `YYYY-MM-DD` in `timeZone`; dividing their UTC-midnight parse by `MS_PER_DAY`
 * turns each into a day INDEX on the proleptic Gregorian calendar. No instant
 * is being advanced, so a 23- or 25-hour day cannot move the answer.
 *
 * Only safe to call where a re-render on the client is impossible (server
 * components), since it reads the clock when `now` is omitted.
 */
export function relativeDayOffset(
  date: Date,
  now: Date = new Date(),
  timeZone: string = APP_TIME_ZONE
): number {
  const dayOf = (d: Date) => {
    const iso = toCalendarDate(d, timeZone);
    return Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
  };
  return dayOf(date) - dayOf(now);
}

/** `"Today"` / `"Tomorrow"` / `"In 3 days"` / `"Yesterday"` / `"3 days ago"`. */
export function formatRelativeDay(
  date: Date,
  now: Date = new Date(),
  timeZone: string = APP_TIME_ZONE
): string {
  const days = relativeDayOffset(date, now, timeZone);
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
 * render — and the fallback goes through `formatDate`, which is pinned to the
 * given zone (church zone when plumbed, otherwise `APP_TIME_ZONE`).
 *
 * Future instants are labelled too (`"In 5m"`), so a caller that hands this a
 * scheduled-ahead row gets something honest rather than "0m ago".
 */
export function formatRelativeTimestamp(
  date: Date,
  now: Date = new Date(),
  timeZone: string = APP_TIME_ZONE
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

  return formatDate(date, "short", timeZone);
}
