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

/**
 * The query param that carries the flow's current step (#373):
 * `/dashboard?step=journey`.
 *
 * The flow has no route of its own — it renders AS the dashboard while
 * `onboarding_completed_at` is null — so the step has to live in the URL for
 * anything outside the flow to be able to see it. The contextual wiki guide is
 * the first such reader (`src/lib/wiki/guide-config.ts`, ruled on PR #367:
 * step-scoped, journey only), and OB-004's re-entry link already used this same
 * param name, so nothing new is being introduced here.
 */
export const ONBOARDING_STEP_PARAM = "step";

/**
 * Is this URL value one of the four steps?
 *
 * The ONE place a `?step=` value becomes a step id, so both halves of the flow
 * — the page that resolves where a planter lands and the client that reads the
 * URL on every render — refuse the same set of garbage. It returns false rather
 * than defaulting to a step: an unrecognised value is a caller error, and the
 * server's resume rule is a better answer than a guess.
 */
export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEP_IDS as readonly string[]).includes(value)
  );
}

/**
 * What the server does with the `?step=` a request arrived carrying.
 *
 * Three answers, not two, because "no step named" and "a step named and
 * declined" cannot share a path: the first is an ordinary `/dashboard` that the
 * resume rule answers, the second has to leave the address bar or the client
 * reads it back off the URL on the very next render and honours it there.
 */
export type OnboardingStepRequest =
  | { outcome: "none" }
  | { outcome: "honour"; step: OnboardingStepId }
  | { outcome: "refuse" };

/**
 * The honour/refuse decision that guards the flow (#373), as a pure function.
 *
 * It lives here rather than inline in the page for one reason: it is the rule
 * that decides which step a URL may open, and a rule that can only be exercised
 * by rendering an async server component is a rule pinned by regex against its
 * own source — which catches a deletion and cannot catch a wrong answer. That
 * is exactly how the repeated-`?step=` hole below survived a green suite.
 *
 * The rules, in order:
 *
 *  - No `?step=` at all → `none`. A plain `/dashboard` never redirects.
 *  - A REPEATED param (`?step=journey&step=journey`, which Next hands back as an
 *    array) → `refuse`. It names no single step, and the two client readers
 *    disagree about which value wins — `useSearchParams().get()` takes the
 *    first, the wiki guide's provider builds its object with `forEach` and so
 *    takes the LAST. Resolving it to either one would leave the flow showing one
 *    step and the guide answering another; refusing it settles both.
 *  - An unrecognised single value → `none`. A `?step=journey%20` typo is a
 *    caller error with a better answer available than a redirect: the resume
 *    rule, after which the flow stamps the real step over it (`params.set`
 *    collapses the param), so the URL heals with no navigation.
 *  - Step 1 is addressable EXACTLY WHILE THERE IS NO CHURCH, and every later
 *    step exactly once there is. The second half is OB-004's original guard —
 *    deep-linking past step 1 without a church lands on a form that would
 *    update a church that does not exist. The first half is the ruling of
 *    2026-08-10: once the church exists step 1 is not re-enterable, so
 *    `/dashboard?step=basics` must not reopen its empty, required form (a
 *    second submit is discarded by `runCreateChurch`'s already-have-church
 *    branch, so the form would be lying about what it does).
 *
 * Note which answer step 1 gets when it is closed: `none`, NOT `refuse`. The
 * refusal is a redirect, and this exact URL is the one showing while step 1's
 * own create action revalidates — the church exists by then, so a refusal would
 * fire during the planter's own submit and yank them out of the flow. `none`
 * hands the decision to the resume rule instead, and the client refuses the
 * stale value on its side (`addressableOnboardingStep`), so nothing renders
 * step 1 and nothing navigates.
 */
export function resolveOnboardingStepRequest({
  step,
  churchId,
}: {
  /** The raw `?step=` value. Repeated params arrive as an array. */
  step: string | string[] | undefined;
  churchId: string | null | undefined;
}): OnboardingStepRequest {
  if (step === undefined) return { outcome: "none" };
  if (Array.isArray(step)) return { outcome: "refuse" };
  if (!isOnboardingStepId(step)) return { outcome: "none" };

  if (isFirstOnboardingStep(step)) {
    return churchId ? { outcome: "none" } : { outcome: "honour", step };
  }

  return churchId ? { outcome: "honour", step } : { outcome: "refuse" };
}

/**
 * The client's half of the same rule: the step a URL names, or null when the
 * flow will not open it.
 *
 * The flow reads its step from the URL, so the server declining a value is only
 * half a refusal — the client has to decline it too or it renders the very step
 * the page would not resolve. It cannot ask the database, and it does not need
 * to: THE STEP THE SERVER LANDED IT ON IS THE ANSWER. `resolveResumeStep`
 * returns step 1 only while `churchId` is missing, and the resolver above
 * honours step 1 only then as well, so `initialStep === FIRST_ONBOARDING_STEP`
 * holds exactly while there is no church. Pinned by `steps.test.ts`, because
 * that equivalence is what this function rests on.
 */
