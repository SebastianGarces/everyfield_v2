import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INCOMPLETE_ONBOARDING_ITEMS,
  incompleteOnboardingItems,
} from "./incomplete-onboarding";
import { ONBOARDING_STEP_IDS } from "@/lib/onboarding/steps";

// ----------------------------------------------------------------------------
// F12 / OB-011 — the incomplete-onboarding indicator.
//
// Everything here is about the indicator being a function of the CHURCH ROW and
// nothing else. Nobody records which steps were skipped (OB-007 made skipping
// first-class), so the list has to be derived from what is missing — which is
// also what makes "completing the remaining steps removes it" true without any
// clearing step: the row stops being missing and the item stops existing.
// ----------------------------------------------------------------------------

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

test("a plant that skipped everything after step 1 lists all three, in flow order", () => {
  const items = incompleteOnboardingItems({ churchId: CHURCH_ID });

  assert.deepEqual(
    items.map((item) => item.id),
    ["leadership", "journey", "people"]
  );
});

test("every fact in means no indicator at all", () => {
  const items = incompleteOnboardingItems({
    churchId: CHURCH_ID,
    leadershipStatus: "planter_confirmed",
    journeyDeclared: true,
    peopleAdded: true,
  });

  assert.deepEqual(items, []);
});

test("each fact that lands removes exactly its own row", () => {
  assert.deepEqual(
    incompleteOnboardingItems({
      churchId: CHURCH_ID,
      leadershipStatus: "no_planter",
    }).map((item) => item.id),
    ["journey", "people"]
  );

  assert.deepEqual(
    incompleteOnboardingItems({
      churchId: CHURCH_ID,
      journeyDeclared: true,
    }).map((item) => item.id),
    ["leadership", "people"]
  );

  assert.deepEqual(
    incompleteOnboardingItems({
      churchId: CHURCH_ID,
      peopleAdded: true,
    }).map((item) => item.id),
    ["leadership", "journey"]
  );
});

test("an answered No counts as answered — the nudge covers it, not this list", () => {
  const items = incompleteOnboardingItems({
    churchId: CHURCH_ID,
    leadershipStatus: "no_planter",
    journeyDeclared: true,
    peopleAdded: true,
  });

  assert.deepEqual(items, []);
});

test("step 1 is never listed: the dashboard does not render without a church", () => {
  // Facts with no churchId cannot reach this surface — the onboarding flow owns
  // the page instead — and the type excludes "basics" so it cannot be added by
  // accident either.
  const items = incompleteOnboardingItems({});

  assert.ok(!items.some((item) => (item.id as string) === "basics"));
});

test("every skippable step has a row, so a new step cannot ship without copy", () => {
  const covered = Object.keys(INCOMPLETE_ONBOARDING_ITEMS);
  const skippable = ONBOARDING_STEP_IDS.filter((id) => id !== "basics");

  assert.deepEqual([...covered].sort(), [...skippable].sort());
});

test("every row links somewhere real and says what it costs", () => {
  for (const item of Object.values(INCOMPLETE_ONBOARDING_ITEMS)) {
    // An in-app path, never an empty or fragment-only href: a dead link inside
    // a nudge about unfinished work is worse than no nudge.
    assert.match(item.href, /^\/[a-z]/);
    assert.ok(item.detail.length > 20);
    assert.ok(item.cta.length > 0);
  }
});

test("the leadership row uses the one specced re-entry into the flow", () => {
  assert.equal(
    INCOMPLETE_ONBOARDING_ITEMS.leadership.href,
    "/dashboard?step=leadership"
  );
});
