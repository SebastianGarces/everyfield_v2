import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NOT_RECORDED,
  daysUntilLaunch,
  formatAssociationProvenance,
  formatLaunchCountdown,
  formatPhase,
  formatPlantLocation,
  meetingsStats,
  ministryTeamsStats,
  peopleStats,
  scopeLabelForRole,
  summarizeSendingChurchRoster,
  tasksStats,
} from "./presentation";
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
  assert.equal(daysUntilLaunch("2026-09-01", asOf), 26);
  assert.equal(daysUntilLaunch(null, asOf), null);
  assert.equal(daysUntilLaunch("not-a-date", asOf), null);
});

test("a past launch date reads as past, not as a negative number", () => {
  assert.equal(formatLaunchCountdown(null), "No launch date set");
  assert.equal(formatLaunchCountdown(0), "Launches today");
  assert.equal(formatLaunchCountdown(1), "1 day to launch");
  assert.equal(formatLaunchCountdown(42), "42 days to launch");
  assert.equal(formatLaunchCountdown(-1), "Launched 1 day ago");
  assert.equal(formatLaunchCountdown(-30), "Launched 30 days ago");
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

test("a network admin sees which sending church the plant came through", () => {
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
  assert.equal(scopeLabelForRole("network_admin"), "network");
  assert.equal(scopeLabelForRole("sending_church_admin"), "sending church");
});

test("an out-of-range phase does not blow up the row", () => {
  assert.equal(formatPhase(0), "Phase 0: Discovery");
  assert.equal(formatPhase(99), "Phase 99");
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
