import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_PARAM,
  addressableOnboardingStep,
  isOnboardingStepId,
  resolveOnboardingStepRequest,
} from "@/lib/onboarding/steps";
import { resolveGuideEntry, wikiGuideConfig } from "@/lib/wiki/guide-config";

// ============================================================================
// #373 — the onboarding flow's step lives in the URL.
//
// The flow has no route of its own: it renders AS the dashboard while
// `onboarding_completed_at` is null. So `?step=` is the ONLY way anything
// outside the flow can tell which step is showing, and the contextual wiki
// guide has to know — it is scoped to step 3 alone (ruled on PR #367, option C:
// no guide on the finished dashboard and none on steps 1/2/4).
//
// That makes this file two kinds of test, and both are load bearing:
//
//   - The CONTRACT between the flow and the guide is real behaviour and is
//     asserted as such: the exact URL the flow writes on step 3 is the URL the
//     dormant guide entry from PR #367 was keyed on, and the URLs it writes on
//     the other three match nothing. If either side drifts, the Guide button
//     appears on the wrong step or disappears from the right one, and nothing
//     else in the suite would notice.
//
//   - The WIRING is pinned against the source, the form this repo already uses
//     for a call site (`onboarding-flow.test.ts`, `people-step.test.ts`). The
//     step is URL-derived rather than mirrored into state, and the writes are
//     shallow (`window.history.*`, not `router.push`) — one `useState` or one
//     `router.push` reintroduced would keep every other test green while
//     breaking Back, the deep link, or the "no server re-render" requirement.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** Comments are prose; the scans below run on code only. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const FLOW_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow-client.tsx")
);
const PAGE_CODE = stripComments(
  read("app", "(dashboard)", "dashboard", "page.tsx")
);

// ----------------------------------------------------------------------------
// The param itself
// ----------------------------------------------------------------------------

test("the step param is `step`, the name OB-004 already used", () => {
  // OB-004's re-entry link (`/dashboard?step=leadership`) shipped before this
  // and still points at a finished dashboard. Reusing the name is what keeps
  // one param meaning one thing; a second name would leave two ways to say
  // "which step", and the guide config could only be keyed on one of them.
  assert.equal(ONBOARDING_STEP_PARAM, "step");
});

test("only the four steps are accepted as a `?step=` value", () => {
  for (const id of ONBOARDING_STEP_IDS) {
    assert.equal(isOnboardingStepId(id), true, `${id} is a step`);
  }

  // Garbage names no step. The point is that it is REFUSED rather than coerced
  // to a default: a `?step=journey%20` typo must fall back to the server's
  // resume rule, not silently become step 3.
  for (const value of [
    "finish",
    "Journey",
    "journey ",
    "",
    null,
    undefined,
    3,
    ["journey"],
  ]) {
    assert.equal(isOnboardingStepId(value), false, `${String(value)} is not`);
  }
});

// ----------------------------------------------------------------------------
// AC 2 + AC 3 — the contract with the wiki guide
// ----------------------------------------------------------------------------

test("the URL the flow writes on step 3 is the one the guide entry is keyed on", () => {
  // The dormant entry landed in PR #367 keyed on `/dashboard?step=journey` and
  // is deliberately NOT changed by this work. This is the assertion that wakes
  // it up: the flow writes `?step=<id>`, `journey` is that step's id, and the
  // resolver matches the pair.
  const entry = resolveGuideEntry("/dashboard", {
    [ONBOARDING_STEP_PARAM]: "journey",
  });

  assert.ok(entry, "the journey step must resolve a guide entry");
  assert.equal(entry.label, "Your Journey Guide");
  assert.ok(entry.slugs.length > 0, "an entry with no slugs shows no button");
  assert.deepEqual(entry, wikiGuideConfig["/dashboard?step=journey"]);
});

