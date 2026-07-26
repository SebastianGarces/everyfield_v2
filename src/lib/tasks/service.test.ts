import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_BULK_TASKS,
  bulkCompleteTasks,
  bulkRescheduleTasks,
  planBulkTaskOperation,
  reconcileBulkTaskOperation,
  type BulkTaskCandidate,
  type BulkTaskDeps,
} from "./service";

// ----------------------------------------------------------------------------
// Bulk operations (T-019).
//
// The bulk write itself is one SQL statement, so the interesting behaviour is
// everything around it: what happens to a requested id the write never touched,
// and how many `task.completed` events come out the other side. Both are driven
// here through injected deps — no database, no event bus.
// ----------------------------------------------------------------------------

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function candidate(
  id: string,
  overrides: Partial<BulkTaskCandidate> = {}
): BulkTaskCandidate {
  return {
    id,
    churchId: CHURCH_ID,
    title: `Task ${id}`,
    status: "not_started",
    category: null,
    relatedType: null,
    relatedId: null,
    ...overrides,
  };
}

interface FakeDepsOptions {
  rows: BulkTaskCandidate[];
  /** Ids the write refuses to touch (simulating a row that failed). */
  unwritable?: string[];
  /** Make the whole write throw. */
  writeError?: Error;
}

function makeDeps(options: FakeDepsOptions) {
  const unwritable = new Set(options.unwritable ?? []);

  const emitted: string[] = [];
  const rescheduled: { ids: string[]; dueDate: string }[] = [];

  const deps: BulkTaskDeps = {
    async loadCandidates(_churchId, taskIds) {
      const requested = new Set(taskIds);
      return options.rows.filter((row) => requested.has(row.id));
    },
    async completeMany(_churchId, taskIds) {
      if (options.writeError) throw options.writeError;
      return taskIds.filter((id) => !unwritable.has(id));
    },
    async rescheduleMany(_churchId, taskIds, dueDate) {
      if (options.writeError) throw options.writeError;
      rescheduled.push({ ids: taskIds, dueDate });
      return taskIds.filter((id) => !unwritable.has(id));
    },
    async emitCompleted(task) {
      emitted.push(task.id);
    },
  };

  return { deps, emitted, rescheduled };
}

// ----------------------------------------------------------------------------
// Planning
// ----------------------------------------------------------------------------

test("planBulkTaskOperation reports a requested id that does not exist", () => {
  const plan = planBulkTaskOperation(["a", "b"], [candidate("a")]);

  assert.deepEqual(
    plan.actionable.map((row) => row.id),
    ["a"]
  );
  assert.deepEqual(plan.failures, [
    { taskId: "b", title: null, reason: "Task not found" },
  ]);
});

test("planBulkTaskOperation rejects already-complete tasks when asked to", () => {
  const plan = planBulkTaskOperation(
    ["a", "b"],
    [candidate("a"), candidate("b", { status: "complete" })],
    { rejectCompleted: true }
  );

  assert.deepEqual(
    plan.actionable.map((row) => row.id),
    ["a"]
  );
  assert.equal(plan.failures[0]?.reason, "Task is already complete");
  assert.equal(plan.failures[0]?.title, "Task b");
});

test("planBulkTaskOperation de-duplicates requested ids", () => {
  const plan = planBulkTaskOperation(["a", "a", "a"], [candidate("a")]);

  assert.deepEqual(plan.requested, ["a"]);
  assert.equal(plan.actionable.length, 1);
});

test("reconcileBulkTaskOperation never silently drops an untouched row", () => {
  const plan = planBulkTaskOperation(
    ["a", "b"],
    [candidate("a"), candidate("b")]
  );
  const { result, written } = reconcileBulkTaskOperation(plan, ["a"], "boom");

  assert.deepEqual(result.succeeded, ["a"]);
  assert.deepEqual(result.failed, [
    { taskId: "b", title: "Task b", reason: "boom" },
  ]);
  assert.deepEqual(
    written.map((row) => row.id),
    ["a"]
  );
});

// ----------------------------------------------------------------------------
// Bulk complete
// ----------------------------------------------------------------------------

test("bulkCompleteTasks completes every selected task and emits one event each", async () => {
  const { deps, emitted } = makeDeps({
    rows: [candidate("a"), candidate("b"), candidate("c")],
  });

  const result = await bulkCompleteTasks(
    CHURCH_ID,
    ["a", "b", "c"],
    USER_ID,
    deps
  );

  assert.equal(result.requested, 3);
  assert.deepEqual(result.succeeded, ["a", "b", "c"]);
  assert.deepEqual(result.failed, []);
  // One task.completed per completed task — no batching, none skipped.
  assert.deepEqual(emitted, ["a", "b", "c"]);
  assert.equal(result.eventsEmitted, 3);
});

