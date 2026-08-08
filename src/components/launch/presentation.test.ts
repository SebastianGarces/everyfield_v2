import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { daysUntilTarget } from "@/lib/launch/countdown";
import type { LaunchReadiness } from "@/lib/launch/milestones";

import {
  applyReadinessChange,
  canCompleteMilestone,
  completeMilestoneBlockedReason,
  countdownFigure,
  countdownLabel,
  formatLaunchDay,
  journalEntryLabel,
  launchedHeadline,
  launchStatusMeta,
  outcomeSummary,
  progressPercent,
} from "./presentation";

// ============================================================================
// LS-004/005 — what the launch surfaces SAY.
// ============================================================================

// ---------------------------------------------------------------------------
// The countdown, and the divergence that must not come back
// ---------------------------------------------------------------------------

test("the launch page's words come from the ONE countdown helper", () => {
  // This is #338's regression test at the presentation layer: the label is
  // computed from `daysUntilTarget`'s answer, so a plant reads "Today" on the
  // MORNING of its launch — not "Yesterday", which every hand-rolled
  // day-vs-instant diff produced from 00:00:01 UTC onward.
  const target = "2026-09-20";
  for (const hour of ["00:00:01", "09:30:00", "23:59:59"]) {
    assert.equal(
      countdownLabel(daysUntilTarget(target, new Date(`2026-09-20T${hour}Z`))),
      "Today",
      `launch morning at ${hour} must read "Today"`
    );
  }
  assert.equal(
    countdownLabel(daysUntilTarget(target, new Date("2026-09-19T23:00:00Z"))),
    "Tomorrow"
  );
  assert.equal(
    countdownLabel(daysUntilTarget(target, new Date("2026-09-21T01:00:00Z"))),
    "Yesterday"
  );
  assert.equal(
    countdownLabel(daysUntilTarget(target, new Date("2026-06-22T17:41:00Z"))),
    "90 days out"
  );
});

test("no date is a sentence, not a zero", () => {
  // A `0` here would read as "today", which is the opposite of the truth.
  assert.equal(countdownLabel(null), "No date yet");
  assert.equal(countdownFigure(null), null);
});

test("the big number is a magnitude, singular when it is one", () => {
  assert.deepEqual(countdownFigure(12), { value: "12", unit: "days" });
  assert.deepEqual(countdownFigure(1), { value: "1", unit: "day" });
  assert.deepEqual(countdownFigure(-1), { value: "1", unit: "day" });
  assert.deepEqual(countdownFigure(0), { value: "0", unit: "days" });
});

test("a launch day is formatted in the app's zone, not the runtime's", () => {
  // memory/invariants.md → Date & Time Rendering: `APP_TIME_ZONE` is UTC, so a
  // stored `2026-09-20` reads as September 20th on every machine — and the
  // server's markup matches the browser's.
  assert.equal(formatLaunchDay("2026-09-20"), "Sunday, September 20, 2026");
  assert.equal(formatLaunchDay("2026-09-20", "short"), "Sun, Sep 20, 2026");
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test("postponed reads as a fact, not a failure (LS-009)", () => {
  // A postponement carries a NEW date and the plant goes on preparing, so it is
  // never styled as an error.
  const postponed = launchStatusMeta("postponed");
  assert.equal(postponed.label, "Postponed");
  assert.notEqual(postponed.badgeVariant, "destructive");
  assert.equal(launchStatusMeta("scheduled").label, "Scheduled");
  assert.equal(launchStatusMeta("completed").label, "Launched");
  assert.equal(launchStatusMeta("planning").label, "Planning");
});

// ---------------------------------------------------------------------------
// The hybrid model's rule, as the button sees it
// ---------------------------------------------------------------------------

test("a milestone with open tasks is not manually completable", () => {
  assert.equal(
    canCompleteMilestone({ isComplete: false, openTaskCount: 2 }),
    false
  );
  assert.equal(
    completeMilestoneBlockedReason({ isComplete: false, openTaskCount: 2 }),
    "2 tasks still open"
  );
  assert.equal(
    completeMilestoneBlockedReason({ isComplete: false, openTaskCount: 1 }),
    "1 task still open"
  );
});

test("a milestone with NO open tasks is completable — including one with none at all", () => {
  assert.equal(
    canCompleteMilestone({ isComplete: false, openTaskCount: 0 }),
    true
  );
  assert.equal(
    completeMilestoneBlockedReason({ isComplete: false, openTaskCount: 0 }),
    null
  );
});

test("an already-complete milestone is not completable again", () => {
  assert.equal(
    canCompleteMilestone({ isComplete: true, openTaskCount: 0 }),
    false
  );
});

test("progress is a whole percent, and an empty list is 0 rather than NaN", () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(3, 9), 33);
  assert.equal(progressPercent(9, 9), 100);
});

