import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { codeOf, functionBodies } from "@/lib/auth/server-action-surface";

import type { Task, User, UserSeat } from "@/db/schema";
import { SeatRefusalError } from "@/lib/auth/seat-rules";

import {
  NOT_YOUR_TASK_REASON,
  assertMayActOnTask,
  mayActOnTask,
  planBulkTaskOperation,
  type BulkTaskCandidate,
} from "./service";
import { mayActOnTaskRow } from "./own-duty.shared";

// ============================================================================
// THE SUBJECT HALF OF `tasks.own` (AS-006) — "their own task", enforced.
//
// The seat guard on each action decides the FIRST half: `tasks.own` requires a
// seat in the plant, which refuses a coach and an oversight account before the
// parse. It cannot decide the second half, because that needs the argument —
// so `assertMayActOnTask` runs in the service after the row is loaded, and this
// is what proves it does something.
//
// IT SHIPPED WITHOUT THIS FOR A ROUND, and the shape of the miss is worth
// keeping: `tasks.own` was set to `SEATED` and nothing else, so every Member in
// the plant could complete, reopen and restatus every task in it. The capability
// LOOKED like the narrow one. A floor with nothing above it is wider than the
// `tasks.write` it replaced was going to be, and only a test that runs the rule
// against a Member and somebody else's task says so.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function account(id: string, seat: UserSeat): User {
  return {
    id,
    seat,
    churchId: CHURCH,
    sendingChurchId: null,
    sendingNetworkId: null,
  } as unknown as User;
}

const member = account(MEMBER_ID, "member");
const admin = account(OTHER_ID, "admin");
const owner = account(OTHER_ID, "owner");

const task = (assignedToId: string | null): Pick<Task, "assignedToId"> => ({
  assignedToId,
});

// ----------------------------------------------------------------------------
// The rule
// ----------------------------------------------------------------------------

test("a Member may act on the task assigned to them", () => {
  assert.equal(mayActOnTask(member, task(MEMBER_ID)), true);
  assert.doesNotThrow(() => assertMayActOnTask(member, task(MEMBER_ID)));
});

test("a Member may NOT act on a task assigned to somebody else", () => {
  // The case the first round admitted. `assignedToId` references `users.id`,
  // which is what makes the question answerable at all — the sibling own-duty
  // verbs name a PERSON and have no such column, which is why they ship at
  // `teams.write` / `meetings.write` instead of on a floor like this.
  assert.equal(mayActOnTask(member, task(OTHER_ID)), false);

  assert.throws(
    () => assertMayActOnTask(member, task(OTHER_ID)),
    (error: unknown) => error instanceof SeatRefusalError
  );
});

test("a Member may NOT act on an UNASSIGNED task", () => {
  // `null` is not "everybody's". An unassigned task is nobody's duty, so it
  // falls to `tasks.write` like any other task the Member was not given — and
  // `null === actor.id` is false, which is the whole implementation of that.
  assert.equal(mayActOnTask(member, task(null)), false);
});

test("an Admin and an Owner act on anybody's task", () => {
  // Through `tasks.write`, not through ownership: neither of them is the
  // assignee here, and both pass.
  for (const actor of [admin, owner]) {
    assert.equal(mayActOnTask(actor, task(MEMBER_ID)), true);
    assert.equal(mayActOnTask(actor, task(null)), true);
  }
});

test("a coach and an oversight account fail the rule too", () => {
  // Belt and braces: the seat guard already refused them before the parse, so
  // reaching here means a caller arrived some other way. `holdsSeatFor` says no
  // for both, and neither can be an assignee of a plant task.
  const coach = { ...account(OTHER_ID, "member"), seat: null } as User;
  const orgOwner = {
    id: OTHER_ID,
    seat: "owner",
    churchId: null,
    sendingChurchId: "44444444-4444-4444-8444-444444444444",
    sendingNetworkId: null,
  } as unknown as User;

  assert.equal(mayActOnTask(coach, task(null)), false);
  assert.equal(mayActOnTask(orgOwner, task(null)), false);
});

// ----------------------------------------------------------------------------
// The two paths that ask the question in the ACTION, not in the service
// ----------------------------------------------------------------------------

test("the two actions that write past the service ask the rule themselves", () => {
  // FOUR OF THE SIX `tasks.own` PATHS ARE COVERED BY THE SERVICE, because
  // `completeTask` and `reopenTask` assert after their own load — which is also
  // what covers `/launch`'s milestone ticks. The other two write through doors
  // that have no subject of their own:
  //
  //   * `updateTaskStatusAction`'s non-complete branch goes to `updateTask`,
  //     a `tasks.write` function;
  //   * `addSubtaskAction` goes to `createTask`, and its subject is the PARENT,
  //     which no service on that path ever reads.
  //
  // So both load the row and assert in the action body, and nothing downstream
  // would notice if that line were deleted. This is the assertion that would —
  // source-shaped for the reason `launch/service.test.ts`'s pair is: the
  // property is "this call is present on this path", and a unit test that
  // stubbed the service would pass with the line gone.
  const code = codeOf(
    path.join(process.cwd(), "src/app/(dashboard)/tasks/actions.ts")
  );

  for (const name of ["updateTaskStatusAction", "addSubtaskAction"]) {
    const body = functionBodies(code).find((fn) => fn.name === name);

    assert.ok(body, `${name} is gone from tasks/actions.ts`);
    assert.match(
      body.body,
      /assertMayActOnTask\(user, (?:existing|parent)\)/,
      `${name} writes without asking whose task it is — the seat guard admits every Member, and this path has no service-side check behind it (AS-006)`
    );

    // …and it asks about a row it LOADED, not about the id it was handed.
    assert.match(
      body.body,
      /await getTask\(user\.churchId, \w+\)/,
      `${name} must read the row it is judging`
    );
  }
});

