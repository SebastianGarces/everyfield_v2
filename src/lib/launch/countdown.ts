// ============================================================================
// The launch countdown — one implementation, and the reason it is not two.
//
// A launch target is a DAY (`launches.target_date`, a `date` column). `asOf` is
// an INSTANT. Subtracting one from the other leaves a fraction of the current
// day in the numerator, and flooring throws it away — so from 00:00:01 UTC
// onward the answer is a full day short, and a plant reads "Launched 1 day ago"
// on the morning of its own launch. That bug shipped twice: once in the
// oversight presentation layer (#303, fixed in PR #339) and once in the
// phase-engine signal layer (#338, fixed by this module).
//
// The rule, from #303's ruling: floor BOTH sides to a UTC midnight, THEN
// subtract. `APP_TIME_ZONE` is UTC (`src/lib/datetime.ts`), so a UTC midnight is
// the app's midnight and the answer does not follow the server's `TZ`.
// ============================================================================

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Parse a yyyy-mm-dd DB date string at UTC midnight (timezone-stable). */
export function parseTargetDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Whole days from `asOf` to a yyyy-mm-dd launch target; negative once past,
 * `null` when there is no target (or the stored value is unparseable).
 *
 * Day-vs-day, never day-vs-instant — see the header. Because both operands are
 * exact UTC midnights the quotient is a whole number already; it is rounded
 * rather than floored so a DST-free but leap-second-adjacent runtime cannot
 * shave it.
 */
export function daysUntilTarget(
  targetDate: string | null,
  asOf: Date
): number | null {
  if (!targetDate) return null;
  const target = parseTargetDate(targetDate);
  if (Number.isNaN(target.getTime())) return null;
  const todayUtc = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate()
  );
  return Math.round((target.getTime() - todayUtc) / MS_PER_DAY);
}
