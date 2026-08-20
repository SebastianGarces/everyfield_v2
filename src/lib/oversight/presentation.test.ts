import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LAUNCHED_CAPTION,
  LAUNCH_PHASE,
  NOT_RECORDED,
  PHASE_SEQUENCE,
  PRE_LAUNCH_CAPTION,
  formatAssociationProvenance,
  formatLaunchCountdown,
  formatPhase,
  formatPlantLocation,
  meetingsStats,
  ministryTeamsStats,
  peopleStats,
  portfolioSpreadCaption,
  summarizePortfolioPhases,
  summarizeSendingChurchRoster,
  tasksStats,
} from "./presentation";
// The two scope-label words come from the IMPORT-FREE LEAF, never from
// `presentation.ts`, and this import is part of what pins that: a re-export
// there would make the heavy module reachable from `remove-plant-dialog.tsx`,
// a `"use client"` component (`org-label.test.ts` asserts the property).
import { scopeLabelForOrgType } from "./org-label";
// The countdown oversight renders is the CANON, not a local copy: this module
// used to carry a byte-for-byte duplicate of it (PR #339), which is how #338
// shipped twice. These cases stay here because they pin what the oversight
// listing composes — `formatLaunchCountdown(daysUntilTarget(...))` — and that
// pairing is this module's, even though the arithmetic no longer is.
import { daysUntilTarget } from "@/lib/launch/countdown";
import type {
  MeetingsAggregate,
  MinistryTeamsAggregate,
  NetworkSendingChurchSummary,
  PeopleAggregate,
  TasksAggregate,
} from "./types";

// ----------------------------------------------------------------------------
// Location — three individually-optional columns (OB-002)
// ----------------------------------------------------------------------------

test("a partial location renders the parts that exist, not a blank", () => {
  assert.equal(
    formatPlantLocation("Austin", "Texas", "US"),
    "Austin, Texas, US"
  );
  assert.equal(formatPlantLocation("Austin", null, null), "Austin");
  assert.equal(formatPlantLocation(null, "Texas", "US"), "Texas, US");
  // Whitespace-only is not a location; it must not render as ", , ".
  assert.equal(formatPlantLocation("  ", "", null), null);
  assert.equal(formatPlantLocation(null, null, null), null);
});

// ----------------------------------------------------------------------------
// Launch countdown — pinned to APP_TIME_ZONE, never the runtime's zone
// ----------------------------------------------------------------------------

test("the countdown is computed at UTC midnight, so it cannot drift with TZ", () => {
  const asOf = new Date("2026-08-05T23:30:00.000Z");
  // The launch date is a wall-clock day. Parsed at UTC midnight it is 27 days
  // out; parsed in a negative-offset local zone it would be 26 or 28.
  assert.equal(daysUntilTarget("2026-09-01", asOf), 27);
  assert.equal(daysUntilTarget(null, asOf), null);
  assert.equal(daysUntilTarget("not-a-date", asOf), null);
});

test("both sides are floored to a UTC day, so the answer holds all day long", () => {
  // The same three dates read from midnight, mid-morning and late evening. A
  // countdown that diffed the launch day against the raw instant lost a whole
  // day the moment the clock passed 00:00 UTC.
  for (const at of [
    "2026-08-05T00:00:00.000Z",
    "2026-08-05T14:00:00.000Z",
    "2026-08-05T23:59:59.000Z",
  ]) {
    const asOf = new Date(at);
    assert.equal(
      daysUntilTarget("2026-08-05", asOf),
      0,
      `launch today @ ${at}`
    );
    assert.equal(
      daysUntilTarget("2026-08-06", asOf),
      1,
      `launch tomorrow @ ${at}`
    );
    assert.equal(
      daysUntilTarget("2026-08-04", asOf),
      -1,
      `launched yesterday @ ${at}`
    );
    assert.equal(
      daysUntilTarget("2026-08-28", asOf),
      23,
      `23 days out @ ${at}`
    );
  }
});

