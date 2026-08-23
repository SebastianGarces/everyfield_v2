import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields, TenancyFields } from "@/lib/auth/tenancy";
import { PHASES } from "@/lib/constants";
import {
  JOURNEY_STAGE_NOT_SURE,
  JOURNEY_STAGE_OPTIONS,
  LAST_ONBOARDING_STEP,
  LAUNCH_DATE_CHOICES,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  addressableOnboardingStep,
  historyWriteFor,
  incompleteOnboardingSteps,
  isLaunchDateChoice,
  journeyStageForPhase,
  onboardingFinishScreen,
  onboardingStepUrl,
  phaseForJourneyStage,
  isFirstOnboardingStep,
  isLastOnboardingStep,
  isSkippableOnboardingStep,
  nextOnboardingStep,
  onboardingStep,
  onboardingStepComplete,
  previousOnboardingStep,
  resolveFinishedDashboardStepRequest,
  resolveOnboardingStepRequest,
  resolveResumeStep,
  shouldShowOnboarding,
  type OnboardingStepId,
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
const SENDING_CHURCH_ID = "66666666-6666-4666-8666-666666666666";
const NETWORK_ID = "77777777-7777-4777-8777-777777777777";

/**
 * A seat held in a tenancy. All three tenancy FKs are named on every one of
 * them because `OnboardingViewer` is `SeatFields` and the type requires it: the
 * seat alone does not say WHOSE owner, so a fixture that omitted an FK would be
 * asserting about a shape `isChurchLevelOwner` never sees.
 */
function viewer(
  seat: SeatFields["seat"],
  tenancy: Partial<TenancyFields> = {}
): SeatFields {
  return {
    seat,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...tenancy,
  };
}

test("a planter with no church sees the onboarding flow", () => {
  assert.equal(
    shouldShowOnboarding({ ...viewer("owner"), onboardingCompletedAt: null }),
    true
  );
});

test("a planter who abandoned after step 1 still sees the flow", () => {
  // The church exists and is valid — the flow is simply not finished.
  assert.equal(
    shouldShowOnboarding({
      ...viewer("owner", { churchId: CHURCH_ID }),
      onboardingCompletedAt: null,
    }),
    true
  );
});

test("a planter who finished (or skipped out) gets their dashboard back", () => {
  assert.equal(
    shouldShowOnboarding({
      ...viewer("owner", { churchId: CHURCH_ID }),
      onboardingCompletedAt: new Date("2026-07-30T12:00:00Z"),
    }),
    false
  );
});

test("nobody but a plant's Owner is ever put through onboarding", () => {
  // The four role names that never onboarded, restated as (seat, tenancy)
  // pairs — plus the plant `admin` seat, which the five role names could not
  // express and which the Owner-only rule refuses for the same reason.
  const NEVER_ONBOARDS: [string, SeatFields][] = [
    ["a coach", viewer(null)],
    ["a plant Member", viewer("member", { churchId: CHURCH_ID })],
    ["a plant Admin", viewer("admin", { churchId: CHURCH_ID })],
    [
      "a sending church's Owner",
      viewer("owner", { sendingChurchId: SENDING_CHURCH_ID }),
    ],
    ["a network's Owner", viewer("owner", { sendingNetworkId: NETWORK_ID })],
  ];

  for (const [who, fields] of NEVER_ONBOARDS) {
    assert.equal(
      shouldShowOnboarding({ ...fields, onboardingCompletedAt: null }),
      false,
      `${who} does not onboard a plant`
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
    onboardingStepComplete("journey", {
      journey: { declaredInPhaseHistory: true },
    }),
    true
  );
  assert.equal(onboardingStepComplete("people", { peopleAdded: true }), true);
});

test("step 3 reads every piece of evidence a declared journey leaves", () => {
  // #306 and #675 are the two halves of one rule, and each broke when the
  // other's evidence was the only one read.
  //
  // #306: "not sure, and no date yet" is a real answer that writes no launch
  // row and leaves `current_phase` at 0. Read the columns alone and the
  // planter who answered looks exactly like the planter who never saw the
  // step, so the nudge asks forever.
  assert.equal(
    onboardingStepComplete("journey", {
      journey: {
        declaredInPhaseHistory: true,
        currentPhase: 0,
        hasLaunch: false,
      },
    }),
    true,
    "the declaration row answers on its own, every column empty"
  );

  // #675: the converse. A plant on Phase 5 with a launch date, whose phase
  // arrived through the phase control rather than through step 3, has no
  // declaration row — and was told its phase and launch date were "still
  // unset" while the control beside the nudge showed both.
  assert.equal(
    onboardingStepComplete("journey", {
      journey: { declaredInPhaseHistory: false, currentPhase: 5 },
    }),
    true,
    "a phase above zero is a declared journey, however it got there"
  );
  assert.equal(
    onboardingStepComplete("journey", {
      journey: { declaredInPhaseHistory: false, hasLaunch: true },
    }),
    true,
    "a launch row is a named day, and step 3 is the only place to say no day"
  );

  // The case the nudge exists for: no record anywhere that the question was
  // ever put to this planter.
  assert.equal(
    onboardingStepComplete("journey", {
      journey: {
        declaredInPhaseHistory: false,
        currentPhase: 0,
        hasLaunch: false,
      },
    }),
    false,
    "no declaration, no phase, no launch — the step is genuinely unanswered"
  );
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

test("step 1 is where a planter resumes if and only if there is no church", () => {
  // This equivalence is not a curiosity — `addressableOnboardingStep` RESTS on
  // it. The client cannot see the church row, so it reads "may step 1 still be
  // opened?" off the step the server landed it on. If resumption ever returned
  // step 1 for a planter who has a church, the flow would start honouring
  // `?step=basics` again and the 2026-08-10 ruling would silently unwind.
  assert.equal(resolveResumeStep({}), "basics");
  assert.equal(resolveResumeStep({ churchId: null }), "basics");

  for (const facts of [
    {},
    { leadershipStatus: "planter_confirmed" as const },
    { journeyDeclared: true },
    { leadershipStatus: "no_planter" as const, peopleAdded: true },
  ]) {
    assert.notEqual(
      resolveResumeStep({ ...facts, churchId: CHURCH_ID }),
      "basics",
      "a church exists, so step 1 is answered and never resumed to"
    );
  }
});

// ----------------------------------------------------------------------------
// #373 / ruling 2026-08-10 — which step a URL may open
//
// The guard used to live inline in an async server component, where the only
// available test was a regex over the page's own source: enough to catch a
// deletion, blind to a wrong ANSWER — which is exactly how the repeated-param
// hole passed a green suite. It is a pure function now, so these are calls.
// ----------------------------------------------------------------------------

test("a request naming no step, or naming garbage, is left to the resume rule", () => {
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: undefined, churchId: CHURCH_ID }),
    { outcome: "none" }
  );

  // Refused as a step, but NOT redirected: the resume rule is a better answer
  // than a navigation, and the flow's own stamp rewrites the URL afterwards.
  for (const value of ["", "finish", "Journey", "journey "]) {
    assert.deepEqual(
      resolveOnboardingStepRequest({ step: value, churchId: CHURCH_ID }),
      { outcome: "none" },
      value
    );
  }
});

test("step 1 is addressable exactly while there is no church, later steps exactly once there is", () => {
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "basics", churchId: undefined }),
    { outcome: "honour", step: "basics" }
  );
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "basics", churchId: CHURCH_ID }),
    { outcome: "none" }
  );

  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "journey", churchId: undefined }),
    { outcome: "refuse" }
  );
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "journey", churchId: CHURCH_ID }),
    { outcome: "honour", step: "journey" }
  );
});

