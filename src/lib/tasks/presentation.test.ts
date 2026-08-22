import assert from "node:assert/strict";
import { test } from "node:test";

import { readsAsAnImperative } from "@/lib/auth/read-only-surfaces";
import { heldCapabilities } from "@/lib/auth/seat-rules";

import { mayActOnTaskRow } from "./own-duty";
import { TASKS_SUBTITLE_FOR_A_READER, taskListSubtitle } from "./presentation";

// ============================================================================
// #668 — the Tasks header stops offering a Member the whole of `tasks.write`,
// WITHOUT taking away the one verb they hold.
//
// This is the one of the three pages where the Member's sentence was a copy
// decision. /people and /teams hand their non-holder nothing, so the honest
// sentence describes the page; here `tasks.own` is SEATED, so a Member may
// complete and reopen a task assigned to them — which means both a too-generous
// sentence and a too-modest one are wrong, and the second test below is what
// stops the modest one being written later as a "tidy-up".
// ============================================================================

test("the subtitle asks the seat that may write to manage, and names the Member's own verb", () => {
  const writer = taskListSubtitle(true);
  assert.equal(writer, "Manage your tasks and follow-ups");
  assert.ok(
    readsAsAnImperative(writer),
    "the seat that holds `tasks.write` is the one the header may address with it"
  );

  const member = taskListSubtitle(false);
  assert.equal(member, TASKS_SUBTITLE_FOR_A_READER);
  assert.equal(
    member,
    "Your plant's tasks and follow-ups — complete the ones assigned to you",
    "the Member's header names the list AND the one verb they hold; #668's copy decision is this string"
  );
  assert.ok(
    !readsAsAnImperative(member),
    "'Manage' offered a Member the whole of `tasks.write` — that is the #668 defect"
  );
});

test("the verb the Member's sentence promises is one a Member actually holds", () => {
  // THE SENTENCE MAKES A CLAIM ABOUT THE PRODUCT, so the claim is asserted
  // against the rules rather than trusted. If `tasks.own` were ever narrowed out
  // of SEATED, or `mayActOnTaskRow` stopped admitting the assignee, this
  // subtitle would be promising a Member a control the server refuses — the
  // #668 defect pointing the other way — and this fails instead of the copy
  // going quietly wrong.
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

  // The subject half: their OWN row, and only their own.
  assert.ok(
    mayActOnTaskRow({
      canWrite: false,
      assignedToId: "u1",
      viewerId: "u1",
    }),
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