export function addressableOnboardingStep(
  value: unknown,
  initialStep: OnboardingStepId
): OnboardingStepId | null {
  if (!isOnboardingStepId(value)) return null;
  if (isFirstOnboardingStep(value) && !isFirstOnboardingStep(initialStep)) {
    return null;
  }
  return value;
}

// ============================================================================
// The flow's URL writes (#397, follow-up 2 of PR #390)
//
// WHAT THE URL SAYS IS A DECISION, so it is a function that can be CALLED.
//
// It used to live inline in `onboarding-flow-client.tsx` — one ternary and two
// `window.history.*` calls — and was pinned by regex against that component's
// source. A regex over source catches a deletion and nothing else: it broke on
// a local rename that changed no behaviour, and it passed a `pushState` swapped
// for a `replaceState`, which changes what the browser's Back button does. The
// decision moved here so the test CALLS it; the component only APPLIES the
// `{method, url}` it is handed.
// ============================================================================

/**
 * The part of `window.location` the URL writes are built from — structural, so
 * the browser's own `location` satisfies it and a test can pass a literal.
 */
export type OnboardingUrlLocation = {
  pathname: string;
  search: string;
};

/**
 * `location` with `?step=` set to `step`, every OTHER param kept (#373).
 *
 * Built from the location handed in rather than from a fresh `URLSearchParams`
 * so `?churchCreated=true` and anything else on the address bar survives a step
 * change. The component passes `window.location`, which is what the address bar
 * says AT THE MOMENT of the write — including a param some other client wrote
 * since this render began.
 *
 * `null` REMOVES the param, which is how the OB-015 finish screen is addressed
 * without being given a step id of its own (ruled 2026-08-10). `params.set` is
 * also what collapses a repeated `?step=a&step=a` back to one value, so a URL
 * the server declined heals on the next stamp.
 */
export function onboardingStepUrl(
  location: OnboardingUrlLocation,
  step: OnboardingStepId | null
): string {
  const params = new URLSearchParams(location.search);
  if (step === null) params.delete(ONBOARDING_STEP_PARAM);
  else params.set(ONBOARDING_STEP_PARAM, step);
  const query = params.toString();
  return query ? `${location.pathname}?${query}` : location.pathname;
}

/** A history write the flow is asking for, ready to be applied verbatim. */
export type OnboardingHistoryWrite = {
  /**
   * `push` gives Back the step just left; `replace` takes the current entry out
   * of the history instead of adding one.
   */
  method: "push" | "replace";
  /** Path + query, as `window.history.pushState`/`replaceState` want it. */
  url: string;
};

/**
 * The flow's ONE history-write decision: given what the URL names now and what
 * it should name, what write applies — and is any write needed at all?
 *
 * `null` means the address bar already says it. That answer is read off the URL
 * this function would WRITE rather than off `from`, so a value the client
 * declined (`?step=journey%20`, or a step 1 the church closed) is cleaned up
 * rather than left sitting there because it names no step either way.
 *
 * The method, in the order the rules apply:
 *
 *  - `to === null` → REPLACE. The only thing addressed by no step is the
 *    OB-015 finish screen, which is not a step and not a navigation: it is the
 *    same screen the planter is already on, minus a param.
 *  - `from === null` → REPLACE. The URL named no step, so nothing is being left
 *    behind — this is the ARRIVAL stamp (a planter resuming onto step 3 must
 *    end up at `/dashboard?step=journey` or the wiki guide never matches for
 *    exactly the planters it is for), or the heal after a declined value.
 *    Arriving is not navigating, and a history entry here would make the first
 *    Back a no-op that appears to do nothing.
 *  - `from` is step 1 → REPLACE. Ruled 2026-08-10: STEP 1 IS NOT IN THE
 *    HISTORY. The only way off it is creating the church, so by the time this
 *    runs step 1 is not re-enterable, and browser Back was landing planters on
 *    its empty, required form whose second submit `runCreateChurch` discards.
 *    The cost is named and accepted: Back from step 2 leaves the flow.
 *  - otherwise → PUSH. The push is what gives Back the step just left.
 */
export function historyWriteFor({
  from,
  to,
  location,
}: {
  /** The step the URL names now — `null` when it names none the client honours. */
  from: OnboardingStepId | null;
  /** The step the URL should name — `null` for the finish screen. */
  to: OnboardingStepId | null;
  location: OnboardingUrlLocation;
}): OnboardingHistoryWrite | null {
  const url = onboardingStepUrl(location, to);
  if (url === `${location.pathname}${location.search}`) return null;

  const replace = to === null || from === null || isFirstOnboardingStep(from);
  return { method: replace ? "replace" : "push", url };
}

