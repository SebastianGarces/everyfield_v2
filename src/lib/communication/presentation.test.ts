import assert from "node:assert/strict";
import { test } from "node:test";

import { readsAsAnImperative } from "@/lib/auth/read-only-surfaces";

import {
  ADMINS_SEND_THE_MESSAGES,
  HUB_SUBTITLE_FOR_A_READER,
  communicationEmptyStateLine,
  communicationHubSubtitle,
} from "./presentation";

// ============================================================================
// #666 — the Communication Hub stops telling a Member to send messages.
//
// The hub's subtitle read "Send messages and track communication with your
// people" to every seat. `communication.send` is ADMIN_PLUS, so a plant Member
// was being instructed to do the one thing `requireSeat` refuses them, on a
// page whose own empty state already told them who sends.
//
// EACH SENTENCE IS PINNED BY EQUALITY, not by the shared predicate alone.
// `readsAsAnImperative` reads a CLOSED list of write verbs, which is right for
// a repo-wide scan and wrong as the only guard here: "Message your people and
// track what was sent" is an instruction to a Member and the predicate says
// nothing about it. The equality is what fails when the copy changes; the
// predicate call beside it is what ties this surface to the shared rule.
//
// The scan that applies that rule to every dashboard page lives in
// `read-only-surfaces.test.ts` — a page whose subtitle is one of these helper
// calls has no literal for it to read, which is how routing the sentence
// through here is what moves it under this file's guard.
// ============================================================================

test("the subtitle asks the sender to send and tells everyone else what they can read", () => {
  const sender = communicationHubSubtitle(true);
  assert.ok(
    readsAsAnImperative(sender),
    "the seat that holds `communication.send` is the one the header may address"
  );

  const member = communicationHubSubtitle(false);
  assert.equal(member, HUB_SUBTITLE_FOR_A_READER);
  assert.equal(
    member,
    "What your plant has sent, and how it was delivered",
    "the Member's header says what the page IS for them — the counts, the delivery overview and the recent list are all readable — rather than going quiet"
  );
  assert.ok(
    !readsAsAnImperative(member),
    "an imperative for a write they do not hold is the #666 defect"
  );
});

test("the empty state states who sends rather than inviting a refused send", () => {
  assert.ok(readsAsAnImperative(communicationEmptyStateLine(true)));

  const member = communicationEmptyStateLine(false);
  assert.equal(member, ADMINS_SEND_THE_MESSAGES);
  assert.equal(member, "Your plant's admins send messages to your people.");
  assert.ok(
    !readsAsAnImperative(member),
    "the empty state invited a Member to send a first message they would be refused"
  );
});

test("the two Member sentences answer the same question without repeating it", () => {
  // Both render together on an empty hub. #659's defect was two surfaces
  // DISAGREEING about who acts; the failure mode in the other direction is a
  // page that says the same sentence twice, which reads as a bug.
  assert.notEqual(
    communicationHubSubtitle(false),
    communicationEmptyStateLine(false)
  );
});
