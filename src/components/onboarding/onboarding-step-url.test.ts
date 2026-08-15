import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_PARAM,
  addressableOnboardingStep,
  historyWriteFor,
  isOnboardingStepId,
  onboardingFinishScreen,
  onboardingStepUrl,
  resolveFinishedDashboardStepRequest,
  resolveOnboardingStepRequest,
  type OnboardingStepId,
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
// THE CONTRACT BETWEEN THE FLOW AND THE GUIDE IS REAL BEHAVIOUR AND IS
// ASSERTED AS SUCH — the URL the flow writes on step 3 is the URL the dormant
// guide entry from PR #367 was keyed on, and the URLs it writes elsewhere match
// nothing. If either side drifts, the Guide button appears on the wrong step or
// disappears from the right one, and nothing else in the suite would notice.
//
// #397 — AND IT IS ASSERTED BY CALLING, not by reading the component's source.
// This file used to pin the flow's history writes with regexes over
// `onboarding-flow-client.tsx`: `const urlStepParam … = atFinishScreen ? null :
// step;` and the push/replace split. That is a pin with both failure modes at
// once — it broke on a local rename that changed nothing a planter can see, and
// it passed a `pushState` swapped for a `replaceState`, which changes what the
// browser's Back button does. The decision now lives in `steps.ts` as
// `historyWriteFor` / `onboardingFinishScreen`, the component only applies the
// `{method, url}` it is handed, and everything below EXERCISES the rule.
//
// The `?step=` guard on the PAGES is still read off their source: those are
// call sites in files this work does not own, and "the page calls the shared
// resolver" is a wiring fact with nothing to call.
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

