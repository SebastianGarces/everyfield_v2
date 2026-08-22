/**
 * F12 / OB-011 — the incomplete-onboarding indicator, as data.
 *
 * "Skippable is not optional-forever" is the FRD's third design principle:
 * skipped facts leave visible, dismissible nudges where their absence hurts. So
 * what this module answers is not "how far did they get" — nobody records that,
 * and OB-007 made skipping a first-class move — but **which facts are still
 * missing right now**, read from the church row itself
 * (`incompleteOnboardingSteps`). Answer a step's question anywhere in the
 * product and it drops off this list; answer them all and the indicator is gone
 * without anything having to be marked complete.
 *
 * LEADERSHIP IS FED THE RAW COLUMN, on purpose. The caller passes
 * `churches.leadership_status` itself, not `resolvedLeadershipStatus()`, so a
 * plant with an implicit planter (a `users` row with the role, no recorded
 * answer) still sees this row while it never sees the pastor-confirmation
 * prompt. Ruled 2026-08-08 (Sebastian, PR #335): the prompt is a demand and
 * must stay quiet for a plant that is plainly led; the indicator is a standing
 * list of facts still worth having, and an explicit answer is worth something
 * on its own. See the note on `resolvedLeadershipStatus` before changing it.
 *
 * Pure, so the copy and the links are unit testable without a database.
 */

import {
  incompleteOnboardingSteps,
  type OnboardingFacts,
  type OnboardingStepId,
} from "@/lib/onboarding/steps";
import { LEADERSHIP_STEP_HREF } from "@/lib/onboarding/leadership";
import type { Capability } from "@/lib/auth/seat-rules";

/**
 * The steps this indicator can list.
 *
 * Step 1 is excluded structurally, not filtered defensively: the dashboard only
 * renders for a planter whose church exists, and if it did not, the onboarding
 * flow would own the page instead of this banner (`shouldShowOnboarding`).
 */
export type SkippedStepId = Exclude<OnboardingStepId, "basics">;

export type IncompleteOnboardingItem = {
  id: SkippedStepId;
  title: string;
  /** What is missing and what it costs — one sentence, no scolding. */
  detail: string;
  /** The link back to where this fact is captured. */
  href: string;
  /** The link's label. A verb, so the row reads as a next action. */
  cta: string;
  /**
   * THE VERB THIS ROW ASKS THE READER TO PERFORM (AS-020, #499).
   *
   * The module already applied this rule to `leadership` alone — "dropped for
   * anybody whose answer would be refused (a link that quietly does nothing is
   * worse than no link)" — and the other two rows went out to everybody. On a
   * plant Member's dashboard that produced exactly the failure that sentence
   * describes: "Set your stage" pointing at `/phase`, which redirects them
   * straight back, under a card offering to dismiss the reminder.
   *
   * So the rule becomes the table's, not one row's. `leadership` still carries
   * its own predicate rather than a capability, because `church.claim` GRANTS a
   * seat rather than spending one and its rule is not an authority rule.
   */
  requires: Capability;
};

/**
 * WHERE EACH ROW LINKS, and why they are not all `?step=`.
 *
 * The FRD asks these to link back into the flow at that step. That is literally
 * true of leadership, which has a real re-entry (`/dashboard?step=leadership` —
 * the one specced way back into a finished flow, ruling 2026-07-31). It is not
 * yet true of the other two: leaving onboarding is otherwise one-way, so their
 * facts are captured on the surfaces that own them for good — the phase control
 * for the journey declaration, the people list for the first person. Pointing a
 * row at `?step=journey` would be a link to a step that does not re-open, and a
 * dead link in a nudge about unfinished work is worse than no nudge. When steps
 * 3-4 grow their own re-entry, this map is the one place that changes.
 */
export const INCOMPLETE_ONBOARDING_ITEMS: Record<
  SkippedStepId,
  IncompleteOnboardingItem
> = {
  leadership: {
    id: "leadership",
    title: "Who leads this plant",
    detail:
      "We never got an answer about who the lead planter/pastor is, so follow-ups and reminders have nobody to name.",
    href: LEADERSHIP_STEP_HREF,
    cta: "Answer this",
    // Never consulted: `canAnswerLeadership` decides this row, below. Named so
    // the table has no hole for a reader to wonder about.
    requires: "church.claim",
  },
  journey: {
    id: "journey",
    title: "Where you are in the journey",
    detail:
      "Your stage and target launch date are still unset, so guidance, the countdown and your phase all assume you are starting from zero.",
    href: "/phase",
    cta: "Set your stage",
    // `/phase` itself redirects anyone who is not the plant's Owner.
    requires: "phase.declare",
  },
  people: {
    id: "people",
    title: "The people walking with you",
    detail:
      "Nobody is on your list yet, so the pipeline, meeting attendance and follow-ups have nothing to work with.",
    href: "/people",
    cta: "Add your people",
    // ADMIN_PLUS, so an Admin keeps this row — the gate refuses the Member, not
    // everyone who is not the Owner.
    requires: "people.write",
  },
};

function isSkippedStep(id: OnboardingStepId): id is SkippedStepId {
  return id !== "basics";
}

/**
 * Who is looking, as far as the leadership row is concerned. The row is the raw
 * fact — "nobody answered the question" — so it is filtered twice before it can
 * mislead: dropped for anybody whose answer would be refused (a link that
 * quietly does nothing is worse than no link), and dropped while the pastor
 * prompt is up, since that IS this question and asking it twice on one screen
 * reads as a bug. What survives is the case the indicator is for: somebody who
 * can answer, is not being asked, and never did — a planter who skipped step 2,
 * or a plant that predates the flow entirely.
 */
export type IncompleteOnboardingVisibility = {
  /** `canAnswerLeadershipQuestion` for this viewer and this church. */
  canAnswerLeadership: boolean;
  /** Is the pastor-confirmation prompt already asking on this render? */
  pastorPromptShowing: boolean;
  /**
   * Does this viewer hold a verb? `holdsSeatFor(viewer, …)` at the call site.
   *
   * A PREDICATE RATHER THAN THE SEAT, so this module keeps the property its
   * docblock claims — pure, and unit testable without a database or a session.
   */
  holds: (capability: Capability) => boolean;
};

/**
 * The rows to show, in flow order. Empty means the indicator does not render —
 * which is how "completing the remaining steps removes it" works: nothing is
 * dismissed or cleared, the facts simply stop being missing.
 */
export function incompleteOnboardingItems(
  facts: OnboardingFacts,
  visibility: IncompleteOnboardingVisibility
): IncompleteOnboardingItem[] {
  return (
    incompleteOnboardingSteps(facts)
      .filter(isSkippedStep)
      .filter(
        (id) =>
          id !== "leadership" ||
          (visibility.canAnswerLeadership && !visibility.pastorPromptShowing)
      )
      .map((id) => INCOMPLETE_ONBOARDING_ITEMS[id])
      // AS-020: a row whose action this viewer would be refused is not shown at
      // all. `leadership` has already been decided above and is exempt here — its
      // rule is a grant, not a capability.
      .filter(
        (item) => item.id === "leadership" || visibility.holds(item.requires)
      )
  );
}
