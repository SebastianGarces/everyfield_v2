import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INCOMPLETE_ONBOARDING_ITEMS,
  incompleteOnboardingItems,
  type IncompleteOnboardingVisibility,
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
//
// The one exception is WHO IS LOOKING: the leadership row is dropped for a
// viewer whose answer would be refused, and while the pastor prompt is already
// asking the same question. That rule lives here too, so it is exercised by
// calling it rather than by rendering the page.
// ----------------------------------------------------------------------------

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

/** Holds every verb — the plant's Owner, for whom no row is filtered. */
const OWNER = () => true;

/** A viewer the leadership row is FOR: can answer, not currently being asked. */
const ASKABLE: IncompleteOnboardingVisibility = {
  canAnswerLeadership: true,
  pastorPromptShowing: false,
  holds: OWNER,
};

test("a plant that skipped everything after step 1 lists all three, in flow order", () => {
  const items = incompleteOnboardingItems({ churchId: CHURCH_ID }, ASKABLE);

  assert.deepEqual(
    items.map((item) => item.id),
    ["leadership", "journey", "people"]
  );
});

test("every fact in means no indicator at all", () => {
  const items = incompleteOnboardingItems(
    {
      churchId: CHURCH_ID,
      leadershipStatus: "planter_confirmed",
      journey: { declaredInPhaseHistory: true },
      peopleAdded: true,
    },
    ASKABLE
  );

  assert.deepEqual(items, []);
});

test("each fact that lands removes exactly its own row", () => {
  assert.deepEqual(
    incompleteOnboardingItems(
      { churchId: CHURCH_ID, leadershipStatus: "no_planter" },
      ASKABLE
    ).map((item) => item.id),
    ["journey", "people"]
  );

  assert.deepEqual(
    incompleteOnboardingItems(
      { churchId: CHURCH_ID, journey: { declaredInPhaseHistory: true } },
      ASKABLE
    ).map((item) => item.id),
    ["leadership", "people"]
  );

  assert.deepEqual(
    incompleteOnboardingItems(
      { churchId: CHURCH_ID, peopleAdded: true },
      ASKABLE
    ).map((item) => item.id),
    ["leadership", "journey"]
  );
});

test("an answered No counts as answered — the nudge covers it, not this list", () => {
  const items = incompleteOnboardingItems(
    {
      churchId: CHURCH_ID,
      leadershipStatus: "no_planter",
      journey: { declaredInPhaseHistory: true },
      peopleAdded: true,
    },
    ASKABLE
  );

  assert.deepEqual(items, []);
});

// ----------------------------------------------------------------------------
// The leadership row's two visibility gates
// ----------------------------------------------------------------------------

test("the leadership row is dropped for a viewer whose answer would be refused", () => {
  // A link that quietly does nothing is worse than no link: the re-entry
  // renders only for somebody `canAnswerLeadershipQuestion` admits.
  const items = incompleteOnboardingItems(
    { churchId: CHURCH_ID },
    { canAnswerLeadership: false, pastorPromptShowing: false, holds: OWNER }
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["journey", "people"]
  );
});

test("the leadership row is dropped while the pastor prompt is asking it", () => {
  // The prompt IS this question; asking it twice on one screen reads as a bug.
  const items = incompleteOnboardingItems(
    { churchId: CHURCH_ID },
    { canAnswerLeadership: true, pastorPromptShowing: true, holds: OWNER }
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["journey", "people"]
  );
});

test("the two leadership gates drop that row and no other", () => {
  // Named for what it asserts: `canAnswerLeadership` and `pastorPromptShowing`
  // decide the leadership row ALONE. The capability filter added for AS-020 is
  // the thing that reaches the other two, and `OWNER` holds every verb here so
  // this case still isolates the leadership pair.
  const items = incompleteOnboardingItems(
    { churchId: CHURCH_ID },
    { canAnswerLeadership: false, pastorPromptShowing: true, holds: OWNER }
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["journey", "people"]
  );
});

test("step 1 is never listed: the dashboard does not render without a church", () => {
  // Facts with no churchId cannot reach this surface — the onboarding flow owns
  // the page instead — and the type excludes "basics" so it cannot be added by
  // accident either.
  const items = incompleteOnboardingItems({}, ASKABLE);

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

// ----------------------------------------------------------------------------
// AS-020 (#499) — a row is a CALL TO ACTION, so it is addressed only to
// somebody who could take it.
//
// The module already refused to show the leadership row to a viewer whose
// answer would be refused, on the stated ground that "a link that quietly does
// nothing is worse than no link". The other two rows went out to everybody, and
// on a plant Member's dashboard that produced exactly that: "Set your phase"
// linking to /phase, which redirects them back, under an offer to dismiss the
// reminder.
// ----------------------------------------------------------------------------

test("a plant Member is shown no row at all, so the indicator does not render", () => {
  const items = incompleteOnboardingItems(
    { churchId: CHURCH_ID },
    {
      canAnswerLeadership: false,
      pastorPromptShowing: false,
      // A Member holds neither `phase.declare` (OWNER_ONLY) nor `people.write`
      // (ADMIN_PLUS) — the two verbs the surviving rows ask for.
      holds: () => false,
    }
  );

  assert.deepEqual(items, [], "a Member was offered a step they cannot take");
});

test("an Admin keeps the row they can act on, and loses the Owner-only one", () => {
  // THE OVER-HIDE GUARD. `people.write` is ADMIN_PLUS, so an Admin really can
  // add the first person and must still be told to; `phase.declare` is
  // OWNER_ONLY and /phase would bounce them.
  const items = incompleteOnboardingItems(
    { churchId: CHURCH_ID },
    {
      canAnswerLeadership: false,
      pastorPromptShowing: false,
      holds: (capability) => capability === "people.write",
    }
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["people"]
  );
});

test("every row names a verb, so none can be added without deciding who sees it", () => {
  for (const item of Object.values(INCOMPLETE_ONBOARDING_ITEMS)) {
    assert.ok(
      typeof item.requires === "string" && item.requires.length > 0,
      `the ${item.id} row names no capability`
    );
  }
});