// ----------------------------------------------------------------------------
// The bulk press applies it PER TASK
// ----------------------------------------------------------------------------

function candidate(id: string, assignedToId: string | null): BulkTaskCandidate {
  return {
    id,
    churchId: CHURCH,
    title: `Task ${id}`,
    status: "not_started",
    category: null,
    relatedType: null,
    relatedId: null,
    assignedToId,
  };
}

test("a bulk complete writes the Member's own rows and names the rest", () => {
  // PER TASK, not once for the press. A Member ticking three rows owns one of
  // them; the other two must come back as NAMED failures rather than being
  // written, and rather than taking the whole batch down — a mixed selection is
  // the ordinary case on a list where you can see everybody's work.
  const plan = planBulkTaskOperation(
    ["mine", "theirs", "nobodys"],
    [
      candidate("mine", MEMBER_ID),
      candidate("theirs", OTHER_ID),
      candidate("nobodys", null),
    ],
    { rejectCompleted: true, actor: member }
  );

  assert.deepEqual(
    plan.actionable.map((row) => row.id),
    ["mine"]
  );
  assert.deepEqual(plan.failures, [
    { taskId: "theirs", title: "Task theirs", reason: NOT_YOUR_TASK_REASON },
    { taskId: "nobodys", title: "Task nobodys", reason: NOT_YOUR_TASK_REASON },
  ]);
});

test("the same press as an Admin writes every row", () => {
  const plan = planBulkTaskOperation(
    ["mine", "theirs"],
    [candidate("mine", MEMBER_ID), candidate("theirs", OTHER_ID)],
    { rejectCompleted: true, actor: admin }
  );

  assert.deepEqual(
    plan.actionable.map((row) => row.id),
    ["mine", "theirs"]
  );
  assert.deepEqual(plan.failures, []);
});

test("with no actor the planner decides nothing about ownership", () => {
  // `bulkRescheduleTasks` passes none — it is a `tasks.write` verb, so the seat
  // guard has already settled the whole question and a second, weaker copy of
  // it here would be the drift this issue exists to end.
  const plan = planBulkTaskOperation(
    ["theirs"],
    [candidate("theirs", OTHER_ID)],
    { rejectCompleted: true }
  );

  assert.deepEqual(
    plan.actionable.map((row) => row.id),
    ["theirs"]
  );
});

test("an already-complete row is reported as such, not as somebody else's", () => {
  // The two rejections are different sentences and the order matters: a task
  // that is BOTH complete and somebody else's is reported complete, because
  // that is the fact the presser can act on.
  const done = { ...candidate("done", OTHER_ID), status: "complete" as const };

  const plan = planBulkTaskOperation(["done"], [done], {
    rejectCompleted: true,
    actor: member,
  });

  assert.deepEqual(plan.failures, [
    { taskId: "done", title: "Task done", reason: "Task is already complete" },
  ]);
});

// ----------------------------------------------------------------------------
// THE SURVIVOR, IN A MIXED LIST — #655's owed assertion, unblocked by #660.
//
// #655 closed with one thing it could not show: "the survivor — your own task
// keeps its checkbox while the row beside it does not — could not be shown in
// the browser". The reason was #660: no view rendered a Member's own task and
// somebody else's in ONE list. My Tasks showed only your own, and the All Tasks
// tab pushed the My Tasks URL, so it could not be selected at all.
//
// With `?view=all` reachable, that list exists — and this is the rule it is
// rendered through. The card asks `mayActOnTaskRow` and so does the service
// (#660 made them one function), so a row-by-row assertion here is an assertion
// about what the list SHOWS, not a paraphrase of it.
// ----------------------------------------------------------------------------

test("in one list, a Member acts on their own row and not on the one beside it", () => {
  const list = [task(MEMBER_ID), task(OTHER_ID), task(null)];

  assert.deepEqual(
    list.map((row) => mayActOnTask(member, row)),
    [true, false, false],
    "the All Tasks view puts these three rows on one screen: the Member's own keeps its checkbox, somebody else's does not, and an unassigned row is nobody's own"
  );
});

test("the same list is fully actionable for an Admin, so the hide is about ownership", () => {
  const list = [task(MEMBER_ID), task(OTHER_ID), task(null)];

  assert.deepEqual(
    list.map((row) => mayActOnTask(admin, row)),
    [true, true, true],
    "`tasks.write` is the other half of the rule — an Admin's list has a checkbox on every row, which is what makes the Member's list a HIDE and not a broken render"
  );
});

test("the card and the service ask ONE function, so the checkbox and the action agree", () => {
  // The card cannot import the service (`@/db` would cross into the bundle), so
  // the rule lives in `own-duty.shared` and both call it. This asserts the
  // client's call shape against the same answers the service gives above.
  const asTheCardAsks = (assignedToId: string | null) =>
    mayActOnTaskRow({
      canWrite: false, // a Member: `useCan("tasks.write")` is false
      assignedToId,
      viewerId: MEMBER_ID,
    });

  assert.deepEqual(
    [MEMBER_ID, OTHER_ID, null].map(asTheCardAsks),
    [true, false, false],
    "what the checkbox is drawn from must equal what `assertMayActOnTask` will accept"
  );

  // The card may be handed no viewer id at all. An unassigned row must not
  // become everybody's just because both sides are null.
  assert.equal(
    mayActOnTaskRow({ canWrite: false, assignedToId: null, viewerId: null }),
    false
  );
});
