import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  isSkippableOnboardingStep,
  onboardingStep,
} from "@/lib/onboarding/steps";

// ============================================================================
// F12 / OB-003 + OB-005 — step 3, the journey declaration.
//
// The two hardest guarantees here are both NEGATIVES, and neither is observable
// by rendering the step:
//
//   * the launch date is written through the launch ENTITY's service write path
//     and never to a column on `churches`. `churches.launch_date` was dropped
//     by migration 0032 (LS-001), so a second write path would not merely
//     duplicate the journal, the oversight announcement and the Playbook
//     milestone seed — it would not compile against a column that exists.
//     Going through `scheduleLaunchAction` is what makes "setting the date from
//     onboarding lands on the same rail as any other date set" structural.
//
//   * "no date yet" writes NOTHING. A `planning` placeholder row would be
//     indistinguishable, to every reader downstream, from a plant that has
//     started planning a launch — and the countdown has to read empty, not
//     zero.
//
// Both live in the import graph and in one branch of one action, so they are
// pinned against the source — the repo's established form for a call site
// (`people-step.test.ts`, `onboarding-flow.test.ts`).
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Comments are prose, not code. The forbidden-symbol scans below run on the
 * stripped source so these files stay free to EXPLAIN which write paths they
 * deliberately do not touch — naming a dropped column is how that explanation
 * gets written.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const STEP = read("components", "onboarding", "journey-step.tsx");
const STEP_CODE = stripComments(STEP);
const FLOW_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow.tsx")
);
const ACTIONS_CODE = stripComments(
  read("app", "(dashboard)", "dashboard", "actions.ts")
);

// ----------------------------------------------------------------------------
// 1. The launch date goes through the entity, never a column on `churches`
// ----------------------------------------------------------------------------

