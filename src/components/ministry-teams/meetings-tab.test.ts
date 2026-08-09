import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { formatDate, formatTime } from "@/lib/datetime";

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
// The component cannot be imported here: it pulls in the teams server actions,
// which open a database connection at import time. So the tile derivation is
// mirrored below (and the guard test holds the source to it), and the strings
// are checked against the same helpers the detail page calls.
// ----------------------------------------------------------------------------

const SOURCE_PATH = path.join(__dirname, "meetings-tab.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

/** The derivation `calendarTileParts` performs, mirrored. */
function calendarTileParts(date: Date): [month: string, day: string] {
  const [, monthAndDay = ""] = formatDate(date, "short").split(", ");
  const [month = "", day = ""] = monthAndDay.split(" ");
  return [month, day];
}

// A meeting late in the UTC evening: the hour at which an unpinned formatter
// east of UTC has already rolled the card onto the next calendar day.
const LATE_NIGHT = new Date("2026-07-30T23:30:00Z");

test("the calendar tile splits the pinned short date, so it never rolls a day", () => {
  assert.equal(formatDate(LATE_NIGHT, "short"), "Thu, Jul 30, 2026");
  assert.deepEqual(calendarTileParts(LATE_NIGHT), ["Jul", "30"]);
});

test("a single-digit day keeps the tile to the bare number", () => {
  assert.deepEqual(calendarTileParts(new Date("2026-03-01T09:05:00Z")), [
    "Mar",
    "1",
  ]);
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

test("the tile and the time still come from the pinned helpers", () => {
  assert.ok(
    source.includes('formatDate(date, "short").split(", ")'),
    "the tile derivation moved — keep it sourced from the pinned short date"
  );
  assert.ok(
    source.includes("formatTime(meetingDate)"),
    "the card's time must come from the same helper the detail page uses"
  );
});
