import assert from "node:assert/strict";
import { test } from "node:test";

import { getDueDateInfo } from "./task-card-view";

// ----------------------------------------------------------------------------
// THE DUE-DATE LINE — the card's only clock read, and it was reading the wrong
// clock (#411).
//
// `getDueDateInfo` used to floor `new Date()` with `setHours(0,0,0,0)` — the
// RUNTIME's midnight — and compare it against `new Date(dueDate + "T00:00:00")`,
// which JS specifies as local time as well. Two things followed, and the tests
// below are one per consequence:
//
//   1. "Due today" was a claim about whichever calendar the machine kept. The
//      card is server-rendered and then hydrated, so between a server on UTC
//      and a reader four hours west, the same row said "Due today" once and
//      "Due tomorrow" once — a React #418 hydration mismatch, on every task in
//      the list, for a few hours a day.
//   2. The instant was read inside the component, so two cards in one list
//      could straddle a midnight.
//
// Both are closed by the same move: the comparison happens in `APP_TIME_ZONE`
// and `now` is a PARAMETER, passed once from the server page. Every assertion
// here therefore names its own instant, and none of them depends on the zone
// this suite happens to run in.
// ----------------------------------------------------------------------------

/** 09:00 UTC on 2026-08-13 — mid-morning, far from any midnight. */
const MIDDAY = new Date("2026-08-13T09:00:00.000Z");

/** 02:00 UTC on 2026-08-13, which is 22:00 on the 12th anywhere west of UTC-3.
 *  The old arithmetic answered this hour with the PREVIOUS day. */
const LATE_EVENING_IN_THE_AMERICAS = new Date("2026-08-13T02:00:00.000Z");

/** 23:30 UTC on 2026-08-13, already the 14th east of UTC+1. */
const LATE_NIGHT_IN_UTC = new Date("2026-08-13T23:30:00.000Z");

test("no due date says so, and is neither overdue nor due", () => {
  assert.deepEqual(getDueDateInfo(null, MIDDAY), {
    label: "No due date",
    isOverdue: false,
    isDueToday: false,
    isDueSoon: false,
  });
});

test("the day it is due is read in the app's zone, not the runtime's", () => {
  // THE REGRESSION. At 02:00 UTC the process-local day is still the 12th
  // wherever this suite is run in the Americas, so the old code called a task
  // due on the 13th "Due tomorrow" — while the server that rendered the same
  // markup an instant earlier had called it "Due today".
  const info = getDueDateInfo("2026-08-13", LATE_EVENING_IN_THE_AMERICAS);

  assert.equal(info.label, "Due today");
  assert.equal(info.isDueToday, true);
  assert.equal(info.isOverdue, false);
});

test("…and the same holds from the other side of midnight", () => {
  // 23:30 UTC is already tomorrow east of UTC+1, where the old code would have
  // called a task due on the 14th "Due today".
  const info = getDueDateInfo("2026-08-14", LATE_NIGHT_IN_UTC);

  assert.equal(info.label, "Due tomorrow");
  assert.equal(info.isDueToday, false);
  assert.equal(info.isDueSoon, true);
});

test("a past day is overdue, counted in whole days", () => {
  const oneDay = getDueDateInfo("2026-08-12", MIDDAY);
  assert.equal(oneDay.label, "1 day overdue");
  assert.equal(oneDay.isOverdue, true);

  const several = getDueDateInfo("2026-08-10", MIDDAY);
  assert.equal(several.label, "3 days overdue");
  assert.equal(several.isOverdue, true);
});

test("the week ahead counts down; beyond it, the day is named", () => {
  assert.equal(getDueDateInfo("2026-08-14", MIDDAY).label, "Due tomorrow");
  assert.equal(getDueDateInfo("2026-08-16", MIDDAY).label, "Due in 3 days");

  const edge = getDueDateInfo("2026-08-20", MIDDAY);
  assert.equal(edge.label, "Due in 7 days", "the seventh day is still a count");
  assert.equal(edge.isDueSoon, true);

  // The eighth is a date, and it is zone-pinned too — `calendarTileParts` is
  // the one "Aug 21" formatter, so this cannot drift back to a local one.
  const beyond = getDueDateInfo("2026-08-21", MIDDAY);
  assert.equal(beyond.label, "Due Aug 21");
  assert.equal(beyond.isDueSoon, false);
});

test("the hour of the instant never moves the answer", () => {
  // Whole calendar days in `APP_TIME_ZONE`, not 24-hour blocks: every instant
  // inside one UTC day answers a given due date identically. This is what makes
  // the server's render and the browser's hydration agree.
  const answers = new Set(
    [
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
      "2026-08-13T09:00:00.000Z",
      "2026-08-13T23:59:59.000Z",
    ].map((instant) => getDueDateInfo("2026-08-16", new Date(instant)).label)
  );

  assert.deepEqual([...answers], ["Due in 3 days"]);
});