test("the date is written through the launch entity's service rail", () => {
  assert.match(
    ACTIONS_CODE,
    /import \{ scheduleLaunchAction \} from "@\/app\/\(dashboard\)\/launch\/actions"/
  );
  assert.match(ACTIONS_CODE, /await scheduleLaunchAction\(\{/);
});

test("no onboarding surface writes a launch date to the church row", () => {
  // `churches.launch_date` does not exist (migration 0032). Naming it — or
  // reaching for the service that used to own it — is the regression this
  // guards, and it is worth guarding because the column shape is what every
  // pre-0032 example in the repo's history shows.
  for (const source of [STEP_CODE, ACTIONS_CODE]) {
    assert.equal(/launch_date/.test(source), false);
    assert.equal(/churches\/launch-date/.test(source), false);
  }

  // The action may not hand-roll the write either: the guards (the row lock,
  // the compare-and-set, the `launch_events` journal) live in
  // `src/lib/launch/service.ts`, and an action with its own statement would be
  // a second write path with none of them.
  assert.equal(/setLaunchDateStatement/.test(ACTIONS_CODE), false);
  assert.equal(/update\(launches\)/.test(ACTIONS_CODE), false);
});

// ----------------------------------------------------------------------------
// 2. "No date yet" stores nothing
// ----------------------------------------------------------------------------

test("'no date yet' reaches no launch write at all", () => {
  // The schedule call is inside the branch that has a date. Hoisted out — or
  // called with a null/empty target "so the row exists" — a planter who said
  // they have no date would get a launch row anyway, and the countdown would
  // have something to render.
  const branch = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("if (rawDate)"),
    ACTIONS_CODE.indexOf("try {")
  );
  assert.match(branch, /await scheduleLaunchAction\(/);
  assert.equal(
    (ACTIONS_CODE.match(/scheduleLaunchAction\(/g) ?? []).length,
    1,
    "exactly one call site, and it is the one inside the has-a-date branch"
  );

  // No placeholder row by any other route either.
  assert.equal(/planning/.test(ACTIONS_CODE), false);
  assert.equal(/insert\(launches\)/.test(ACTIONS_CODE), false);
});

// ----------------------------------------------------------------------------
// 3. The stage declaration is a declaration, not a transition
// ----------------------------------------------------------------------------

test("the stage goes through declareInitialPhase, not transitionPhase", () => {
  assert.match(
    ACTIONS_CODE,
    /import \{ declareInitialPhase \} from "@\/lib\/phase-engine\/transitions"/
  );
  assert.match(ACTIONS_CODE, /await declareInitialPhase\(/);
  assert.equal(
    /transitionPhase\(/.test(ACTIONS_CODE),
    false,
    "a transition would claim the planter moved phases inside EveryField"
  );
});

test("the date is written BEFORE the declaration captures its snapshot", () => {
  // The declaration's fact snapshot includes the launch countdown. Declared
  // first, the plant's own audit row would record it as having no launch date
  // moments before it acquired one.
  const scheduleAt = ACTIONS_CODE.indexOf("scheduleLaunchAction(");
  const declareAt = ACTIONS_CODE.indexOf("declareInitialPhase(");
  assert.ok(scheduleAt > -1 && declareAt > scheduleAt);
});

test("the stage value becomes a phase through the one parser", () => {
  assert.match(ACTIONS_CODE, /phaseForJourneyStage\(input\.stage\)/);
  assert.match(
    ACTIONS_CODE,
    /if \(phase === null\)/,
    "an unrecognised stage is refused, not defaulted"
  );
});

// ----------------------------------------------------------------------------
// 4. The step is wired into the flow, commits independently, and is skippable
// ----------------------------------------------------------------------------

test("the flow renders the journey step rather than a shell", () => {
  assert.match(FLOW_CODE, /import \{ JourneyStep \} from "\.\/journey-step"/);
  assert.match(FLOW_CODE, /<JourneyStep/);

  // The flow still owns no step's write (OB-007): step 3's action belongs to
  // step 3, exactly as step 1's and step 2's belong to theirs.
  assert.equal(/declareJourney/.test(FLOW_CODE), false);
});

test("the flow advances only once the declaration has committed", () => {
  assert.match(FLOW_CODE, /onDeclared=\{goForward\}/);
  assert.match(STEP_CODE, /onDeclared\(\)/);

  // …and the advance is inside the success arm, after the error arm returns.
  const errorAt = STEP_CODE.indexOf('result.status === "error"');
  const advanceAt = STEP_CODE.indexOf("onDeclared()");
  assert.ok(errorAt > -1 && advanceAt > errorAt);
});

test("step 3 is skippable, and skipping writes nothing", () => {
  assert.equal(isSkippableOnboardingStep("journey"), true);
  assert.equal(onboardingStep("journey").number, 3);

  // Skip is the flow's plain forward move — a skip with its own handler could
  // grow a save, and the whole point of the control is that nothing commits.
  assert.match(FLOW_CODE, /onSkip=\{goForward\}/);
});

test("the step holds no server data in state", () => {
  // memory/contracts/data-patterns.md. The only `useState` here is the
  // planter's own in-progress input; server data never round-trips through it,
  // and there is no `useEffect` syncing anything.
  assert.equal(/useEffect/.test(STEP_CODE), false);
  assert.equal(/router\.refresh/.test(STEP_CODE), false);
});

// ----------------------------------------------------------------------------
// 5. "Did they answer step 3?" is asked of phase history
// ----------------------------------------------------------------------------

test("the step-3 fact comes from the declaration record, not the columns", () => {
  // Inferring it from `current_phase > 0 || a launch date` cannot see the
  // honest answer: "not sure — start me at the beginning" plus "no date yet"
  // leaves phase 0 and no launch row, so the planter who answered and the
  // planter who never saw the step look identical, and the OB-011 nudge would
  // keep asking forever.
  const page = stripComments(
    read("app", "(dashboard)", "dashboard", "page.tsx")
  );

  assert.match(page, /hasInitialPhaseDeclaration\(churchId\)/);
  assert.match(page, /journeyDeclared,/);
  assert.equal(
    /journeyDeclared: !!launch\?\.targetDate/.test(page),
    false,
    "the column-shaped inference is gone, not merely supplemented"
  );
});

// ----------------------------------------------------------------------------
// 6. The document merge fields read the real value
// ----------------------------------------------------------------------------

test("both document call sites source the launch date from the entity", () => {
  const page = read("app", "(dashboard)", "documents", "page.tsx");
  const route = read("app", "api", "documents", "[templateId]", "route.ts");

  for (const [name, source] of [
    ["documents/page.tsx", page],
    ["api/documents/[templateId]/route.ts", route],
  ] as const) {
    assert.match(
      source,
      /import \{ getLaunchForChurch \} from "@\/lib\/launch\/queries"/,
      `${name} must read the launch entity`
    );
    assert.match(
      source,
      /launchDate: launch\?\.targetDate \?\? null/,
      `${name} must pass the stored date, not a stub`
    );
    // The stale "null because sourcing is #203's job" stubs are gone — a
    // hardcoded null that outlives its reason reads as a decision.
    assert.equal(
      /launchDate: null/.test(stripComments(source)),
      false,
      `${name} must no longer hardcode a null launch date`
    );
  }
});
