import assert from "node:assert/strict";
import { test } from "node:test";

import {
  channelEligibility,
  MAX_DELIVERY_ATTEMPTS,
  PERMANENT_FAILURE_PREFIX,
} from "../dispatch";
import type { NotificationDelivery } from "@/db/schema";

import {
  notificationDeliveryOutcome,
  WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES,
} from "./delivery-events";

// ============================================================================
// Provider delivery webhooks → `notification_deliveries` (N-016).
//
// The load-bearing assertion is the last one: a hard bounce must not merely be
// RECORDED as failed, it must be recorded in the form that stops the
// dispatcher trying again. That is a property of two files agreeing on
// `PERMANENT_FAILURE_PREFIX`, so it is asserted by feeding the mapping's own
// output straight into `channelEligibility`.
// ============================================================================

const NOW = new Date("2026-07-30T09:00:00.000Z");

function delivery(
  overrides: Partial<NotificationDelivery>
): NotificationDelivery {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channel: "email",
    status: "failed",
    attemptCount: 1,
    error: null,
    providerMessageId: "resend-1",
    sentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as NotificationDelivery;
}

test("a hard bounce is a permanent failure", () => {
  const outcome = notificationDeliveryOutcome({ type: "email.bounced" });

  assert.equal(outcome.kind, "failed");
  assert.ok(outcome.kind === "failed");
  assert.equal(outcome.permanent, true);
  assert.ok(outcome.error.startsWith(PERMANENT_FAILURE_PREFIX));
  assert.match(outcome.error, /hard bounce/);
});

test("a hard bounce recorded this way is never retried", () => {
  const outcome = notificationDeliveryOutcome({ type: "email.bounced" });
  assert.ok(outcome.kind === "failed");

  // The row the webhook would write, fed to the dispatcher's own policy. This
  // is the assertion that stops the two files drifting: change the prefix in
  // one place and this fails.
  const bounced = delivery({
    status: "failed",
    error: outcome.error,
    attemptCount: 1,
  });
  const eligibility = channelEligibility(
    bounced,
    // Far past any backoff window — only permanence can refuse it now.
    new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    MAX_DELIVERY_ATTEMPTS
  );

  assert.equal(eligibility.eligible, false);
  assert.ok(!eligibility.eligible);
  assert.equal(eligibility.reason, "attempts_exhausted");
});

test("a soft bounce keeps its bounded retries", () => {
  for (const bounceType of ["Transient", "transient", "SoftBounce"]) {
    const outcome = notificationDeliveryOutcome({
      type: "email.bounced",
      bounceType,
    });
    assert.ok(outcome.kind === "failed");
    assert.equal(outcome.permanent, false, `${bounceType} was treated as hard`);
    assert.ok(!outcome.error.startsWith(PERMANENT_FAILURE_PREFIX));
  }

  // And such a row IS eligible again once the backoff has elapsed.
  const outcome = notificationDeliveryOutcome({
    type: "email.bounced",
    bounceType: "Transient",
  });
  assert.ok(outcome.kind === "failed");
  const soft = delivery({ status: "failed", error: outcome.error });
  assert.equal(
    channelEligibility(
      soft,
      new Date(NOW.getTime() + 60 * 60 * 1000),
      MAX_DELIVERY_ATTEMPTS
    ).eligible,
    true
  );
});

test("a spam complaint is permanent", () => {
  const outcome = notificationDeliveryOutcome({ type: "email.complained" });

  assert.ok(outcome.kind === "failed");
  assert.equal(outcome.permanent, true);
  assert.ok(outcome.error.startsWith(PERMANENT_FAILURE_PREFIX));
});

test("a generic provider failure is transient", () => {
  const outcome = notificationDeliveryOutcome({ type: "email.failed" });

  assert.ok(outcome.kind === "failed");
  assert.equal(outcome.permanent, false);
  assert.ok(!outcome.error.startsWith(PERMANENT_FAILURE_PREFIX));
});

test("success and engagement events change nothing", () => {
  for (const type of [
    "email.sent",
    "email.delivered",
    "email.opened",
    "email.clicked",
    "email.delivery_delayed",
    "contact.created",
    "",
  ]) {
    assert.equal(
      notificationDeliveryOutcome({ type }).kind,
      "ignored",
      `${type} was not ignored`
    );
  }
});

test("only an unsettled or sent attempt may be overwritten by a webhook", () => {
  assert.deepEqual(
    [...WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES],
    ["queued", "sent"]
  );

  // Stated as the exclusion it really is: a cancelled or preference-suppressed
  // channel was never sent, so no bounce can be about it, and re-writing an
  // already-failed row would reset the backoff clock the dispatcher reads.
  for (const excluded of ["failed", "cancelled", "suppressed_by_preference"]) {
    assert.ok(
      !(WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES as readonly string[]).includes(
        excluded
      )
    );
  }
});
