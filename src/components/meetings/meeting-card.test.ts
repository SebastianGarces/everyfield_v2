import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ----------------------------------------------------------------------------
// Meeting-list relative-day badge — server-minted `now` (#166)
//
// MeetingList is a client component, so MeetingCard is in the client graph.
// relativeDayOffset is only safe in server components when `now` is omitted
// (src/lib/datetime.ts). The meetings page mints one instant and plumbs it
// through the list into the card. Marketing embeds omit the badge.
// memory/invariants.md → Date & Time Rendering.
// ----------------------------------------------------------------------------

const CARD = readFileSync(path.join(__dirname, "meeting-card.tsx"), "utf8");
const LIST = readFileSync(path.join(__dirname, "meeting-list.tsx"), "utf8");
const PAGE = readFileSync(
  path.join(process.cwd(), "src/app/(dashboard)/meetings/page.tsx"),
  "utf8"
);

test("the meetings page mints now on the server and plumbs it through the list", () => {
  assert.match(PAGE, /const now = new Date\(\)/);
  assert.match(PAGE, /now=\{now\}/);
  assert.match(LIST, /now: Date/);
  assert.match(LIST, /now=\{now\}/);
});

test("MeetingCard never reads the clock for the relative-day badge", () => {
  assert.doesNotMatch(CARD, /new Date\(\)/);
  assert.match(
    CARD,
    /formatRelativeDay\(meeting\.datetime,\s*now,\s*timeZone\)/
  );
});
