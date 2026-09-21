import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  taskCleanupCalendar,
  taskCleanupFixtureIds,
  taskCleanupPlanReference,
  taskCleanupReadIds,
  taskCleanupRowSignature,
} from "./task-cleanup";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const plan = { planId: a, fingerprint: "a".repeat(64) };
const prepared: CapturedCall = {
  id: "prepare",
  name: "actions.prepare",
  input: {},
  output: {
    artifacts: [{ kind: "confirmation" }],
    activePlan: { mode: "set", plan },
  },
};
const page = (
  ids: string[],
  cursor: string | null = null,
  total = 3
): CapturedCall => ({
  id: `page-${cursor}`,
  name: "tasks.query",
  input: {
    where: { all: [{ assignment: { kind: "mine" } }] },
    query: { mode: "list", limit: 2, cursor },
  },
  output: {
    kind: "read",
    counts: { matched: total },
    items: ids.map((id) => ({ id, label: "Task" })),
  },
});

test("tasks-07 keeps the original request, not a simplified replacement or tasks-10", () => {
  assert.deepEqual(taskCleanupFixtureIds, ["tasks-07"]);
  assert.deepEqual(questions.find((q) => q.id === "tasks-07")!.turns, [
    "Move my overdue tasks to Friday, but leave launch milestones alone.",
  ]);
});
test("requires the latest preparation to contain a presented confirmation", () => {
  assert.deepEqual(
    taskCleanupPlanReference([prepared], new Set([prepared.id])),
    plan
  );
  assert.equal(taskCleanupPlanReference([prepared], new Set()), null);
  for (const output of [
    {},
    { activePlan: { mode: "set", plan } },
    { artifacts: [{ kind: "read" }], activePlan: { mode: "set", plan } },
    {
      artifacts: [{ kind: "confirmation" }],
      activePlan: { mode: "set", plan: { ...plan, fingerprint: "bad" } },
    },
  ]) {
    assert.equal(
      taskCleanupPlanReference(
        [{ ...prepared, output }],
        new Set([prepared.id])
      ),
      null
    );
    assert.equal(
      taskCleanupPlanReference(
        [prepared, { ...prepared, id: "later", output }],
        new Set([prepared.id, "later"])
      ),
      null
    );
  }
});
test("collects complete actual pages, not proposed IDs, incomplete pages or duplicate rows", () => {
  assert.deepEqual(taskCleanupReadIds([page([a, b]), page([c], "2")]), [
    a,
    b,
    c,
  ]);
  for (const calls of [
    [page([a, b])],
    [page([a, b]), page([c], "3")],
    [page([a, b]), page([a], "2")],
    [page([a, b]), page([c], "2", 4)],
    [{ ...page([a, b, c], null), output: {} }],
    [page([a, b]), { ...page([c], "2"), output: { status: "unavailable" } }],
  ])
    assert.deepEqual(taskCleanupReadIds(calls), []);
});
test("complete refresh replaces its previous pages; a later failed refresh cannot reuse stale evidence", () => {
  const prior = [page([a, b]), page([c], "2")];
  assert.deepEqual(taskCleanupReadIds([...prior, ...prior]), [a, b, c]);
  assert.deepEqual(
    taskCleanupReadIds([...prior, { ...page([]), output: {} }]),
    []
  );
  const reordered = {
    ...page([c], "2"),
    input: {
      query: { cursor: "2", limit: 2, mode: "list" },
      where: { all: [{ assignment: { kind: "mine" } }] },
    },
  };
  assert.deepEqual(taskCleanupReadIds([page([a, b]), reordered]), [a, b, c]);
  const changed = {
    ...page([c], "2"),
    input: { where: {}, query: { mode: "list", limit: 2, cursor: "2" } },
  };
  assert.deepEqual(taskCleanupReadIds([page([a, b]), changed]), []);
});
test("calendar evidence must be an actual resolved current-clock result", () => {
  const now = "2026-09-20T16:00:00.000Z";
  const output = {
    status: "resolved",
    calendarDate: "2026-09-25",
    timeZone: "America/New_York",
    referenceInstant: now,
  };
  const call: CapturedCall = {
    id: "date",
    name: "calendar.resolve",
    input: { date: { kind: "weekday", weekday: 5, occurrence: "upcoming" } },
    output,
  };
  assert.deepEqual(taskCleanupCalendar([call], now), output);
  assert.equal(
    taskCleanupCalendar([{ ...call, output: {}, input: output }], now),
    null
  );
  assert.equal(taskCleanupCalendar([call], "2026-09-21T16:00:00.000Z"), null);
  assert.equal(
    taskCleanupCalendar(
      [call, { ...call, output: { status: "needs_input" } }],
      now
    ),
    null
  );
});
test("independent signatures distinguish another owner, another date and changed task content", () => {
  const row = {
    id: a,
    title: "Task",
    description: "Keep",
    status: "blocked",
    priority: "high",
    dueDate: "2026-09-18",
    assignedToId: b,
  };
  for (const change of [
    { assignedToId: c },
    { dueDate: "2026-10-02" },
    { description: "Changed" },
    { status: "complete" },
    { id: c },
  ])
    assert.notEqual(
      taskCleanupRowSignature(row),
      taskCleanupRowSignature({ ...row, ...change })
    );
});
