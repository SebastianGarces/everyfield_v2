import assert from "node:assert/strict";
import { test } from "node:test";

import { teamsMeetingInstant } from "./meeting-time";

test("Teams meeting wall clocks resolve in the disclosed zone", () => {
  assert.equal(
    teamsMeetingInstant("2031-02-03T18:30", "America/New_York")?.toISOString(),
    "2031-02-03T23:30:00.000Z"
  );
  assert.equal(
    teamsMeetingInstant(
      "2031-02-03T18:30",
      "America/Los_Angeles"
    )?.toISOString(),
    "2031-02-04T02:30:00.000Z"
  );
});

test("invalid, missing, gap, and fold wall clocks are refused", () => {
  assert.equal(teamsMeetingInstant("2031-02-03", "America/New_York"), null);
  assert.equal(teamsMeetingInstant("2031-02-03T18:30", "Not/AZone"), null);
  assert.equal(
    teamsMeetingInstant("2030-03-10T02:30", "America/New_York"),
    null
  );
  assert.equal(
    teamsMeetingInstant("2030-11-03T01:30", "America/New_York"),
    null
  );
});
