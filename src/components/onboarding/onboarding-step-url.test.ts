import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_PARAM,
  isOnboardingStepId,
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
    /isOnboardingStepId\(stepParam\)\s*\?\s*stepParam\s*:\s*initialStep/
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
    /window\.history\.replaceState\(null, "", stepUrl\(step\)\)/
  );
  assert.match(
    FLOW_CODE,
    /if \(stepParam === step\) return;/,
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
  assert.match(PAGE_CODE, /isOnboardingStepId\(step\) \? step : null/);
});

test("a step the server declines is redirected out of the URL, not ignored", () => {
  // OB-004's rule survives: a URL may name a step only once step 1's church
  // exists. What changed is the ENFORCEMENT — the flow now reads the URL, so an
  // ignored value would still be obeyed by the client on the next render. The
  // refusal has to leave the address bar.
  assert.match(
    PAGE_CODE,
    /requestedStep &&\s*\(user\?\.churchId \|\| requestedStep === FIRST_ONBOARDING_STEP\)/
  );
  assert.match(
    PAGE_CODE,
    /if \(requestedStep && !honouredStep\) \{\s*redirect\("\/dashboard"\);/
  );
});