const PAGE_CODE = stripComments(
  read("app", "(dashboard)", "dashboard", "page.tsx")
);
// The onboarding half of the split route — the flow's own `?step=` guard
// lives with the flow it guards.
const ONBOARDING_PAGE_CODE = stripComments(
  read("app", "(dashboard)", "dashboard", "onboarding-dashboard.tsx")
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
// AC 1 + AC 4 + AC 5 — the history writes, exercised
// ----------------------------------------------------------------------------

/** The dashboard, sitting on `search`. Shaped like `window.location`. */
function at(search: string) {
  return { pathname: "/dashboard", search };
}

/**
 * The params object the wiki guide's provider builds for a URL, so a URL the
 * flow WRITES can be handed straight to the resolver the guide READS.
 *
 * `forEach` on purpose: that is the provider's own loop
 * (`wiki-guide-provider.tsx`), which is why a repeated param resolves to its
 * LAST value there and to its first through `useSearchParams().get()`.
 */
function guideParamsFor(url: string): Record<string, string> {
  const params = new URL(url, "https://everyfield.test").searchParams;
  const obj: Record<string, string> = {};
  params.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

test("moving between steps pushes, so Back returns to the step just left", () => {
  // The push IS the Back button: one entry per step the planter moved through.
  assert.deepEqual(
    historyWriteFor({
      from: "leadership",
      to: "journey",
      location: at("?step=leadership"),
    }),
    { method: "push", url: "/dashboard?step=journey" }
  );
  assert.deepEqual(
    historyWriteFor({
      from: "journey",
      to: "people",
      location: at("?step=journey"),
    }),
    { method: "push", url: "/dashboard?step=people" }
  );
});

test("arriving stamps the step without adding a history entry", () => {
  // AC 1 is about RESUMING, not only navigating: a planter whose first render
  // lands on step 3 must end up at `/dashboard?step=journey` or the guide never
  // matches for the planters it exists for. `replace` because arriving is not
  // navigating — a pushed entry here makes the first Back look broken.
  assert.deepEqual(
    historyWriteFor({ from: null, to: "journey", location: at("") }),
    {
      method: "replace",
      url: "/dashboard?step=journey",
    }
  );

  // And the stamp is conditional, or it would fight every push: once the URL
  // says it, there is nothing to write.
  assert.equal(
    historyWriteFor({
      from: "journey",
      to: "journey",
      location: at("?step=journey"),
    }),
    null
  );
});

test("a value the client declined is healed out of the address bar", () => {
  // `?step=journey%20` names no step, so the flow shows the server's resume
  // answer — and the URL has to catch up, or the address bar keeps claiming
  // something the flow is not doing. `from` is null because the client's guard
  // already declined the raw value; the write is still owed because the URL
  // this produces differs from the one showing.
  assert.deepEqual(
    historyWriteFor({
      from: null,
      to: "journey",
      location: at("?step=journey%20"),
    }),
    { method: "replace", url: "/dashboard?step=journey" }
  );

  // A REPEATED param collapses to one value for the same reason — `params.set`
  // is what does it, and the server refuses the request in the meantime.
  assert.deepEqual(
    historyWriteFor({
      from: null,
      to: "journey",
      location: at("?step=journey&step=journey"),
    }),
    { method: "replace", url: "/dashboard?step=journey" }
  );
});

test("every other query param survives a step change", () => {
  // `?churchCreated=true` fires the confetti. Rebuilding the query from scratch
  // instead of editing the one on the address bar would drop it.
  assert.deepEqual(
    historyWriteFor({
      from: "leadership",
      to: "journey",
      location: at("?churchCreated=true&step=leadership"),
    }),
    { method: "push", url: "/dashboard?churchCreated=true&step=journey" }
  );

  // Including when the step is REMOVED for the finish screen: the param goes,
  // and nothing else does.
  assert.equal(
    onboardingStepUrl(at("?churchCreated=true&step=journey"), null),
    "/dashboard?churchCreated=true"
  );
  // …and with nothing else on it, the query goes entirely rather than leaving a
  // bare `?`.
  assert.equal(onboardingStepUrl(at("?step=journey"), null), "/dashboard");
});

// ----------------------------------------------------------------------------
// The server half — the guard #373 widened rather than removed
// ----------------------------------------------------------------------------

test("the page resolves `?step=` through the shared guard", () => {
  assert.match(
    ONBOARDING_PAGE_CODE,
    /const stepRequest = resolveOnboardingStepRequest\(\{ step, churchId \}\);/,
    "the decision is CALLED, not restated inline where only a regex can see it"
  );
  assert.match(
    ONBOARDING_PAGE_CODE,
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
    ONBOARDING_PAGE_CODE,
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
  // the branch, not merely somewhere in the file. The rule itself is the pure
  // `resolveFinishedDashboardStepRequest` (exercised by `steps.test.ts`);
  // what this pins is that the finished half of the page actually calls it
  // and redirects on its refusal.
  const branchStart = PAGE_CODE.indexOf("shouldShowOnboarding({");
  assert.ok(branchStart > 0, "the onboarding branch must still exist");
  const branchEnd = PAGE_CODE.indexOf("\n  }\n", branchStart);
  assert.ok(branchEnd > branchStart, "the onboarding branch must still close");
  const finishedDashboardCode = PAGE_CODE.slice(branchEnd);

  assert.match(
    finishedDashboardCode,
    /const stepRequest = resolveFinishedDashboardStepRequest\(step\);/,
    "the finished dashboard's `?step=` decision is CALLED, never re-derived"
  );
  assert.match(
    finishedDashboardCode,
    /if \(stepRequest\.outcome === "refuse"\) \{\s*redirect\("\/dashboard"\);/,
    "a finished dashboard must redirect every `?step=` but OB-004's leadership"
  );
  assert.deepEqual(resolveFinishedDashboardStepRequest("journey"), {
    outcome: "refuse",
  });
  assert.deepEqual(resolveFinishedDashboardStepRequest("leadership"), {
    outcome: "leadership",
  });

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
  assert.deepEqual(
    historyWriteFor({
      from: "journey",
      to: null,
      location: at("?step=journey"),
    }),
    { method: "replace", url: "/dashboard" },
    "the finish screen's URL carries no step — and REMOVES the param rather than writing an empty one"
  );

  // `replace`, never `push`: the finish screen is the screen the planter is
  // already on minus a param, so it owes the history nothing. Pushing would put
  // an entry between the last step and wherever the planter came from.

  // And no fifth step id was smuggled in to carry it.
  assert.equal(ONBOARDING_STEP_IDS.length, 4);
  assert.equal(isOnboardingStepId("finish"), false);

  // The behaviour that buys: the URL the finish screen leaves behind resolves
  // no guide entry, so there is no Guide button to paint over the offer. An
  // empty `?step=` would NOT have done this — it is a present param, and the
  // finished-dashboard redirect above would fire on it after onboarding ends.
  assert.equal(resolveGuideEntry("/dashboard", {}), null);
  assert.equal(
    resolveGuideEntry(
      "/dashboard",
      guideParamsFor(onboardingStepUrl(at("?step=journey"), null))
    ),
    null,
    "the URL the flow writes for the finish screen must match no guide entry"
  );
});

// ----------------------------------------------------------------------------
// #397 (1) — and NO FRAME paints the offer with the journey Guide pill over it
// ----------------------------------------------------------------------------

test("a painted finish screen and a Guide pill cannot share a frame", () => {
  // The bug this replaces was worth exactly one frame in 180, and it was a
  // frame in which the planter saw "You are set up" under a button offering to
  // explain a question the screen does not ask.
  //
  // The cause was a race between two readers of the same URL that update at
  // different times: `atFinishScreen` flipped during render, while the param
  // left in a passive effect — and Next dispatches a shallow URL change inside
  // a `startTransition`, so no layout effect can pull the guide's re-render
  // back before the paint. The guide is not even a descendant of the flow
  // (`WikiGuide` is a sibling of the dashboard's children), so there is no
  // context to suppress it through either.
  //
  // The fix is to stop racing: the finish screen does not PAINT until the URL
  // agrees. Both readers read the same `useSearchParams()`, so the property
  // below holds for every state the flow can be in, and holds by construction
  // rather than by timing.
  const steps: (OnboardingStepId | null)[] = [null, ...ONBOARDING_STEP_IDS];

  for (const finishScreenStep of steps) {
    for (const urlStep of steps) {
      const screen = onboardingFinishScreen({ urlStep, finishScreenStep });
      // The URL the flow is sitting on in this state.
      const url = onboardingStepUrl(at(""), urlStep);
      const guide = resolveGuideEntry("/dashboard", guideParamsFor(url));

      if (screen.showing) {
        assert.equal(
          guide,
          null,
          `the finish screen must never paint while ${url} resolves a guide`
        );
      }
    }
  }

  // The frame BEFORE it is a correct pairing rather than a wrong one: the step
  // behind the screen is still showing, and so is that step's own guide.
  const pending = onboardingFinishScreen({
    urlStep: "journey",
    finishScreenStep: "journey",
  });
  assert.deepEqual(pending, { open: true, showing: false });
  assert.ok(
    resolveGuideEntry("/dashboard", { [ONBOARDING_STEP_PARAM]: "journey" }),
    "the journey step is what is painted in that frame, guide and all"
  );

  // And the flow gets out of that frame, because the write is derived from
  // `open` — waiting for the paint to decide to strip the param would be a
  // deadlock in which "Finish setup later" did nothing at all.
  const write = historyWriteFor({
    from: "journey",
    to: pending.open ? null : "journey",
    location: at("?step=journey"),
  });
  assert.deepEqual(write, { method: "replace", url: "/dashboard" });

  // One write later, the screen is showing and the guide is gone.
  assert.deepEqual(
    onboardingFinishScreen({ urlStep: null, finishScreenStep: "journey" }),
    { open: true, showing: true }
  );
  assert.equal(
    resolveGuideEntry("/dashboard", guideParamsFor(write!.url)),
    null
  );
});

test("browser Back off the finish screen closes it rather than repainting it", () => {
  // Back moves the URL to a step id again, and the screen belongs to the step
  // it was opened from — so returning to a DIFFERENT step closes it instead of
  // leaving the offer painted over a step the planter has already returned to.
  assert.deepEqual(
    onboardingFinishScreen({
      urlStep: "leadership",
      finishScreenStep: "journey",
    }),
    { open: false, showing: false }
  );

  // And with the screen closed there is nothing to strip: the URL says what is
  // showing.
  assert.deepEqual(
    onboardingFinishScreen({ urlStep: null, finishScreenStep: null }),
    { open: false, showing: false }
  );
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
  assert.deepEqual(
    historyWriteFor({
      from: "basics",
      to: "leadership",
      location: at("?step=basics"),
    }),
    { method: "replace", url: "/dashboard?step=leadership" }
  );

  // The other three steps still push, or Back leaves the flow from anywhere.
  for (const from of ONBOARDING_STEP_IDS) {
    const to = from === "people" ? "journey" : "people";
    assert.equal(
      historyWriteFor({ from, to, location: at(`?step=${from}`) })?.method,
      from === "basics" ? "replace" : "push",
      `leaving ${from} writes the wrong kind of history entry`
    );
  }
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
