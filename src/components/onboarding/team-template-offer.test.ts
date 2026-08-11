import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { JOURNEY_STAGE_OPTIONS } from "@/lib/onboarding/steps";
import {
  TEAM_TEMPLATES,
  getTotalRoleTemplateCount,
} from "@/lib/ministry-teams/role-templates";

import {
  TEAM_TEMPLATE_OFFER_MIN_PHASE,
  meetsTeamTemplateOfferPhase,
  shouldOfferTeamTemplates,
  teamTemplateOfferSummary,
} from "./team-template-offer";

// ============================================================================
// F12 / OB-015 — the stage-gated ministry team template offer.
//
// The requirement is a gate and a caller, so the test is in two halves:
//
//   * THE GATE is a real function with a real boundary, so it is tested as one
//     — every stage a planter can declare, against the answer the FRD gives.
//     "Phase 0 or 1 never sees the offer" is the criterion that has to survive
//     someone later deciding the offer would be nice for everyone, and the
//     2026-08-09 ruling adds the other half: the gate reads the PLANT'S STATE,
//     so a resumed session gets the same answer as a straight-through one.
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
const OFFER_CODE = stripComments(
  read("components", "onboarding", "team-template-offer.ts")
);
const FLOW_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow-client.tsx")
);
const FLOW_SERVER_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow.tsx")
);
const TEAM_ACTIONS = read("app", "(dashboard)", "teams", "actions.ts");
const TEAM_ACTIONS_CODE = stripComments(TEAM_ACTIONS);

/**
 * The offer action's body, for assertions about what it is made of. Bounded by
 * the next export, because the comment banners are gone from the stripped
 * source this slices.
 */
const OFFER_ACTION = (() => {
  const start = TEAM_ACTIONS_CODE.indexOf(
    "export async function initializeTeamsWithRolesAction"
  );
  // The next export after the offer. (It was listRolesAction until the #403
  // sweep moved the caller-less reads into teams/queries.ts.)
  const end = TEAM_ACTIONS_CODE.indexOf(
    "export async function createRoleAction"
  );
  assert.ok(start > -1 && end > start, "the offer's action must exist");
  return TEAM_ACTIONS_CODE.slice(start, end);
})();

// ----------------------------------------------------------------------------
// 1. The gate: phase ≥ 2, and nothing else
// ----------------------------------------------------------------------------

test("phase 0 and 1 never see the offer; 2 and later always do", () => {
  assert.equal(TEAM_TEMPLATE_OFFER_MIN_PHASE, 2);

  assert.equal(meetsTeamTemplateOfferPhase(0), false);
  assert.equal(meetsTeamTemplateOfferPhase(1), false);

  for (const phase of [2, 3, 4, 5, 6]) {
    assert.equal(
      meetsTeamTemplateOfferPhase(phase),
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
      shouldOfferTeamTemplates({
        declaredPhase: option.phase,
        teamsInitialized: false,
      }),
      option.phase >= TEAM_TEMPLATE_OFFER_MIN_PHASE,
      `stage "${option.value}" (phase ${option.phase})`
    );
  }
});

test("an unknown declaration is a no, never a guess", () => {
  // A plant with no church row yet, or one whose phase could not be read.
  // Guessing high would push the whole team structure onto a plant that never
  // said it was ready for it.
  for (const phase of [
    null,
    undefined,
    Number.NaN,
    2.5,
    "3" as unknown as number,
  ]) {
    assert.equal(
      shouldOfferTeamTemplates({
        declaredPhase: phase,
        teamsInitialized: false,
      }),
      false,
      `${String(phase)} is not a declaration`
    );
  }
});

// ----------------------------------------------------------------------------
// 2. Ruling 2026-08-09 — the offer is STATE-driven, not path-driven
// ----------------------------------------------------------------------------

test("a plant at phase 2+ with no teams is offered them, whatever the path", () => {
  // The reproduced defect this pins: a planter who declared phase 3 in an
  // earlier session and resumed onboarding today reached a finish screen with
  // nothing on it but "Go to my dashboard". The gate now takes the phase the
  // CHURCH ROW holds, so the two paths cannot answer differently — there is no
  // input to this function that says how the planter got here.
  assert.equal(
    shouldOfferTeamTemplates({ declaredPhase: 3, teamsInitialized: false }),
    true
  );
  assert.equal(
    shouldOfferTeamTemplates({ declaredPhase: 2, teamsInitialized: false }),
    true
  );
});

