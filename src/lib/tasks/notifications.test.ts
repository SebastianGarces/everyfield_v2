// The dispatch runs below render a real email, and rendering mints a real
// unsubscribe token — so this suite provisions its own deterministic secret
// rather than inheriting whatever the machine happens to have (the reasoning is
// spelled out at the top of `src/lib/notifications/dispatch.test.ts`). Safe at
// module scope despite import hoisting: `unsubscribeTokenSecret()` reads
// `process.env` at CALL time, never at import time.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-0123456789";

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  clearStillLivePredicates,
  runDispatch,
  stillLivePredicateFor,
} from "@/lib/notifications/dispatch";
import { FakeNotificationQueue } from "@/lib/testing/notification-queue";
import { stripComments } from "@/lib/testing/source-span";

import {
  TASK_DUE_TYPE,
  TASK_NOTIFICATION_TYPES,
  TASK_OVERDUE_TYPE,
  cancelTaskNotifications,
  planTaskNotifications,
  registerTaskStillLivePredicates,
  syncTaskNotifications,
  taskDueAt,
  taskNotificationsDiffer,
  type TaskNotificationDeps,
  type TaskNotificationFacts,
} from "./notifications";

// ============================================================================
// T-018 — task due / overdue notifications on the shared F11 queue.
//
// Every assertion below is made on the ROWS, through the real `runEnqueue` /
// `runCancelByEntity` / `runDispatch` orchestration over the in-memory store in
// `src/lib/testing/notification-queue.ts`. What is faked is Postgres and the
// email provider; the contract under test is the one this module keeps.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-08-14T09:00:00.000Z");

/** A due date comfortably ahead of `NOW`, so both conditions are in the future. */
const FUTURE_DUE = "2026-08-20";
/** A due date whose overdue moment has already passed. */
const PAST_DUE = "2026-08-01";

