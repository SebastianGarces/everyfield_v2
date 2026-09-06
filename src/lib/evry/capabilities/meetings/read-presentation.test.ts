import assert from "node:assert/strict";
import test from "node:test";

import { meetingReadDateTime } from "./reads";

test("meeting reads preserve the stored wall clock and use the church's seasonal time zone", () => {
  assert.equal(
    meetingReadDateTime(new Date("2026-09-22T10:00:00Z"), "America/New_York"),
    "Tuesday, September 22, 2026 at 10:00 AM EDT"
  );
  assert.equal(
    meetingReadDateTime(new Date("2026-12-22T10:00:00Z"), "America/New_York"),
    "Tuesday, December 22, 2026 at 10:00 AM EST"
  );
  assert.match(
    meetingReadDateTime(new Date("2026-09-22T10:00:00Z"), "America/Chicago"),
    /10:00 AM CDT$/
  );
});

test("legacy ambiguous and nonexistent meeting times do not invent an offset", () => {
  for (const date of ["2026-03-08T02:30:00Z", "2026-11-01T01:30:00Z"]) {
    assert.match(
      meetingReadDateTime(new Date(date), "America/New_York"),
      /America\/New_York; time needs review/
    );
  }
});
