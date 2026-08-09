import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESEND_COOLDOWN_HOURS,
  evaluateResendEligibility,
  resendBlockedHint,
  resendBlockedMessage,
  type ResendEligibilityInput,
} from "./resend-policy";

// ----------------------------------------------------------------------------
// Ruled 2026-08-09 on PR #371. Before the gate, a resend's own detail page
// re-offered a resend to the same people seconds later: every new recipient
// row is `pending`, none records an open, so "who has not opened?" answered
// with the whole list again. Three clicks, three copies, no cooldown.
//
// Both conditions have to hold. These tests pin the boundary in both
// directions, because a gate that is only nearly right is a gate that fires on
// the wrong side of midnight.
// ----------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-08-09T12:00:00.000Z");

/** A message that clears every gate — each test spoils exactly one thing. */
function eligible(
  overrides: Partial<ResendEligibilityInput> = {}
): ResendEligibilityInput {
  return {
    status: "sent",
    sentAt: new Date(NOW.getTime() - 48 * HOUR_MS),
    deliveredCount: 5,
    nonOpenerCount: 3,
    now: NOW,
    ...overrides,
  };
}

test("a sent message past the cooldown with confirmed deliveries may be resent", () => {
  assert.deepEqual(evaluateResendEligibility(eligible()), {
    allowed: true,
    reason: null,
  });
});

// --- gate 1: the cooldown ---------------------------------------------------

test("a resend is refused before the cooldown elapses", () => {
  const result = evaluateResendEligibility(
    eligible({ sentAt: new Date(NOW.getTime() - 1 * HOUR_MS) })
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "tooSoon");
});

test("the cooldown boundary is exact in both directions", () => {
  const oneMinuteShort = evaluateResendEligibility(
    eligible({
      sentAt: new Date(NOW.getTime() - RESEND_COOLDOWN_HOURS * HOUR_MS + 60000),
    })
  );
  const exactlyOnTime = evaluateResendEligibility(
    eligible({
      sentAt: new Date(NOW.getTime() - RESEND_COOLDOWN_HOURS * HOUR_MS),
    })
  );

  assert.equal(oneMinuteShort.reason, "tooSoon");
  assert.equal(exactlyOnTime.allowed, true);
});

test("a message sent seconds ago is refused even though nobody has opened it", () => {
  // The exact shape of the defect: a resend lands on its own page, every row
  // pending, and asks to be resent again.
  const result = evaluateResendEligibility(
    eligible({ sentAt: NOW, deliveredCount: 0, nonOpenerCount: 3 })
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "tooSoon");
});

test("a sent message with no send timestamp waits rather than proceeding", () => {
  // The cooldown cannot be proven to have elapsed, so it has not.
  const result = evaluateResendEligibility(eligible({ sentAt: null }));

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "tooSoon");
});

// --- gate 2: at least one delivered row --------------------------------------

test("a resend is refused while nothing is confirmed as delivered", () => {
  const result = evaluateResendEligibility(eligible({ deliveredCount: 0 }));

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "noDeliveryYet");
});

test("one delivered row is enough to clear the delivery gate", () => {
  assert.equal(
    evaluateResendEligibility(eligible({ deliveredCount: 1 })).allowed,
    true
  );
});

test("both gates must hold, not either one", () => {
  const noDelivery = evaluateResendEligibility(eligible({ deliveredCount: 0 }));
  const tooSoon = evaluateResendEligibility(eligible({ sentAt: NOW }));

  assert.equal(noDelivery.allowed, false);
  assert.equal(tooSoon.allowed, false);
});

// --- the other refusals ------------------------------------------------------

test("only a sent message can be resent", () => {
  for (const status of ["draft", "sending", "failed", "logged"]) {
    const result = evaluateResendEligibility(eligible({ status }));
    assert.equal(result.allowed, false, `${status} should not be resendable`);
    assert.equal(result.reason, "notSent");
  }
});

test("a message everyone opened has nobody left to reach", () => {
  const result = evaluateResendEligibility(eligible({ nonOpenerCount: 0 }));

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "noNonOpeners");
});

test("the cooldown is checked before the emptier reasons", () => {
  // A message sent minutes ago with nothing delivered fails both; the user is
  // told the one that will resolve on its own first.
  const result = evaluateResendEligibility(
    eligible({ sentAt: NOW, deliveredCount: 0, nonOpenerCount: 0 })
  );

  assert.equal(result.reason, "tooSoon");
});

// --- copy --------------------------------------------------------------------

test("every reason has a short hint and a full sentence", () => {
  for (const reason of [
    "notSent",
    "tooSoon",
    "noDeliveryYet",
    "noNonOpeners",
  ] as const) {
    assert.ok(resendBlockedHint(reason).length > 0);
    assert.ok(resendBlockedMessage(reason).endsWith("."));
  }
});

test("the cooldown copy names the actual cooldown", () => {
  assert.equal(
    resendBlockedHint("tooSoon"),
    `Available ${RESEND_COOLDOWN_HOURS} hours after send`
  );
  assert.match(
    resendBlockedMessage("tooSoon"),
    new RegExp(`${RESEND_COOLDOWN_HOURS} hours`)
  );
});

test("the delivery-gate copy says what is being waited on", () => {
  assert.equal(
    resendBlockedHint("noDeliveryYet"),
    "Waiting for delivery confirmation"
  );
});
