/**
 * #312 / VM-016c — what should a planter see when the meetings evaluated
 * BEFORE this one sit outside the 50-meeting comparison window?
 *
 * Four directions over the same data. The shipped comparison maths is copied
 * verbatim from `src/lib/meetings/service.ts` (compareEvaluationToHistory) so
 * every direction is judged on the same arithmetic — only the history each one
 * is given, and the copy each one renders, differ.
 *
 * Throwaway. Nothing here merges.
 */

export interface EvaluatedMeeting {
  meetingId: string;
  meetingNumber: number;
  totalScore: number;
  datetime: Date;
}

export interface Comparison {
  currentScore: number;
  previousCount: number;
  previousAverage: number;
  previousScore: number;
  delta: number;
}

export const EVALUATION_COMPARISON_WINDOW = 50;

const toOneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** VERBATIM from the shipped service. Do not "improve" it here. */
export function compareEvaluationToHistory(
  trend: readonly EvaluatedMeeting[],
  current: { meetingId: string; datetime: Date; totalScore: number }
): Comparison | null {
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
    delta: toOneDecimal(toOneDecimal(current.totalScore) - previousAverage),
  };
}

/** The shipped read: the N most recent evaluated meetings, church-wide. */
export function getEvaluationTrend(
  all: readonly EvaluatedMeeting[],
  limit: number
): EvaluatedMeeting[] {
  return [...all]
    .sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
    .slice(0, limit)
    .reverse();
}

/** The read direction B would need instead: the N evaluated meetings BEFORE this one. */
export function getEvaluationTrendBefore(
  all: readonly EvaluatedMeeting[],
  before: Date,
  limit: number
): EvaluatedMeeting[] {
  return [...all]
    .filter((m) => m.datetime.getTime() < before.getTime())
    .sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
    .slice(0, limit)
    .reverse();
}

// ---------------------------------------------------------------------------
// What the card renders
// ---------------------------------------------------------------------------

export interface RenderedCard {
  /** `data-testid` the card would carry — the state, in one token. */
  testid: string;
  /** Headline line, or null for an empty state. */
  headline: string | null;
  /** The three figures, or an empty list. */
  figures: string[];
  /** The prose the planter actually reads. */
  prose: string;
  /** True when the planter is told something that is not true of their data. */
  lies: boolean;
  /** How many earlier meetings the rendered average covers; null on an empty state. */
  baselineCount: number | null;
  /** Reads/queries this direction costs per page view. */
  cost: string;
}

const populated = (c: Comparison, cost: string): RenderedCard => {
  const sign = c.delta > 0 ? "+" : c.delta < 0 ? "−" : "";
  const way =
    c.delta > 0
      ? "above your previous average"
      : c.delta < 0
        ? "below your previous average"
        : "level with your previous average";
  return {
    testid: "evaluation-comparison",
    headline: `${sign}${Math.abs(c.delta).toFixed(1)} ${way}`,
    figures: [
      `This meeting ${c.currentScore.toFixed(1)}`,
      `Previous meeting ${c.previousScore.toFixed(1)}`,
      `Average of previous ${c.previousCount} = ${c.previousAverage.toFixed(1)}`,
    ],
    prose: `Scores are out of 5.0. The average covers the ${
      c.previousCount === 1 ? "one meeting" : `${c.previousCount} meetings`
    } you evaluated before this one.`,
    lies: false,
    baselineCount: c.previousCount,
    cost,
  };
};

const FIRST_EVER =
  "No comparison yet — this is the first meeting you have evaluated. " +
  "Evaluate another and this card shows how the scores move.";

export interface Direction {
  key: string;
  name: string;
  blurb: string;
  render: (
    all: readonly EvaluatedMeeting[],
    current: EvaluatedMeeting
  ) => RenderedCard;
}