test("steps 1, 2 and 4 and the finished dashboard resolve no guide at all", () => {
  // Option C stated as the thing a planter sees: the Guide button renders only
  // when `resolveGuideEntry` returns an entry (`wiki-guide-button.tsx` →
  // `isAvailable`), so "no entry" IS "no button".
  for (const id of ONBOARDING_STEP_IDS.filter((s) => s !== "journey")) {
    assert.equal(
      resolveGuideEntry("/dashboard", { [ONBOARDING_STEP_PARAM]: id }),
      null,
      `step ${id} must show no Guide button`
    );
  }

  // The finished dashboard: onboarding is over, the flow stamps nothing, and
  // the bare path was deliberately left without an entry.
  assert.equal(resolveGuideEntry("/dashboard"), null);
  assert.equal(
    resolveGuideEntry("/dashboard", { churchCreated: "true" }),
    null
  );

  // And OB-004's re-entry, which is a finished dashboard answering one
  // question — not step 2 of the flow.
  assert.equal(
    resolveGuideEntry("/dashboard", { [ONBOARDING_STEP_PARAM]: "leadership" }),
    null
  );
});

// ----------------------------------------------------------------------------
// AC 1 + AC 4 + AC 5 — the wiring
// ----------------------------------------------------------------------------

test("the step showing is read from the URL, not mirrored into state", () => {
  assert.match(
    FLOW_CODE,
    /searchParams\.get\(ONBOARDING_STEP_PARAM\)/,
    "the flow has to READ the param, or a deep link opens on step 1"
  );
  assert.match(
    FLOW_CODE,
    /addressableOnboardingStep\(stepParam, initialStep\)/,
    "the URL's step goes through the client's half of the page's guard"
  );
  assert.match(
    FLOW_CODE,
    /const step: OnboardingStepId = urlStep \?\? finishScreenStep \?\? initialStep;/,
    "the URL wins, the finish screen holds the step behind it, the server is last"
  );

  // The anti-assertion is the important one. A `useState` copy of the step
  // would keep every visible behaviour of the flow working while silently
  // breaking Back and Forward: the URL would move and the render would not.
  assert.doesNotMatch(
    FLOW_CODE,
    /setStep\b/,
    "a state copy of the step desynchronises from the address bar"
  );
});

