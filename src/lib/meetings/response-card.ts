import type { ResponseCardType } from "@/db/schema/meetings";

// ============================================================================
// VM-014 — the ONE response-card vocabulary, and the breakdown arithmetic.
//
// A db-free sibling of `service.ts` (memory/invariants.md → Meetings), because
// BOTH surfaces need it and one of them is a `"use client"` island: the capture
// control in the attendance workflow, and the read-only summary on the Outcomes
// tab. `service.ts` opens with `@/db` and the schema barrel, so a component that
// took the labels from there would ship drizzle to the browser.
//
// The `ResponseCardType` import is TYPE-ONLY and must stay that way — it is
// erased at compile time, so it adds no bundle edge (`ruled-copy.test.ts` names
// this file's allowance; `client-boundary.test.ts` walks the value edges).
//
// WHAT IS DECLARED ONCE HERE: the five options with their labels, the parser,
// and the arithmetic that turns raw counts into the rows a surface renders. The
// zod enum, the capture control, the summary and the counts test are all BUILT
// from `RESPONSE_CARD_OPTIONS`, so a sixth response type is one entry here plus
// a CHECK widened in a migration — never a sixth hand-written list.
// ============================================================================

export interface ResponseCardOption {
  value: ResponseCardType;
  /** What the planter picks, and what the breakdown row is headed. */
  label: string;
  /**
   * The printed card's own wording, so whoever keys a card in is matching a
   * sentence they are holding rather than guessing which label means which box.
   * `not_interested` has no printed box — see the schema comment.
   */
  description: string;
}

/**
 * Strongest commitment first. The ORDER is the rule, not a detail: the
 * breakdown renders in this order, so a planter reads the room top-down from
 * "ready to join" to "not for me" and the shape of the meeting is the shape of
 * the list.
 */
export const RESPONSE_CARD_OPTIONS: readonly ResponseCardOption[] = [
  {
    value: "ready_commit",
    label: "Ready to commit",
    description: "I want to join the core group.",
  },
  {
    value: "interested",
    label: "Wants to learn more",
    description: "I'd like to learn more about the church plant.",
  },
  {
    value: "prayer_request",
    label: "Asked for prayer",
    description: "I'd like someone to pray for me.",
  },
  {
    value: "stay_informed",
    label: "Wants updates",
    description: "Please add me to the email list.",
  },
  {
    value: "not_interested",
    label: "Not interested",
    description: "Told us in the room that this is not for them.",
  },
];

/**
 * The label for a stored value, read through `Object.hasOwn` rather than a bare
 * index.
 *
 * `meetings/labels.ts` learned this the hard way: `"constructor"` reached
 * `Object.prototype` and returned a defined value the `??` fallback never
 * caught. A response type arrives from a form post, so it is untrusted input on
 * exactly that path.
 */
export function responseCardLabel(value: string): string {
  const table = RESPONSE_CARD_LABELS;
  return Object.hasOwn(table, value) ? table[value as ResponseCardType] : value;
}

const RESPONSE_CARD_LABELS: Record<ResponseCardType, string> =
  Object.fromEntries(
    RESPONSE_CARD_OPTIONS.map((option) => [option.value, option.label])
  ) as Record<ResponseCardType, string>;

/**
 * A caller-supplied value as a response type, or `null`.
 *
 * PARSED, never cast. `response_type` carries a CHECK constraint, so a cast let
 * a typo'd value reach the database and fail as a raw driver error in front of
 * a planter — the same mistake `parseMeetingType` exists to stop.
 */
export function parseResponseCardType(value: unknown): ResponseCardType | null {
  if (typeof value !== "string") return null;
  const match = RESPONSE_CARD_OPTIONS.find((option) => option.value === value);
  return match ? match.value : null;
}

/** Counts keyed by response type, as the breakdown query returns them. */
export type ResponseCardCounts = Partial<Record<ResponseCardType, number>>;

export interface ResponseBreakdownRow {
  value: ResponseCardType;
  label: string;
  description: string;
  count: number;
  /**
   * This row's share of the cards that CAME BACK, 0–100, or `null` when none
   * did. Never a share of attendance: a meeting where four of nineteen people
   * handed in a card has four data points, not fifteen silent ones.
   *
   * `null` rather than `0` when the denominator is zero, on the same rule as
   * the communication figures: "0%" claims something about a count that was
   * never taken (memory/invariants.md → Communication).
   */
  share: number | null;
}

export interface ResponseBreakdown {
  /** Everyone marked attended — the population the cards came out of. */
  attendeeCount: number;
  /** Attendees whose card was keyed in. */
  recordedCount: number;
  /**
   * Attendees with NO card recorded.
   *
   * ITS OWN NUMBER, never folded into `not_interested`. VM-014's acceptance
   * criterion is exactly this distinction: a planter who did not get a card
   * back learned nothing, and reporting that silence as a refusal invents a no
   * that nobody said.
   *
   * Floored at zero as DEFENCE IN DEPTH, not as the fix for anything: the two
   * queries that feed this function count one population, so `recordedCount`
   * cannot exceed `attendeeCount` (see `meetingResponseCountsQuery` and
   * `meetingAttendedCountQuery` in `service.ts`). The floor is what stops a
   * FUTURE caller that computes its counts some other way rendering a negative
   * — it never again stands in for a denominator that is missing people.
   */
  notRecordedCount: number;
  /** One row per option, in `RESPONSE_CARD_OPTIONS` order, zero counts kept. */
  rows: ResponseBreakdownRow[];
}

/**
 * Turn raw per-type counts into the rows a surface renders.
 *
 * Pure, so the whole "absence is not a refusal" rule is assertable without a
 * database or a browser. ZERO-COUNT ROWS ARE KEPT: a breakdown that hid them
 * would change shape between meetings, and "nobody was ready to commit" is a
 * finding a planter needs to see rather than an absence they have to notice.
 */
export function buildResponseBreakdown(
  counts: ResponseCardCounts,
  attendeeCount: number
): ResponseBreakdown {
  const rows = RESPONSE_CARD_OPTIONS.map((option) => ({
    option,
    count: Math.max(counts[option.value] ?? 0, 0),
  }));

  const recordedCount = rows.reduce((total, row) => total + row.count, 0);

  return {
    attendeeCount,
    recordedCount,
    notRecordedCount: Math.max(attendeeCount - recordedCount, 0),
    rows: rows.map(({ option, count }) => ({
      value: option.value,
      label: option.label,
      description: option.description,
      count,
      share:
        recordedCount === 0
          ? null
          : Math.round((count / recordedCount) * 1000) / 10,
    })),
  };
}

// ----------------------------------------------------------------------------
// Ruled copy
// ----------------------------------------------------------------------------

/**
 * The empty state. It says the cards have not been KEYED IN, never that nobody
 * responded — the two are indistinguishable from here, and the second is a
 * claim about a meeting this screen cannot make.
 */
export const RESPONSE_SUMMARY_EMPTY_COPY =
  "No response cards recorded yet. Record what people handed in on the Attendance tab and the breakdown appears here.";

/** The row heading for attendees whose card never arrived. */
export const RESPONSE_NOT_RECORDED_LABEL = "No card recorded";

/**
 * …and why that is not a refusal, said out loud on the screen rather than left
 * for the reader to infer from a row title.
 */
export const RESPONSE_NOT_RECORDED_COPY =
  "Not a no — these attendees handed nothing in, so the meeting says nothing about them either way.";
