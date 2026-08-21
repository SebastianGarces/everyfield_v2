import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTIVE_RUBRIC,
  ACTIVE_RUBRIC_VERSION,
  RUBRICS,
  getRubric,
} from "./rubric";

// ----------------------------------------------------------------------------
// The draft-then-flip guard (#469 series).
//
// v1 lands one ruled change at a time across ~18 PRs. Every one of them edits
// RUBRIC_V1_BODY, and every one of them is one keystroke away from flipping the
// version planters actually receive. #538 is the single issue allowed to do
// that, so the constraint lives here as a test instead of as a sentence in a
// spec: v1 is registered, and v0 is what runs.
// ----------------------------------------------------------------------------

test("v1 is registered so it can be reviewed and looked up", () => {
  assert.equal(getRubric("v1")?.version, "v1");
  assert.ok(RUBRICS.v1.body.startsWith("# Plant Intelligence Rubric — v1"));
});

test("v1 is NOT the active rubric — only #538 flips it", () => {
  assert.equal(ACTIVE_RUBRIC_VERSION, "v0");
  assert.equal(ACTIVE_RUBRIC.version, "v0");
});

test("v0 is frozen — its Lens 2 keeps the bottleneck line v1 deletes", () => {
  assert.match(RUBRICS.v0.body, /you're carrying all the follow-up yourself/);
});

test("v1 will not call three weeks flat 'stalled' (#471)", () => {
  // v0 said "growth stalled N weeks" with nothing under it; v1 names the two
  // levels and the facts they read, so the word has a floor the judge cannot
  // slide under.
  assert.match(RUBRICS.v0.body, /growth stalled N weeks/);
  assert.doesNotMatch(RUBRICS.v1.body, /growth stalled N weeks/);
  assert.match(RUBRICS.v1.body, /slowedThresholdDays` \(21\)/);
  assert.match(RUBRICS.v1.body, /stalledThresholdDays` \(28\)/);
  assert.match(RUBRICS.v1.body, /ANY NEW COMMITTED ADULT RESETS BOTH CLOCKS/);
});

test("v1 frames 50/100 as this methodology's benchmark (#472)", () => {
  // The numbers do not change. What changes is that the judge is told whose
  // numbers they are, and forbidden from reading undershoot as a verdict.
  assert.match(RUBRICS.v1.body, /THIS METHODOLOGY'S BENCHMARKS/);
  assert.match(
    RUBRICS.v1.body,
    /may not call a plant unhealthy, or call its size a failure, for being under 50/
  );
  assert.match(RUBRICS.v1.body, /benchmark of 50–100 committed adults/);
});

test("v1 renames Lens 4 to Cohesion and says why (#473)", () => {
  assert.match(RUBRICS.v0.body, /### CSF-4 · Unity/);
  assert.match(RUBRICS.v1.body, /### CSF-4 · Core Group Cohesion/);
  assert.doesNotMatch(RUBRICS.v1.body, /### CSF-4 · Unity/);
  // The rename is only half of it. The other half is telling the judge that
  // the thing it cannot see is the thing the old name claimed.
  assert.match(RUBRICS.v1.body, /THIS LENS IS NOT ABOUT UNITY/);
  assert.match(
    RUBRICS.v1.body,
    /relational judgment for the planter and their coach/
  );
});

test("v1 feeds Lens 5 from rhythms, not from a title (#474)", () => {
  assert.match(RUBRICS.v0.body, /Prayer Leader role assigned\?/);
  assert.match(
    RUBRICS.v1.body,
    /THE PRAYER LEADER TITLE DOES NOT FEED THIS LENS/
  );
  assert.match(RUBRICS.v1.body, /prayer_rhythm_established/);
  assert.match(RUBRICS.v1.body, /prayer_in_gatherings/);
  // The half that stops a blank reading as a pass.
  assert.match(RUBRICS.v1.body, /UNANSWERED IS UNKNOWN, NEVER HEALTHY/);
  assert.match(RUBRICS.v1.body, /STALE IS CITED WITH ITS AGE/);
});

test("v1 scores generosity and solvency apart (#475)", () => {
  // v0 fused them into one line, which is the sentence Bryan objected to.
  assert.match(
    RUBRICS.v0.body,
    /Generosity \(CSF #6\) and 'Finances in place'/
  );
  assert.doesNotMatch(RUBRICS.v1.body, /'Finances in place' are launch gates/);

  assert.match(RUBRICS.v1.body, /### CSF-6 · Generosity & Financial Readiness/);
  assert.match(RUBRICS.v1.body, /core_group_giving/);
  assert.match(RUBRICS.v1.body, /financial_base_established/);
  assert.match(
    RUBRICS.v1.body,
    /YOU MAY NOT READ ONE AS EVIDENCE FOR THE OTHER/
  );
});

test("v1 calls 60 days a candidate signal, not readiness (#476)", () => {
  // v0 handed the judge the verdict in the example itself.
  assert.match(RUBRICS.v0.body, /emerging leader/);
  assert.doesNotMatch(RUBRICS.v1.body, /is the profile of an emerging leader/);

  assert.match(RUBRICS.v1.body, /LEADERSHIP CANDIDATE SIGNAL, NOT READINESS/);
  assert.match(RUBRICS.v1.body, /candidateThresholdDays/);
  assert.match(
    RUBRICS.v1.body,
    /YOU MAY CITE A RECORDED HUMAN JUDGMENT; YOU MAY NEVER MAKE ONE/
  );
  assert.match(
    RUBRICS.v1.body,
    /A MISSING RECORD IS A NEXT STEP, NEVER A MARK AGAINST THE PERSON/
  );
});

test("v1 makes the Phase 1 gate a cluster, not a headcount (#477)", () => {
  assert.match(RUBRICS.v1.body, /CLUSTER OF FIVE, read as a CONJUNCTION/);
  assert.match(
    RUBRICS.v1.body,
    /Hitting 30 with no worship leader and no financial base is NOT the gate/
  );
  assert.match(
    RUBRICS.v1.body,
    /AN UNANSWERED INDICATOR BLOCKS BUT DOES NOT FAIL/
  );
  // The number itself is kept (C23), so v0 and v1 agree on it.
  assert.match(RUBRICS.v0.body, /30–40 committed adults/);
  assert.match(RUBRICS.v1.body, /30–40 committed adults/);
});

test("v1 caps the planter's list at 1 primary + 2 supplements (#478)", () => {
  assert.match(
    RUBRICS.v1.body,
    /ONE PRIMARY FOCUS AND AT MOST TWO SUPPLEMENTS/
  );
  assert.match(
    RUBRICS.v1.body,
    /POSITIVE OBSERVATIONS ARE EXEMPT AND ARE REPORTED SEPARATELY/
  );
  // The budget must not read as an instruction to say less overall.
  assert.match(RUBRICS.v1.body, /FORCES PRIORITIZATION, NOT SILENCE/);
  assert.doesNotMatch(RUBRICS.v0.body, /observation budget/i);
});

test("v1 stops claiming a universal sharing default (#479)", () => {
  // v0 stated it as a fact of the product. It is a fact of ONE of the two ways
  // a plant arrives (ledger row 187): self-started plants share nothing,
  // invited plants start with sharing on and consent at the acceptance screen.
  assert.match(
    RUBRICS.v0.body,
    /Never expose individual person records to the network audience/
  );
  assert.match(RUBRICS.v1.body, /THERE IS NO UNIVERSAL SHARING DEFAULT/);
  assert.match(RUBRICS.v1.body, /Never say "sharing is off by default"/);
  assert.match(
    RUBRICS.v1.body,
    /NEVER EDITORIALIZE ABOUT A PLANT'S SHARING CHOICES/
  );
});

test("v1 will not let silence read as On track (#480)", () => {
  assert.match(RUBRICS.v0.body, /observation, not verdict/);
  assert.match(RUBRICS.v1.body, /FOUR VALUES, NOT THREE/);
  assert.match(RUBRICS.v1.body, /NEVER ONE OF THE THREE HEALTH POSTURES/);
  // Escalations must survive the new posture, or a gated plant with a real
  // problem would be softened into "we cannot see".
  assert.match(RUBRICS.v1.body, /ESCALATIONS STILL WIN/);
  assert.match(RUBRICS.v1.body, /A NEUTRAL FACT, NOT A FAULT/);
});

test("v1 reads role fill as coverage, not as an absence of people (#481)", () => {
  assert.match(
    RUBRICS.v1.body,
    /COVERAGE INSIGHTS ARE ABOUT ASSIGNMENT, NEVER ABOUT THE ABSENCE OF LEADERS AS PEOPLE/
  );
  assert.match(
    RUBRICS.v1.body,
    /TWO PIPELINES, AND THEY ARE NOT THE SAME PIPELINE/
  );
  // The banned phrases have to be NAMED to be bannable — and the ban must not
  // read as licence to use them, so they appear only inside the ban.
  assert.match(RUBRICS.v1.body, /BANNED as inferences from role-fill data/);
  assert.match(RUBRICS.v1.body, /"a lack of emerging leadership"/);
});

test("v1 puts the network in a coaching register (#482)", () => {
  assert.match(
    RUBRICS.v1.body,
    /THE PLANTER SEES IT FIRST, AND EVERY NETWORK CONCERN IS ALSO A PLANTER CONCERN/
  );
  assert.match(RUBRICS.v1.body, /BANNED IN NETWORK-AUDIENCE TEXT/);
  assert.match(RUBRICS.v1.body, /PATTERN, NOT CAUSE/);
  // The one idiom the ban must not swallow.
  assert.match(RUBRICS.v1.body, /"critical mass" is the name of CSF-3/);
});

test("v1 may not claim the planter carries follow-up", () => {
  assert.doesNotMatch(RUBRICS.v1.body, /carrying all the follow-up/);
  assert.match(RUBRICS.v1.body, /Make sure each one has a clear owner/);
  assert.match(RUBRICS.v1.body, /You own 6 of the 9 open follow-ups/);
});
