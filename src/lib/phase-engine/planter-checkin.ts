// ============================================================================
// THE PLANTER'S OWN SUSTAINABILITY (#484, C19).
//
// Bryan, on the biggest thing missing from the rubric: "Is the planter
// spiritually healthy? Is his marriage/family surviving the process? Is he
// financially sustainable? Is he building at a pace he can actually maintain?
// I understand that software cannot measure most of that, but I would love some
// periodic planter/coach attestation because a plant can hit every launch
// metric while the planter himself is falling apart."
//
// THIS MODULE IS OUTSIDE THE ENGINE ON PURPOSE. It is filed under
// `lib/phase-engine/` because that is where the concern was raised, and it is
// wired to nothing there: no signal reads it, no snapshot carries it, no judge
// prompt sees it, no oversight payload contains it. `planter-checkin.test.ts`
// sweeps the phase-engine and oversight source and fails if any of them so much
// as names this file.
//
// NOT A NINTH LENS, and not an attestation. `plant_signals` is read by the fact
// snapshot — a row there becomes a fact the judge is handed and a citation a
// network insight can carry. These four answers must be structurally
// unreachable by that pipeline, so they do not live in that table.
//
// EVERYTHING DERIVED HERE IS DETERMINISTIC. The nudges below are computed in
// TypeScript from the planter's own answers. No model reads them, writes them,
// or comments on them — a language model paraphrasing "my marriage is
// struggling" back to somebody is not a feature this product will ship.
// ============================================================================

// BROWSER-SAFE BY CONSTRUCTION. The `"use client"` card imports this module
// for its dimensions, levels and nudge math, so nothing here may reach `@/db`
// (whose module scope calls `neon()` and throws in a browser). The two
// database touches live in `planter-checkin-db.ts`; the type-only import
// below erases at compile time. `client-boundary.bundle.test.ts` holds the
// line for every client module at once.

import type { PlanterCheckin, PlanterCheckinLevel } from "@/db/schema";

/** Bryan's four questions, verbatim and in his order. */
export const CHECKIN_DIMENSIONS = [
  {
    key: "spiritually",
    label: "Spiritually",
    prompt: "How are you doing with the Lord this week?",
  },
  {
    key: "marriageFamily",
    label: "Marriage & family",
    prompt: "How is your marriage and family surviving the process?",
  },
  {
    key: "financially",
    label: "Financially",
    prompt: "Are you financially sustainable right now?",
  },
  {
    key: "pace",
    label: "Pace",
    prompt: "Can you keep this up?",
  },
] as const;

export type CheckinDimension = (typeof CHECKIN_DIMENSIONS)[number]["key"];

/** The three levels, in order of concern. One tap each (#484 D1). */
export const CHECKIN_LEVELS = [
  { value: "steady", label: "Steady" },
  { value: "strained", label: "Strained" },
  { value: "struggling", label: "Struggling" },
] as const satisfies readonly { value: PlanterCheckinLevel; label: string }[];

/** How many weeks the private trend strip shows. */
export const CHECKIN_HISTORY_WEEKS = 12;

/**
 * A run of this many consecutive weeks at `strained` or worse raises the nudge.
 *
 * Three, not two: a hard fortnight is a hard fortnight, and a product that asks
 * "who is caring for you?" every time somebody has a bad week teaches them to
 * answer `steady` to make it stop.
 */
export const CHECKIN_NUDGE_RUN = 3;

// ----------------------------------------------------------------------------
// Weeks
// ----------------------------------------------------------------------------

/**
 * The Monday of the week containing `date`, as `yyyy-mm-dd`.
 *
 * MONDAY, and UTC. The week is an identity here, not a display — it is the
 * unique key that makes answering idempotent — so it must not shift with the
 * reader's timezone. A planter in Auckland and their coach in Dallas have to
 * agree which row "this week" is.
 */
export function weekStartOf(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // getUTCDay: 0 = Sunday. Monday-based, so Sunday belongs to the week behind.
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return utc.toISOString().slice(0, 10);
}

/** The `weekStart` values for the last `weeks` weeks, oldest first. */
export function recentWeekStarts(asOf: Date, weeks: number): string[] {
  const current = new Date(`${weekStartOf(asOf)}T00:00:00.000Z`);
  return Array.from({ length: weeks }, (_, index) => {
    const week = new Date(current);
    week.setUTCDate(week.getUTCDate() - (weeks - 1 - index) * 7);
    return week.toISOString().slice(0, 10);
  });
}

// ----------------------------------------------------------------------------
// Reads and writes
// ----------------------------------------------------------------------------

export interface CheckinAnswer {
  spiritually: PlanterCheckinLevel;
  marriageFamily: PlanterCheckinLevel;
  financially: PlanterCheckinLevel;
  pace: PlanterCheckinLevel;
  note?: string | null;
}

// ----------------------------------------------------------------------------
// The deterministic reading (no LLM, ever)
// ----------------------------------------------------------------------------

/** One dimension's run of consecutive weeks at `strained` or worse. */
export interface CheckinNudge {
  dimension: CheckinDimension;
  label: string;
  weeks: number;
  /** What the strip says. Written here so there is one wording. */
  message: string;
}

const CONCERNING: readonly PlanterCheckinLevel[] = ["strained", "struggling"];

/**
 * Which dimensions have been at `strained` or worse for the last
 * {@link CHECKIN_NUDGE_RUN} weeks running.
 *
 * COUNTED FROM THE MOST RECENT WEEK BACKWARDS, and a gap breaks the run: three
 * hard weeks in the last three is the thing worth naming; three hard weeks
 * scattered across a quarter is a normal season of planting.
 *
 * The wording asks a question rather than issuing advice. The product does not
 * know what a planter should do about a struggling marriage, and pretending
 * otherwise would be worse than saying nothing — but it does know who to point
 * at, which is somebody other than itself.
 */
export function checkinNudges(
  checkins: readonly PlanterCheckin[]
): CheckinNudge[] {
  const newestFirst = [...checkins].reverse();

  return CHECKIN_DIMENSIONS.flatMap((dimension) => {
    let run = 0;
    for (const checkin of newestFirst) {
      if (!CONCERNING.includes(checkin[dimension.key])) break;
      run += 1;
    }

    if (run < CHECKIN_NUDGE_RUN) return [];

    return [
      {
        dimension: dimension.key,
        label: dimension.label,
        weeks: run,
        message: `${dimension.label.toLowerCase()} has been strained ${run} weeks running — who is caring for you?`,
      },
    ];
  });
}

/**
 * This church's row for the week containing `asOf`, or `null` if nobody has
 * answered it yet.
 *
 * THE ROW, NOT A BOOLEAN (#634). The card has to be able to REOPEN a week that
 * was already answered — the write was an upsert from the start, so correcting
 * an answer was always possible and only the affordance was missing. A form
 * reopened with nothing to prefill would blank the note the planter wrote, so
 * the answer itself is what crosses to the card and "answered" is derived from
 * it rather than tracked beside it.
 */
export function thisWeeksCheckin(
  checkins: readonly PlanterCheckin[],
  asOf: Date = new Date()
): PlanterCheckin | null {
  const week = weekStartOf(asOf);
  return (
    checkins.find((checkin) => checkin.weekStart.slice(0, 10) === week) ?? null
  );
}
