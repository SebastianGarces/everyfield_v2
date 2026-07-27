import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bulkRescheduleSchema,
  bulkTaskIdsSchema,
  isCalendarDate,
} from "./tasks";
import { MAX_BULK_TASKS } from "@/lib/tasks/types";

// ----------------------------------------------------------------------------
// Bulk reschedule validation (T-019).
//
// The interesting case is the impossible calendar day. A regex plus
// `Date.parse` looks like it validates a date and does not: JavaScript rolls
// 2026-02-31 over to Mar 3 rather than returning NaN, so without a round-trip
// check the user's reschedule lands on a day they never chose.
// ----------------------------------------------------------------------------

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

test("isCalendarDate accepts real days", () => {
  for (const value of [
    "2026-08-01",
    "2026-02-28",
    "2024-02-29",
    "2026-12-31",
  ]) {
    assert.equal(isCalendarDate(value), true, value);
  }
});

test("isCalendarDate rejects days that do not exist", () => {
  // Each of these parses to a real timestamp via roll-over, which is exactly
  // why Date.parse alone is not a validation.
  for (const value of [
    "2026-02-31", // rolls to Mar 3
    "2026-02-30",
    "2025-02-29", // 2025 is not a leap year
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
  ]) {
    assert.equal(isCalendarDate(value), false, value);
  }
});

test("isCalendarDate rejects anything that is not a plain Y-M-D string", () => {
  for (const value of [
    "",
    "2026-8-1",
    "26-08-01",
    "2026-08-01T00:00:00Z",
    "tomorrow",
  ]) {
    assert.equal(isCalendarDate(value), false, value);
  }
});

test("bulkRescheduleSchema rejects an impossible date with a usable message", () => {
  const parsed = bulkRescheduleSchema.safeParse({
    taskIds: [UUID_A],
    dueDate: "2026-02-31",
  });

  assert.equal(parsed.success, false);
  assert.equal(
    parsed.success ? null : parsed.error.issues[0]?.message,
    "Choose a valid date"
  );
});

test("bulkRescheduleSchema accepts a real date", () => {
  const parsed = bulkRescheduleSchema.safeParse({
    taskIds: [UUID_A, UUID_B],
    dueDate: "2026-08-01",
  });

  assert.equal(parsed.success, true);
});

test("bulkTaskIdsSchema requires at least one task", () => {
  const parsed = bulkTaskIdsSchema.safeParse([]);

  assert.equal(parsed.success, false);
  assert.equal(
    parsed.success ? null : parsed.error.issues[0]?.message,
    "Select at least one task"
  );
});

test("bulkTaskIdsSchema caps the selection at MAX_BULK_TASKS", () => {
  const tooMany = Array.from({ length: MAX_BULK_TASKS + 1 }, () => UUID_A);
  const parsed = bulkTaskIdsSchema.safeParse(tooMany);

  assert.equal(parsed.success, false);
  assert.match(
    parsed.success ? "" : (parsed.error.issues[0]?.message ?? ""),
    /100 tasks at once/
  );
});

test("bulkTaskIdsSchema rejects a non-uuid id", () => {
  assert.equal(bulkTaskIdsSchema.safeParse(["not-a-uuid"]).success, false);
});