test("a repeated `?step=` names no step and is refused", () => {
  // Next hands `?step=a&step=b` back as an array. Typed as a plain string it
  // satisfied neither branch of the old inline guard, so it bypassed it whole.
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: ["journey"], churchId: CHURCH_ID }),
    { outcome: "refuse" }
  );
  assert.deepEqual(
    resolveOnboardingStepRequest({
      step: ["journey", "journey"],
      churchId: undefined,
    }),
    { outcome: "refuse" }
  );
});

test("a finished dashboard honours no step, save the leadership re-entry", () => {
  // #373 AC 3: nothing owns `?step=` past onboarding, so a value left in the
  // address bar would put the wiki guide on a finished dashboard (#367 ruling).
  assert.deepEqual(resolveFinishedDashboardStepRequest(undefined), {
    outcome: "none",
  });
  assert.deepEqual(resolveFinishedDashboardStepRequest("leadership"), {
    outcome: "leadership",
  });

  // Every other value goes, recognised or not — past this point there is no
  // flow left to resume into. `journey` is the Back-button case: finishing
  // from step 3 pushes `?churchCreated=true`, so Back lands on a finished
  // `/dashboard?step=journey`.
  for (const value of [
    "journey",
    "basics",
    "people",
    "",
    "finish",
    "Leadership",
  ]) {
    assert.deepEqual(
      resolveFinishedDashboardStepRequest(value),
      { outcome: "refuse" },
      value
    );
  }
});