export const DIRECTIONS: Direction[] = [
  {
    key: "a",
    name: "Ship as-is (what is on the branch today)",
    blurb:
      "Window = the 50 most recent evaluated meetings church-wide. Anything with no earlier point inside that window renders the first-ever empty state.",
    render: (all, current) => {
      const trend = getEvaluationTrend(all, EVALUATION_COMPARISON_WINDOW);
      const comparison = compareEvaluationToHistory(trend, current);
      if (comparison)
        return populated(comparison, "1 read (shared, capped 50)");
      const hasEarlier = all.some(
        (m) =>
          m.meetingId !== current.meetingId &&
          m.datetime.getTime() < current.datetime.getTime()
      );
      return {
        testid: "evaluation-comparison-empty",
        headline: null,
        figures: [],
        prose: FIRST_EVER,
        lies: hasEarlier,
        baselineCount: null,
        cost: "1 read (shared, capped 50)",
      };
    },
  },
  {
    key: "b",
    name: "History relative to THIS meeting",
    blurb:
      "Change the read: the 50 evaluated meetings immediately BEFORE this one (datetime < current, newest first, limit 50). A comparison always appears when any earlier evaluation exists.",
    render: (all, current) => {
      const trend = getEvaluationTrendBefore(
        all,
        current.datetime,
        EVALUATION_COMPARISON_WINDOW
      );
      const comparison = compareEvaluationToHistory(trend, current);
      if (comparison)
        return populated(comparison, "1 read (per-meeting, capped 50)");
      return {
        testid: "evaluation-comparison-empty",
        headline: null,
        figures: [],
        prose: FIRST_EVER,
        lies: false,
        baselineCount: null,
        cost: "1 read (per-meeting, capped 50)",
      };
    },
  },
  {
    key: "c",
    name: "Keep the window, name the third state",
    blurb:
      "Window unchanged. The comparison returns a discriminated result, so the card can distinguish 'nothing before this' from 'the earlier meetings are outside the window'. Needs one extra existence check and NEW COPY nobody has written.",
    render: (all, current) => {
      const trend = getEvaluationTrend(all, EVALUATION_COMPARISON_WINDOW);
      const comparison = compareEvaluationToHistory(trend, current);
      if (comparison)
        return populated(comparison, "1 read + 1 exists-check (capped 50)");
      const hasEarlier = all.some(
        (m) =>
          m.meetingId !== current.meetingId &&
          m.datetime.getTime() < current.datetime.getTime()
      );
      return hasEarlier
        ? {
            testid: "evaluation-comparison-out-of-window",
            headline: null,
            figures: [],
            prose:
              `This meeting is older than your ${EVALUATION_COMPARISON_WINDOW} most recent evaluations, ` +
              "so there is nothing in the comparison window to measure it against. " +
              "Open a recent meeting to see how the scores are moving.",
            lies: false,
            baselineCount: null,
            cost: "1 read + 1 exists-check (capped 50)",
          }
        : {
            testid: "evaluation-comparison-empty",
            headline: null,
            figures: [],
            prose: FIRST_EVER,
            lies: false,
            baselineCount: null,
            cost: "1 read + 1 exists-check (capped 50)",
          };
    },
  },
  {
    key: "d",
    name: "Keep the behaviour, fix only the sentence",
    blurb:
      "No query change, no new state. One empty state that never claims 'first' — it says there is nothing to compare against, which is true in both cases.",
    render: (all, current) => {
      const trend = getEvaluationTrend(all, EVALUATION_COMPARISON_WINDOW);
      const comparison = compareEvaluationToHistory(trend, current);
      if (comparison)
        return populated(comparison, "1 read (shared, capped 50)");
      return {
        testid: "evaluation-comparison-empty",
        headline: null,
        figures: [],
        prose:
          "No comparison to show for this meeting — there are no earlier evaluations to measure it against. " +
          "Evaluate another meeting and this card shows how the scores move.",
        lies: false,
        baselineCount: null,
        cost: "1 read (shared, capped 50)",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Scenarios — the contentious cases, preloaded
// ---------------------------------------------------------------------------

const day = (n: number): Date => new Date(Date.UTC(2024, 0, 1 + n * 7));

/** Deterministic scores that wobble around 4.2, so deltas are readable. */
const scoreFor = (n: number): number => toOneDecimal(3.6 + ((n * 7) % 13) / 10);

const church = (count: number): EvaluatedMeeting[] =>
  Array.from({ length: count }, (_, i) => ({
    meetingId: `m${i + 1}`,
    meetingNumber: i + 1,
    totalScore: scoreFor(i + 1),
    datetime: day(i + 1),
  }));

export interface Scenario {
  key: string;
  name: string;
  why: string;
  all: EvaluatedMeeting[];
  currentId: string;
}

const SMALL = church(4);
const BIG = church(60);

export const SCENARIOS: Scenario[] = [
  {
    key: "1",
    name: "Today's reality — 4 evaluated meetings, opening #3",
    why: "Every church in the database is here. The largest has 4 evaluated meetings, so all four directions must agree.",
    all: SMALL,
    currentId: "m3",
  },
  {
    key: "2",
    name: "True first-ever meeting (4 evaluated, opening #1)",
    why: "The state VM-016c's AC actually asserts. No direction may regress it.",
    all: SMALL,
    currentId: "m1",
  },
  {
    key: "3",
    name: "60 evaluated, opening #3 — the hole",
    why: "The window holds meetings 11-60. Nothing earlier than #3 is in it, so the shipped code returns null and calls #3 the first meeting ever evaluated. It is the third.",
    all: BIG,
    currentId: "m3",
  },
  {
    key: "4",
    name: "60 evaluated, opening #12 — the truncated baseline",
    why: "The window holds 11-60, so exactly one earlier point survives. The shipped card DOES populate here — and tells the planter the average covers the one meeting they evaluated before this one. Eleven did.",
    all: BIG,
    currentId: "m12",
  },
  {
    key: "5",
    name: "60 evaluated, opening #60 — the normal case",
    why: "The meeting a planter opens most often. Every direction must give the same figures here, or it is changing the answer people already read.",
    all: BIG,
    currentId: "m60",
  },
];
