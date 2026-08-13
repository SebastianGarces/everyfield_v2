/**
 * Ruled UI copy for the meetings surfaces.
 *
 * These are strings a ruling pins, not data access. They live in their own
 * module — importing nothing from `@/db` or drizzle — for two reasons:
 *
 * 1. LAYER. Their only consumers are React Server Components and the test that
 *    pins the rulings (`ruled-copy.test.ts`). Keeping them in `service.ts`
 *    meant every future ruled string landed in the 1.7k-line data-access
 *    module by precedent.
 * 2. BOUNDARY. `service.ts` opens by importing `@/db`, ten schema tables,
 *    drizzle and `src/lib/tasks/events`. The moment a card that renders one of
 *    these strings becomes interactive and gains `"use client"`, that whole
 *    graph would follow the import edge into the client bundle. A copy module
 *    cannot drag anything.
 *
 * That boundary is ENFORCED, not merely described — but not by the compiler.
 * `import "server-only"` is unusable in `service.ts`: the package is a Next.js
 * build-time alias with no `react-server` export condition under `pnpm test`,
 * so adding it makes five test files unresolvable, and forcing the condition on
 * the runner breaks every suite that renders email with `react-dom/server`.
 * `ruled-copy.test.ts` walks every `"use client"` module in `src` instead and
 * fails if one value-imports `service.ts`. See the accepted residual in
 * `memory/invariants.md` → Meetings — Evaluation Comparison.
 *
 * `service.ts` deliberately does NOT re-export these: a pass-through keeps the
 * coupling this module exists to remove and adds a second name for one string.
 * Import them from here. `agenda.ts` is the same module shape for the agenda's
 * bounds, clamp and reader, which the client component needs too.
 *
 * The rulings themselves are recorded in `memory/invariants.md` → Meetings —
 * Evaluation Comparison, and asserted in `src/lib/meetings/ruled-copy.test.ts`.
 */

/**
 * What the comparison card says when it has no baseline (ruled 2026-08-10 on
 * #312, round 2).
 *
 * It lives here, as a plain string, because it is the one sentence in the
 * feature that a ruling pins. A test can import and compare it; a sentence
 * built inline in JSX can only be re-parsed out of the source, and a test that
 * parses JSX starts failing for reasons that have nothing to do with the
 * ruling.
 *
 * Two properties this string must keep, both of them the ruling itself:
 *
 * 1. It never says "first". `compareEvaluationToHistory` returns `null` for two
 *    different reasons — nothing was evaluated earlier, or everything earlier
 *    fell outside `EVALUATION_COMPARISON_WINDOW` — and the card cannot tell
 *    them apart. One sentence has to be true of both.
 * 2. It names no window and no number. The window is a mechanism the planter
 *    did not ask about; it stays in code, named only by
 *    `EVALUATION_COMPARISON_WINDOW` in `evaluation-comparison.ts`.
 */
export const EVALUATION_COMPARISON_EMPTY_COPY =
  "No comparison available — no earlier evaluated meeting to compare against.";

/**
 * What the POPULATED comparison card says under the numbers (ruled 2026-08-12
 * on #312, decision 1, option B).
 *
 * It reports what the average COVERS, not what the planter DID. `previousCount`
 * is `earlier.length` from `compareEvaluationToHistory` — the earlier points
 * inside the window `getEvaluationTrend` fetched, not the planter's history. A
 * church with 60 evaluated meetings opening meeting #55 has 54 meetings behind
 * it and a `previousCount` of 44, so the old sentence ("the 44 meetings you
 * evaluated before this one") made a false claim about the planter with a true
 * number. "In view" is true of both cases: window == history, and window <
 * history.
 *
 * That is the same species of false claim the 2026-08-10 ruling took off the
 * EMPTY branch, so the fix is the same shape — the string lives here, and the
 * card renders it. Ruled explicitly: no query change and no extra state. The
 * singular form is not a new branch on the data; it is the pre-existing
 * grammar branch this sentence already carried.
 */
export function evaluationComparisonDenominatorCopy(
  previousCount: number
): string {
  const meetings =
    previousCount === 1
      ? "one earlier meeting"
      : `${previousCount} earlier meetings`;

  return `Scores are out of 5.0. The average covers the ${meetings} in view.`;
}

/**
 * The title of the meeting-detail card backed by `getFollowUpCompletion`
 * (ruled 2026-08-12 on #312, decision 2, option A).
 *
 * It used to read "Follow-up completion", which promised more than the query
 * counts. `meetingLinkedTaskConditions` admits only `related_type = 'meeting'`
 * rows, and the one such task the product ever creates is the single "Complete
 * evaluation for <meeting>" task (`src/lib/tasks/events.ts`). The per-attendee
 * follow-ups minted by the same finalization are linked to the PERSON, so in
 * production the card could only ever read "0 of 1" or "1 of 1" — an
 * evaluation-done indicator wearing the name of a follow-up metric.
 *
 * The ruling keeps the narrow query and renames the card. Widening VM-020 at
 * the generator was considered and explicitly NOT ruled in: if follow-up
 * tracking earns a real metric later, that is its own issue. Widening it in the
 * QUERY stays forbidden for the reason above `meetingLinkedTaskConditions` —
 * joining back through attendance double-counts a person who attended two
 * meetings.
 */
export const MEETING_EVALUATION_TASK_CARD_TITLE = "Evaluation task";

/**
 * The progress line under that card: "1 of 1 task complete".
 *
 * One function so there is exactly ONE grammar branch. The sentence used to be
 * assembled in the page's JSX, which cost twice: the `Progress` bar carried a
 * second, drifted copy in an `aria-label` (hardcoded "tasks" while the visible
 * line branched on `total === 1`), and the test that policed it could only read
 * the page's source text — including a regex over the ternary's exact shape,
 * which a Prettier re-wrap breaks with no behaviour change.
 *
 * As a value it is asserted by equality, and the bar names it with
 * `aria-labelledby` instead of restating it.
 *
 * The singular is not an edge case here. `meetingLinkedTaskConditions` admits
 * only `related_type = 'meeting'` rows and the product creates exactly one such
 * task per meeting, so `total === 1` is the ONLY case a planter reaches — see
 * `MEETING_EVALUATION_TASK_CARD_TITLE` above. The plural stays because the
 * figure is a count and a count that can read 1 can read 2.
 */
export function meetingLinkedTaskProgressCopy(
  completed: number,
  total: number
): string {
  return `${completed} of ${total} ${total === 1 ? "task" : "tasks"} complete`;
}