// ---------------------------------------------------------------------------
// Optimistic readiness
// ---------------------------------------------------------------------------

function readiness(): LaunchReadiness {
  const task = (id: string, isComplete: boolean) => ({
    id,
    title: id,
    status: (isComplete ? "complete" : "not_started") as
      | "complete"
      | "not_started",
    isComplete,
    dueDate: null,
    assigneeName: null,
  });

  return {
    milestones: [
      {
        id: "m1",
        templateKey: "operations.equipment_on_site",
        area: "operations",
        title: "Equipment",
        description: null,
        sortOrder: 10,
        completedAt: null,
        isComplete: false,
        tasks: [task("t1", false), task("t2", true)],
        openTaskCount: 1,
        completedTaskCount: 1,
      },
      {
        id: "m2",
        templateKey: "promotion.plan",
        area: "promotion",
        title: "Promotion plan",
        description: null,
        sortOrder: 20,
        completedAt: null,
        isComplete: false,
        tasks: [],
        openTaskCount: 0,
        completedTaskCount: 0,
      },
    ],
    completedCount: 0,
    totalCount: 2,
    openTaskCount: 1,
  };
}

test("ticking the last task moves its milestone's counts, and only its own", () => {
  const next = applyReadinessChange(readiness(), {
    kind: "task",
    taskId: "t1",
    complete: true,
  });

  const [first, second] = next.milestones;
  assert.equal(first.openTaskCount, 0);
  assert.equal(first.completedTaskCount, 2);
  // Ticking every task does NOT close the milestone — closing it is a separate,
  // manual act (the hybrid ruling). What it does is make it closeable.
  assert.equal(first.isComplete, false);
  assert.equal(canCompleteMilestone(first), true);
  assert.equal(second.openTaskCount, 0);
  assert.equal(next.openTaskCount, 0);
});

test("the optimistic guess obeys the same rule the server does", () => {
  // A milestone with an open task does not close, even optimistically: a
  // checkbox that ticks and then silently unticks itself is worse than one that
  // never ticked.
  const next = applyReadinessChange(readiness(), {
    kind: "milestone",
    milestoneId: "m1",
    complete: true,
  });
  assert.equal(next.milestones[0].isComplete, false);
  assert.equal(next.completedCount, 0);
});

test("closing a milestone with no open tasks moves the headline count", () => {
  const next = applyReadinessChange(readiness(), {
    kind: "milestone",
    milestoneId: "m2",
    complete: true,
  });
  assert.equal(next.milestones[1].isComplete, true);
  assert.equal(next.completedCount, 1);
  assert.equal(next.totalCount, 2);
});

test("applying a change never mutates the snapshot it was given", () => {
  // `useOptimistic` calls this during render; a mutation there is a bug that
  // only shows up under Strict Mode or a re-render.
  const before = readiness();
  applyReadinessChange(before, { kind: "task", taskId: "t1", complete: true });
  assert.equal(before.milestones[0].openTaskCount, 1);
  assert.equal(before.milestones[0].tasks[0].isComplete, false);
});

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

