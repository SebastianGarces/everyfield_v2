import assert from "node:assert/strict";
import { test } from "node:test";
import { getFollowUpInfo } from "./follow-up-warning";

test("multiple obligations: overdue wins; future and undated tasks are neutral", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  assert.equal(getFollowUpInfo([], now, "UTC"), null);
  assert.deepEqual(
    getFollowUpInfo(
      [
        { id: "future", dueDate: "2026-10-01" },
        { id: "old", dueDate: "2026-09-29" },
        { id: "none", dueDate: null },
      ],
      now,
      "UTC"
    ),
    { count: 3, taskId: "old", dueDate: "2026-09-29", overdueCount: 1 }
  );
  assert.equal(
    getFollowUpInfo([{ id: "today", dueDate: "2026-09-30" }], now, "UTC")
      ?.overdueCount,
    0
  );
});
test("date-only task due day respects church midnight and DST", () => {
  const task = [{ id: "task", dueDate: "2026-03-08" }];
  assert.equal(
    getFollowUpInfo(task, new Date("2026-03-09T04:30:00Z"), "America/Chicago")
      ?.overdueCount,
    0
  );
  assert.equal(
    getFollowUpInfo(task, new Date("2026-03-09T05:30:00Z"), "America/Chicago")
      ?.overdueCount,
    1
  );
  assert.equal(
    getFollowUpInfo(task, new Date("2026-03-09T04:30:00Z"), "UTC")
      ?.overdueCount,
    1
  );
});
