import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ONBOARDING_STEP_IDS, resolveResumeStep } from "@/lib/onboarding/steps";

// ============================================================================
// OB-007 / #307 — the flow's contract with the server.
//
// `steps.test.ts` owns the RULES (which step is skippable, where a returning
// planter resumes) and `create-church.test.ts` owns step 1's WRITE. What is
// left over is the wiring between them, and it is where the FRD's two hardest
// guarantees actually live:
//
//   - "each step commits independently — a save failure on one step never
//     loses prior steps". That is true of this component because it holds no
//     answers: it never calls a step's save action, so there is nothing
//     accumulated in memory for a later failure to lose. A component that
//     cannot submit cannot half-submit.
//
//   - "abandoning and returning resumes at the first incomplete step, with the
//     earlier answers intact". Resumption is a SERVER decision — the page
//     derives `initialStep` from the church row — and the answers are intact
//     only because the recorded ones are handed back down into the step that
//     asked for them.
//
// Both are one-line bindings that a refactor can quietly drop while every
// other test stays green, so they are pinned against the source, the form this
// repo already uses for a call site (`people-step.test.ts`,
// `invitations-ui.test.ts`).
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Comments are prose, not code. The forbidden-symbol scan runs on the stripped
 * source so the flow stays free to EXPLAIN which write paths it deliberately
 * does not touch — naming them is how that explanation is written.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// The flow is two files: a server component that resolves the facts OB-015's
// offer is gated on, and the client component that runs the steps. Everything
// below is about the interactive half.
const FLOW = read("components", "onboarding", "onboarding-flow-client.tsx");
const FLOW_CODE = stripComments(FLOW);
const FLOW_SERVER_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow.tsx")
);
const ACTIONS = read("app", "(dashboard)", "dashboard", "actions.ts");

// ----------------------------------------------------------------------------
// Independent commits (FRD NFR)
// ----------------------------------------------------------------------------

test("the flow owns no step's write, so it cannot lose one", () => {
  // The only server action this component may reach for is the one that LEAVES
  // it. Step 1's create and step 2's answer belong to the steps themselves, and
  // that is the whole mechanism behind "each step commits independently": the
  // flow has no draft to submit at the end and no failure that could discard an
  // earlier step's saved answer.
  assert.match(FLOW_CODE, /import \{ completeOnboarding \}/);

  for (const action of ["createChurchBasics", "confirmLeadership"]) {
    assert.doesNotMatch(
      FLOW_CODE,
      new RegExp(action),
      `${action} belongs to the step that owns it, never to the flow`
    );
  }
});

test("the flow advances only once a step reports its write committed", () => {
  // `onCreated` and `onSaved` fire after the step's action has returned
  // success, so forward motion always trails a commit. A step wired to advance
  // on submit instead would move the planter past an answer that never landed —
  // the FRD's "a save failure never loses prior steps" read backwards.
  assert.match(FLOW_CODE, /onCreated=\{goForward\}/);
  assert.match(FLOW_CODE, /onSaved=\{goForward\}/);
});

// ----------------------------------------------------------------------------
// Resume (FRD AC 5)
// ----------------------------------------------------------------------------

test("where the planter lands is the server's decision, and the URL's fallback", () => {
  // `initialStep` is derived from the church row by the page. Since #373 it is
  // the FALLBACK the flow uses when the URL names no step, not a seed copied
  // into state — which step is showing afterwards is the URL, and the URL is
  // the planter's own navigation. A reload re-derives it, which is what makes
  // abandoning the flow safe without anything being persisted per step.
  assert.match(
    FLOW_CODE,
    /const step: OnboardingStepId = urlStep \?\? finishScreenStep \?\? initialStep;/,
    "the step showing is read from the URL, falling back to the server's answer"
  );

  // And the rule it is derived from, stated once here so the binding above has
  // a meaning attached: after step 2 is answered, resumption is step 3.
  assert.equal(
    resolveResumeStep({
      churchId: "22222222-2222-4222-8222-222222222222",
      leadershipStatus: "planter_confirmed",
    }),
    ONBOARDING_STEP_IDS[2]
  );
});

test("the call site still imports one component, and it is the server half", () => {
  // Splitting the flow in two must not move work onto the pages that render it:
  // `OnboardingFlow` keeps the same name and the same two props, and resolves
  // OB-015's facts itself. A page that had to pass them would be a page that
  // could forget to.
  assert.match(
    FLOW_SERVER_CODE,
    /export async function OnboardingFlow\(\{\s*initialStep,\s*leadershipStatus,\s*\}/
  );
  assert.match(
    read("app", "(dashboard)", "dashboard", "onboarding-dashboard.tsx"),
    /import \{ OnboardingFlow \} from "@\/components\/onboarding\/onboarding-flow"/
  );
  assert.match(FLOW, /^"use client";/);
});

test("the recorded leadership answer comes back down into step 2", () => {
  // "Steps 1-2 answers intact" is only observable if the answer the church row
  // holds is what step 2 opens on. Without this the planter resumes past a
  // question they answered No to and finds it showing the default Yes — the
  // flow would be quietly offering to overwrite their answer.
  assert.match(
    FLOW_CODE,
    /initialAnswer=\{leadershipAnswerForStatus\(leadershipStatus\)\}/
  );
});

// ----------------------------------------------------------------------------
// #243 — the losing tab of a double step-1 submit
// ----------------------------------------------------------------------------

test("the already-have-church branch's revalidate really is revalidatePath", () => {
  // `create-church.test.ts` proves that branch calls `deps.revalidate` before
  // reporting success. That only buys the losing tab a fresh render if the dep
  // the action injects is the real cache invalidation — and at the LAYOUT
  // level, since while onboarding is unfinished the flow IS the dashboard's
  // primary content, so the page alone is not the thing that changed.
  assert.match(ACTIONS, /from "next\/cache"/);
  assert.match(
    ACTIONS,
    /function revalidateDashboard\(\)\s*\{\s*revalidatePath\("\/",\s*"layout"\);/,
    "the injected revalidate has to invalidate the layout, not just the page"
  );
  assert.match(
    ACTIONS,
    /createChurchDeps\(revalidateDashboard\)/,
    "step 1's write path must be handed the real revalidate"
  );
});