test("a repeated `?step=` is refused on a finished dashboard too", () => {
  // An array equals no literal — including `?step=leadership&step=leadership`,
  // which must not re-enter with the guide's own reader pointed elsewhere.
  for (const value of [
    ["leadership"],
    ["leadership", "leadership"],
    ["leadership", "journey"],
  ]) {
    assert.deepEqual(
      resolveFinishedDashboardStepRequest(value),
      { outcome: "refuse" },
      JSON.stringify(value)
    );
  }
});

test("the client refuses a step the page would not resolve", () => {
  // `addressableOnboardingStep` is the same rule on the other side, with
  // `initialStep` standing in for the church row.
  assert.equal(addressableOnboardingStep("journey", "leadership"), "journey");
  assert.equal(addressableOnboardingStep("basics", "basics"), "basics");
  assert.equal(addressableOnboardingStep("basics", "people"), null);

  // Garbage names no step here either — the flow falls back to `initialStep`.
  for (const value of [null, undefined, "", "finish", 3, ["journey"]]) {
    assert.equal(addressableOnboardingStep(value, "journey"), null);
  }
});

// ----------------------------------------------------------------------------
// Step 3's options (OB-003 + OB-005)
//
// The picker's list is product surface, not component detail: what a planter is
// offered, and which phase each answer means, decides what gets written to
// `churches.current_phase` and to phase history. So it is pinned here, where
// both the picker and the write path read it from.
// ----------------------------------------------------------------------------

test("the stage picker offers the seven phases plus an escape hatch", () => {
  assert.equal(JOURNEY_STAGE_OPTIONS.length, 8);

  // Every phase 0-6 exactly once, in order, before the escape hatch.
  const phases = JOURNEY_STAGE_OPTIONS.slice(0, 7).map((o) => o.phase);
  assert.deepEqual(phases, [0, 1, 2, 3, 4, 5, 6]);

  const last = JOURNEY_STAGE_OPTIONS[JOURNEY_STAGE_OPTIONS.length - 1];
  assert.equal(last.value, JOURNEY_STAGE_NOT_SURE);
});

test("the options are in plain language, not phase numbers", () => {
  // FRD AC: "the seven phases in plain language". The methodology's own name
  // rides along in `phaseName` so the vocabulary is still visible — but a
  // planter who has not read the Playbook has to be able to place themselves,
  // which "Phase 2: Launch Team Formation" alone does not let them do.
  for (const option of JOURNEY_STAGE_OPTIONS) {
    assert.doesNotMatch(option.label, /^Phase \d/);
    assert.ok(option.hint.length > 0);
    assert.match(option.phaseName, /^Phase \d/);
  }
});

test("'not sure' starts the planter at the beginning", () => {
  assert.equal(phaseForJourneyStage(JOURNEY_STAGE_NOT_SURE), 0);
});

test("a submitted stage becomes a phase in exactly one place", () => {
  assert.equal(phaseForJourneyStage("0"), 0);
  assert.equal(phaseForJourneyStage("3"), 3);
  assert.equal(phaseForJourneyStage("6"), 6);
});

test("an unknown stage is refused, never defaulted to Discovery", () => {
  // A POST carrying `stage=9` is a caller error. Defaulting it to 0 would
  // record a Discovery declaration the planter never made — and phase history
  // is append-only, so there is no taking it back.
  for (const bad of ["9", "-1", "", "phase-3", null, undefined, 3]) {
    assert.equal(phaseForJourneyStage(bad), null);
  }
});

