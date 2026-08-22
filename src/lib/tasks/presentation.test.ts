import assert from "node:assert/strict";
import { test } from "node:test";

import { heldCapabilities } from "@/lib/auth/seat-rules";

import { mayActOnTaskRow } from "./own-duty";
import { taskListSubtitle } from "./presentation";

// ============================================================================
// #668 — the one capability-matched subtitle that makes a CLAIM ABOUT THE
// PRODUCT, and therefore needs more than a string comparison.
//
// Both branches of this sentence are pinned by equality in
// `CAPABILITY_MATCHED_SUBTITLES` (`@/lib/auth/read-only-surfaces.test.ts`) with
// the other four, and that is all the other four need: they describe a page.
// This one PROMISES A CONTROL — "complete the ones assigned to you" — so the
// promise is asserted against the rules that would have to keep it.
//
// The failure this exists to catch is the sentence going quietly wrong while
// the string it is pinned to never changes: narrow `tasks.own` out of SEATED,
// or stop `mayActOnTaskRow` admitting the assignee, and the subtitle starts
// offering a Member a control the server refuses — the #668 defect pointing the
// other way, and one no equality check upstairs would notice.
// ============================================================================

test("the verb the Member's sentence promises is one a Member actually holds", () => {
  const member = {
    seat: "member" as const,
    churchId: "11111111-1111-4111-8111-111111111111",
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  const held = heldCapabilities(member);

  assert.ok(
    held.includes("tasks.own"),
    "a plant Member no longer holds `tasks.own` — the subtitle offers them a completion they would be refused"
  );
  assert.ok(
    !held.includes("tasks.write"),
    "a plant Member now holds `tasks.write` — the header can go back to one sentence for every seat"
  );

  // The sentence a Member reads is the one that carries the promise.
  assert.match(
    taskListSubtitle(false),
    /complete the ones assigned to you/,
    "the Member's subtitle stopped naming the verb they hold — if that was deliberate, this test is what it has to argue with"
  );

  // The subject half: their OWN row, and only their own.
  assert.ok(
    mayActOnTaskRow({ canWrite: false, assignedToId: "u1", viewerId: "u1" }),
    "'complete the ones assigned to you' is what this rule must let them do"
  );
  assert.ok(
    !mayActOnTaskRow({
      canWrite: false,
      assignedToId: "someone-else",
      viewerId: "u1",
    }),
    "the sentence says 'assigned to you' precisely because somebody else's row is not theirs to complete"
  );
});
