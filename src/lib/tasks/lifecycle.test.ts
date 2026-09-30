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
  const winter = new Date("2026-01-15T18:00:00Z");
  assert.equal(
    followUpMeetingInstant(winter, "America/Chicago")?.toISOString(),
    "2026-01-16T00:00:00.000Z"
  );
  assert.equal(
    followUpMeetingInstant(winter, "America/New_York")?.toISOString(),
    "2026-01-15T23:00:00.000Z"
  );
  const acrossDST = followUpMeetingInstant(
    new Date("2026-03-07T18:00:00Z"),
    "America/Chicago"
  )!;
  assert.equal(
    new Date(acrossDST.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    "2026-03-10T00:00:00.000Z"
  );

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