test("a stored phase reads back as the stage the picker offered", () => {
  // The inverse of `phaseForJourneyStage`, and the refusal message's whole
  // vocabulary: "your starting stage is already recorded as 3" names a number
  // the planter never chose. They chose a sentence.
  assert.equal(journeyStageForPhase(3)?.label, "We are training the teams");
  assert.equal(journeyStageForPhase(3)?.phaseName, PHASES[3]);
  assert.equal(journeyStageForPhase(6)?.label, "We have launched");

  // Phase 0 resolves to the real stage, not to the "not sure" escape hatch that
  // also writes 0 — only the number survives the write, so the honest reading
  // back is the stage, not a guess at which door the planter came through.
  assert.equal(
    journeyStageForPhase(0)?.value,
    "0",
    "phase 0 is Discovery, not the escape hatch"
  );

  // Nothing is invented for a phase the picker does not offer.
  assert.equal(journeyStageForPhase(9), null);
  assert.equal(journeyStageForPhase(-1), null);
});

test("every offered stage round-trips through both directions", () => {
  for (const option of JOURNEY_STAGE_OPTIONS) {
    assert.equal(phaseForJourneyStage(option.value), option.phase);
    // Not `option.value` — two options share phase 0 on purpose.
    assert.equal(journeyStageForPhase(option.phase)?.phase, option.phase);
  }
});

test("'no date yet' is one of two explicit answers, not a blank field", () => {
  assert.deepEqual([...LAUNCH_DATE_CHOICES], ["date", "none"]);
  assert.equal(isLaunchDateChoice("none"), true);
  assert.equal(isLaunchDateChoice("date"), true);
  assert.equal(isLaunchDateChoice("maybe"), false);
  assert.equal(isLaunchDateChoice(null), false);
});

// ----------------------------------------------------------------------------
// #397 — the flow's URL writes, as a rule that can be CALLED
//
// These used to be a ternary and two `window.history.*` calls inside
// `onboarding-flow-client.tsx`, pinned by regex against that component's
// source — a pin that broke on a local rename and passed a `pushState` swapped
// for a `replaceState`. The rule lives here now, so the assertions below are
// the rule being exercised rather than the component being read.
// ----------------------------------------------------------------------------

/** The dashboard sitting on `from`'s own URL — what the flow reads at the write. */
function sittingOn(from: OnboardingStepId | null) {
  return {
    pathname: "/dashboard",
    search: from === null ? "" : `?step=${from}`,
  };
}

test("a write is owed exactly when the address bar does not already say it", () => {
  // Exhaustive over the state space, because "did anything change?" is the
  // condition that keeps the arrival stamp from fighting every push: a stamp
  // that fires unconditionally rewrites history on every render.
  for (const from of [null, ...ONBOARDING_STEP_IDS]) {
    for (const to of [null, ...ONBOARDING_STEP_IDS]) {
      const location = sittingOn(from);
      const write = historyWriteFor({ from, to, location });

      if (from === to) {
        assert.equal(write, null, `${from} → ${to} needs no write`);
        continue;
      }

      assert.ok(write, `${from} → ${to} must be written`);
      assert.equal(write.url, onboardingStepUrl(location, to));
    }
  }
});

