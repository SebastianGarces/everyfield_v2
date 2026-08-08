/**
 * F12 / OB-001 — the onboarding flow's step model.
 *
 * Pure data and pure functions, deliberately free of React and of the database
 * client, so the two questions that decide what a planter sees — "is this
 * planter still onboarding?" and "which step do they land on?" — are unit
 * testable without a browser or a DB.
 *
 * Step 2 captures the leadership answer (OB-004), step 3 the journey
 * declaration (OB-003/005) and step 4 the people import (OB-006); what lives
 * here is the rule that does not care which of them has landed —
 * `onboardingStepComplete` asks one question per step, and every "where does
 * this planter go?" answer is derived from it.
 *
 * Step 3's OPTIONS live here too, for the same reason the step model does: what
 * the stage picker offers, and which phase each choice means, is a decision the
 * product made, not a detail of a radio group. Keeping it here means the picker
 * and the write path read the SAME list, and `phaseForJourneyStage` is the one
 * place a submitted value becomes a phase number.
 */

import { PHASES, type PhaseNumber } from "@/lib/constants";
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
  /**
   * Step 3 — the planter declared where they are (OB-003/005). The durable
   * record is the INITIAL DECLARATION row in `phase_transitions`
   * (`isInitialDeclaration`, `src/lib/phase-engine/transitions/service.ts`),
   * because that is the one fact both answers write: "not sure, and no date
   * yet" writes no launch row and leaves `current_phase` at 0, so neither
   * column can tell a planter who answered apart from one who never saw the
   * step.
   */
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

// ============================================================================
// Step 3 — the journey declaration (OB-003 + OB-005)
// ============================================================================

/**
 * The launch-date half of step 3. "No date yet" is an ANSWER, not an empty
 * field — a planter in Discovery genuinely does not have a day, and the FRD
 * asks for that to be sayable rather than inferred from a blank input.
 *
 * `none` writes NOTHING: no launch row, no `planning` placeholder. The launch
 * entity's absence and its `planning` status are already two different facts
 * (`src/lib/phase-engine/signals/queries.ts` — "no launch record at all" vs "a
 * launch being planned with no day named"), and a plant that has not named a
 * day has not started planning a launch either. The countdown reads `null` from
 * `daysUntilTarget` and renders empty rather than zero, which is the AC.
 */
export const LAUNCH_DATE_CHOICES = ["date", "none"] as const;
export type LaunchDateChoice = (typeof LAUNCH_DATE_CHOICES)[number];

export function isLaunchDateChoice(value: unknown): value is LaunchDateChoice {
  return (
    typeof value === "string" &&
    (LAUNCH_DATE_CHOICES as readonly string[]).includes(value)
  );
}

/** The value the stage picker submits for "not sure — start me at the beginning". */
export const JOURNEY_STAGE_NOT_SURE = "not_sure";

/** The phase "not sure" resolves to. Discovery — the beginning (FRD AC). */
export const JOURNEY_STAGE_NOT_SURE_PHASE: PhaseNumber = 0;

export type JourneyStageOption = {
  /** `"0"`…`"6"`, or `not_sure`. A form value, so a string. */
  value: string;
  /** What declaring this option sets `churches.current_phase` to. */
  phase: PhaseNumber;
  /** Plain language — what the planter is actually doing right now. */
  label: string;
  /** One line of "does this sound like us?". */
  hint: string;
  /** The methodology's own name for it, shown small so the two can be matched. */
  phaseName: string;
};

/**
 * The seven phases in plain language, plus the escape hatch (FRD AC).
 *
 * PLAIN LANGUAGE FIRST, methodology name second, and deliberately in that
 * order: a planter arriving at onboarding has not read the Playbook yet, so
 * "Phase 2: Launch Team Formation" is a label they cannot place themselves
 * against. `phaseName` keeps the vocabulary visible so the dashboard header
 * they land on afterwards is recognisable.
 */
export const JOURNEY_STAGE_OPTIONS: readonly JourneyStageOption[] = [
  {
    value: "0",
    phase: 0,
    label: "We are still discerning the call",
    hint: "Praying, learning the ground, looking for a coach. Nobody gathered yet.",
    phaseName: PHASES[0],
  },
  {
    value: "1",
    phase: 1,
    label: "We are gathering a core group",
    hint: "Vision meetings and follow-up, praying people toward commitment.",
    phaseName: PHASES[1],
  },
  {
    value: "2",
    phase: 2,
    label: "We are forming the launch team",
    hint: "The core group is becoming a team and leaders are being named.",
    phaseName: PHASES[2],
  },
  {
    value: "3",
    phase: 3,
    label: "We are training the teams",
    hint: "Ministry teams are in training and the systems are being built.",
    phaseName: PHASES[3],
  },
  {
    value: "4",
    phase: 4,
    label: "We are in the final weeks before launch",
    hint: "Promotion, run-throughs and the last checks before the day.",
    phaseName: PHASES[4],
  },
  {
    value: "5",
    phase: 5,
    label: "Launch Sunday is here",
    hint: "The first public service is this week.",
    phaseName: PHASES[5],
  },
  {
    value: "6",
    phase: 6,
    label: "We have launched",
    hint: "The church is meeting weekly and we are settling into rhythms.",
    phaseName: PHASES[6],
  },
  {
    value: JOURNEY_STAGE_NOT_SURE,
    phase: JOURNEY_STAGE_NOT_SURE_PHASE,
    label: "Not sure — start me at the beginning",
    hint: "We will set you at Discovery. You can move phases any time from the phase page.",
    phaseName: PHASES[JOURNEY_STAGE_NOT_SURE_PHASE],
  },
];

/**
 * The submitted stage value as a phase number, or `null` when it is not one of
 * the offered options.
 *
 * The ONE place a form value becomes a phase, so "not sure means 0" is stated
 * once. Returns `null` rather than defaulting to 0 on garbage: a POST carrying
 * `stage=9` is a caller error and must be refused, not quietly recorded as a
 * Discovery declaration the planter never made.
 */
export function phaseForJourneyStage(value: unknown): PhaseNumber | null {
  if (typeof value !== "string") return null;
  return (
    JOURNEY_STAGE_OPTIONS.find((option) => option.value === value)?.phase ??
    null
  );
}
