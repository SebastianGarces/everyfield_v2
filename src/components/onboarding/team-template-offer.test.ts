import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { JOURNEY_STAGE_OPTIONS } from "@/lib/onboarding/steps";

import {
  TEAM_TEMPLATE_OFFER_MIN_PHASE,
  shouldOfferTeamTemplates,
} from "./team-template-offer";

// ============================================================================
// F12 / OB-015 — the stage-gated ministry team template offer.
//
// The requirement is a gate and a caller, so the test is in two halves:
//
//   * THE GATE is a real function with a real boundary, so it is tested as one
//     — every stage a planter can declare, against the answer the FRD gives.
//     "Phase 0 or 1 never sees the offer" is the criterion that has to survive
//     someone later deciding the offer would be nice for everyone.
//
//   * THE CALLER is source-shaped, the form this repo already uses for a call
//     site (`people-step.test.ts`, `journey-step.test.ts`). What OB-015 asks
//     for is mostly NEGATIVE — accepting runs the EXISTING initialization, and
//     the flow grows no roster assignment or role editing — and a forked
//     implementation would look identical right up until the two disagree.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Comments are prose, not code. The forbidden-symbol scans run on the stripped
 * source so these files stay free to EXPLAIN which actions they deliberately do
 * not reach for — naming them is how that explanation is written.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const SCREEN = read("components", "onboarding", "finish-screen.tsx");
const SCREEN_CODE = stripComments(SCREEN);
const FLOW_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow.tsx")
);
const TEAM_ACTIONS = read("app", "(dashboard)", "teams", "actions.ts");
const TEAM_ACTIONS_CODE = stripComments(TEAM_ACTIONS);

/**
 * The new action's body, for assertions about what it is made of. Bounded by
 * the next export, because the comment banners are gone from the stripped
 * source this slices.
 */
const OFFER_ACTION = (() => {
  const start = TEAM_ACTIONS_CODE.indexOf(
    "export async function initializeTeamsWithRolesAction"
  );
  const end = TEAM_ACTIONS_CODE.indexOf(
    "export async function listRolesAction"
  );
  assert.ok(start > -1 && end > start, "the offer's action must exist");
  return TEAM_ACTIONS_CODE.slice(start, end);
})();

// ----------------------------------------------------------------------------
// 1. The gate: phase ≥ 2, and nothing else
// ----------------------------------------------------------------------------

test("phase 0 and 1 never see the offer; 2 and later always do", () => {
  assert.equal(TEAM_TEMPLATE_OFFER_MIN_PHASE, 2);

  assert.equal(shouldOfferTeamTemplates(0), false);
  assert.equal(shouldOfferTeamTemplates(1), false);

  for (const phase of [2, 3, 4, 5, 6]) {
    assert.equal(
      shouldOfferTeamTemplates(phase),
      true,
      `a planter declaring phase ${phase} is forming teams already`
    );
  }
});

test("every stage the picker offers gets a defined answer", () => {
  // The gate's input is whatever step 3 can declare, so the two lists have to
  // agree. "Not sure" resolves to phase 0 and therefore to no offer — which is
  // the point: an unsure planter is not handed ten empty teams.
  for (const option of JOURNEY_STAGE_OPTIONS) {
    assert.equal(
      shouldOfferTeamTemplates(option.phase),
      option.phase >= TEAM_TEMPLATE_OFFER_MIN_PHASE,
      `stage "${option.value}" (phase ${option.phase})`
    );
  }
});

test("an unknown declaration is a no, never a guess", () => {
  // A planter who skipped step 3, or who is finishing from a step they reached
  // without declaring. Guessing high would push the whole team structure onto a
  // plant that never said it was ready for it.
  assert.equal(shouldOfferTeamTemplates(null), false);
  assert.equal(shouldOfferTeamTemplates(undefined), false);
  assert.equal(shouldOfferTeamTemplates(Number.NaN), false);
  assert.equal(shouldOfferTeamTemplates(2.5), false);
  assert.equal(shouldOfferTeamTemplates("3" as unknown as number), false);
});

