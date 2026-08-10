import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { formatDate, formatTime } from "@/lib/datetime";

// ----------------------------------------------------------------------------
// Guest RSVP page — the pinned wall clock (#169)
//
// The page an invitee sees is the one place the app has no second chance: it
// states a time to someone who is not logged in and cannot cross-check it. It
// formatted with date-fns, which follows the runtime's zone, so one change of
// the deployment's `TZ` made the guest's page and the planter's meeting page
// name two different hours for the same meeting.
// memory/invariants.md → Date & Time Rendering.
// ----------------------------------------------------------------------------

const SOURCE_PATH = path.join(__dirname, "page.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

const LATE_NIGHT = new Date("2026-07-30T23:30:00Z");

test("the page holds no unpinned formatter", () => {
  assert.ok(
    !/from "date-fns"/.test(source),
    "date-fns follows the runtime's zone — format through @/lib/datetime"
  );
  assert.ok(
    !/\btoLocale(Date|Time)?String\s*\(/.test(source),
    "`toLocale*` follows the runtime's zone — format through @/lib/datetime"
  );
  assert.ok(source.includes('from "@/lib/datetime"'));
});

test("the meeting datetime goes through the pinned helpers", () => {
  assert.ok(source.includes("formatDate(meeting.datetime)"));
  assert.ok(source.includes("formatTime(meeting.datetime)"));
});

test("the guest is told the same wall clock the planter sees", () => {
  // The long variant is what the previous "EEEE, MMMM d, yyyy" pattern spelled
  // out, and what /meetings/[id] shows.
  assert.equal(formatDate(LATE_NIGHT), "Thursday, July 30, 2026");
  assert.equal(formatTime(LATE_NIGHT), "11:30 PM");
});