test("the launch-day boundary reads as today, not as already launched", () => {
  // The sentence a reader acts on, end to end: a plant launching today must not
  // be reported as having launched yesterday.
  const morningOfLaunch = new Date("2026-08-05T14:00:00.000Z");
  assert.equal(
    formatLaunchCountdown(daysUntilTarget("2026-08-05", morningOfLaunch)),
    "Launches today"
  );
  assert.equal(
    formatLaunchCountdown(daysUntilTarget("2026-08-06", morningOfLaunch)),
    "1 day to launch"
  );
  assert.equal(
    formatLaunchCountdown(daysUntilTarget("2026-08-04", morningOfLaunch)),
    "Launched 1 day ago"
  );
});

test("a past launch date reads as past, not as a negative number", () => {
  assert.equal(formatLaunchCountdown(null), "No launch date set");
  assert.equal(formatLaunchCountdown(0), "Launches today");
  assert.equal(formatLaunchCountdown(1), "1 day to launch");
  assert.equal(formatLaunchCountdown(42), "42 days to launch");
  assert.equal(formatLaunchCountdown(-1), "Launched 1 day ago");
  assert.equal(formatLaunchCountdown(-30), "Launched 30 days ago");
});

test("this module owns no launch-countdown arithmetic of its own", () => {
  // The counterpart of the guard in `src/components/launch/presentation.test.ts`
  // — and this one has teeth, because THIS file is where the second copy of
  // `daysUntilTarget` actually lived (PR #339). Two implementations of exactly
  // this calculation is how #338 shipped twice; the canon is
  // `src/lib/launch/countdown.ts` and there is to be no third.
  //
  // Scoped to this file on purpose. `read.ts` still owns day math, and rightly:
  // its meeting cadence and idle-day figures diff two genuine INSTANTS, where
  // flooring is correct. The bug was never flooring — it was mixing a
  // wall-clock DAY with an instant (memory/invariants.md → Date & Time
  // Rendering).
  const code = readFileSync(
    path.join(process.cwd(), "src/lib/oversight/presentation.ts"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(
    !/86_?400_?000|1000 \* 60 \* 60 \* 24|MS_PER_DAY/.test(code),
    "presentation.ts does day arithmetic — call daysUntilTarget (#338)"
  );
  // And it must not re-acquire the old name as a local function, which would be
  // the same duplication wearing the same label.
  assert.doesNotMatch(code, /function daysUntilLaunch/);
});

// ----------------------------------------------------------------------------
// Provenance (OV-001)
// ----------------------------------------------------------------------------

test("provenance names the caller's own org and dates the acceptance", () => {
  const line = formatAssociationProvenance({
    orgType: "network",
    orgName: "Redeemer Network",
    viaSendingChurchName: null,
    associatedAt: new Date("2026-08-03T15:00:00.000Z"),
  });
  assert.match(line, /^Joined Redeemer Network on /);
  assert.match(line, /Aug 3, 2026/);
});

test("a missing acceptance date says so rather than rendering blank", () => {
  // Associations can predate the invitation system or arrive by seeding — the
  // same fact `association_events.source_invitation_id` records as null.
  const line = formatAssociationProvenance({
    orgType: "sending_church",
    orgName: "Grace Fellowship",
    viaSendingChurchName: null,
    associatedAt: null,
  });
  assert.equal(
    line,
    "Associated with Grace Fellowship — no invitation on record"
  );
});

test("a network admin sees which of THEIR sending churches the plant sits under", () => {
  // The read layer only ever populates this with a sending church inside the
  // caller's own network (`sendingChurchesInNetwork`), so the qualifier is a
  // position in their hierarchy — never a third org's name.
  const line = formatAssociationProvenance({
    orgType: "network",
    orgName: "Redeemer Network",
    viaSendingChurchName: "Grace Fellowship",
    associatedAt: null,
  });
  assert.match(line, /through Grace Fellowship$/);
});

// ----------------------------------------------------------------------------
// Scope + phase labels
// ----------------------------------------------------------------------------

test("the scope label matches the caller's kind of org", () => {
  assert.equal(scopeLabelForOrgType("network"), "network");
  assert.equal(scopeLabelForOrgType("sending_church"), "sending church");
});

test("an out-of-range phase does not blow up the row", () => {
  assert.equal(formatPhase(0), "Phase 0: Discovery");
  assert.equal(formatPhase(99), "Phase 99");
});

// ----------------------------------------------------------------------------
// Portfolio phase distribution — the oversight index (`/oversight`)
//
// The index used to count these inline off `Array.from({ length: 7 })` and a
// bare `< 5`. `churches.current_phase` is an unconstrained integer, so both
// were claims the column could falsify.
// ----------------------------------------------------------------------------

test("the phase sequence is derived from PHASES, not counted out by hand", () => {
  // Every declared phase, ascending, with no gaps invented and none dropped.
  assert.deepEqual([...PHASE_SEQUENCE], [0, 1, 2, 3, 4, 5, 6]);
  for (const phase of PHASE_SEQUENCE) {
    assert.notEqual(
      formatPhase(phase),
      `Phase ${phase}`,
      `phase ${phase} is in the sequence but has no label in PHASES`
    );
  }
});

test("every declared phase gets a bar, including the ones nobody is in", () => {
  const summary = summarizePortfolioPhases([0, 0, 5]);

  assert.equal(summary.distribution.length, PHASE_SEQUENCE.length);
  assert.deepEqual(
    summary.distribution.map((row) => row.count),
    [2, 0, 0, 0, 0, 1, 0]
  );
  // A zero is a real answer ("nobody is at Phase 3"), and it renders as 0% —
  // the bar used to draw `Math.max(percentage, 2)` and show a sliver there.
  assert.equal(summary.distribution[3].count, 0);
  assert.equal(summary.distribution[3].percentage, 0);
});

test("the bars always sum to the headline total, whatever the column holds", () => {
  // An out-of-range phase used to be counted in the total, drawn in no bar, and
  // bucketed as "launched" by accident — three figures on one card disagreeing.
  const summary = summarizePortfolioPhases([0, 3, 9]);

  assert.equal(summary.total, 3);
  assert.equal(
    summary.distribution.reduce((sum, row) => sum + row.count, 0),
    summary.total
  );

  const stray = summary.distribution.find((row) => row.phase === 9);
  assert.ok(stray, "an undeclared phase is present in the data but has no row");
  assert.equal(stray.count, 1);
  // …and it is LABELLED rather than blank: the raw `PHASES[...]` lookup the
  // index used rendered `undefined` here.
  assert.equal(stray.label, "Phase 9");
});

test("the launch split is decided by LAUNCH_PHASE and covers every plant", () => {
  const phases = [0, 4, 5, 6, 9];
  const summary = summarizePortfolioPhases(phases);

  assert.equal(summary.preLaunch, 2);
  assert.equal(summary.launched, 3);
  assert.equal(summary.preLaunch + summary.launched, summary.total);
  // The boundary the captions name is the boundary the figures use.
  assert.ok(PRE_LAUNCH_CAPTION.includes(String(LAUNCH_PHASE)));
  assert.ok(LAUNCHED_CAPTION.includes(String(LAUNCH_PHASE)));
  // …and neither caption enumerates the phases either side of it, which is the
  // second declaration of the phase list that went stale ("phases 5-6").
  assert.ok(!/\d\s*-\s*\d/.test(PRE_LAUNCH_CAPTION), PRE_LAUNCH_CAPTION);
  assert.ok(!/\d\s*-\s*\d/.test(LAUNCHED_CAPTION), LAUNCHED_CAPTION);
});

test("an empty portfolio divides by nothing and claims no spread", () => {
  const summary = summarizePortfolioPhases([]);

  assert.equal(summary.total, 0);
  assert.equal(summary.preLaunch, 0);
  assert.equal(summary.launched, 0);
  assert.equal(summary.occupiedPhases, 0);
  for (const row of summary.distribution) {
    assert.equal(row.percentage, 0, `${row.label} divided by zero`);
  }
});

test("the spread caption counts occupied phases and pluralises", () => {
  assert.equal(
    portfolioSpreadCaption(summarizePortfolioPhases([2, 2, 2])),
    "Across 1 phase"
  );
  assert.equal(
    portfolioSpreadCaption(summarizePortfolioPhases([0, 2, 5])),
    "Across 3 phases"
  );
});

// ----------------------------------------------------------------------------
// Stat lists — labelled numbers only, and never a blank cell
// ----------------------------------------------------------------------------

test("people stats are counts across every pipeline stage, including zeroes", () => {
  const aggregate: PeopleAggregate = {
    total: 3,
    byStatus: [
      { status: "prospect", count: 2 },
      { status: "core_group", count: 1 },
      { status: "leader", count: 0 },
    ],
  };
  const stats = peopleStats(aggregate);
  assert.deepEqual(stats[0], { label: "People tracked", value: "3" });
  // A stage with nobody in it still renders its zero — omitting it would read
  // as "unknown" when the honest answer is none.
  assert.deepEqual(stats.at(-1), { label: "Leader", value: "0" });
});

test("an unrecorded meeting number says so instead of rendering empty", () => {
  const aggregate: MeetingsAggregate = {
    completedCount: 1,
    upcomingCount: 0,
    lastCompletedAt: new Date("2026-07-30T18:00:00.000Z"),
    daysSinceLastCompleted: 6,
    // One meeting cannot make a gap, and attendance was never entered.
    averageCadenceDays: null,
    averageAttendance: null,
  };
  const byLabel = new Map(meetingsStats(aggregate).map((s) => [s.label, s]));
  assert.equal(byLabel.get("Average attendance")?.value, NOT_RECORDED);
  assert.equal(byLabel.get("Average gap")?.value, "Needs two meetings");
  assert.match(byLabel.get("Last meeting")?.value ?? "", /Jul 30, 2026/);
  assert.equal(byLabel.get("Last meeting")?.hint, "6 days ago");
});

test("a never-held meeting history renders a statement, not an empty date", () => {
  const stats = meetingsStats({
    completedCount: 0,
    upcomingCount: 0,
    lastCompletedAt: null,
    daysSinceLastCompleted: null,
    averageCadenceDays: null,
    averageAttendance: null,
  });
  for (const stat of stats) {
    assert.notEqual(stat.value.trim(), "", `${stat.label} rendered blank`);
  }
});

test("task and team stats carry their denominator as a hint", () => {
  const tasks: TasksAggregate = {
    total: 10,
    open: 4,
    completed: 6,
    overdue: 2,
  };
  const taskByLabel = new Map(tasksStats(tasks).map((s) => [s.label, s]));
  assert.equal(taskByLabel.get("Completed")?.value, "6");
  assert.equal(taskByLabel.get("Completed")?.hint, "of 10 tasks");
  assert.equal(taskByLabel.get("Overdue")?.value, "2");

  const teams: MinistryTeamsAggregate = {
    teamCount: 1,
    teamsWithLeader: 1,
    activeMemberships: 5,
  };
  const teamByLabel = new Map(
    ministryTeamsStats(teams).map((s) => [s.label, s])
  );
  // Singular, not "of 1 teams".
  assert.equal(teamByLabel.get("With a leader")?.hint, "of 1 team");
});

// ----------------------------------------------------------------------------
// Sending-church roster summary (OV-009)
// ----------------------------------------------------------------------------

function rosterRow(
  name: string,
  plantCount: number,
  pendingInvitationCount: number
): NetworkSendingChurchSummary {
  return {
    sendingChurchId: `id-${name}`,
    name,
    plantCount,
    pendingInvitationCount,
  };
}

test("the roster summary totals every column and pluralises each clause", () => {
  assert.equal(
    summarizeSendingChurchRoster([
      rosterRow("Grace", 5, 2),
      rosterRow("Hope", 12, 1),
    ]),
    "2 sending churches · 17 plants · 3 invitations awaiting a reply"
  );
});

test("one of anything reads singular — including the irregular noun", () => {
  assert.equal(
    summarizeSendingChurchRoster([rosterRow("Grace", 1, 1)]),
    "1 sending church · 1 plant · 1 invitation awaiting a reply"
  );
});

test("a zero is stated, never dropped", () => {
  // A missing clause reads as a rendering failure; "0 plants" is the answer.
  assert.equal(
    summarizeSendingChurchRoster([rosterRow("Grace", 0, 0)]),
    "1 sending church · 0 plants · 0 invitations awaiting a reply"
  );
});