test("moving between steps is a shallow history push, never a router navigation", () => {
  // `router.push` re-runs the server render and fetches an RSC payload for
  // every step change — the one thing #373 says must not happen. `pushState`
  // is patched by Next so `useSearchParams` (here AND in the guide's provider)
  // sees the new value with no request at all.
  assert.match(
    FLOW_CODE,
    /window\.history\.pushState\(null, "", stepUrl\(next\)\)/
  );
  assert.doesNotMatch(FLOW_CODE, /useRouter|router\.(push|replace)\(/);

  // And the push is what gives Back something to return to: one entry per step
  // the planter moved through.
  assert.match(FLOW_CODE, /function goTo\(next: OnboardingStepId\)/);
});

test("arriving stamps the step without adding a history entry", () => {
  // AC 1 is about RESUMING, not only navigating: a planter whose first render
  // lands on step 3 must end up at `/dashboard?step=journey` or the guide never
  // matches for the planters it exists for. `replaceState` because arriving is
  // not navigating — a pushed entry here makes the first Back look broken.
  assert.match(
    FLOW_CODE,
    /window\.history\.replaceState\(null, "", stepUrl\(urlStepParam\)\)/
  );
  assert.match(
    FLOW_CODE,
    /if \(stepParam === urlStepParam\) return;/,
    "the stamp must be conditional, or it fights every push"
  );
});

test("every other query param survives a step change", () => {
  // Built from `window.location.search` rather than from a fresh
  // URLSearchParams, so `?churchCreated=true` and anything else on the URL is
  // still there after the flow rewrites the step.
  assert.match(
    FLOW_CODE,
    /new URLSearchParams\(window\.location\.search\)[\s\S]*params\.set\(ONBOARDING_STEP_PARAM, step\)/
  );
});

// ----------------------------------------------------------------------------
// The server half — the guard #373 widened rather than removed
// ----------------------------------------------------------------------------

test("the page resolves `?step=` through the shared guard", () => {
  assert.match(
    PAGE_CODE,
    /const stepRequest = resolveOnboardingStepRequest\(\{\s*step,\s*churchId: user\?\.churchId,\s*\}\);/,
    "the decision is CALLED, not restated inline where only a regex can see it"
  );
  assert.match(
    PAGE_CODE,
    /stepRequest\.outcome === "honour"\s*\?\s*stepRequest\.step\s*:\s*resolveResumeStep\(/,
    "an honoured step wins; anything else falls to the resume rule"
  );
});

test("a step the server declines is redirected out of the URL, not ignored", () => {
  // OB-004's rule survives: a URL may name a LATER step only once step 1's
  // church exists. What changed is the ENFORCEMENT — the flow now reads the
  // URL, so an ignored value would still be obeyed by the client on the next
  // render. The refusal has to leave the address bar.
  assert.match(
    PAGE_CODE,
    /if \(stepRequest\.outcome === "refuse"\) \{\s*redirect\("\/dashboard"\);/
  );

  // And the rule itself, exercised by calling it rather than by reading the
  // page's source — which is the point of the extraction (PR #390 warning 2).
  for (const id of ONBOARDING_STEP_IDS.filter((s) => s !== "basics")) {
    assert.deepEqual(
      resolveOnboardingStepRequest({ step: id, churchId: undefined }),
      { outcome: "refuse" },
      `${id} may not be addressed before the church exists`
    );
    assert.deepEqual(
      resolveOnboardingStepRequest({ step: id, churchId: "church-1" }),
      { outcome: "honour", step: id }
    );
  }
});

// ----------------------------------------------------------------------------
// PR #390 warning 1 — a REPEATED `?step=` bypassed the guard entirely
// ----------------------------------------------------------------------------

test("a repeated `?step=` is refused, not resolved to one of its values", () => {
  // Next hands `?step=journey&step=journey` back as an array. Typed as a plain
  // string it satisfied neither the honour path nor the refusal, so a planter
  // with NO CHURCH landed on step 3 — while `useSearchParams().get()` on the
  // client happily took the first value. Refusing is what settles it, and it
  // has to be refusal rather than "take the first": the wiki guide's provider
  // builds its params object with `forEach`, so it takes the LAST value, and
  // `?step=leadership&step=journey` would otherwise show one screen with
  // another screen's guide.
  assert.deepEqual(
    resolveOnboardingStepRequest({
      step: ["journey", "journey"],
      churchId: undefined,
    }),
    { outcome: "refuse" }
  );

  // Refused even when every value is legal and the church exists — the point is
  // that it names no ONE step, not that its values are bad.
  assert.deepEqual(
    resolveOnboardingStepRequest({
      step: ["leadership", "journey"],
      churchId: "church-1",
    }),
    { outcome: "refuse" }
  );
});

test("a FINISHED dashboard refuses a stray `?step=` too, not only the flow", () => {
  // AC 3's second half, and the half that was reachable in the first attempt.
  //
  // The refusal above lives INSIDE the `shouldShowOnboarding` branch, so it
  // stops running the moment `onboarding_completed_at` is set — and nothing
  // else scrubs the param. The guide resolves from pathname + search params
  // alone (`wiki-guide-provider.tsx`), so a finished dashboard sitting at
  // `/dashboard?step=journey` renders the Guide button, which the PR #367
  // ruling (option C) forbids. Reached without typing anything: finish from the
  // journey step, land on `/dashboard?churchCreated=true` (a Server Action
  // redirect is a history PUSH), press Back.
  //
  // So the slice below is the point of the test — the refusal has to be AFTER
  // the branch, not merely somewhere in the file.
  const branchStart = PAGE_CODE.indexOf("shouldShowOnboarding({");
  assert.ok(branchStart > 0, "the onboarding branch must still exist");
  const branchEnd = PAGE_CODE.indexOf("\n  }\n", branchStart);
  assert.ok(branchEnd > branchStart, "the onboarding branch must still close");
  const finishedDashboardCode = PAGE_CODE.slice(branchEnd);

  assert.match(
    finishedDashboardCode,
    /if \(step !== undefined && !wantsLeadershipStep\) \{\s*redirect\("\/dashboard"\);/,
    "a finished dashboard must redirect every `?step=` but OB-004's leadership"
  );

  // And the reason it must: this is the one `?step=` value that resolves a
  // guide entry, so it is the one that must never survive onto a finished
  // dashboard. `leadership` is the exception the redirect keeps, and it
  // resolves nothing — asserted above — so keeping it shows no button either.
  assert.ok(
    resolveGuideEntry("/dashboard", { [ONBOARDING_STEP_PARAM]: "journey" }),
    "the journey guide entry is what makes the stray param dangerous"
  );
});

// ----------------------------------------------------------------------------
// Ruling 2026-08-10 (1) — no Guide on the OB-015 finish screen, and no URL
// for it either
// ----------------------------------------------------------------------------

test("the finish screen takes the step OUT of the URL rather than inventing one", () => {
  // Ruled option B: suppress the guide there, without giving the screen a
  // `?step=` of its own — a fifth value would be a shareable URL that reopens
  // an offer whose gate the planter already answered.
  //
  // So the mechanism is subtraction, and it is the SAME writer that stamps the
  // step, not a second way to answer "is the guide on?".
  assert.match(
    FLOW_CODE,
    /const urlStepParam: OnboardingStepId \| null = atFinishScreen \? null : step;/,
    "the finish screen's URL carries no step"
  );
  assert.match(
    FLOW_CODE,
    /if \(step === null\) params\.delete\(ONBOARDING_STEP_PARAM\);/,
    "`stepUrl(null)` has to REMOVE the param, not write an empty one"
  );

  // And no fifth step id was smuggled in to carry it.
  assert.equal(ONBOARDING_STEP_IDS.length, 4);
  assert.equal(isOnboardingStepId("finish"), false);

  // The behaviour that buys: the URL the finish screen leaves behind resolves
  // no guide entry, so there is no Guide button to paint over the offer. An
  // empty `?step=` would NOT have done this — it is a present param, and the
  // finished-dashboard redirect above would fire on it after onboarding ends.
  assert.equal(resolveGuideEntry("/dashboard", {}), null);
});

// ----------------------------------------------------------------------------
// Ruling 2026-08-10 (2) — step 1 is not in the browser's step history
// ----------------------------------------------------------------------------

test("leaving step 1 replaces its history entry instead of pushing", () => {
  // The only way off step 1 is creating the church, so by then step 1 is not
  // re-enterable — and browser Back was landing planters on its empty, required
  // form whose second submit `runCreateChurch` discards. Replacing takes the
  // entry out of the history; every other step still pushes, so Back inside the
  // flow keeps working from step 2 onward.
  assert.match(
    FLOW_CODE,
    /if \(isFirstOnboardingStep\(step\)\) \{\s*window\.history\.replaceState\(null, "", stepUrl\(next\)\);\s*return;\s*\}/
  );
  assert.match(
    FLOW_CODE,
    /window\.history\.pushState\(null, "", stepUrl\(next\)\)/,
    "the other three steps still push, or Back leaves the flow from anywhere"
  );
});

test("the deep link `?step=basics` is refused by BOTH halves once the church exists", () => {
  // The ruling covers the second door into the same room. The server declines
  // to honour it...
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "basics", churchId: "church-1" }),
    { outcome: "none" },
    "a closed step 1 falls to the resume rule"
  );

  // ...and deliberately does NOT redirect, because this exact URL is the one
  // showing while step 1's own create action revalidates. A refusal there would
  // fire during the planter's own submit and throw them out of the flow.
  assert.deepEqual(
    resolveOnboardingStepRequest({ step: "basics", churchId: undefined }),
    { outcome: "honour", step: "basics" },
    "step 1 stays addressable while there is no church to have created"
  );

  // The client is the other half: it reads the step from the URL, so the page
  // declining a value only matters if the flow declines it too. `initialStep`
  // is the church's proxy — the server lands a planter on step 1 exactly while
  // there is none.
  assert.equal(addressableOnboardingStep("basics", "leadership"), null);
  assert.equal(addressableOnboardingStep("basics", "basics"), "basics");
  assert.equal(addressableOnboardingStep("journey", "leadership"), "journey");
});