function taskId(n: number): string {
  return `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
}

function facts(
  overrides: Partial<TaskNotificationFacts> = {}
): TaskNotificationFacts {
  return {
    id: taskId(1),
    churchId: CHURCH,
    title: "Book the venue",
    status: "not_started",
    dueDate: FUTURE_DUE,
    dueTime: null,
    assignedToId: ASSIGNEE,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * The store, plus the task rows the still-live re-check reads back.
 *
 * `enqueueCalls` is counted rather than inferred from the row count: "one
 * enqueue per task" and "one row per task" are different claims, and a caller
 * that pre-batched would fail the first while passing the second.
 */
function harness() {
  const queue = new FakeNotificationQueue();
  const tasks = new Map<string, TaskNotificationFacts>();
  let enqueueCalls = 0;

  const deps: TaskNotificationDeps = {
    enqueue: (input) => {
      enqueueCalls += 1;
      return queue.enqueue(input);
    },
    cancelByEntity: (input) => queue.cancelByEntity(input),
    async loadTask(churchId, id) {
      const row = tasks.get(id);
      if (!row || row.churchId !== churchId) return null;
      return { status: row.status, deletedAt: row.deletedAt };
    },
    async loadFacts(churchId, ids) {
      return ids
        .map((id) => tasks.get(id))
        .filter(
          (row): row is TaskNotificationFacts =>
            row !== undefined && row.churchId === churchId && !row.deletedAt
        );
    },
  };

  return {
    queue,
    tasks,
    deps,
    calls: () => enqueueCalls,
    /**
     * Put a task in the store and enqueue what it owes.
     *
     * `previous` is the harness's own convenience, NOT the sync's parameter:
     * `syncTaskNotifications` takes one honest `mustCancel` boolean, and the
     * differ that answers it belongs to the caller — `updateTask` and
     * `reopenTask` compute it exactly this way, and `createTask` /
     * `createNextRecurrence` pass `false` outright, which is what `null` means
     * here.
     */
    async write(
      row: TaskNotificationFacts,
      options: { previous?: TaskNotificationFacts | null; now?: Date } = {}
    ) {
      const previous =
        "previous" in options ? options.previous : (tasks.get(row.id) ?? null);
      tasks.set(row.id, row);
      return syncTaskNotifications(row, {
        deps,
        now: options.now ?? NOW,
        mustCancel:
          previous !== null &&
          previous !== undefined &&
          taskNotificationsDiffer(previous, row),
      });
    },
  };
}

// ----------------------------------------------------------------------------
// AC: a task becoming due enqueues one `tasks` row to its assignee, referencing
// the task
// ----------------------------------------------------------------------------

test("a due task enqueues one tasks notification to its assignee, referencing the task", async () => {
  const h = harness();
  await h.write(facts());

  const due = h.queue.pending(TASK_DUE_TYPE);
  assert.equal(due.length, 1);

  const row = due[0];
  assert.equal(row.category, "tasks");
  assert.equal(row.recipientUserId, ASSIGNEE);
  assert.equal(row.entityType, "task");
  assert.equal(row.entityId, taskId(1));
  // The row is eligible when the task is actually due, not when it was written.
  assert.deepEqual(row.scheduledFor, taskDueAt(facts()));
});

test("overdue is a DIFFERENT type from due", async () => {
  const h = harness();
  await h.write(facts());

  const due = h.queue.pending(TASK_DUE_TYPE);
  const overdue = h.queue.pending(TASK_OVERDUE_TYPE);

  assert.equal(due.length, 1);
  assert.equal(overdue.length, 1);
  assert.notEqual(due[0].type, overdue[0].type);
  // ...and the late one is scheduled after the due one, or a planter would hear
  // "overdue" before "due".
  assert.ok(
    overdue[0].scheduledFor.getTime() > due[0].scheduledFor.getTime(),
    "the overdue row must come after the due row"
  );
});

// ----------------------------------------------------------------------------
// AC: one enqueue per task — T-018 does no batching of its own (N-012 groups at
// send time)
// ----------------------------------------------------------------------------

test("twenty overdue tasks produce twenty pending notifications, one enqueue each", async () => {
  const h = harness();

  for (let n = 1; n <= 20; n += 1) {
    await h.write(
      facts({ id: taskId(n), title: `Overdue task ${n}`, dueDate: PAST_DUE })
    );
  }

  const overdue = h.queue.pending(TASK_OVERDUE_TYPE);
  assert.equal(overdue.length, 20, "one pending row per task, never a batch");
  assert.equal(h.calls(), 20, "one enqueue call per task");
  assert.equal(
    new Set(overdue.map((row) => row.entityId)).size,
    20,
    "each row names its own task"
  );

  // A task that is already late owes the overdue row ALONE: its due moment has
  // been superseded by the very condition that replaces it.
  assert.equal(h.queue.pending(TASK_DUE_TYPE).length, 0);
});

// ----------------------------------------------------------------------------
// AC: a dedupeKey prevents a second notification for the same task + condition
// ----------------------------------------------------------------------------

test("a repeated run writes no second row for the same task and condition", async () => {
  const h = harness();
  const task = facts();

  await h.write(task, { previous: null });
  assert.equal(h.queue.rows.length, 2, "a due row and an overdue row");

  // The same task, saved again with nothing a notification depends on changed.
  const report = await h.write(task);

  assert.equal(h.queue.rows.length, 2, "no second row was written");
  assert.equal(report.cancelled, 0, "and nothing live was cancelled to do it");
  assert.equal(report.considered, 2, "both conditions were still offered");
  assert.equal(
    report.created,
    0,
    "both were absorbed by the dedupe key rather than re-created"
  );
  assert.equal(h.queue.pending().length, 2, "exactly one live pair remains");
});

test("the dedupe key survives a repeat that does NOT cancel first", async () => {
  const h = harness();
  const task = facts();
  h.tasks.set(task.id, task);

  const plan = planTaskNotifications(task, NOW);
  for (const input of plan.notifications) await h.deps.enqueue(input);
  for (const input of plan.notifications) await h.deps.enqueue(input);

  assert.equal(
    h.queue.rows.length,
    2,
    "the second pass was absorbed by the partial unique index"
  );
});

// ----------------------------------------------------------------------------
// AC: nothing is enqueued for a task that cannot owe one
// ----------------------------------------------------------------------------

test("a task already complete enqueues nothing", async () => {
  const h = harness();
  const report = await h.write(facts({ status: "complete" }));

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "already_complete");
});

test("a task with no assignee enqueues no unaddressed notification", async () => {
  const h = harness();
  const report = await h.write(facts({ assignedToId: null }));

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "unassigned");
});

test("a task with no due date has no moment to be due at", async () => {
  const h = harness();
  const report = await h.write(facts({ dueDate: null }));

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "no_due_date");
});

test("a soft-deleted task enqueues nothing", async () => {
  const h = harness();
  const report = await h.write(facts({ deletedAt: new Date() }));

  assert.equal(h.queue.rows.length, 0);
  assert.equal(report.reason, "deleted");
});

// ----------------------------------------------------------------------------
// AC: completing or deleting cancels by ENTITY reference — dispatch after a
// completion sends nothing
// ----------------------------------------------------------------------------

test("completing a task cancels its pending rows, and dispatch then sends nothing", async () => {
  const h = harness();
  const task = facts({ dueDate: PAST_DUE });
  await h.write(task);
  h.queue.addRecipient(ASSIGNEE);

  assert.equal(h.queue.pending().length, 1);

  // What `completeTask` does, in the order it does it.
  h.tasks.set(task.id, { ...task, status: "complete" });
  const cancelled = await cancelTaskNotifications(CHURCH, task.id, h.deps);
  assert.equal(cancelled, 1);

  const summary = await runDispatch(h.queue, { now: NOW });

  assert.equal(summary.claimed, 0, "a cancelled row is never claimed");
  assert.equal(h.queue.sends.length, 0, "nothing was sent");
  assert.equal(h.queue.byStatus("cancelled").length, 1);
});

test("the cancel reaches every recipient's row for the entity", async () => {
  // A task's assignee can change between the two enqueues, so the entity is the
  // only handle that reaches both rows. `cancelByEntity` is church-wide by
  // design, and this is why.
  const h = harness();
  const task = facts({ dueDate: PAST_DUE });
  await h.write(task);
  await h.write({ ...task, assignedToId: OTHER });

  // Re-enqueued under a new recipient; the first pair is already cancelled.
  assert.equal(h.queue.pending().length, 1);
  assert.equal(h.queue.pending()[0].recipientUserId, OTHER);

  await cancelTaskNotifications(CHURCH, task.id, h.deps);
  assert.equal(h.queue.pending().length, 0);
});

// ----------------------------------------------------------------------------
// AC: a still-live predicate is registered for the task types
// ----------------------------------------------------------------------------

test("the registrar arms every task type, and only through a call", async (t) => {
  // WHAT THIS PROVES, AND WHAT IT DOES NOT. Importing this module registers
  // NOTHING — that is asserted first, and it is the whole reason the registrar
  // is a function: a module-load side effect here armed the check in every
  // runtime EXCEPT the one that reads it, because the dispatcher's entrypoint
  // imports no feature module. Whether production actually calls it is asserted
  // over the ROUTE's own module graph, in
  // `src/app/api/notifications/dispatch/route.test.ts`.
  //
  // KEEP THIS THE FIRST TEST IN THE FILE THAT TOUCHES THE REGISTRY: the "not
  // registered" half can only speak for module load if nothing has registered
  // yet. The route suite's source guard says the same thing order-independently.
  for (const type of TASK_NOTIFICATION_TYPES) {
    assert.equal(
      stillLivePredicateFor(type),
      undefined,
      `importing this module registered "${type}" — arming must be a call the dispatcher makes, not an import side effect`
    );
  }

  registerTaskStillLivePredicates(harness().deps);
  t.after(() => clearStillLivePredicates());

  for (const type of TASK_NOTIFICATION_TYPES) {
    assert.ok(
      stillLivePredicateFor(type),
      `no still-live predicate is registered for ${type}`
    );
  }
});

test("a task completed after enqueue is not announced — dispatch cancels it", async (t) => {
  const h = harness();
  const task = facts({ dueDate: PAST_DUE });
  await h.write(task);
  h.queue.addRecipient(ASSIGNEE);

  // Point the registered predicate at this test's store.
  registerTaskStillLivePredicates(h.deps);
  t.after(() => clearStillLivePredicates());

  // Completed WITHOUT the cancel — the path the predicate exists to cover: a
  // row a dispatch run has already claimed cannot be reached by a cancel.
  h.tasks.set(task.id, { ...task, status: "complete" });

  const summary = await runDispatch(h.queue, { now: NOW });

  assert.equal(summary.claimed, 1, "the row was due and was claimed");
  assert.equal(summary.cancelled, 1, "the predicate resolved it");
  assert.equal(summary.delivered, 0);
  assert.equal(h.queue.sends.length, 0, "nothing was emailed");
  assert.equal(
    h.queue.deliveryFor(h.queue.rows[0].id, "email")?.status,
    "cancelled",
    "and the delivery log says why it never arrived (N-016)"
  );
});

test("a live task IS announced — the predicate is not a blanket refusal", async (t) => {
  const h = harness();
  const task = facts({ dueDate: PAST_DUE });
  await h.write(task);
  h.queue.addRecipient(ASSIGNEE);

  registerTaskStillLivePredicates(h.deps);
  t.after(() => clearStillLivePredicates());

  const summary = await runDispatch(h.queue, { now: NOW });

  assert.equal(summary.delivered, 1);
  assert.equal(h.queue.sends.length, 1);
});

// ----------------------------------------------------------------------------
// AC: rescheduling is cancel + re-enqueue, leaving nothing at the old date
// ----------------------------------------------------------------------------

test("rescheduling leaves no pending row at the old due date", async () => {
  const h = harness();
  const task = facts();
  await h.write(task);

  const oldDueAt = taskDueAt(task)!;
  const moved = { ...task, dueDate: "2026-09-15" };
  await h.write(moved);

  const pending = h.queue.pending();
  assert.equal(pending.length, 2, "one due row and one overdue row");
  for (const row of pending) {
    assert.notEqual(
      row.scheduledFor.getTime(),
      oldDueAt.getTime(),
      "a pending row is still aimed at the old due date"
    );
    assert.ok(
      row.dedupeKey?.includes("2026-09-15"),
      "the dedupe key carries the new schedule"
    );
  }
});

test("reopening a task re-enqueues, because cancelling released the key", async () => {
  const h = harness();
  const task = facts();
  await h.write(task);
  await cancelTaskNotifications(CHURCH, task.id, h.deps);
  assert.equal(h.queue.pending().length, 0);

  await h.write(task);

  assert.equal(
    h.queue.pending().length,
    2,
    "a cancelled row must not keep reserving its dedupe key"
  );
});

// ----------------------------------------------------------------------------
// AC (T-018): every path that WRITES a task asks for its notifications
// ----------------------------------------------------------------------------
//
// The rows a planter never typed are the ones they are most likely to forget: a
// phase-template import mints a whole dated checklist, and a finalised meeting
// mints a follow-up per attendee plus an evaluation task — all with an assignee
// and a due date, and all silent while `import.ts` and `events.ts` were the two
// modules that inserted into `tasks` without asking.
//
// Pinned as a PROPERTY over the directory rather than as two call sites: nothing
// about the notification module distinguishes those rows, so the only thing that
// can go wrong again is a THIRD writer that does not ask. A `db.insert(tasks)`
// cannot be executed in a unit test's process, so this is source-shaped by
// necessity — the behaviour it stands for is covered by every
// `syncTaskNotificationsFor` test above.

test("no module inserts into tasks without asking for notifications", () => {
  const dir = path.join(process.cwd(), "src/lib/tasks");
  const writers = readdirSync(dir)
    .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => ({
      name,
      source: readFileSync(path.join(dir, name), "utf8"),
    }))
    .filter(({ source }) => /\.insert\(tasks\)/.test(stripComments(source)));

  assert.ok(writers.length >= 3, "the writer scan found nothing to check");

  const silent = writers
    .filter(
      ({ source }) =>
        !/(sync|cancel)Task(Notifications|NotificationsFor)\(/.test(
          stripComments(source)
        )
    )
    .map(({ name }) => name);

  assert.deepEqual(
    silent,
    [],
    "a module writes tasks and never asks for their due/overdue notifications — those rows are silent for ever"
  );
});
