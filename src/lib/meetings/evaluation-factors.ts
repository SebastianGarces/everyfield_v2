// ============================================================================
// The evaluation quality factors — one list, three consumers
// ============================================================================
//
// The eight factors a planter scores were declared THREE independent times:
// `evaluation-form.tsx` (key + label + description), `evaluation-summary.tsx`
// (key + label, hand-written again) and `evaluationCreateSchema` in
// `src/lib/validations/meetings.ts` (the same eight keys a third time). A ninth
// factor therefore needed three edits in three directories to be one factor:
// added to the form alone it divided correctly and gated Save correctly, and
// then the summary listed eight of the planter's nine scores while the zod
// schema rejected the ninth field outright.
//
// So the list lives here and the schema is BUILT from it. The form and the
// summary map over it; `evaluationCreateSchema` spreads its keys; `service.ts`
// takes the divisor of the average from its length.
//
// `key` is `EvaluationScoreKey`, derived from the `meeting_evaluations` score
// columns themselves — a typo is a COMPILE error rather than a hidden input
// (`name={factor.key}`) posting a field the schema does not know, which reached
// the planter as "Validation failed" with a fieldError pointing at a control
// they had filled in.
//
// Keep this module free of runtime `@/db` imports: both components that read it
// are `"use client"`, and a value import here would pull schema code into the
// browser bundle. The type-only import below is erased at compile time.
// `ruled-copy.test.ts` lists this file among the db-free siblings and pins that
// allowance; `client-boundary.test.ts` pins the far half.
// ============================================================================

import type { MeetingEvaluation } from "@/db/schema/meetings";

/**
 * A score column of `meeting_evaluations`, read off the row type itself.
 *
 * `totalScore` is a `varchar` and so is excluded by the `number` test — it is
 * the DERIVED average, not a factor a planter rates.
 */
export type EvaluationScoreKey = {
  [K in keyof MeetingEvaluation]-?: K extends `${string}Score`
    ? MeetingEvaluation[K] extends number
      ? K
      : never
    : never;
}[keyof MeetingEvaluation];

/** One rated factor: the column it posts to, and how it is introduced. */
export type EvaluationQualityFactor = {
  key: EvaluationScoreKey;
  label: string;
  description: string;
};

/**
 * The factors a complete evaluation carries, in the order they are asked.
 *
 * `as const satisfies` rather than a plain annotation: `satisfies` makes a key
 * that is not a score column a compile error, and `as const` keeps each key a
 * literal, so `evaluation[factor.key]` on the summary is typed as the `number`
 * it is instead of an index into an unknown column.
 */
export const EVALUATION_QUALITY_FACTORS = [
  {
    key: "attendanceScore",
    label: "Great Attendance",
    description: "Core Group actively inviting",
  },
  {
    key: "locationScore",
    label: "Acceptable Location",
    description: "Easy to find, welcoming, distraction-free",
  },
  {
    key: "logisticsScore",
    label: "Great Logistics",
    description: "Room ready, AV tested, materials prepared",
  },
  {
    key: "agendaScore",
    label: "Clear Agenda",
    description: "Planned in detail, starts and ends on time",
  },
  {
    key: "vibeScore",
    label: "Great Vibe",
    description: "Warm, inviting, enthusiastic",
  },
  {
    key: "messageScore",
    label: "Compelling Message",
    description: "Clear vision presented effectively",
  },
  {
    key: "closeScore",
    label: "Strong Close",
    description: "Non-manipulative call to action",
  },
  {
    key: "nextStepsScore",
    label: "Clear Next Steps",
    description: "Dates and details communicated",
  },
] as const satisfies readonly EvaluationQualityFactor[];

/** The keys the list above actually declares. */
type DeclaredScoreKey = (typeof EVALUATION_QUALITY_FACTORS)[number]["key"];

type AssertNever<T extends never> = T;

/**
 * Compile-time totality: every score column of `meeting_evaluations` is one of
 * the factors above. Adding a ninth column without adding its row here makes
 * this alias's constraint fail, so the list cannot fall behind the table.
 * `ruled-copy.test.ts` asserts the same set at runtime, against the table and
 * against `evaluationCreateSchema`.
 */
export type EveryScoreColumnIsDeclared = AssertNever<
  Exclude<EvaluationScoreKey, DeclaredScoreKey>
>;

/**
 * The rating a star offers, low to high.
 *
 * Written once for the same reason as the list: the form and the summary each
 * carried their own `[1, 2, 3, 4, 5]`, and the form's star labels ("3 out of
 * 5") read the length of its copy.
 */
export const RATINGS = [1, 2, 3, 4, 5] as const;