test("a plant that already has teams is offered nothing", () => {
  // Pressing the card would be a no-op: `initializeTeamsWithRolesAction` refuses
  // a church that already has teams, because the initialization inserts
  // unconditionally. An offer that does nothing is worse than no offer.
  for (const phase of [2, 3, 6]) {
    assert.equal(
      shouldOfferTeamTemplates({
        declaredPhase: phase,
        teamsInitialized: true,
      }),
      false,
      `phase ${phase} with teams already initialized`
    );
  }

  // …and the two halves are AND, not OR: no teams is not enough on its own.
  assert.equal(
    shouldOfferTeamTemplates({ declaredPhase: 1, teamsInitialized: false }),
    false
  );
});

test("the server half resolves both facts and hands them down", () => {
  // The ruling only holds if the phase comes from the church row on EVERY
  // render, so the resumed session sees the same thing the straight-through one
  // does. Reading it in the server component is what makes that true — and is
  // why the client half can hold no copy of it (`data-patterns.md`).
  assert.match(
    FLOW_SERVER_CODE,
    /import \{ getCurrentUserChurch \} from "@\/lib\/auth"/
  );
  assert.match(
    FLOW_SERVER_CODE,
    /import \{ listTeams \} from "@\/lib\/ministry-teams\/service"/
  );
  assert.match(FLOW_SERVER_CODE, /await getCurrentUserChurch\(\)/);
  assert.match(
    FLOW_SERVER_CODE,
    /declaredPhase=\{church\?\.currentPhase \?\? null\}/
  );
  assert.match(FLOW_SERVER_CODE, /teamsInitialized=\{teams\.length > 0\}/);

  // No church means no plant to ask about — and no team read either.
  assert.match(
    FLOW_SERVER_CODE,
    /church \? await listTeams\(church\.id\) : \[\]/
  );

  // The server half is a resolver, not a second flow: it renders the client one
  // and nothing else.
  assert.match(FLOW_SERVER_CODE, /<OnboardingFlowClient/);
  assert.equal(
    FLOW_SERVER_CODE.includes("use client"),
    false,
    "the resolving half must stay a server component"
  );
});

