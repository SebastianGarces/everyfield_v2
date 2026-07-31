import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  isFirstOnboardingStep,
  isLastOnboardingStep,
  nextOnboardingStep,
  onboardingStep,
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
  assert.equal(resolveResumeStep({ churchId: null }), "basics");
  assert.equal(resolveResumeStep({ churchId: undefined }), "basics");
  // Step 1 is done the moment the church row exists, so a returning planter
  // resumes past it rather than being asked to create a second church.
  assert.equal(resolveResumeStep({ churchId: CHURCH_ID }), "leadership");
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
