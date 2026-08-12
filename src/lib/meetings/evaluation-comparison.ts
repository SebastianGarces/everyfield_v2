/**
 * How one evaluated meeting sits against the ones before it (VM-016c).
 *
 * This module imports NOTHING — the rule `copy.ts` keeps outright, and that
 * `agenda.ts` and `meeting-type-filter.ts` keep with a single erased-type
 * allowance. `service.ts` opens with `@/db`, ten schema tables and drizzle, so
 * every symbol in it is one `"use client"` away from dragging that graph into
 * the client bundle, and two unit suites were loading a database client at
 * module scope to exercise arithmetic.
 *
 * The split is by DEPENDENCY, not by topic: the QUERY that fetches the trend
 * (`getEvaluationTrend`) stays in `service.ts` because it touches the database;
 * the window it is called with, the shape of a point, and the comparison itself
 * touch nothing and live here. `service.ts` imports the point type from here
 * and re-exports nothing — a pass-through keeps the coupling this split exists
 * to remove. Import from here.
 */

/** One evaluated meeting on the score trend. */
export interface EvaluationTrendPoint {
  /** Present so a reader can tell WHICH meeting a point is — see below. */
  meetingId: string;
  meetingNumber: number | null;
  totalScore: number;
  datetime: Date;
}

/**
 * How far back the evaluation comparison looks (VM-016c).
 *
 * The comparison is against the trend window, not against all history: a
 * planter with more evaluated meetings than this would be compared to the most
 * recent `EVALUATION_COMPARISON_WINDOW` of them. That is deliberate (ruled
 * 2026-08-10 on #312, the window kept as-is) — the number a planter cares
 * about is "how did this one go against how things have been going".
 *
 * The rendered denominator sentence is `evaluationComparisonDenominatorCopy`
 * in `copy.ts` — it reports what the average covers, and this comment asserts
 * nothing about it.
 *
 * The cost of keeping it: for a church past the window, opening an EARLY
 * meeting hands `compareEvaluationToHistory` a window of only LATER meetings,
 * so it returns `null` even though earlier meetings exist. That is why the
 * empty-state sentence is ruled — it lives in `copy.ts`.
 *
 * This number is never rendered. Round 2 of the same ruling took the window
 * out of the empty-state sentence, so changing it here changes behaviour only
 * — no copy follows it.
 */
export const EVALUATION_COMPARISON_WINDOW = 50;

/** How one evaluated meeting sits against the ones before it (VM-016c). */
export interface EvaluationComparison {
  /** This meeting's own total score. */
  currentScore: number;
  /** How many earlier evaluated meetings the average covers. Always ≥ 1. */
  previousCount: number;
  /** Mean of those earlier scores, to one decimal. */
  previousAverage: number;
  /** The score of the evaluated meeting immediately before this one. */
  previousScore: number;
  /** `currentScore - previousAverage`, to one decimal. Signed. */
  delta: number;
}

/** One decimal, the precision `createEvaluation` stores scores at. */
function toOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Compare one meeting's evaluation against the meetings evaluated before it.
 *
 * Returns `null` when NOTHING IN THE GIVEN TREND is earlier than `current`,
 * which is a different statement from "compared to 0.0" or "0% change".
 * Rendering a delta against an absent history would tell the planter their
 * meeting was a catastrophic drop.
 *
 * `null` is NOT the same as "this is the first evaluated meeting", and no
 * caller may render it as that (ruled 2026-08-10, #312). It has two causes:
 * nothing was evaluated earlier, or everything earlier fell outside the window
 * the caller drew `trend` from. This function is handed an array; it cannot
 * tell the two apart, and neither can the card.
 *
 * "Before" is decided by `datetime`, not by position in the array, and the
 * current meeting is excluded by id — a meeting evaluated on the same day as
 * another must not end up inside its own baseline.
 *
 * `currentScore` is passed in rather than looked up in `trend`, so a meeting
 * that has itself fallen outside the window is still scored correctly against
 * whatever earlier points survived in the window. When none survived, the
 * baseline has not shrunk — it is gone, and the answer is `null`.
 */
export function compareEvaluationToHistory(
  trend: readonly EvaluationTrendPoint[],
  current: { meetingId: string; datetime: Date; totalScore: number }
): EvaluationComparison | null {
  const currentTime = current.datetime.getTime();

  const earlier = trend
    .filter(
      (point) =>
        point.meetingId !== current.meetingId &&
        point.datetime.getTime() < currentTime
    )
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

  if (earlier.length === 0) return null;

  const sum = earlier.reduce((total, point) => total + point.totalScore, 0);
  const previousAverage = toOneDecimal(sum / earlier.length);

  return {
    currentScore: toOneDecimal(current.totalScore),
    previousCount: earlier.length,
    previousAverage,
    previousScore: earlier[earlier.length - 1]!.totalScore,
    // Against the ROUNDED average, so the delta on screen is exactly the
    // subtraction of the two numbers next to it.
    delta: toOneDecimal(toOneDecimal(current.totalScore) - previousAverage),
  };
}