test("bulkCompleteTasks reports the failing row instead of dropping it", async () => {
  const { deps, emitted } = makeDeps({
    rows: [candidate("a"), candidate("b"), candidate("c")],
    unwritable: ["b"],
  });

  const result = await bulkCompleteTasks(
    CHURCH_ID,
    ["a", "b", "c"],
    USER_ID,
    deps
  );

  assert.deepEqual(result.succeeded, ["a", "c"]);
  assert.deepEqual(result.failed, [
    { taskId: "b", title: "Task b", reason: "Task could not be completed" },
  ]);
  // The failed row is accounted for: requested === succeeded + failed.
  assert.equal(
    result.requested,
    result.succeeded.length + result.failed.length
  );
  // And it emits no event, because it was never completed.
  assert.deepEqual(emitted, ["a", "c"]);
  assert.equal(result.eventsEmitted, 2);
});

test("bulkCompleteTasks surfaces a whole-write failure against every actionable task", async () => {
  const { deps, emitted } = makeDeps({
    rows: [candidate("a"), candidate("b")],
    writeError: new Error("connection lost"),
  });

  const result = await bulkCompleteTasks(CHURCH_ID, ["a", "b"], USER_ID, deps);

  assert.deepEqual(result.succeeded, []);
  assert.deepEqual(
    result.failed.map((failure) => failure.reason),
    ["connection lost", "connection lost"]
  );
  assert.deepEqual(emitted, []);
  assert.equal(result.eventsEmitted, 0);
});

test("bulkCompleteTasks mixes not-found, already-complete and written rows", async () => {
  const { deps, emitted } = makeDeps({
    rows: [candidate("a"), candidate("b", { status: "complete" })],
  });

  const result = await bulkCompleteTasks(
    CHURCH_ID,
    ["a", "b", "missing"],
    USER_ID,
    deps
  );

  assert.deepEqual(result.succeeded, ["a"]);
  assert.deepEqual(
    result.failed.map((failure) => [failure.taskId, failure.reason]),
    [
      ["b", "Task is already complete"],
      ["missing", "Task not found"],
    ]
  );
  assert.deepEqual(emitted, ["a"]);
});

test("bulkCompleteTasks does not fail a task when its event emission throws", async () => {
  const { deps } = makeDeps({ rows: [candidate("a"), candidate("b")] });
  const failing: BulkTaskDeps = {
    ...deps,
    async emitCompleted(task) {
      if (task.id === "a") throw new Error("subscriber blew up");
    },
  };

  const result = await bulkCompleteTasks(
    CHURCH_ID,
    ["a", "b"],
    USER_ID,
    failing
  );

  assert.deepEqual(result.succeeded, ["a", "b"]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.eventsEmitted, 1);
});

test("bulkCompleteTasks is a no-op for an empty selection", async () => {
  const { deps, emitted } = makeDeps({ rows: [] });

  const result = await bulkCompleteTasks(CHURCH_ID, [], USER_ID, deps);

  assert.deepEqual(result, {
    requested: 0,
    succeeded: [],
    failed: [],
    eventsEmitted: 0,
  });
  assert.deepEqual(emitted, []);
});

test("bulkCompleteTasks refuses a selection larger than the cap", async () => {
  const ids = Array.from({ length: MAX_BULK_TASKS + 1 }, (_, i) => `id-${i}`);
  const { deps } = makeDeps({ rows: [] });

  await assert.rejects(
    () => bulkCompleteTasks(CHURCH_ID, ids, USER_ID, deps),
    /more than 100 tasks/
  );
});

// ----------------------------------------------------------------------------
// Bulk reschedule
// ----------------------------------------------------------------------------

test("bulkRescheduleTasks sets the same due date on every selected task", async () => {
  const { deps, rescheduled } = makeDeps({
    rows: [candidate("a"), candidate("b")],
  });

  const result = await bulkRescheduleTasks(
    CHURCH_ID,
    ["a", "b"],
    "2026-08-01",
    deps
  );

  assert.deepEqual(result.succeeded, ["a", "b"]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(rescheduled, [{ ids: ["a", "b"], dueDate: "2026-08-01" }]);
  // Rescheduling is not a material status change, so it emits nothing.
  assert.equal(result.eventsEmitted, 0);
});

test("bulkRescheduleTasks reports rows the write did not touch", async () => {
  const { deps } = makeDeps({
    rows: [candidate("a"), candidate("b")],
    unwritable: ["b"],
  });

  const result = await bulkRescheduleTasks(
    CHURCH_ID,
    ["a", "b", "missing"],
    "2026-08-01",
    deps
  );

  assert.deepEqual(result.succeeded, ["a"]);
  assert.deepEqual(
    result.failed.map((failure) => [failure.taskId, failure.reason]),
    [
      ["missing", "Task not found"],
      ["b", "Task could not be rescheduled"],
    ]
  );
});

test("bulkRescheduleTasks reschedules a completed task without objecting", async () => {
  const { deps, rescheduled } = makeDeps({
    rows: [candidate("a", { status: "complete" })],
  });

  const result = await bulkRescheduleTasks(
    CHURCH_ID,
    ["a"],
    "2026-08-01",
    deps
  );

  assert.deepEqual(result.succeeded, ["a"]);
  assert.equal(rescheduled.length, 1);
});
