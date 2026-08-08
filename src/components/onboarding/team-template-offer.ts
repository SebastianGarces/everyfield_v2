/**
 * F12 / OB-015 — when the onboarding finish screen offers the ministry-team
 * templates.
 *
 * The rule lives in its own module, free of React, because it is the whole
 * requirement: "declared phase ≥ 2 shows the offer; phase 0–1 never sees it."
 * Inlined into the flow's JSX it would be a comparison nobody can test without
 * a browser; here it is one function with a name, and `team-template-offer.test.ts`
 * pins both ends of the boundary.
 *
 * WHY 2. The offer creates the standard ministry teams and their role
 * descriptions — a structure that only means anything once there are people to
 * put in it. Phase 2 is Launch Team Formation: the point at which the core
 * group is becoming a team and leaders are being named (`JOURNEY_STAGE_OPTIONS`,
 * `src/lib/onboarding/steps.ts`). A planter still discerning the call (0) or
 * gathering a core group (1) would be handed ten empty teams as their first
 * view of EveryField, which is the opposite of the "meet planters where they
 * are" premise the whole flow is built on. They lose nothing: /teams offers the
 * same initialization whenever they get there.
 */

/** The declared phase at which the offer starts appearing. */
export const TEAM_TEMPLATE_OFFER_MIN_PHASE = 2;

/**
 * Does a planter who declared `phase` get the offer?
 *
 * `null`/`undefined` means "we do not know what they declared" — a planter who
 * skipped step 3, or who is finishing without having passed through it — and
 * the answer there is NO. Guessing high would push ten teams on a plant that
 * never said it was ready for them; guessing at all is worse than the /teams
 * button they already have.
 *
 * Anything that is not a whole number is refused for the same reason rather
 * than coerced: the only honest answers to "did they declare 2 or more?" are
 * yes and no.
 */
export function shouldOfferTeamTemplates(
  phase: number | null | undefined
): boolean {
  if (typeof phase !== "number" || !Number.isInteger(phase)) return false;
  return phase >= TEAM_TEMPLATE_OFFER_MIN_PHASE;
}
