import assert from "node:assert/strict";
import { test } from "node:test";


import type { NewTask, Task } from "@/db/schema";
import {
  SUBTASK_DEPTH_ERROR,
  SUBTASK_HAS_CHILDREN_ERROR,
  SUBTASK_PARENT_MISSING_ERROR,
  SUBTASK_SELF_ERROR,
  checkSubtaskNesting,
  createNextRecurrence,
  planRecurrenceChildren,
  resolveSubtaskAssignee,
  type RecurrenceChild,
  type RecurrenceDeps,
} from "./service";

// ----------------------------------------------------------------------------
// Subtasks (T-016) — the nesting rule.
//
// `parent_task_id` is a self-FK, so the database will accept a chain of any
// depth. One level is an application rule, and this is where it lives. The
// cases below are the four ways to break it; each has to be refused for its
// own reason, because refusing only the obvious one leaves the others open.
// ----------------------------------------------------------------------------

const TOP_LEVEL = { id: "task-a", parentTaskId: null };
const SUBTASK = { id: "task-b", parentTaskId: "task-a" };

test("a top-level task may take subtasks", () => {
  assert.equal(checkSubtaskNesting({ child: null, parent: TOP_LEVEL }), null);
  assert.equal(
    checkSubtaskNesting({
      child: { id: "task-c", hasSubtasks: false },
      parent: TOP_LEVEL,
    }),
    null
  );
});

test("a subtask may NOT take subtasks — nesting is one level", () => {
  assert.equal(
    checkSubtaskNesting({ child: null, parent: SUBTASK }),
    SUBTASK_DEPTH_ERROR
  );
});

test("a task that already has subtasks may not become one", () => {
  // The other half of the same rule. Without it, "give B to A" is refused but
  // "give A to B" achieves the identical two-level tree.
  assert.equal(
    checkSubtaskNesting({
      child: { id: "task-c", hasSubtasks: true },
      parent: TOP_LEVEL,
    }),
    SUBTASK_HAS_CHILDREN_ERROR
  );
});

test("a task may not be its own subtask", () => {
  assert.equal(
    checkSubtaskNesting({
      child: { id: TOP_LEVEL.id, hasSubtasks: false },
      parent: TOP_LEVEL,
    }),
    SUBTASK_SELF_ERROR
  );
});

test("a parent that is not in scope reads as missing", () => {
  // The loader is church-scoped, so a parent id from another tenant — or a
  // soft-deleted one — arrives here as `null`. It must be a refusal, never a
  // silently un-parented task.
  assert.equal(
    checkSubtaskNesting({ child: null, parent: null }),
    SUBTASK_PARENT_MISSING_ERROR
  );
});

test("the self check runs before the depth check", () => {
  // A subtask asked to parent itself is refused for the reason that actually
  // explains it, rather than the incidental one.
  assert.equal(
    checkSubtaskNesting({
      child: { id: SUBTASK.id, hasSubtasks: false },
      parent: SUBTASK,
    }),
    SUBTASK_SELF_ERROR
  );
});

// ----------------------------------------------------------------------------
// Who owns a subtask (ruling on #370).
//
// Before the ruling a subtask was created with no assignee at all, which made
// it invisible to "My tasks" and to every assignee filter. It now starts on
// the parent's assignee — as a DEFAULT, so an explicit choice still wins.
// ----------------------------------------------------------------------------

const PLANTER = "33333333-3333-4333-8333-333333333333";
const CO_LEADER = "44444444-4444-4444-8444-444444444444";

test("a subtask inherits the parent's assignee", () => {
  assert.equal(resolveSubtaskAssignee(undefined, PLANTER), PLANTER);
  assert.equal(resolveSubtaskAssignee(null, PLANTER), PLANTER);
  // The quick-add form posts an empty string for "nobody picked".
  assert.equal(resolveSubtaskAssignee("", PLANTER), PLANTER);
});

test("an explicit assignee beats the parent's", () => {
  assert.equal(resolveSubtaskAssignee(CO_LEADER, PLANTER), CO_LEADER);
});

test("an unassigned parent leaves the subtask unassigned", () => {
  // Inheritance, not invention: there is nobody to inherit from here.
  assert.equal(resolveSubtaskAssignee(undefined, null), null);
  assert.equal(resolveSubtaskAssignee("", null), null);
});

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";

// ----------------------------------------------------------------------------
// The checklist carries over to the next instance (decision A on #370).
//
// The checklist is part of the task's template. Completing a recurring task
// hands the successor the SAME list, every box unticked — ticked items and
// never-started items alike, one rule for both.
// ----------------------------------------------------------------------------

const CREATOR = "22222222-2222-4222-8222-222222222222";
const SERIES_ID = "55555555-5555-4555-8555-555555555555";
const SUCCESSOR_ID = "66666666-6666-4666-8666-666666666666";