// ----------------------------------------------------------------------------
// 2. The flow shows the screen only through the gate
// ----------------------------------------------------------------------------

test("the finish screen is reached through the gate, on every way out", () => {
  assert.match(
    FLOW_CODE,
    /import \{ shouldOfferTeamTemplates \} from "\.\/team-template-offer"/
  );
  assert.match(FLOW_CODE, /import \{ FinishScreen \} from "\.\/finish-screen"/);

  // ONE decision point, and it is the flow's single exit — so the offer cannot
  // be reachable from one way out and missing from another. The gate is the
  // first thing `finish()` does, and it RETURNS: an offer that fell through
  // would complete onboarding underneath the screen it just opened.
  const finishBody = FLOW_CODE.slice(FLOW_CODE.indexOf("function finish() {"));
  assert.match(
    finishBody,
    /function finish\(\) \{\s*if \(!atFinishScreen && shouldOfferTeamTemplates\(declaredPhase\)\) \{[\s\S]*?setAtFinishScreen\(true\);\s*return;\s*\}/
  );
  assert.ok(
    finishBody.indexOf("setAtFinishScreen(true)") <
      finishBody.indexOf("startFinishing(")
  );

  // Every exit is that one function.
  assert.equal(
    (FLOW_CODE.match(/onFinish=\{finish\}/g) ?? []).length,
    2,
    "steps 3 and 4 leave through the flow's exit"
  );
  assert.match(FLOW_CODE, /finish\(\);\s*\}/, "forward past the last step");
  assert.match(FLOW_CODE, /onClick=\{finish\}/, "step 2's finish-later");

  // The screen's own "not now" is that same exit, which the `atFinishScreen`
  // guard turns into a plain completion — otherwise declining would re-offer
  // and the flow would have no way out at all.
  assert.match(FLOW_CODE, /<FinishScreen onDone=\{finish\} busy=\{finishing\}/);

  // The gate decides the screen and the last step's label, and nothing else.
  assert.equal(
    (FLOW_CODE.match(/shouldOfferTeamTemplates\(declaredPhase\)/g) ?? [])
      .length,
    2
  );
});

test("the flow still owns no write of its own", () => {
  // OB-007's mechanism, unchanged by OB-015: the flow calls the action that
  // LEAVES it and nothing else. The offer's action belongs to the screen that
  // offers it, exactly as each step's action belongs to the step.
  for (const symbol of [
    "initializeTeamsWithRolesAction",
    "initializeTeamsAction",
    "declareJourney",
  ]) {
    assert.equal(
      FLOW_CODE.includes(symbol),
      false,
      `${symbol} belongs to the component that owns it, never to the flow`
    );
  }
});

// ----------------------------------------------------------------------------
// 3. Accepting runs the EXISTING initialization; declining does nothing
// ----------------------------------------------------------------------------

