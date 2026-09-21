import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDateTimeWithZone } from "@/lib/datetime";
import { MILESTONE_KINDS } from "@/lib/phase-engine/signals/milestones";
import { plantIntelligenceMilestoneDate } from "./reads";

test("Launch Sunday is a calendar date, never the prior evening in the church timezone", () => {
  const event = {
    kind: "launch_day" as const,
    at: new Date("2026-10-11T00:00:00.000Z"),
  };
  for (const zone of [
    "America/New_York",
    "America/Los_Angeles",
    "Pacific/Honolulu",
    "Pacific/Auckland",
    "UTC",
  ]) {
    assert.equal(
      plantIntelligenceMilestoneDate(event, zone),
      "Sunday, October 11, 2026"
    );
  }
});

test("the first vision meeting preserves its scheduled 10 AM wall clock in summer and winter", () => {
  for (const [date, zone, expected] of [
    [
      "2026-09-22T10:00:00Z",
      "America/New_York",
      "Tuesday, September 22, 2026 at 10:00 AM EDT",
    ],
    [
      "2026-12-22T10:00:00Z",
      "America/New_York",
      "Tuesday, December 22, 2026 at 10:00 AM EST",
    ],
    [
      "2026-09-22T10:00:00Z",
      "America/Chicago",
      "Tuesday, September 22, 2026 at 10:00 AM CDT",
    ],
  ]) {
    assert.equal(
      plantIntelligenceMilestoneDate(
        { kind: "first_vision_meeting", at: new Date(date) },
        zone
      ),
      expected
    );
  }
});

test("legacy ambiguous meeting wall clocks ask for review instead of inventing a UTC offset", () => {
  assert.equal(
    plantIntelligenceMilestoneDate(
      { kind: "first_vision_meeting", at: new Date("2026-11-01T01:30:00Z") },
      "America/New_York"
    ),
    "Sunday, November 1, 2026 at 1:30 AM (America/New_York; time needs review)"
  );
});

test("actual timestamp milestones, including recording launch outcomes, keep their church-local time", () => {
  const at = new Date("2026-10-11T00:00:00.000Z");
  for (const kind of MILESTONE_KINDS.filter(
    (kind) => kind !== "launch_day" && kind !== "first_vision_meeting"
  )) {
    for (const zone of ["America/New_York", "Pacific/Auckland", "UTC"]) {
      assert.equal(
        plantIntelligenceMilestoneDate({ kind, at }, zone),
        formatDateTimeWithZone(at, zone)
      );
    }
  }
  assert.equal(
    plantIntelligenceMilestoneDate(
      { kind: "launch_recorded", at },
      "America/New_York"
    ),
    "Saturday, October 10, 2026 at 8:00 PM EDT"
  );
});
