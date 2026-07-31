/**
 * F12 / OB-001 — the onboarding flow's step model.
 *
 * Pure data and pure functions, deliberately free of React and of the database
 * client, so the two questions that decide what a planter sees — "is this
 * planter still onboarding?" and "which step do they land on?" — are unit
 * testable without a browser or a DB.
 *
 * Step 2 captures the leadership answer (OB-004). Steps 3-4 are still shells:
 * declared, ordered, skippable and navigable, but capturing nothing yet.
 * Issues #205-#210 fill them in, and when they do, `resolveResumeStep` is the
 * one place that learns to send a returning planter to the first step whose
 * facts are still missing.
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
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "basics",
    number: 1,
    title: "Church basics",
    description: "Name your church plant and tell us where it is.",
  },
  {
    id: "leadership",
    number: 2,
    title: "Leadership",
    description: "Who is leading this plant.",
  },
  {
    id: "journey",
    number: 3,
    title: "Your journey",
    description: "Where you are today and when you hope to launch.",
  },
  {
    id: "people",
    number: 4,
    title: "Bring your people",
    description: "Add the people already walking with you.",
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
 * Where a planter lands when the flow renders.
 *
 * One clause per fact the flow has learned to capture: the church row exists
 * (step 1), the leadership question has been answered (step 2, OB-004). As
 * #205-#210 land, each adds its fact here (stage declared, people added) and
 * resumption gets finer-grained; nothing outside this function has to change.
 *
 * The leadership clause reads "answered", not "yes" — a planter who said No
 * has answered step 2 and must resume past it (FRD AC 5). Getting back to it is
 * the dashboard nudge's job, not this function's.
 */
export function resolveResumeStep(viewer: {
  churchId: string | null | undefined;
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
}): OnboardingStepId {
  if (!viewer.churchId) return "basics";
  if (!leadershipAnswered(viewer)) return "leadership";
  return "journey";
}