/**
 * The OB-015 finish screen, as the two questions the flow actually asks about
 * it — and the reason they are two (#397, follow-up 1 of PR #390).
 *
 * The screen has no `?step=` of its own: it is `/dashboard` with the param
 * REMOVED, which is also how the contextual wiki guide is suppressed there
 * (ruled 2026-08-10, option B — a fifth step value would be a shareable URL
 * that reopens an offer whose gate the planter already answered).
 *
 * THE GUIDE IS A PURE FUNCTION OF THE URL and it lives OUTSIDE the flow —
 * `WikiGuide` is a sibling of the dashboard's children, not an ancestor
 * (`app/(dashboard)/layout.tsx`), so the URL is the only channel between them.
 * That is what makes the two questions different:
 *
 *  - `open` — the flow has opened the finish screen, so the URL must stop
 *    naming a step. This is what the history write is derived from.
 *  - `showing` — the finish screen is what PAINTS, which additionally requires
 *    the URL to have already lost the param.
 *
 * Painting on `open` alone is what put the journey Guide pill over the
 * ministry-teams offer for one committed frame: `open` flips during render,
 * the param leaves in an effect, and Next dispatches that URL change inside a
 * `startTransition` — so no layout effect can pull the guide's re-render back
 * before the paint. Requiring the URL to agree makes the two mutually exclusive
 * BY CONSTRUCTION rather than by timing: both the screen and the guide read the
 * same `useSearchParams()`, so a frame showing the finish screen is a frame
 * whose URL names no step, and a URL naming no step resolves no guide entry.
 *
 * The cost is one frame in which the step behind it is still painted — which is
 * a pairing that has always been correct, rather than one that never is.
 */
export type OnboardingFinishScreenState = {
  /** The flow has opened it: the URL must name no step. */
  open: boolean;
  /** It is what renders: the URL has stopped naming one. */
  showing: boolean;
};

export function onboardingFinishScreen({
  urlStep,
  finishScreenStep,
}: {
  /** The step the URL names, after the client's own guard. */
  urlStep: OnboardingStepId | null;
  /** The step the finish screen was opened FROM, or `null` when it is closed. */
  finishScreenStep: OnboardingStepId | null;
}): OnboardingFinishScreenState {
  // Open while the URL still names the step it was opened from (the frames
  // before the param is stripped) and while it names no step at all (every
  // frame after). What CLOSES it is the URL naming a DIFFERENT step, which is
  // what browser Back off the screen does — so a Back lands the planter on the
  // step they returned to rather than on an offer painted over it.
  const open =
    finishScreenStep !== null &&
    (urlStep === null || urlStep === finishScreenStep);

  return { open, showing: open && urlStep === null };
}

/**
 * What a FINISHED dashboard does with the `?step=` a request arrived carrying —
 * the resolver's other half (#373 AC 3), for once `onboarding_completed_at` is
 * set and `resolveOnboardingStepRequest` above no longer runs.
 */
export type FinishedDashboardStepRequest =
  | { outcome: "none" }
  | { outcome: "leadership" }
  | { outcome: "refuse" };

/**
 * The honour/refuse decision for a dashboard the flow no longer owns, as a pure
 * function — same reason `resolveOnboardingStepRequest` is one: a rule that can
 * only be exercised by rendering an async server component is pinned by regex
 * against its own source, which catches a deletion and cannot catch a wrong
 * answer.
 *
 * The rules:
 *
 *  - No `?step=` at all → `none`. A plain `/dashboard` never redirects.
 *  - `leadership` → the one step a finished dashboard answers to. Re-entry is a
 *    single question, not the whole wizard (OB-004, ruling 2026-07-31), so this
 *    is one literal value and never becomes "any recognised step".
 *  - EVERYTHING else → `refuse`. The flow owned `?step=` while it rendered;
 *    nothing owns it now, and a value left in the address bar would put the
 *    contextual wiki guide on a finished dashboard — the guide resolves from
 *    pathname + search params alone, and the PR #367 ruling (step-scoped)
 *    forbids it there. Reachable without typing a URL: finishing from step 3
 *    redirects to `/dashboard?churchCreated=true`, and a Server Action redirect
 *    PUSHES, so Back returns to `/dashboard?step=journey` — now finished. An
 *    unrecognised value is refused too, since past this point there is no flow
 *    left to resume into.
 *  - A REPEATED param (`?step=leadership&step=journey`, an array) equals no
 *    literal and is refused with the rest — never resolved to one of its
 *    values, for the same reader-disagreement reason the flow's resolver
 *    refuses it.
 */
export function resolveFinishedDashboardStepRequest(
  step: string | string[] | undefined
): FinishedDashboardStepRequest {
  if (step === undefined) return { outcome: "none" };
  if (step === "leadership") return { outcome: "leadership" };
  return { outcome: "refuse" };
}

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

/**
 * The inverse: the option that a STORED phase corresponds to, so a surface can
 * name a recorded stage in the same plain language the picker offered it in.
 *
 * Used when a re-declaration is refused (#306, ruled 2026-08-09): telling a
 * planter "your starting stage is already recorded as 3" names a number they
 * never chose — they chose "We are training the teams". The refusal has to
 * speak the picker's language or it does not identify the answer it is
 * refusing to replace.
 *
 * Phase 0 resolves to the FIRST option carrying it — "We are still discerning
 * the call", not the "not sure" escape hatch below it. Both write phase 0, and
 * only the stored number survives, so the honest reading back is the stage, not
 * a guess at which door the planter came through.
 */
export function journeyStageForPhase(phase: number): JourneyStageOption | null {
  return JOURNEY_STAGE_OPTIONS.find((option) => option.phase === phase) ?? null;
}