test("the client half never stores the declared phase, it only overrides it", () => {
  // memory/contracts/data-patterns.md — server data arrives as props. The one
  // piece of state is the answer step 3 just reported, which takes precedence
  // over a prop resolved before the declaration existed and is null on every
  // later visit.
  assert.match(
    FLOW_CODE,
    /shouldOfferTeamTemplates\(\{\s*declaredPhase: declaredThisVisit \?\? declaredPhase,\s*teamsInitialized,\s*\}\)/
  );
  assert.equal(
    /useState<number \| null>\(declaredPhase\)/.test(FLOW_CODE),
    false,
    "the prop must not be seeded into state — it would go stale on revalidation"
  );
  assert.equal(/useEffect\(\(\) => set/.test(FLOW_CODE), false);
});

// ----------------------------------------------------------------------------
// 3. The flow shows the screen only through the gate
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
  // `setFinishScreenStep(step)` rather than a bare boolean since #373: the step
  // behind the screen now lives in the URL and can change under it (Back), so
  // the screen records WHICH step it was opened from and closes when the
  // planter returns to another one. The gate above it is unchanged.
  assert.match(
    finishBody,
    /function finish\(\) \{\s*if \(!atFinishScreen && offerTeamTemplates\) \{[\s\S]*?setFinishScreenStep\(step\);\s*return;\s*\}/
  );
  assert.ok(
    finishBody.indexOf("setFinishScreenStep(step)") <
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

  // The gate is evaluated ONCE, and its answer decides the screen and the last
  // step's label — nothing else.
  assert.equal(
    (FLOW_CODE.match(/shouldOfferTeamTemplates\(/g) ?? []).length,
    1
  );
  assert.equal((FLOW_CODE.match(/offerTeamTemplates/g) ?? []).length, 3);
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
    assert.equal(
      FLOW_SERVER_CODE.includes(symbol),
      false,
      `${symbol} belongs to the component that owns it, never to the flow`
    );
  }
});

// ----------------------------------------------------------------------------
// 4. Accepting runs the EXISTING initialization; declining does nothing
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

  // A church that already has teams is skipped without a write. The read is a
  // convenience, not the concurrency guard — that lives in
  // `initializePredefinedTeams` as one insert with `ON CONFLICT DO NOTHING`
  // against `ministry_teams_predefined_name_unique_idx` (migration 0034), and
  // `predefined-teams-guard.test.ts` pins it. The card asks the same question
  // before it appears at all (`shouldOfferTeamTemplates`).
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
// 5. No roster assignment, no role editing — the card links out instead
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

// ----------------------------------------------------------------------------
// 6. The copy: counts come from the templates, and keep their spaces
// ----------------------------------------------------------------------------

test("the offer says what it creates, from the templates themselves", () => {
  // Hard-coded counts in the copy are a promise the templates can break
  // silently, so the numbers are read from the same list the action initializes.
  assert.match(
    OFFER_CODE,
    /import \{\s*TEAM_TEMPLATES,\s*getTotalRoleTemplateCount,\s*\} from "@\/lib\/ministry-teams\/role-templates"/
  );

  const summary = teamTemplateOfferSummary();
  assert.ok(summary.includes(String(TEAM_TEMPLATES.length)));
  assert.ok(summary.includes(String(getTotalRoleTemplateCount())));

  // And the screen renders that one string rather than assembling its own.
  assert.match(SCREEN_CODE, /\{teamTemplateOfferSummary\(\)\}/);
  assert.equal(SCREEN_CODE.includes("TEAM_TEMPLATES.length"), false);

  // It is honest about what it does not do.
  assert.match(SCREEN, /teams start empty/i);
});

test("no count is ever fused to the word after it", () => {
  // The G4 copy defect: a number rendered next to a JSX expression lost its
  // space ("10ministry teams"). The sentence is one string now, so the space is
  // part of it — and this is the assertion that says so for any counts.
  for (const [teams, roles] of [
    [TEAM_TEMPLATES.length, getTotalRoleTemplateCount()],
    [3, 7],
    [1, 1],
  ]) {
    const summary = teamTemplateOfferSummary(teams, roles);
    assert.doesNotMatch(
      summary,
      /\d\p{L}/u,
      `a count is fused to the word after it: ${summary}`
    );
    assert.match(summary, new RegExp(`\\b${teams} standard ministry teams\\b`));
    assert.match(summary, new RegExp(`\\b${roles} role descriptions\\b`));
  }
});

// ----------------------------------------------------------------------------
// 7. Repo rules (FRD AC 7)
// ----------------------------------------------------------------------------

test("every clickable on the finish screen carries cursor-pointer", () => {
  const clickables = SCREEN.match(/<(?:Button|Link)\b[\s\S]*?>/g) ?? [];
  assert.ok(clickables.length > 0, "expected the screen to render controls");

  for (const clickable of clickables) {
    assert.match(
      clickable,
      /cursor-pointer/,
      `a control in finish-screen.tsx is missing cursor-pointer: ${clickable}`
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

// ----------------------------------------------------------------------------
// better-interface G3 — the failure sits with the control that failed
// ----------------------------------------------------------------------------

test("the offer's failure message renders inside the card, beside the button", () => {
  // It used to sit at the top of the screen, above "Your church plant is
  // saved" — a message about the offer, rendered over a line saying everything
  // worked, and on a phone one the planter cannot see from the button that
  // produced it. Nothing above the card failed.
  const card = SCREEN_CODE.slice(
    SCREEN_CODE.indexOf('<div className="border-border'),
    SCREEN_CODE.lastIndexOf("</Button>")
  );
  assert.match(card, /role="alert"/);
  assert.match(card, /\{error\}/);

  // And the button announces the reason with its own accessible name, so the
  // sentence is readable again when focus returns rather than announced once.
  assert.match(
    SCREEN_CODE,
    /aria-describedby=\{error \? errorId : undefined\}/
  );

  // The old top-of-screen slot is gone: exactly one place renders the error.
  assert.equal((SCREEN_CODE.match(/role="alert"/g) ?? []).length, 1);
});

test("both exits report their own progress", () => {
  // `busy` is the FLOW's finish, which either button can start. Reporting it on
  // the wrong control tells a planter who declined that teams are being set up.
  assert.match(
    SCREEN_CODE,
    /aria-busy=\{pending \|\| \(pressed === "accept" && busy\)\}/
  );
  assert.match(SCREEN_CODE, /aria-busy=\{pressed === "decline" && busy\}/);
});
