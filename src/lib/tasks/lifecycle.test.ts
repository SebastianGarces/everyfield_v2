import assert from "node:assert/strict";
import { test } from "node:test";
import { actionableTaskStatuses, isTaskSettled } from "./lifecycle";
import { parseTaskListSearchParams, taskListParamsWith } from "./list-params";

test("waived is settled without being complete, visible under closed tasks", () => {
  assert.equal(isTaskSettled("no_longer_needed"), true);
  assert.equal(isTaskSettled("complete"), true);
  for (const status of actionableTaskStatuses)
    assert.equal(isTaskSettled(status), false);
  const parsed = parseTaskListSearchParams({ status: "no_longer_needed" });
  assert.equal(parsed.showCompleted, true);
  assert.deepEqual(parsed.status, ["no_longer_needed"]);
  assert.equal(
    taskListParamsWith(
      "completed=true&status=no_longer_needed",
      "completed",
      null
    ).has("status"),
    false
  );
});

import { followUpMeetingInstant } from "./events";
test("meeting provenance resolves church wall time, with ambiguous DST Unknown", () => {
  const wall = new Date("2026-09-01T18:12:34.567Z");
  assert.equal(
    followUpMeetingInstant(wall, "UTC")?.toISOString(),
    "2026-09-01T18:12:34.567Z"
  );
  assert.equal(
    followUpMeetingInstant(wall, "America/Chicago")?.toISOString(),
    "2026-09-01T23:12:34.567Z"
  );
  assert.equal(
    followUpMeetingInstant(wall, "America/New_York")?.toISOString(),
    "2026-09-01T22:12:34.567Z"
  );
  assert.equal(
    followUpMeetingInstant(
      new Date("2026-03-08T02:30:00Z"),
      "America/New_York"
    ),
    null
  );
  assert.equal(
    followUpMeetingInstant(
      new Date("2026-11-01T01:30:00Z"),
      "America/New_York"
    ),
    null
  );
});
