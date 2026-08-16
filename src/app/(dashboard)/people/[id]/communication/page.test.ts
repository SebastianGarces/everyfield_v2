import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ----------------------------------------------------------------------------
// Person communication log — church-zoned sentAt (#166)
//
// The hub and the message-history table already plumb the church's IANA zone
// into formatDateTime / formatRelativeTimestamp. This page was the leftover:
// formatDateTime(communication.sentAt, "short") with no zone, so a church-
// scoped instant still rendered in APP_TIME_ZONE (UTC).
// memory/invariants.md → Date & Time Rendering.
// ----------------------------------------------------------------------------

const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

test("the person communication log formats sentAt in the church zone", () => {
  assert.match(source, /getCurrentUserChurch\(\)/);
  assert.match(
    source,
    /const timeZone = church\?\.timeZone \?\? DEFAULT_CHURCH_TIME_ZONE/
  );
  assert.match(
    source,
    /formatDateTime\(\s*communication\.sentAt,\s*"short",\s*timeZone\s*\)/
  );
});
