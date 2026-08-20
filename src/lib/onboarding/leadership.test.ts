import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields } from "@/lib/auth/tenancy";

import {
  CHURCH_LEADERSHIP_STATUSES,
  DEFAULT_LEADERSHIP_ANSWER,
  LEADERSHIP_STEP_HREF,
  NO_PLANTER_LIMITS,
  canAnswerLeadershipQuestion,
  churchHasNoPlanter,
  isLeadershipAnswer,
  leadershipAnswerForStatus,
  leadershipAnswered,
  leadershipStatusForAnswer,
  leadershipWritePlan,
  resolvedLeadershipStatus,
  shouldPromptPastorConfirmation,
  shouldShowNoPlanterNudge,
  type ChurchLeadershipState,
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

/**
 * A viewer with the given seat in `CHURCH_ID`. The two oversight FKs are null
 * on every one of them, because `LeadershipViewer` is `SeatFields` and all
 * three tenancy columns are required — a fixture that omitted one would be
 * asserting about a shape `oversightOrgOf` never sees.
 */
function viewer(
  seat: SeatFields["seat"],
  churchId: string | null = CHURCH_ID
): SeatFields {
  return { seat, churchId, sendingChurchId: null, sendingNetworkId: null };
}

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

// ----------------------------------------------------------------------------
// OB-010 — the one-time pastor confirmation.
//
// The bug this rules out is the two-state one again, one level up: a church can
// have a PLANTER and no recorded ANSWER, and treating that as unanswered would
// ask every church created before OB-004 a question it has already lived the
// answer to. The FRD's open question 3 rules the implicit assignment
// (`users.church_id` + role) as confirmation, so `hasPlanterUser` is an input
// here and never derived from the column.
// ----------------------------------------------------------------------------

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

function churchState(
  overrides: Partial<ChurchLeadershipState> = {}
): ChurchLeadershipState {
  return {
    churchId: CHURCH_ID,
    leadershipStatus: null,
    hasPlanterUser: false,
    ...overrides,
  };
}

test("a plant with a planter and no recorded answer is treated as confirmed", () => {
  const church = churchState({ hasPlanterUser: true });

  assert.equal(resolvedLeadershipStatus(church), "planter_confirmed");
  assert.equal(shouldPromptPastorConfirmation(viewer("member"), church), false);
});

test("the resolved status never overwrites a recorded one", () => {
  // A plant that answered No and then somehow has a planter row keeps its
  // answer: the column is what somebody said, and nothing here writes back.
  assert.equal(
    resolvedLeadershipStatus(
      churchState({ leadershipStatus: "no_planter", hasPlanterUser: true })
    ),
    "no_planter"
  );
});

test("the prompt fires only for an empty seat with no answer", () => {
  const who = viewer("member");

  assert.equal(shouldPromptPastorConfirmation(who, churchState()), true);

  for (const status of CHURCH_LEADERSHIP_STATUSES) {
    assert.equal(
      shouldPromptPastorConfirmation(
        who,
        churchState({ leadershipStatus: status })
      ),
      false,
      `answered ${status} — never ask again`
    );
  }
});

test("the prompt never reaches somebody else's plant, or a tenancy that leads none", () => {
  const church = churchState();

  assert.equal(
    shouldPromptPastorConfirmation(
      viewer("member", "44444444-4444-4444-8444-444444444444"),
      church
    ),
    false
  );

  // The three shapes the old role list refused, in the seat model's terms: a
  // coach holds no seat, and an oversight account's tenancy is not this plant
  // however its `church_id` reads.
  const leadsNobody: [string, SeatFields][] = [
    ["a coach", { ...viewer(null), churchId: CHURCH_ID }],
    [
      "a sending church's Owner",
      { ...viewer("owner", null), sendingChurchId: "sc-1" },
    ],
    [
      "a network's Owner",
      { ...viewer("owner", null), sendingNetworkId: "n-1" },
    ],
  ];

  for (const [what, who] of leadsNobody) {
    assert.equal(
      shouldPromptPastorConfirmation(who, church),
      false,
      `${what} does not lead this plant`
    );
  }
});

test("answering Yes is only permitted while the seat is empty", () => {
  const who = viewer("member");

  assert.equal(canAnswerLeadershipQuestion(who, churchState()), true);
  assert.equal(
    canAnswerLeadershipQuestion(who, churchState({ hasPlanterUser: true })),
    false
  );
});

test("the plant's planter may always answer — that is OB-004's re-entry", () => {
  const who = viewer("owner");

  assert.equal(
    canAnswerLeadershipQuestion(
      who,
      churchState({ leadershipStatus: "no_planter", hasPlanterUser: true })
    ),
    true
  );
});

test("the nudge follows an answered No, never a church that was merely never asked", () => {
  const who = viewer("owner");

  assert.equal(
    shouldShowNoPlanterNudge(
      who,
      churchState({ leadershipStatus: "no_planter", hasPlanterUser: true })
    ),
    true
  );
  assert.equal(
    shouldShowNoPlanterNudge(who, churchState({ hasPlanterUser: true })),
    false
  );
});

test("the team member who answered No under OB-010 still gets the nudge", () => {
  // Same No path as OB-004: the plant is recorded planterless, the seat is
  // still empty, so the person who answered can reach the question again.
  assert.equal(
    shouldShowNoPlanterNudge(
      viewer("member"),
      churchState({ leadershipStatus: "no_planter" })
    ),
    true
  );
});

test("Yes assigns only when the answerer is not already the planter", () => {
  const empty = churchState();

  assert.equal(leadershipWritePlan(viewer("member"), empty, "yes"), "claim");
  assert.equal(
    leadershipWritePlan(
      viewer("owner"),
      churchState({ hasPlanterUser: true }),
      "yes"
    ),
    "confirm"
  );
  assert.equal(leadershipWritePlan(viewer("member"), empty, "no"), "decline");
});
