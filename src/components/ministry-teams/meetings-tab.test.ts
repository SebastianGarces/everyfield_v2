import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { calendarTileParts, formatDate, formatTime } from "@/lib/datetime";

// ----------------------------------------------------------------------------
// Team meetings tab — the pinned wall clock (#169)
//
// This is a `"use client"` component, so it formats twice: once in Node while
// the page is server-rendered, once in the visitor's browser at hydration.
// date-fns `format` follows the runtime's zone, so those two runs produced two
// different strings — React #418 — and the meeting detail page it links to,
// which formats through the pinned helpers, disagreed with the card forever.
// memory/invariants.md → Date & Time Rendering.
//
// The component still cannot be imported here: it pulls in the teams server
// actions, which open a database connection at import time. But the derivation
// it renders no longer lives inside it — `calendarTileParts` moved into
// `@/lib/datetime`, which imports nothing — so these tests exercise the real
// helper rather than a copy of it (#361).
// ----------------------------------------------------------------------------

// A meeting late in the UTC evening: the hour at which an unpinned formatter
// east of UTC has already rolled the card onto the next calendar day.
const LATE_NIGHT = new Date("2026-07-30T23:30:00Z");

test("the calendar tile is zone-pinned, so it never rolls a day", () => {
  assert.deepEqual(calendarTileParts(LATE_NIGHT), ["Jul", "30"]);
});

test("a single-digit day keeps the tile to the bare number", () => {
  assert.deepEqual(calendarTileParts(new Date("2026-03-01T09:05:00Z")), [
    "Mar",
    "1",
  ]);
});

test("the tile agrees with the short date the rest of the app renders", () => {
  // The tile used to be carved out of this string. It is its own formatter now,
  // so hold the two together explicitly instead of by construction.
  const [month, day] = calendarTileParts(LATE_NIGHT);
  assert.equal(formatDate(LATE_NIGHT, "short"), "Thu, Jul 30, 2026");
  assert.ok(formatDate(LATE_NIGHT, "short").includes(`${month} ${day},`));
});

test("the card and the meeting detail page state the same day and time", () => {
  // /meetings/[id] renders `formatDate(...)` / `formatTime(...)`
  // (meeting-header.tsx, meeting-summary-cards.tsx). This pair is exactly what
  // drifted, so hold the two views together explicitly.
  const detailDate = formatDate(LATE_NIGHT); // "Thursday, July 30, 2026"
  const detailTime = formatTime(LATE_NIGHT); // "11:30 PM"
  const [tileMonth, tileDay] = calendarTileParts(LATE_NIGHT);

  assert.equal(detailTime, "11:30 PM");
  assert.ok(
    detailDate.includes(tileMonth),
    `the tile says ${tileMonth}, the detail page says ${detailDate}`
  );
  assert.ok(
    detailDate.includes(` ${tileDay},`),
    `the tile says day ${tileDay}, the detail page says ${detailDate}`
  );
});

test("the component holds no unpinned formatter", () => {
  // The one thing the helper cannot prove about a component it does not import:
  // that nothing ELSE in the file formats a date the runtime-local way. Kept as
  // a pattern guard, not as a copy of the component's source text.
  const source = readFileSync(path.join(__dirname, "meetings-tab.tsx"), "utf8");
  assert.ok(
    !/from "date-fns"/.test(source),
    "date-fns follows the runtime's zone — format through @/lib/datetime"
  );
  assert.ok(
    !/\btoLocale(Date|Time)?String\s*\(/.test(source),
    "`toLocale*` follows the runtime's zone — format through @/lib/datetime"
  );
});
