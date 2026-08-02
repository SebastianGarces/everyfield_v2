import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHURCH_LEADERSHIP_STATUSES,
  DEFAULT_LEADERSHIP_ANSWER,
  LEADERSHIP_STEP_HREF,
  NO_PLANTER_LIMITS,
  churchHasNoPlanter,
  isLeadershipAnswer,
  leadershipAnswerForStatus,
  leadershipAnswered,
  leadershipStatusForAnswer,
} from "./leadership";

// ----------------------------------------------------------------------------
// F12 / OB-004 — the pastor confirmation, as rules.
//
// The whole point of this step is that the assumption of #157 ("the first
// account is the planter") is written down instead of implied. These tests pin
// the three states apart, because the interesting bug is the two-state one:
// treating "never asked" as "no planter" would light the nudge on every church
// that predates this step and strip the assignee off their follow-up tasks.
// ----------------------------------------------------------------------------

test("the flow's default answer is Yes (#157: assume, but ask)", () => {
  assert.equal(DEFAULT_LEADERSHIP_ANSWER, "yes");
  assert.equal(leadershipAnswerForStatus(null), "yes");
  assert.equal(leadershipAnswerForStatus(undefined), "yes");
});

test("Yes records the planter-confirmed state, No the no-planter one", () => {
  assert.equal(leadershipStatusForAnswer("yes"), "planter_confirmed");
  assert.equal(leadershipStatusForAnswer("no"), "no_planter");
});

test("every declared status round-trips back to the answer that made it", () => {
  for (const status of CHURCH_LEADERSHIP_STATUSES) {
    assert.equal(
      leadershipStatusForAnswer(leadershipAnswerForStatus(status)),
      status,
      status
    );
  }
});

test("only 'yes' and 'no' are accepted off the wire", () => {
  assert.equal(isLeadershipAnswer("yes"), true);
  assert.equal(isLeadershipAnswer("no"), true);

  for (const value of ["", "Yes", "true", "planter_confirmed", null, 1, {}]) {
    assert.equal(isLeadershipAnswer(value), false, JSON.stringify(value));
  }
});

// ----------------------------------------------------------------------------
// The three states. `null` is not `"no_planter"`.
// ----------------------------------------------------------------------------

test("a church that was never asked has no answer and no no-planter state", () => {
  const neverAsked = { leadershipStatus: null };

  assert.equal(leadershipAnswered(neverAsked), false);
  // The load-bearing one: pre-OB-004 churches keep inferring their planter from
  // the role, so this change cannot retro-orphan them.
  assert.equal(churchHasNoPlanter(neverAsked), false);
  assert.equal(churchHasNoPlanter({ leadershipStatus: undefined }), false);
});

test("confirming a planter answers the step and leaves a planter in place", () => {
  const confirmed = { leadershipStatus: "planter_confirmed" as const };

  assert.equal(leadershipAnswered(confirmed), true);
  assert.equal(churchHasNoPlanter(confirmed), false);
});

test("answering No is an answer AND the explicit no-planter state", () => {
  const declined = { leadershipStatus: "no_planter" as const };

  assert.equal(leadershipAnswered(declined), true);
  // This is the predicate the dashboard nudge and the follow-up-task assignee
  // lookup both read. With it true, `handleMeetingAttendanceFinalized` takes
  // the sanctioned no-planter path — it warns and returns rather than throwing,
  // so the meeting still finalizes (FRD AC 4).
  assert.equal(churchHasNoPlanter(declined), true);
});

test("the step is resumable-past once answered either way", () => {
  for (const status of CHURCH_LEADERSHIP_STATUSES) {
    assert.equal(
      leadershipAnswered({ leadershipStatus: status }),
      true,
      status
    );
  }
});

// ----------------------------------------------------------------------------
// Copy and the re-entry path are contract, not decoration: the FRD requires the
// step to explain what No limits, and the nudge to link back to the step.
// ----------------------------------------------------------------------------

test("answering No comes with an explanation of what it limits", () => {
  assert.ok(NO_PLANTER_LIMITS.length > 0);
  assert.ok(
    NO_PLANTER_LIMITS.some((limit) => /task/i.test(limit)),
    "the limit planters actually feel is follow-up task assignment"
  );
});

test("the nudge's link re-enters the leadership step specifically", () => {
  assert.equal(LEADERSHIP_STEP_HREF, "/dashboard?step=leadership");
});