test("accepting calls the one action, and declining calls none", () => {
  assert.match(
    SCREEN_CODE,
    /import \{ initializeTeamsWithRolesAction \} from "@\/app\/\(dashboard\)\/teams\/actions"/
  );

  // Exactly one invocation, in the accept handler. Declining is `onDone` — the
  // same move as finishing without the offer, which is what "decline does
  // nothing" means in code: there is nothing to undo because nothing ran.
  assert.equal(
    (SCREEN_CODE.match(/initializeTeamsWithRolesAction\(\)/g) ?? []).length,
    1
  );
  const acceptAt = SCREEN_CODE.indexOf("function accept()");
  const callAt = SCREEN_CODE.indexOf("initializeTeamsWithRolesAction()");
  assert.ok(acceptAt > -1 && callAt > acceptAt);

  // The decline handler in full: it leaves, and that is all it does.
  const decline = SCREEN_CODE.slice(
    SCREEN_CODE.indexOf("function decline()"),
    acceptAt
  );
  assert.match(decline, /onDone\(\);/);
  assert.equal(
    /await |Action\(/.test(decline),
    false,
    "declining must reach no server action at all"
  );

  // …and the flow is left only after the action reported success.
  const failureAt = SCREEN_CODE.indexOf("if (!result.success)");
  const doneAt = SCREEN_CODE.indexOf("onDone();", failureAt);
  assert.ok(failureAt > callAt && doneAt > failureAt);
});

test("the offer's action is a caller of the shipped initialization", () => {
  // OB-015 is explicit that onboarding owns the offer, not the templates. Both
  // halves — the teams and their roles — go through the actions /teams already
  // uses, so the two surfaces cannot drift.
  assert.match(OFFER_ACTION, /await initializeTeamsAction\(\)/);
  assert.match(
    OFFER_ACTION,
    /await importRoleTemplatesAction\(team\.id, teamKey\)/
  );

  // No second write path: no template list of its own, and no database reach.
  for (const symbol of [
    "db.insert",
    "db.select",
    "initializePredefinedTeams",
    "importRoleTemplates(",
    "ministryTeams",
  ]) {
    assert.equal(
      OFFER_ACTION.includes(symbol),
      false,
      `the offer must not reach for ${symbol} — the shipped actions own it`
    );
  }

  // Running it against a church that already has teams would duplicate them,
  // because the initialization inserts unconditionally.
  assert.match(OFFER_ACTION, /await listTeamsAction\(\)/);
  assert.match(OFFER_ACTION, /existing\.data\.length > 0/);
});

test("the action takes no argument that names an actor or a church", () => {
  // memory/invariants.md → Authentication: every export of a "use server"
  // module is a POSTable endpoint. This one takes nothing, so a forged POST can
  // only initialize the caller's own plant.
  assert.match(
    TEAM_ACTIONS_CODE,
    /export async function initializeTeamsWithRolesAction\(\): Promise<\s*ActionResult<MinistryTeam\[\]>\s*>/
  );
});

// ----------------------------------------------------------------------------
// 4. No roster assignment, no role editing — the card links out instead
// ----------------------------------------------------------------------------

test("the finish screen carries no staffing or editing surface", () => {
  const forbidden = [
    "assignMemberAction",
    "removeMemberAction",
    "assignTeamLeaderAction",
    "createRoleAction",
    "updateRoleAction",
    "deleteRoleAction",
    "importRoleTemplatesAction",
    "createTeamAction",
    "updateTeamAction",
  ];

  for (const symbol of forbidden) {
    assert.equal(
      SCREEN_CODE.includes(symbol),
      false,
      `finish-screen.tsx must not reference ${symbol} — /teams owns staffing`
    );
  }

  // The one escape hatch OB-015 does ask for.
  assert.match(SCREEN_CODE, /href="\/teams"/);
});

test("the offer says what it creates, from the templates themselves", () => {
  // Hard-coded counts in the copy are a promise the templates can break
  // silently, so the numbers are read from the same list the action initializes.
  assert.match(
    SCREEN_CODE,
    /import \{\s*TEAM_TEMPLATES,\s*getTotalRoleTemplateCount,\s*\} from "@\/lib\/ministry-teams\/role-templates"/
  );
  assert.match(SCREEN_CODE, /TEAM_TEMPLATES\.length/);
  assert.match(SCREEN_CODE, /getTotalRoleTemplateCount\(\)/);

  // And it is honest about what it does not do.
  assert.match(SCREEN, /teams start empty/i);
});

// ----------------------------------------------------------------------------
// 5. Repo rules (FRD AC 7)
// ----------------------------------------------------------------------------

test("every button on the finish screen carries cursor-pointer", () => {
  const buttons = SCREEN.match(/<Button\b[\s\S]*?>/g) ?? [];
  assert.ok(buttons.length > 0, "expected the screen to render buttons");

  for (const button of buttons) {
    assert.match(
      button,
      /cursor-pointer/,
      `a <Button> in finish-screen.tsx is missing cursor-pointer: ${button}`
    );
  }
});

test("the screen holds no server data in state", () => {
  // memory/contracts/data-patterns.md. The only state is the in-flight press
  // and the failure sentence; what was created is read on /teams, after the
  // redirect the action's revalidation feeds.
  assert.equal(/useEffect/.test(SCREEN_CODE), false);
  assert.equal(/router\.refresh/.test(SCREEN_CODE), false);
});
