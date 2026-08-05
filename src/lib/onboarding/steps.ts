/**
 * F12 / OB-001 — the onboarding flow's step model.
 *
 * Pure data and pure functions, deliberately free of React and of the database
 * client, so the two questions that decide what a planter sees — "is this
 * planter still onboarding?" and "which step do they land on?" — are unit
 * testable without a browser or a DB.
 *
 * Step 2 captures the leadership answer (OB-004). Steps 3-4 are filled in by
 * their own workstreams; what lives here is the rule that does not care which
 * of them has landed — `onboardingStepComplete` asks one question per step,
 * and every "where does this planter go?" answer is derived from it.
 */

import { leadershipAnswered, type ChurchLeadershipStatus } from "./leadership";

export const ONBOARDING_STEP_IDS = [
  "basics",
  "leadership",
  "journey",
  "people",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingStep = {
  id: OnboardingStepId;
  /** 1-based, for "Step 2 of 4" and the step rail. */
  number: number;
  title: string;
  /** One line under the title, describing what the step is for. */
  description: string;
  /**
   * OB-007: every step after step 1 can be moved past without answering it.
   * Step 1 is the exception and always will be — it is the step that creates
   * the church row every later step updates, so there is nothing to skip
   * *into*. Declared here rather than inferred from the index so the rule is
   * stated once and read by the flow's controls, not re-derived per component.
   */
  skippable: boolean;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "basics",
    number: 1,
    title: "Church basics",
    description: "Name your church plant and tell us where it is.",
    skippable: false,
  },
  {
    id: "leadership",
    number: 2,
    title: "Leadership",
    description: "Who is leading this plant.",
    skippable: true,
  },
  {
    id: "journey",
    number: 3,
    title: "Your journey",
    description: "Where you are today and when you hope to launch.",
    skippable: true,
  },
  {
    id: "people",
    number: 4,
    title: "Bring your people",
    description: "Add the people already walking with you.",
    skippable: true,
  },
];

export const FIRST_ONBOARDING_STEP: OnboardingStepId = "basics";

export function onboardingStep(id: OnboardingStepId): OnboardingStep {
  const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`unknown onboarding step: ${id}`);
  return step;
}

export function onboardingStepIndex(id: OnboardingStepId): number {
  return ONBOARDING_STEP_IDS.indexOf(id);
}

export function isFirstOnboardingStep(id: OnboardingStepId): boolean {
  return onboardingStepIndex(id) === 0;
}

export function isLastOnboardingStep(id: OnboardingStepId): boolean {
  return onboardingStepIndex(id) === ONBOARDING_STEP_IDS.length - 1;
}

/** OB-007: may this step be moved past without answering it? */
export function isSkippableOnboardingStep(id: OnboardingStepId): boolean {
  return onboardingStep(id).skippable;
}

/** The final step — where "skip everything from here" lands a planter. */
export const LAST_ONBOARDING_STEP: OnboardingStepId =
  ONBOARDING_STEP_IDS[ONBOARDING_STEP_IDS.length - 1];

/** The step after `id`, or `null` when `id` is the last one. */
export function nextOnboardingStep(
  id: OnboardingStepId
): OnboardingStepId | null {
  return ONBOARDING_STEP_IDS[onboardingStepIndex(id) + 1] ?? null;
}

/** The step before `id`, or `null` when `id` is the first one. */
export function previousOnboardingStep(
  id: OnboardingStepId
): OnboardingStepId | null {
  const index = onboardingStepIndex(id);
  return index <= 0 ? null : ONBOARDING_STEP_IDS[index - 1];
}

/**
 * The subset of the signed-in user and their church that decides whether the
 * onboarding flow owns the dashboard. Kept structural (not `User`/`Church`) so
 * the rule can be tested without constructing whole rows.
 */
export type OnboardingViewer = {
  role: string | null | undefined;
  churchId: string | null | undefined;
  /** `null` while the flow still owns the dashboard; a date once it is done. */
  onboardingCompletedAt: Date | null | undefined;
};

/**
 * OB-001 / AC 1: a planter with no church sees the flow as the primary
 * dashboard content — and, because the church is created at step 1 rather than
 * at the end, so does a planter whose church exists but who has not yet
 * finished or skipped out of the flow. That second clause is what makes
 * abandonment safe: the church is already real, and the planter is returned to
 * the flow instead of to a half-configured dashboard.
 *
 * Only planters. Coaches, team members and oversight roles never onboard a
 * church, and churches that existed before migration 0027 were backfilled to a
 * non-null `onboarding_completed_at`, so nobody is retro-enrolled.
 */
export function shouldShowOnboarding(viewer: OnboardingViewer): boolean {
  if (viewer.role !== "planter") return false;
  if (!viewer.churchId) return true;
  return !viewer.onboardingCompletedAt;
}

/**
 * What the database already knows about a plant, expressed as one fact per
 * step. Every field is optional and absent means "not answered", so a caller
 * that has not learned to read a step's fact yet gets the honest answer
 * (incomplete) rather than a wrong one — and adding a fact is a change here and
 * at the one call site that can supply it, never a change to the flow.
 */
export type OnboardingFacts = {
  /** Step 1 — the church row exists. Written by `createChurchBasics`. */
  churchId?: string | null;
  /** Step 2 — OB-004's question has an explicit answer, either way. */
  leadershipStatus?: ChurchLeadershipStatus | null;
  /** Step 3 — the planter declared a stage or a target launch date. */
  journeyDeclared?: boolean | null;
  /** Step 4 — at least one person is on the plant's list (OB-006). */
  peopleAdded?: boolean | null;
};

/**
 * Has this step's fact been captured?
 *
 * The leadership clause reads "answered", not "yes" — a planter who said No
 * has answered step 2 and must resume past it (FRD AC 5). Getting back to it is
 * the dashboard nudge's job, not this function's.
 */
export function onboardingStepComplete(
  id: OnboardingStepId,
  facts: OnboardingFacts
): boolean {
  switch (id) {
    case "basics":
      return !!facts.churchId;
    case "leadership":
      return leadershipAnswered({ leadershipStatus: facts.leadershipStatus });
    case "journey":
      return !!facts.journeyDeclared;
    case "people":
      return !!facts.peopleAdded;
    default: {
      const unknown: never = id;
      throw new Error(`unknown onboarding step: ${String(unknown)}`);
    }
  }
}

/** The steps whose facts are still missing, in flow order. */
export function incompleteOnboardingSteps(
  facts: OnboardingFacts
): OnboardingStepId[] {
  return ONBOARDING_STEP_IDS.filter((id) => !onboardingStepComplete(id, facts));
}

/**
 * Where a planter lands when the flow renders: OB-007's "resumable at the first
 * incomplete step".
 *
 * Skipping is a first-class move, so the step a planter is sent back to is
 * decided by what the church row actually holds, not by how far they once got.
 * A planter who skipped step 2 and abandoned on step 3 comes back to step 2 —
 * the question is still unanswered, and the flow is the place it gets asked.
 *
 * When every fact is in, resumption lands on the LAST step rather than
 * bouncing a finished planter back to step 3: the flow only renders while
 * `onboarding_completed_at` is null, so what they need is the button that
 * leaves it.
 */
export function resolveResumeStep(facts: OnboardingFacts): OnboardingStepId {
  return incompleteOnboardingSteps(facts)[0] ?? LAST_ONBOARDING_STEP;
}
