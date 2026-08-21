import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NEEDS_OWNER_LABEL,
  countFollowUpOwnership,
  groupByOwner,
  isOwned,
  selectUnownedContacts,
  type FollowUpContact,
  type OpenFollowUpTask,
} from "./follow-up-ownership.shared";

// ----------------------------------------------------------------------------
// What rubric v1's Lens 2 is allowed to say (#470, C01/C13).
//
// v0 read "8 stale follow-ups" and told the planter they were carrying all of
// it. Bryan's objection is that the count supports three different stories.
// These tests pin the counting so that the only story the judge can tell is the
// one the assignments actually establish — and so the `/tasks` view and the fact
// snapshot cannot drift, because they share every function below.
// ----------------------------------------------------------------------------

function task(over: Partial<OpenFollowUpTask> = {}): OpenFollowUpTask {
  return {
    taskId: "t1",
    title: "Follow up with Sara",
    dueDate: null,
    contactId: "p1",
    assignedToId: "u1",
    ownerName: "Ada Planter",
    ownerEmail: "ada@example.com",
    ownerIsCommitted: true,
    ownerIsPlanter: false,
    ...over,
  };
}

function contact(over: Partial<FollowUpContact> = {}): FollowUpContact {
  return {
    personId: "p1",
    name: "Sara Contact",
    status: "attendee",
    lastTouchedAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

// -- what "owned" means -------------------------------------------------------

test("an unassigned follow-up is not owned", () => {
  assert.equal(isOwned(task({ assignedToId: null })), false);
});

test("a follow-up owned by a DEMOTED member is not owned", () => {
  // The FK still points at a live account. The person behind it left the
  // committed set, so the work is uncovered and has to resurface.
  assert.equal(isOwned(task({ ownerIsCommitted: false })), false);
});

test("a follow-up assigned to a committed member is owned", () => {
  assert.equal(isOwned(task()), true);
});

// -- the four facts -----------------------------------------------------------

test("a contact with NO task at all counts as unowned", () => {
  const facts = countFollowUpOwnership([{ id: "p1", isStale: false }], []);
  assert.equal(facts.unownedCount, 1);
  assert.equal(facts.distinctOwnerCount, 0);
});

test("a contact whose task is unassigned counts as unowned", () => {
  const facts = countFollowUpOwnership(
    [{ id: "p1", isStale: true }],
    [task({ assignedToId: null })]
  );
  assert.equal(facts.unownedCount, 1);
  assert.equal(facts.staleUnownedCount, 1);
});

test("staleUnownedCount is the intersection, not the stale count", () => {
  const facts = countFollowUpOwnership(
    [
      { id: "p1", isStale: true }, // owned
      { id: "p2", isStale: true }, // unowned + stale
      { id: "p3", isStale: false }, // unowned, not stale
    ],
    [task({ contactId: "p1" })]
  );
  assert.equal(facts.unownedCount, 2);
  assert.equal(facts.staleUnownedCount, 1);
});

test("distinctOwnerCount counts people, not tasks", () => {
  const facts = countFollowUpOwnership(
    [],
    [
      task({ taskId: "t1", assignedToId: "u1", contactId: "p1" }),
      task({ taskId: "t2", assignedToId: "u1", contactId: "p2" }),
      task({ taskId: "t3", assignedToId: "u2", contactId: "p3" }),
    ]
  );
  assert.equal(facts.distinctOwnerCount, 2);
});

test("planterOwnedCount is the planter's own share of the open tasks", () => {
  const facts = countFollowUpOwnership(
    [],
    [
      task({ taskId: "t1", assignedToId: "u1", ownerIsPlanter: true }),
      task({ taskId: "t2", assignedToId: "u1", ownerIsPlanter: true }),
      task({ taskId: "t3", assignedToId: "u2", ownerIsPlanter: false }),
    ]
  );
  assert.equal(facts.planterOwnedCount, 2);
  // The measured Lens 2 line — "you own 2 of the 3 open follow-ups" — is exactly
  // these two numbers, and neither of them is an inference.
  assert.equal(facts.distinctOwnerCount, 2);
});

test("a demoted owner's task neither owns its contact nor counts as an owner", () => {
  const facts = countFollowUpOwnership(
    [{ id: "p1", isStale: true }],
    [task({ ownerIsCommitted: false })]
  );
  assert.deepEqual(facts, {
    unownedCount: 1,
    staleUnownedCount: 1,
    distinctOwnerCount: 0,
    planterOwnedCount: 0,
  });
});

// -- the assignments view -----------------------------------------------------

test("Needs owner is pinned first even when it is empty", () => {
  const groups = groupByOwner([task()]);
  assert.equal(groups[0].ownerId, null);
  assert.equal(groups[0].ownerName, NEEDS_OWNER_LABEL);
  assert.equal(groups[0].tasks.length, 0);
});

test("unassigned and demoted-owner tasks land in the same group", () => {
  const groups = groupByOwner([
    task({ taskId: "t1", assignedToId: null }),
    task({ taskId: "t2", ownerIsCommitted: false }),
    task({ taskId: "t3", assignedToId: "u9", ownerName: "Zoe" }),
  ]);
  assert.deepEqual(
    groups[0].tasks.map((t) => t.taskId),
    ["t1", "t2"]
  );
  assert.deepEqual(
    groups.slice(1).map((g) => g.ownerName),
    ["Zoe"]
  );
});

test("owner groups are ordered by name, and fall back to the address", () => {
  const groups = groupByOwner([
    task({ taskId: "t1", assignedToId: "u2", ownerName: "Zoe" }),
    task({ taskId: "t2", assignedToId: "u3", ownerName: "Abe" }),
    task({
      taskId: "t3",
      assignedToId: "u4",
      ownerName: null,
      ownerEmail: "mia@example.com",
    }),
  ]);
  assert.deepEqual(
    groups.slice(1).map((g) => g.ownerName),
    ["Abe", "mia@example.com", "Zoe"]
  );
});

test("the one-click list is the contacts nobody is covering (Q1)", () => {
  const unowned = selectUnownedContacts(
    [
      contact({ personId: "p1" }),
      contact({ personId: "p2" }),
      contact({ personId: "p3" }),
    ],
    [
      task({ taskId: "t1", contactId: "p1" }),
      task({ taskId: "t2", contactId: "p2", ownerIsCommitted: false }),
    ]
  );
  assert.deepEqual(
    unowned.map((c) => c.personId),
    ["p2", "p3"]
  );
});
