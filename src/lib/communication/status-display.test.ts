import assert from "node:assert/strict";
import { test } from "node:test";

import {
  communicationStatuses,
  recipientStatuses,
} from "@/db/schema/communication";

import {
  COMMUNICATION_STATUS_BADGE_CLASSES,
  COMMUNICATION_STATUS_LABELS,
  LOGGED_ENTRY_NOTE,
  RECIPIENT_STATUS_BADGE_CLASSES,
  RECIPIENT_STATUS_LABELS,
  communicationStatusBadgeClass,
  communicationStatusLabel,
  recipientStatusBadgeClass,
  recipientStatusLabel,
} from "./status-display";

// ----------------------------------------------------------------------------
// COM-020 shipped `logged` into a UI whose four status maps had never heard of
// it, so a recorded contact rendered as a lowercase token in a "sent"-coloured
// pill. These tests pin the two things that made that possible: a status with
// no entry, and `logged` wearing the same styling as a real send.
// ----------------------------------------------------------------------------

test("every communication status has a label and a badge class", () => {
  for (const status of communicationStatuses) {
    assert.ok(
      COMMUNICATION_STATUS_LABELS[status],
      `no label for status "${status}"`
    );
    assert.ok(
      COMMUNICATION_STATUS_BADGE_CLASSES[status],
      `no badge class for status "${status}"`
    );
  }
});

test("labels are sentence case, never the raw token", () => {
  for (const status of communicationStatuses) {
    const label = COMMUNICATION_STATUS_LABELS[status];
    assert.notEqual(label, status, `"${status}" renders raw`);
    assert.equal(label[0], label[0].toUpperCase());
  }
});

test("a logged contact never reads or looks like a sent message", () => {
  assert.equal(COMMUNICATION_STATUS_LABELS.logged, "Logged");
  assert.notEqual(
    COMMUNICATION_STATUS_BADGE_CLASSES.logged,
    COMMUNICATION_STATUS_BADGE_CLASSES.sent
  );
  assert.notEqual(
    COMMUNICATION_STATUS_BADGE_CLASSES.logged,
    COMMUNICATION_STATUS_BADGE_CLASSES.sending
  );
  assert.match(COMMUNICATION_STATUS_BADGE_CLASSES.logged, /gray/);
});

test("the logged note says plainly that nothing was sent", () => {
  assert.match(LOGGED_ENTRY_NOTE, /No email was sent/);
});

test("an unknown status degrades to itself rather than blanking out", () => {
  assert.equal(communicationStatusLabel("from_the_future"), "from_the_future");
  assert.equal(communicationStatusBadgeClass("from_the_future"), "");
});

// ----------------------------------------------------------------------------
// The same rule for `communication_recipients.status` — the half that re-grew
// as a private map on the message detail page.
// ----------------------------------------------------------------------------

test("every recipient status has a sentence-case label and a badge class", () => {
  for (const status of recipientStatuses) {
    const label = RECIPIENT_STATUS_LABELS[status];
    assert.ok(label, `no label for recipient status "${status}"`);
    assert.notEqual(label, status, `"${status}" renders raw`);
    assert.equal(label[0], label[0].toUpperCase());
    assert.ok(
      RECIPIENT_STATUS_BADGE_CLASSES[status],
      `no badge class for recipient status "${status}"`
    );
  }
});

test("an unknown recipient status degrades to the neutral pending styling", () => {
  assert.equal(recipientStatusLabel("from_the_future"), "Pending");
  assert.equal(
    recipientStatusBadgeClass("from_the_future"),
    RECIPIENT_STATUS_BADGE_CLASSES.pending
  );
});
