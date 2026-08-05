/**
 * F12 / OB-009 — what `/phase` says before the first assessment exists.
 *
 * A plant that has just finished onboarding has no assessment, and the honest
 * reason matters: nothing failed and nothing is missing — the run has not
 * happened yet. Without saying so, the surface reads as "we have nothing for
 * you", which for a planter on day one is indistinguishable from the product
 * being broken.
 *
 * There are two cold starts, and they call for different sentences:
 *
 * - **queued** — `last_material_event_at` is set, so the plant is already
 *   selected by the next run (`assessment/dirty.ts`: never-assessed plants are
 *   always selected, and the stamp is what OB-009 writes when onboarding
 *   completes). The planter has nothing to do but wait.
 * - **quiet** — no material event has ever landed. The plant is still selected
 *   (never assessed = dirty), but there is almost nothing to assess, so the
 *   useful sentence is what to put in front of it.
 *
 * Pure and clock-free so the copy is unit testable, and kept out of the
 * component so the two questions — "is this cold?" and "how do we say it?" —
 * are answered once for whichever surface asks.
 */

/** The cron in `vercel.json`: `0 7 * * *`. Stated once, in the copy's terms. */
export const ASSESSMENT_CADENCE = "Assessments run once a day.";

export type ColdStartInput = {
  /** Has this plant ever completed an assessment? */
  hasAssessment: boolean;
  /** `churches.last_material_event_at` — set once anything material happens. */
  lastMaterialEventAt: Date | null | undefined;
};

export type ColdStartNotice = {
  kind: "queued" | "quiet";
  title: string;
  body: string;
};

/**
 * The notice `/phase` should show, or `null` once an assessment exists — at
 * which point the page has real content and any "coming soon" copy would be a
 * lie about data that is right there.
 */
export function assessmentColdStart(
  input: ColdStartInput
): ColdStartNotice | null {
  if (input.hasAssessment) return null;

  if (input.lastMaterialEventAt) {
    return {
      kind: "queued",
      title: "Your first assessment is on its way",
      body: `Your plant is in the queue. ${ASSESSMENT_CADENCE} Your first read lands on the next one — there is nothing you need to do to trigger it.`,
    };
  }

  return {
    kind: "quiet",
    title: "Your first assessment hasn't run yet",
    body: `${ASSESSMENT_CADENCE} Adding core-group members, holding a vision meeting or attesting your progress all give the first one something to read.`,
  };
}