test("push or replace is decided by the step being LEFT, and by nothing else", () => {
  // Four replacements, one push, and each replacement has its own reason:
  //   - to === null   the finish screen is not a step and not a navigation
  //   - from === null arriving (or healing a declined value) is not navigating
  //   - from === to   the URL is being healed, not navigated
  //   - from is step 1 ruled 2026-08-10: step 1 is not in the history, because
  //                   the only way off it is creating the church
  assert.equal(
    historyWriteFor({
      from: "journey",
      to: null,
      location: sittingOn("journey"),
    })?.method,
    "replace"
  );
  assert.equal(
    historyWriteFor({ from: null, to: "journey", location: sittingOn(null) })
      ?.method,
    "replace"
  );
  assert.equal(
    historyWriteFor({
      from: "basics",
      to: "leadership",
      location: sittingOn("basics"),
    })?.method,
    "replace"
  );
  assert.equal(
    historyWriteFor({
      from: "leadership",
      to: "journey",
      location: sittingOn("leadership"),
    })?.method,
    "push"
  );

  // A write that does not change WHICH step is named is a HEAL, and a heal is
  // never a navigation. `.get()` takes the FIRST value of a repeated param, so
  // `from` is `"journey"` here rather than null — the only consumer of this
  // path is the flow's stamping effect, and every write it can produce has to
  // be a replace or the first Back is a no-op that appears to do nothing.
  assert.deepEqual(
    historyWriteFor({
      from: "journey",
      to: "journey",
      location: {
        pathname: "/dashboard",
        search: "?step=journey&step=journey",
      },
    }),
    { method: "replace", url: "/dashboard?step=journey" }
  );
  // Same shape, reached by a neighbour param `URLSearchParams` re-spells: a
  // valueless `&foo` becomes `foo=`, and a space becomes `+`.
  for (const search of ["?step=journey&foo", "?step=journey&note=a%20b"]) {
    assert.equal(
      historyWriteFor({
        from: "journey",
        to: "journey",
        location: { pathname: "/dashboard", search },
      })?.method,
      "replace",
      search
    );
  }

  // The push is the general case: every step after the first gives Back the
  // step just left.
  for (const from of ONBOARDING_STEP_IDS.filter(
    (id) => !isFirstOnboardingStep(id)
  )) {
    for (const to of ONBOARDING_STEP_IDS.filter((id) => id !== from)) {
      assert.equal(
        historyWriteFor({ from, to, location: sittingOn(from) })?.method,
        "push",
        `${from} → ${to}`
      );
    }
  }
});

test("the step param is edited into the URL, never rebuilt over it", () => {
  // `?churchCreated=true` is the confetti's only trigger. A step change that
  // rebuilt the query from scratch would drop it on the way to step 2.
  assert.equal(
    onboardingStepUrl(
      { pathname: "/dashboard", search: "?churchCreated=true" },
      "journey"
    ),
    "/dashboard?churchCreated=true&step=journey"
  );
  assert.equal(
    onboardingStepUrl(
      { pathname: "/dashboard", search: "?churchCreated=true&step=journey" },
      null
    ),
    "/dashboard?churchCreated=true"
  );
  assert.equal(onboardingStepUrl(sittingOn(null), null), "/dashboard");
});

test("the finish screen is OPEN before it is SHOWING, and that gap is the fix", () => {
  // Two questions, not one (#397). `open` says the URL must stop naming a step
  // — it is what the history write is derived from. `showing` says the screen
  // paints, which additionally requires the URL to have already lost the param.
  //
  // Collapsing them back into one is the bug: the wiki guide resolves from the
  // URL and lives outside the flow, so a screen that paints before the param
  // leaves is a frame of "You are set up" under the journey step's Guide pill.
  // Collapsing them the OTHER way (deriving the write from `showing`) is a
  // deadlock: the param would never leave, so the screen would never paint.
  assert.deepEqual(
    onboardingFinishScreen({ urlStep: "journey", finishScreenStep: "journey" }),
    { open: true, showing: false }
  );
  assert.deepEqual(
    onboardingFinishScreen({ urlStep: null, finishScreenStep: "journey" }),
    { open: true, showing: true }
  );

  // Closed while the flow has not opened it...
  for (const urlStep of [null, ...ONBOARDING_STEP_IDS]) {
    assert.deepEqual(
      onboardingFinishScreen({ urlStep, finishScreenStep: null }),
      { open: false, showing: false }
    );
  }

  // ...and closed again once the URL names a DIFFERENT step, which is what
  // browser Back off the screen does.
  for (const urlStep of ONBOARDING_STEP_IDS.filter((id) => id !== "journey")) {
    assert.deepEqual(
      onboardingFinishScreen({ urlStep, finishScreenStep: "journey" }),
      { open: false, showing: false },
      `Back to ${urlStep} closes the screen opened from journey`
    );
  }

  // The property the frame invariant rests on: SHOWING implies the URL names
  // no step, so the screen and any step-scoped guide are mutually exclusive.
  for (const finishScreenStep of [null, ...ONBOARDING_STEP_IDS]) {
    for (const urlStep of [null, ...ONBOARDING_STEP_IDS]) {
      const screen = onboardingFinishScreen({ urlStep, finishScreenStep });
      if (screen.showing) assert.equal(urlStep, null);
    }
  }
});
