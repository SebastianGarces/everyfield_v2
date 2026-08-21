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

test("v1 may not claim the planter carries follow-up", () => {
  assert.doesNotMatch(RUBRICS.v1.body, /carrying all the follow-up/);
  assert.match(RUBRICS.v1.body, /Make sure each one has a clear owner/);
  assert.match(RUBRICS.v1.body, /You own 6 of the 9 open follow-ups/);
});