test("a reschedule and a postponement read differently (LS-009)", () => {
  assert.equal(
    journalEntryLabel({ event: "moved", previousStatus: "scheduled" }),
    "Date moved"
  );
  assert.equal(
    journalEntryLabel({ event: "postponed", previousStatus: "scheduled" }),
    "Postponed"
  );
  assert.equal(
    journalEntryLabel({ event: "scheduled", previousStatus: "planning" }),
    "Scheduled"
  );
  assert.equal(
    journalEntryLabel({ event: "completed", previousStatus: "scheduled" }),
    "Outcome recorded"
  );
});

test("a correction reads as a correction, not a second launch (LS-006)", () => {
  // Both rows are `completed` events — the enum has four values and the schema
  // owns them — so the pair with `previous_status` is what tells them apart.
  // Labelling a Monday recount "Outcome recorded" a second time would read as a
  // plant that launched twice.
  assert.equal(
    journalEntryLabel({ event: "completed", previousStatus: "completed" }),
    "Outcome corrected"
  );
  assert.equal(
    journalEntryLabel({ event: "completed", previousStatus: "postponed" }),
    "Outcome recorded"
  );
});

// ---------------------------------------------------------------------------
// Once it has happened (LS-005/LS-006)
// ---------------------------------------------------------------------------

test("a plant that launched is never told how overdue it is", () => {
  // The celebrate state's whole point: after the day, the card stops counting
  // down. Every number still comes from `daysUntilTarget` — nothing here
  // subtracts dates (#338).
  const target = "2026-09-20";
  assert.equal(
    launchedHeadline(daysUntilTarget(target, new Date("2026-09-20T09:00:00Z"))),
    "Launched today"
  );
  assert.equal(
    launchedHeadline(daysUntilTarget(target, new Date("2026-09-21T00:00:01Z"))),
    "Launched yesterday"
  );
  assert.equal(
    launchedHeadline(daysUntilTarget(target, new Date("2026-09-27T12:00:00Z"))),
    "Launched 7 days ago"
  );
  assert.equal(launchedHeadline(null), "Launched");
});

test("the card's summary keeps 'not recorded' and zero apart", () => {
  // Null means nobody counted; 0 means nobody came, or nobody responded. A card
  // that printed "0 present" for an unfilled field would invent a bad launch.
  assert.equal(
    outcomeSummary({ attendanceCount: null, decisionsCount: null }),
    null
  );
  assert.equal(
    outcomeSummary({ attendanceCount: 0, decisionsCount: 0 }),
    "0 present · 0 decisions and responses"
  );
  assert.equal(
    outcomeSummary({ attendanceCount: 128, decisionsCount: null }),
    "128 present"
  );
  assert.equal(
    outcomeSummary({ attendanceCount: 1, decisionsCount: 1 }),
    "1 person present · 1 decision or response"
  );
});

// ---------------------------------------------------------------------------
// Shape: the launch UI owns no day arithmetic
// ---------------------------------------------------------------------------

test("no launch component computes a day difference of its own", () => {
  // The rule from #303's ruling and #338's fix: ONE implementation
  // (`daysUntilTarget`). A component that subtracted two dates itself would be
  // free to floor a day away and disagree with the phase-engine snapshot on the
  // morning of a plant's launch — which is exactly how the bug shipped twice.
  const dir = path.join(process.cwd(), "src", "components", "launch");
  const files = readdirSync(dir).filter(
    (file) => !file.endsWith(".test.ts") && /\.tsx?$/.test(file)
  );
  assert.ok(files.length > 0, "found no launch components to scan");

  for (const file of files) {
    const code = readFileSync(path.join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(
      !/86_?400_?000|1000 \* 60 \* 60 \* 24|MS_PER_DAY/.test(code),
      `${file} does day arithmetic — use daysUntilTarget (#338)`
    );
    assert.ok(
      !/new Date\(\)/.test(code),
      `${file} reads the clock — the server passes one instant down, or the SSR and hydrated markup disagree (React #418)`
    );
  }
});
