import type {
  PersonTeamAssignment,
  PersonTrainingItem,
} from "@/lib/ministry-teams/service";

/**
 * Presentation helpers for the person profile's Teams & Training tab.
 *
 * Kept free of JSX and of the database so the ordering and counting rules —
 * the parts that are easy to break silently — can be unit tested.
 */

export interface TrainingSummary {
  /** Programs that apply to this person. */
  total: number;
  /** Applicable programs with a `training_completions` row. */
  completed: number;
  /** Applicable programs flagged `isRequired`. */
  requiredTotal: number;
  /** Required programs with a `training_completions` row. */
  requiredCompleted: number;
  /**
   * 0-100. Measures required training when any is required, otherwise all
   * applicable training. 0 when there is nothing to complete.
   */
  percentComplete: number;
}

/**
 * Count completed vs. required training for one person.
 */
export function summarizeTraining(
  items: PersonTrainingItem[]
): TrainingSummary {
  const total = items.length;
  const completed = items.filter((item) => item.completedAt !== null).length;
  const required = items.filter((item) => item.isRequired);
  const requiredTotal = required.length;
  const requiredCompleted = required.filter(
    (item) => item.completedAt !== null
  ).length;

  const [numerator, denominator] =
    requiredTotal > 0 ? [requiredCompleted, requiredTotal] : [completed, total];

  return {
    total,
    completed,
    requiredTotal,
    requiredCompleted,
    percentComplete:
      denominator === 0 ? 0 : Math.round((numerator / denominator) * 100),
  };
}

/**
 * Order training for scanning: outstanding required work first, then the rest
 * of the outstanding work, then what is already done — alphabetical within
 * each group so the list is stable between renders.
 */
export function sortTrainingItems(
  items: PersonTrainingItem[]
): PersonTrainingItem[] {
  const rank = (item: PersonTrainingItem) => {
    if (item.completedAt !== null) return 2;
    return item.isRequired ? 0 : 1;
  };

  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) || a.programName.localeCompare(b.programName, "en")
  );
}

/**
 * Order team assignments alphabetically by team, then by role, so a person on
 * several teams reads predictably.
 */
export function sortTeamAssignments(
  assignments: PersonTeamAssignment[]
): PersonTeamAssignment[] {
  return [...assignments].sort(
    (a, b) =>
      a.teamName.localeCompare(b.teamName, "en") ||
      a.roleName.localeCompare(b.roleName, "en")
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The one date formatter for the Teams & Training tab — membership start dates
 * and training completions both go through it.
 *
 * Two input shapes, one output:
 *
 * - A `date` column arrives as `YYYY-MM-DD` and is read straight off the
 *   string. Handing it to `Date` would parse it as UTC midnight and shift the
 *   day backwards for anyone west of Greenwich.
 * - A `timestamp` column arrives as a `Date` and is read through the local-time
 *   getters. Going via `toISOString()` would pin the day to UTC, so a
 *   completion recorded at 23:30 local would display as the following day.
 *
 * "Local" is the timezone of whatever runtime renders the card. Both callers
 * are server components today, so that is the server's zone (UTC on Vercel),
 * not the viewer's. Showing a viewer's — or a church's — own calendar day
 * needs a timezone decision this helper cannot make on its own.
 *
 * Returns null for a missing or unparseable value so the caller can omit it.
 */
export function formatCalendarDate(
  value: Date | string | null | undefined
): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    const monthName = MONTHS[value.getMonth()];
    if (!monthName) return null;

    return `${monthName} ${value.getDate()}, ${value.getFullYear()}`;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;

  return `${monthName} ${Number(day)}, ${year}`;
}
