import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LAST_ONBOARDING_STEP,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  incompleteOnboardingSteps,
  isFirstOnboardingStep,
  isLastOnboardingStep,
  isSkippableOnboardingStep,
  nextOnboardingStep,
  onboardingStep,
  onboardingStepComplete,
  previousOnboardingStep,
  resolveResumeStep,
  shouldShowOnboarding,
} from "./steps";

// ----------------------------------------------------------------------------
// F12 / OB-001 — the two rules that decide what a planter sees.
//
// `shouldShowOnboarding` is the interesting one. The obvious implementation —
// "no church means onboarding" — is the one this feature deliberately does NOT
// have: because step 1 creates the church, a planter who abandons the flow has
// a church AND is mid-onboarding, and sending them to a half-configured
// dashboard would silently drop the remaining steps forever.
// ----------------------------------------------------------------------------

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";

test("a planter with no church sees the onboarding flow", () => {
  assert.equal(
    shouldShowOnboarding({
      role: "planter",
      churchId: null,
      onboardingCompletedAt: null,
    }),
    true
  );
});

test("a planter who abandoned after step 1 still sees the flow", () => {
  // The church exists and is valid — the flow is simply not finished.
  assert.equal(
    shouldShowOnboarding({
      role: "planter",
      churchId: CHURCH_ID,
      onboardingCompletedAt: null,
    }),
    true
  );
});

test("a planter who finished (or skipped out) gets their dashboard back", () => {
  assert.equal(
    shouldShowOnboarding({
      role: "planter",
      churchId: CHURCH_ID,
      onboardingCompletedAt: new Date("2026-07-30T12:00:00Z"),
    }),
    false
  );
});

test("no other role is ever put through onboarding", () => {
  for (const role of [
    "coach",
    "team_member",
    "sending_church_admin",
    "network_admin",
    null,
    undefined,
  ]) {
    assert.equal(
      shouldShowOnboarding({
        role,
        churchId: null,
        onboardingCompletedAt: null,
      }),
      false,
      `role: ${role}`
    );
  }
});

test("resolveResumeStep starts at basics only while there is no church", () => {
  assert.equal(
    resolveResumeStep({ churchId: null, leadershipStatus: null }),
    "basics"
  );
  assert.equal(
    resolveResumeStep({ churchId: undefined, leadershipStatus: undefined }),
    "basics"
  );
  // Step 1 is done the moment the church row exists, so a returning planter
  // resumes past it rather than being asked to create a second church.
  assert.equal(
    resolveResumeStep({ churchId: CHURCH_ID, leadershipStatus: null }),
    "leadership"
  );
});

test("resolveResumeStep resumes past leadership once it has been ANSWERED", () => {
  // OB-004 / FRD AC 5: abandoning after step 2 and returning lands on step 3 —
  // and "answered" means either answer. A planter who said No has finished the
  // step; getting back to it is the dashboard nudge's job, not resumption's,
  // and re-asking here would trap them in step 2 forever.
  assert.equal(
    resolveResumeStep({
      churchId: CHURCH_ID,
      leadershipStatus: "planter_confirmed",
    }),
    "journey"
  );
  assert.equal(
    resolveResumeStep({ churchId: CHURCH_ID, leadershipStatus: "no_planter" }),
    "journey"
  );
});

// ----------------------------------------------------------------------------
// Ordering. Cheap to assert, and every navigation control depends on it.
// ----------------------------------------------------------------------------

test("the step list and the id list agree on order and numbering", () => {
  assert.deepEqual(
    ONBOARDING_STEPS.map((step) => step.id),
    [...ONBOARDING_STEP_IDS]
  );
  ONBOARDING_STEPS.forEach((step, index) => {
    assert.equal(step.number, index + 1, step.id);
  });
});

test("next/previous walk the flow and stop at the ends", () => {
  assert.equal(previousOnboardingStep("basics"), null);
  assert.equal(nextOnboardingStep("basics"), "leadership");
  assert.equal(nextOnboardingStep("leadership"), "journey");
  assert.equal(nextOnboardingStep("journey"), "people");
  assert.equal(nextOnboardingStep("people"), null);
  assert.equal(previousOnboardingStep("people"), "journey");
});

test("first and last are the ones the flow treats specially", () => {
  assert.equal(isFirstOnboardingStep("basics"), true);
  assert.equal(isFirstOnboardingStep("leadership"), false);
  assert.equal(isLastOnboardingStep("people"), true);
  assert.equal(isLastOnboardingStep("journey"), false);
});

test("onboardingStep refuses an unknown id instead of returning undefined", () => {
  assert.throws(
    () => onboardingStep("finish" as never),
    /unknown onboarding step/
  );
});

// ----------------------------------------------------------------------------
// OB-007 — skip and resume.
//
// The two halves of one rule. Every step after the first can be moved past
// without answering it, and because it can, resumption may not be "where they
// got to" — it has to be the first step whose fact is still MISSING, or a
// planter who skipped step 2 would never be asked it again.
// ----------------------------------------------------------------------------

test("every step after step 1 is skippable, and step 1 never is", () => {
  assert.equal(isSkippableOnboardingStep("basics"), false);

  for (const id of ONBOARDING_STEP_IDS.slice(1)) {
    assert.equal(isSkippableOnboardingStep(id), true, id);
  }

  // Step 1 creates the church row every later step updates: there is nothing
  // to skip into, which is why this is a property of the step and not a
  // decision each control makes for itself.
  assert.equal(ONBOARDING_STEPS[0].id, "basics");
});

test("each step is complete when — and only when — its own fact is in", () => {
  const nothing = {};
  for (const id of ONBOARDING_STEP_IDS) {
    assert.equal(onboardingStepComplete(id, nothing), false, id);
  }

  assert.equal(onboardingStepComplete("basics", { churchId: CHURCH_ID }), true);
  assert.equal(
    onboardingStepComplete("leadership", { leadershipStatus: "no_planter" }),
    true
  );
  assert.equal(
    onboardingStepComplete("journey", { journeyDeclared: true }),
    true
  );
  assert.equal(onboardingStepComplete("people", { peopleAdded: true }), true);
});

test("incomplete steps are listed in flow order", () => {
  assert.deepEqual(incompleteOnboardingSteps({}), [...ONBOARDING_STEP_IDS]);

  assert.deepEqual(
    incompleteOnboardingSteps({
      churchId: CHURCH_ID,
      leadershipStatus: "planter_confirmed",
      peopleAdded: true,
    }),
    ["journey"]
  );
});

test("a skipped step is where a returning planter resumes", () => {
  // Skipped step 2, answered step 3, came back. The unanswered question is
  // still the first incomplete step, so that is where the flow opens — being
  // further along once is not the same as having answered.
  assert.equal(
    resolveResumeStep({ churchId: CHURCH_ID, journeyDeclared: true }),
    "leadership"
  );
});

test("resumption walks forward as each later fact lands", () => {
  assert.equal(
    resolveResumeStep({
      churchId: CHURCH_ID,
      leadershipStatus: "planter_confirmed",
      journeyDeclared: true,
    }),
    "people"
  );
});

test("a planter with every fact in lands on the last step, not back at 3", () => {
  // The flow only renders while `onboarding_completed_at` is null, so somebody
  // here has answered everything and simply has not left yet. What they need is
  // the control that finishes, which lives on the final step.
  assert.equal(
    resolveResumeStep({
      churchId: CHURCH_ID,
      leadershipStatus: "no_planter",
      journeyDeclared: true,
      peopleAdded: true,
    }),
    LAST_ONBOARDING_STEP
  );
  assert.equal(LAST_ONBOARDING_STEP, "people");
});
