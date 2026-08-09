import {
  TEAM_TEMPLATES,
  getTotalRoleTemplateCount,
} from "@/lib/ministry-teams/role-templates";

/**
 * F12 / OB-015 — when the onboarding finish screen offers the ministry-team
 * templates, and what the offer says it will create.
 *
 * The rule lives in its own module, free of React, because it is the whole
 * requirement: "declared phase ≥ 2 AND the teams are not initialized shows the
 * offer; phase 0–1 never sees it." Inlined into the flow's JSX it would be two
 * comparisons nobody can test without a browser; here it is one function with a
 * name, and `team-template-offer.test.ts` pins every edge of it.
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
 *
 * WHY STATE, NOT PATH (ruling 2026-08-09). The first build asked "did the
 * planter declare a phase IN THIS VISIT", so a planter who declared phase 3 on
 * Monday and resumed onboarding on Tuesday finished with no offer at all —
 * their answer was on the church row the whole time, and the flow was looking
 * at a variable instead. The inputs below are therefore both facts about the
 * PLANT, read on the server for every render of the flow: what phase it is in,
 * and whether it already has teams.
 */

/** The declared phase at which the offer starts appearing. */
export const TEAM_TEMPLATE_OFFER_MIN_PHASE = 2;

/**
 * Is `phase` far enough along for the offer?
 *
 * `null`/`undefined` means "we do not know what they declared" — a plant with
 * no church row yet — and the answer there is NO. Guessing high would push ten
 * teams on a plant that never said it was ready for them; guessing at all is
 * worse than the /teams button they already have.
 *
 * Anything that is not a whole number is refused for the same reason rather
 * than coerced: the only honest answers to "did they declare 2 or more?" are
 * yes and no.
 */
export function meetsTeamTemplateOfferPhase(
  phase: number | null | undefined
): boolean {
  if (typeof phase !== "number" || !Number.isInteger(phase)) return false;
  return phase >= TEAM_TEMPLATE_OFFER_MIN_PHASE;
}

/**
 * The ruling in full: the finish screen offers the templates when the plant is
 * at phase 2 or later AND does not have teams yet.
 *
 * `teamsInitialized` is "does this plant have ANY ministry team", which is the
 * same question `initializeTeamsWithRolesAction` asks before it writes: the
 * initialization inserts unconditionally, so it refuses a church that already
 * has teams. Offering something that would do nothing is a worse first
 * impression than not offering it, so the two answers are kept identical on
 * purpose — the card appears exactly when pressing it would create something.
 */
export function shouldOfferTeamTemplates({
  declaredPhase,
  teamsInitialized,
}: {
  /** `churches.current_phase` — what the plant says it is in, however it got there. */
  declaredPhase: number | null | undefined;
  /** Does the plant already have at least one ministry team? */
  teamsInitialized: boolean;
}): boolean {
  if (teamsInitialized) return false;
  return meetsTeamTemplateOfferPhase(declaredPhase);
}

/**
 * What the card promises, as ONE string.
 *
 * It is built here rather than interpolated into JSX because the counts are the
 * only variable part of the sentence, and a count next to a JSX expression is
 * exactly where a rendered space goes missing — the defect this screen was
 * blocked for. A plain string cannot lose one, and
 * `team-template-offer.test.ts` asserts no digit ever ends up fused to the word
 * after it.
 *
 * The numbers are read from the same list the initialization writes, so adding
 * a template updates the promise instead of silently breaking it.
 */
export function teamTemplateOfferSummary(
  teamCount: number = TEAM_TEMPLATES.length,
  roleCount: number = getTotalRoleTemplateCount()
): string {
  return (
    `Create the ${teamCount} standard ministry teams — worship, ` +
    `children’s ministry, facilities, small groups and the rest — with ` +
    `${roleCount} role descriptions ready to fill.`
  );
}