function recurringTask(overrides: Partial<Task> = {}): Task {
  return {
    id: SERIES_ID,
    churchId: CHURCH_ID,
    title: "Weekly service prep",
    description: null,
    status: "complete",
    priority: "medium",
    dueDate: "2026-09-01",
    dueTime: null,
    assignedToId: PLANTER,
    category: null,
    relatedType: null,
    relatedId: null,
    parentTaskId: null,
    isRecurring: true,
    recurrenceRule: { interval: "weekly", endDate: null },
    completionEvent: null,
    completedAt: new Date("2026-09-01T12:00:00Z"),
    completedById: PLANTER,
    createdById: CREATOR,
    createdAt: new Date("2026-08-01T12:00:00Z"),
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function checklistItem(
  title: string,
  overrides: Partial<RecurrenceChild> = {}
): RecurrenceChild {
  return {
    title,
    description: null,
    priority: "medium",
    dueTime: null,
    assignedToId: PLANTER,
    category: null,
    relatedType: null,
    relatedId: null,
    ...overrides,
  };
}

/** A `RecurrenceDeps` backed by arrays, recording every write it is asked for. */
function fakeRecurrenceDeps(
  children: RecurrenceChild[],
  openInSeries: string[] = []
) {
  const successors: NewTask[] = [];
  const insertedChildren: NewTask[] = [];

  const deps: RecurrenceDeps = {
    async findOpenInSeries() {
      return openInSeries;
    },
    async insertSuccessor(values) {
      successors.push(values);
      return { ...recurringTask(), ...values, id: SUCCESSOR_ID } as Task;
    },
    async listChildren() {
      return children;
    },
    async insertChildren(values) {
      insertedChildren.push(...values);
    },
  };

  return { deps, successors, insertedChildren };
}

test("the successor gets the whole checklist back, unticked", async () => {
  // Three items, two of them already ticked on the instance being completed.
  // `listChildren` returns completed children too — that is the point.
  const { deps, successors, insertedChildren } = fakeRecurrenceDeps([
    checklistItem("Book the room"),
    checklistItem("Print the flyers"),
    checklistItem("Confirm the band"),
  ]);

  const next = await createNextRecurrence(recurringTask(), "2026-09-01", deps);

  assert.ok(next, "a successor should have been minted");
  assert.equal(next.dueDate, "2026-09-08");

  // Exactly one future instance, and exactly one checklist.
  assert.equal(successors.length, 1);
  assert.equal(insertedChildren.length, 3);

  assert.deepEqual(
    insertedChildren.map((row) => row.title),
    ["Book the room", "Print the flyers", "Confirm the band"]
  );

  for (const row of insertedChildren) {
    assert.equal(row.status, "not_started", `${row.title} should arrive open`);
    assert.equal(row.completedAt, null);
    assert.equal(row.completedById, null);
    assert.equal(row.parentTaskId, SUCCESSOR_ID);
    assert.equal(row.churchId, CHURCH_ID);
    // A checklist item never repeats on its own; the parent is the series.
    assert.equal(row.isRecurring, false);
  }
});

test("the successor's checklist keeps the order it was written in", async () => {
  // `listSubtasks` sorts by `created_at`, and one multi-row INSERT would stamp
  // every row with the same transaction timestamp — leaving the order to a
  // random-UUID tiebreak. The planner stamps them apart.
  const stamps = planRecurrenceChildren(
    [checklistItem("First"), checklistItem("Second"), checklistItem("Third")],
    { id: SUCCESSOR_ID, churchId: CHURCH_ID, createdById: CREATOR },
    new Date("2026-09-08T00:00:00Z")
  ).map((row) => (row.createdAt as Date).getTime());

  assert.ok(stamps[0]! < stamps[1]!, "item 1 must sort before item 2");
  assert.ok(stamps[1]! < stamps[2]!, "item 2 must sort before item 3");
});

test("a checklist item's own due date is not carried into the new cycle", async () => {
  // It belonged to the cycle that just closed. Carrying it would hand the new
  // checklist a set of already-overdue items.
  const [row] = planRecurrenceChildren(
    [checklistItem("Book the room")],
    { id: SUCCESSOR_ID, churchId: CHURCH_ID, createdById: CREATOR },
    new Date("2026-09-08T00:00:00Z")
  );

  assert.equal(row!.dueDate, null);
  // The rest of the item survives intact.
  assert.equal(row!.title, "Book the room");
  assert.equal(row!.assignedToId, PLANTER);
});

test("a recurring task with no checklist mints no checklist", async () => {
  const { deps, successors, insertedChildren } = fakeRecurrenceDeps([]);

  const next = await createNextRecurrence(recurringTask(), "2026-09-01", deps);

  assert.ok(next);
  assert.equal(successors.length, 1);
  assert.equal(insertedChildren.length, 0);
});

test("an instance already open in the series mints nothing at all", async () => {
  // The one-open-instance guard runs BEFORE the successor insert, so a series
  // that was resurrected by reopening an older instance does not gain a second
  // open task — nor a duplicate checklist.
  const { deps, successors, insertedChildren } = fakeRecurrenceDeps(
    [checklistItem("Book the room")],
    ["an-already-open-instance"]
  );

  const next = await createNextRecurrence(recurringTask(), "2026-09-01", deps);

  assert.equal(next, null);
  assert.equal(successors.length, 0);
  assert.equal(insertedChildren.length, 0);
});

test("a checklist that fails to copy does not lose the successor", async () => {
  // The completion has already landed and the successor row exists. Reporting
  // "no successor" here would be a lie, and a worse one than a missing list.
  const { deps, successors } = fakeRecurrenceDeps([
    checklistItem("Book the room"),
  ]);
  deps.insertChildren = async () => {
    throw new Error("insert failed");
  };

  const next = await createNextRecurrence(recurringTask(), "2026-09-01", deps);

  assert.ok(next, "the successor must still be returned");
  assert.equal(successors.length, 1);
});

test("a series past its end date mints neither a task nor a checklist", async () => {
  const { deps, successors, insertedChildren } = fakeRecurrenceDeps([
    checklistItem("Book the room"),
  ]);

  const next = await createNextRecurrence(
    recurringTask({
      recurrenceRule: { interval: "weekly", endDate: "2026-09-05" },
    }),
    "2026-09-01",
    deps
  );

  assert.equal(next, null);
  assert.equal(successors.length, 0);
  assert.equal(insertedChildren.length, 0);
});
