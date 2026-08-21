// ============================================================================
// Trends + milestone timeline — read-layer tests (PE-026 + PE-027).
//
// Runs with the Node built-in test runner:
//   DATABASE_URL=postgres://x tsx --test src/lib/phase-engine/signals/queries.test.ts
//
// A dummy DATABASE_URL is only needed because importing this module loads the db
// client at init; every test below exercises the PURE projections
// (`buildPlantTrends`, `buildMilestoneTimeline`, `deriveEngineAlert`) and never
// touches the database.
//
// The acceptance criteria these pin:
//   - all four trends are produced, each from the fact snapshot;
//   - every value traces to a path `assembleFactSnapshot` actually writes —
//     asserted against a REAL assembled snapshot, not against a comment;
//   - a plant with one snapshot gets a value and NO trend line;
//   - alert badges map from the persisted insight severity, never from a
//     threshold applied to the number;
//   - the timeline carries key dates including the launch date when set.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import type { InsightSeverity, PlantInsight } from "@/db/schema";
import type { LatestAssessment } from "@/lib/phase-engine/assessment";
import { readSnapshotFact } from "@/lib/phase-engine/assessment";
import {
  assembleFactSnapshot,
  type SnapshotInputs,
} from "@/lib/phase-engine/signals/build-fact-snapshot";
import type { LaunchRow } from "@/lib/phase-engine/signals/queries";
import {
  buildMilestoneTimeline,
  type CompletedMilestoneRow,
  type MilestoneEvent,
  type PhaseTransitionRow,
} from "@/lib/phase-engine/signals/milestones";
import {
  buildPlantTrends,
  deriveEngineAlert,
  NO_ENGINE_ALERT,
  TREND_METRIC_KEYS,
  type SnapshotHistoryRow,
  type TrendMetric,
  type TrendMetricKey,
} from "@/lib/phase-engine/signals/trends";

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const AS_OF = new Date("2026-06-22T00:00:00.000Z");

// ----------------------------------------------------------------------------
// Fixtures.
// ----------------------------------------------------------------------------

/** One persisted snapshot's readings, all present unless a test says otherwise. */
function historyRow(
  generatedAt: string,
  overrides: Partial<SnapshotHistoryRow> = {}
): SnapshotHistoryRow {
  return {
    assessmentId: `a-${generatedAt}`,
    generatedAt: new Date(generatedAt),
    coreGroupCommittedCount: 10,
    visionMeetingLatestAttendance: 20,
    followUpOpenCount: 10,
    followUpStaleCount: 2,
    followUpStaleThresholdDays: 14,
    ministryRolesFilledCount: 4,
    ministryRolesTotalRoles: 8,
    ...overrides,
  };
}

function insight(overrides: Partial<PlantInsight> = {}): PlantInsight {
  return {
    id: "i1",
    assessmentId: "as1",
    churchId: CHURCH_ID,
    audience: "planter",
    category: "critical_mass",
    severity: "high",
    title: "Core group has stalled",
    body: "Body.",
    citedFacts: ["coreGroup.committedCount=10"],
    relatedArticleSlugs: [],
    rank: 0,
    createdAt: new Date("2026-06-20T00:00:00.000Z"),
    ...overrides,
  } as PlantInsight;
}

function latestWith(insights: PlantInsight[]): LatestAssessment {
  return {
    assessment: {
      id: "as1",
      churchId: CHURCH_ID,
      generatedAt: new Date("2026-06-20T00:00:00.000Z"),
      phase: 2,
      rubricVersion: "rubric-v0",
      factSnapshot: {},
      modelId: "test",
      status: "complete",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    } as LatestAssessment["assessment"],
    insights,
  };
}

function metric(metrics: TrendMetric[], key: TrendMetricKey): TrendMetric {
  const found = metrics.find((m) => m.key === key);
  assert.ok(found, `expected a ${key} metric`);
  return found;
}

// ----------------------------------------------------------------------------
// The four trends exist, and every value comes out of the snapshot.
// ----------------------------------------------------------------------------

test("produces all four trends, in a fixed order", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z"),
      historyRow("2026-06-01T00:00:00.000Z"),
    ],
    null
  );

  assert.ok(trends);
  assert.deepEqual(
    trends.metrics.map((m) => m.key),
    [...TREND_METRIC_KEYS]
  );
  assert.deepEqual(
    [...TREND_METRIC_KEYS],
    [
      "core_group_growth",
      "meeting_attendance",
      "follow_up_completion",
      "team_readiness",
    ]
  );
});

test("every trend's declared fact paths resolve in a real assembled snapshot", () => {
  // The tracing assertion the unit's acceptance criteria call for: not "the
  // comment says these come from build-fact-snapshot.ts", but "assemble a
  // snapshot with the real builder and read every declared path out of it".
  const inputs: SnapshotInputs = {
    church: { id: CHURCH_ID, currentPhase: 2 },
    launch: {
      targetDate: "2026-09-20",
      status: "scheduled",
      outcomeRecordedAt: null,
      attendanceCount: null,
      decisionsCount: null,
    },
    launchMilestones: [{ id: "ms1", completedAt: null }],
    commitments: [
      { personId: "A", commitmentType: "core_group", signedDate: "2026-01-10" },
    ],
    personSources: [],
    visionMeetings: [
      {
        id: "m1",
        datetime: new Date("2026-06-08T18:00:00.000Z"),
        actualAttendance: 30,
      },
    ],
    followUp: [
      {
        id: "p1",
        status: "attendee",
        updatedAt: new Date("2026-06-19T00:00:00.000Z"),
      },
    ],
    followUpTasks: [],
    ministryTeams: [{ id: "t1", name: "Worship Team", leaderId: "A" }],
    leadershipCandidates: [],
    meetingsAttendedByPerson: [],
    activeMembershipsByPerson: [],
    teamLeaderPersonIds: ["A"],
    interviewsByPerson: [],
    assessmentsByPerson: [],
    attendance: [],
    trainingPrograms: [],
    trainingCompletions: [],
    plantSignals: [],
  };

  const snapshot = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  const trends = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z")],
    null
  );
  assert.ok(trends);

  const paths = trends.metrics.flatMap((m) => m.factPaths);
  assert.ok(paths.length >= 7, "every metric declares the paths it read");

  for (const path of paths) {
    const fact = readSnapshotFact(snapshot, path);
    assert.equal(
      fact.present,
      true,
      `${path} is not a field build-fact-snapshot.ts writes`
    );
  }
});

test("reads the latest value and the delta out of the snapshot series", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-04-01T00:00:00.000Z", { coreGroupCommittedCount: 8 }),
      historyRow("2026-05-01T00:00:00.000Z", { coreGroupCommittedCount: 12 }),
      historyRow("2026-06-01T00:00:00.000Z", { coreGroupCommittedCount: 17 }),
    ],
    null
  );
  assert.ok(trends);

  const coreGroup = metric(trends.metrics, "core_group_growth");
  assert.equal(coreGroup.value, 17);
  assert.equal(coreGroup.delta, 9);
  assert.equal(coreGroup.direction, "up");
  assert.deepEqual(
    coreGroup.points.map((p) => p.value),
    [8, 12, 17]
  );
  assert.deepEqual(coreGroup.since, new Date("2026-04-01T00:00:00.000Z"));
  assert.deepEqual(coreGroup.factPaths, ["coreGroup.committedCount"]);
});

test("orders an out-of-order history before computing any delta", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-06-01T00:00:00.000Z", { coreGroupCommittedCount: 17 }),
      historyRow("2026-04-01T00:00:00.000Z", { coreGroupCommittedCount: 8 }),
    ],
    null
  );
  assert.ok(trends);

  const coreGroup = metric(trends.metrics, "core_group_growth");
  assert.equal(coreGroup.value, 17);
  assert.equal(coreGroup.delta, 9);
});

test("a falling series reads as down, an unchanged one as flat", () => {
  const falling = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: 30,
      }),
      historyRow("2026-06-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: 21,
      }),
    ],
    null
  );
  assert.ok(falling);
  const attendance = metric(falling.metrics, "meeting_attendance");
  assert.equal(attendance.delta, -9);
  assert.equal(attendance.direction, "down");

  const flat = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z"),
      historyRow("2026-06-01T00:00:00.000Z"),
    ],
    null
  );
  assert.ok(flat);
  assert.equal(metric(flat.metrics, "meeting_attendance").direction, "flat");
});

// ----------------------------------------------------------------------------
// Ratios: two counts out of the snapshot, and an honest unknown.
// ----------------------------------------------------------------------------

test("follow-up completion is the share of open contacts inside the window", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-06-01T00:00:00.000Z", {
        followUpOpenCount: 10,
        followUpStaleCount: 2,
      }),
    ],
    null
  );
  assert.ok(trends);

  const followUp = metric(trends.metrics, "follow_up_completion");
  assert.equal(followUp.value, 0.8);
  assert.equal(followUp.unit, "rate");
  assert.equal(
    followUp.reading,
    "8 of 10 open contacts touched within 14 days"
  );
});

test("no open follow-ups is unknown, never 100%", () => {
  // A rate with a zero denominator is UNKNOWN (invariants.md → Communication).
  // "Nobody to follow up with" is not "every follow-up completed".
  const trends = buildPlantTrends(
    [
      historyRow("2026-06-01T00:00:00.000Z", {
        followUpOpenCount: 0,
        followUpStaleCount: 0,
      }),
    ],
    null
  );
  assert.ok(trends);

  const followUp = metric(trends.metrics, "follow_up_completion");
  assert.equal(followUp.value, null);
  assert.equal(followUp.reading, null);
  assert.deepEqual(followUp.points, []);
});

test("a reading the newest snapshot could not answer is dated as older", () => {
  // The trap this pins: `value` is the newest AVAILABLE reading, not the newest
  // reading. A plant that clears its follow-up queue makes the newer snapshot
  // unable to answer the rate at all (zero denominator is unknown, never 100%),
  // so the rate falls back to the earlier snapshot's 80%. The card carries ONE
  // "as of" date — the newest snapshot's — so a stale number under it reads as
  // current unless the metric says which day it was measured on.
  const trends = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z", {
        followUpOpenCount: 10,
        followUpStaleCount: 2,
      }),
      historyRow("2026-06-01T00:00:00.000Z", {
        followUpOpenCount: 0,
        followUpStaleCount: 0,
      }),
    ],
    null
  );
  assert.ok(trends);

  const followUp = metric(trends.metrics, "follow_up_completion");
  assert.equal(followUp.value, 0.8, "the older reading is the one shown");
  assert.deepEqual(followUp.valueAt, new Date("2026-05-01T00:00:00.000Z"));
  assert.equal(followUp.valueIsStale, true);
  assert.deepEqual(trends.asOf, new Date("2026-06-01T00:00:00.000Z"));
  // The newest snapshot answered nothing here, so there is no sentence about it.
  assert.equal(followUp.reading, null);

  // A metric the newest snapshot DID answer is not stale, on the same window.
  const coreGroup = metric(trends.metrics, "core_group_growth");
  assert.equal(coreGroup.valueIsStale, false);
  assert.deepEqual(coreGroup.valueAt, new Date("2026-06-01T00:00:00.000Z"));
});

test("a metric no snapshot answered is stale-free, not stale", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: null,
      }),
      historyRow("2026-06-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: null,
      }),
    ],
    null
  );
  assert.ok(trends);

  const attendance = metric(trends.metrics, "meeting_attendance");
  assert.equal(attendance.value, null);
  assert.equal(attendance.valueAt, null);
  // "No reading at all" is its own state; calling it stale would claim there is
  // an older number behind the em dash.
  assert.equal(attendance.valueIsStale, false);
});

test("team readiness is filled roles over the roles the snapshot counted", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-06-01T00:00:00.000Z", {
        ministryRolesFilledCount: 5,
        ministryRolesTotalRoles: 8,
      }),
    ],
    null
  );
  assert.ok(trends);

  const readiness = metric(trends.metrics, "team_readiness");
  assert.equal(readiness.value, 0.625);
  assert.equal(readiness.reading, "5 of 8 roles have a leader");
  assert.deepEqual(readiness.factPaths, [
    "ministryRoles.filledCount",
    "ministryRoles.totalRoles",
  ]);
});

// ----------------------------------------------------------------------------
// Sparse plants.
// ----------------------------------------------------------------------------

test("one snapshot yields values but no trend", () => {
  const trends = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z")],
    null
  );
  assert.ok(trends);

  assert.equal(trends.hasHistory, false);
  assert.equal(trends.snapshotCount, 1);
  for (const m of trends.metrics) {
    assert.equal(m.points.length <= 1, true, `${m.key} plotted a line`);
    assert.equal(m.delta, null, `${m.key} claimed a delta`);
    assert.equal(m.direction, null, `${m.key} claimed a direction`);
    assert.equal(m.since, null, `${m.key} claimed a comparison period`);
  }
  assert.equal(metric(trends.metrics, "core_group_growth").value, 10);
});

test("a never-assessed plant produces no trends at all", () => {
  assert.equal(buildPlantTrends([], null), null);
});

test("a field missing from every stored snapshot is absent, not zero", () => {
  // An older snapshot has no reading at the path; SQL returns null and the
  // point is dropped rather than plotted at 0.
  const trends = buildPlantTrends(
    [
      historyRow("2026-05-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: null,
      }),
      historyRow("2026-06-01T00:00:00.000Z", {
        visionMeetingLatestAttendance: null,
      }),
    ],
    null
  );
  assert.ok(trends);

  const attendance = metric(trends.metrics, "meeting_attendance");
  assert.equal(attendance.value, null);
  assert.deepEqual(attendance.points, []);
  assert.equal(attendance.delta, null);
});

test("a field that only later snapshots carry keeps the readings it has", () => {
  const trends = buildPlantTrends(
    [
      historyRow("2026-04-01T00:00:00.000Z", { coreGroupCommittedCount: null }),
      historyRow("2026-05-01T00:00:00.000Z", { coreGroupCommittedCount: 12 }),
      historyRow("2026-06-01T00:00:00.000Z", { coreGroupCommittedCount: 15 }),
    ],
    null
  );
  assert.ok(trends);

  const coreGroup = metric(trends.metrics, "core_group_growth");
  assert.equal(coreGroup.points.length, 2);
  assert.equal(coreGroup.delta, 3);
});

// ----------------------------------------------------------------------------
// Alert badges — the judge's severity, never a threshold.
// ----------------------------------------------------------------------------

test("a badge is the persisted severity, relabelled", () => {
  const cases: [InsightSeverity, string][] = [
    ["critical", "attention"],
    ["high", "attention"],
    ["medium", "watch"],
    ["low", "noted"],
    ["info", "strength"],
  ];

  for (const [severity, standing] of cases) {
    const trends = buildPlantTrends(
      [historyRow("2026-06-01T00:00:00.000Z")],
      latestWith([insight({ severity, category: "critical_mass" })])
    );
    assert.ok(trends);
    const alert = metric(trends.metrics, "core_group_growth").alert;
    assert.equal(alert.standing, standing);
    assert.equal(alert.severity, severity);
    assert.equal(alert.insightId, "i1");
  }
});

test("the badge does not move when the number does", () => {
  // The proof that no threshold exists: same insight, wildly different values,
  // identical badge.
  const low = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z", { coreGroupCommittedCount: 1 })],
    latestWith([insight({ severity: "info" })])
  );
  const high = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z", { coreGroupCommittedCount: 900 })],
    latestWith([insight({ severity: "info" })])
  );
  assert.ok(low && high);

  assert.equal(
    metric(low.metrics, "core_group_growth").alert.standing,
    "strength"
  );
  assert.equal(
    metric(high.metrics, "core_group_growth").alert.standing,
    "strength"
  );
});

test("a metric the assessment did not speak to is not raised", () => {
  const trends = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z")],
    latestWith([insight({ category: "critical_mass" })])
  );
  assert.ok(trends);

  const readiness = metric(trends.metrics, "team_readiness");
  assert.deepEqual(readiness.alert, NO_ENGINE_ALERT);
  assert.equal(readiness.alert.severity, null);
});

test("the most urgent insight sets the badge; rank breaks a tie", () => {
  const alert = deriveEngineAlert(
    [
      insight({ id: "low", severity: "low", rank: 0 }),
      insight({ id: "urgent", severity: "critical", rank: 5 }),
    ],
    ["critical_mass"]
  );
  assert.equal(alert.insightId, "urgent");
  assert.equal(alert.insightCount, 2);

  const tie = deriveEngineAlert(
    [
      insight({ id: "second", severity: "high", rank: 3 }),
      insight({ id: "first", severity: "high", rank: 1 }),
    ],
    ["critical_mass"]
  );
  assert.equal(tie.insightId, "first");
});

test("another audience's insights never badge a planter's trend", () => {
  const trends = buildPlantTrends(
    [historyRow("2026-06-01T00:00:00.000Z")],
    latestWith([
      insight({ id: "net", audience: "network", severity: "critical" }),
    ]),
    "planter"
  );
  assert.ok(trends);
  assert.deepEqual(
    metric(trends.metrics, "core_group_growth").alert,
    NO_ENGINE_ALERT
  );
});

// ----------------------------------------------------------------------------
// The milestone timeline.
// ----------------------------------------------------------------------------

function launchRow(overrides: Partial<LaunchRow> = {}): LaunchRow {
  return {
    targetDate: "2026-09-20",
    status: "scheduled",
    outcomeRecordedAt: null,
    attendanceCount: null,
    decisionsCount: null,
    ...overrides,
  };
}

function transition(
  overrides: Partial<PhaseTransitionRow> = {}
): PhaseTransitionRow {
  return {
    id: "t1",
    kind: "transition",
    fromPhase: 1,
    toPhase: 2,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

function milestoneRow(
  overrides: Partial<CompletedMilestoneRow> = {}
): CompletedMilestoneRow {
  return {
    id: "ms1",
    title: "Venue secured",
    area: "operations",
    completedAt: new Date("2026-05-05T00:00:00.000Z"),
    ...overrides,
  };
}

function emptyTimelineInputs() {
  return {
    asOf: AS_OF,
    launch: null,
    transitions: [],
    milestones: [],
    visionMeetings: [],
    latest: null,
  };
}

function kinds(events: MilestoneEvent[]): string[] {
  return events.map((event) => event.kind);
}

test("the launch date is on the timeline when one is set", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    launch: launchRow(),
  });

  assert.equal(timeline.launchDate, "2026-09-20");
  assert.equal(timeline.launchStatus, "scheduled");
  assert.equal(timeline.daysUntilLaunch, 90);

  const launchEvent = timeline.events.find((e) => e.kind === "launch_day");
  assert.ok(launchEvent);
  assert.equal(launchEvent.label, "Launch Sunday");
  assert.equal(launchEvent.state, "upcoming");
  // Pinned to UTC midnight, so the day rendered is the day stored.
  assert.equal(launchEvent.at.toISOString(), "2026-09-20T00:00:00.000Z");
});

test("no launch date puts no launch day on the timeline", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    launch: launchRow({ targetDate: null, status: "planning" }),
  });

  assert.equal(timeline.launchDate, null);
  assert.equal(timeline.launchStatus, "planning");
  assert.equal(timeline.daysUntilLaunch, null);
  assert.equal(kinds(timeline.events).includes("launch_day"), false);
});

test("launch day today is still ahead of the plant, not behind it", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    asOf: new Date("2026-09-20T13:00:00.000Z"),
    launch: launchRow(),
  });

  assert.equal(timeline.daysUntilLaunch, 0);
  assert.equal(timeline.events[0].state, "upcoming");
});

test("a past launch day reads as past", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    asOf: new Date("2026-09-27T00:00:00.000Z"),
    launch: launchRow({ status: "completed" }),
  });

  const launchEvent = timeline.events.find((e) => e.kind === "launch_day");
  assert.ok(launchEvent);
  assert.equal(launchEvent.state, "past");
});

test("an initial declaration is a starting point, never an advance", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    transitions: [
      transition({
        id: "d1",
        kind: "initial_declaration",
        fromPhase: 0,
        toPhase: 2,
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
      }),
      transition({ id: "t2", fromPhase: 2, toPhase: 3 }),
    ],
  });

  assert.deepEqual(kinds(timeline.events), ["phase_declared", "phase_change"]);
  assert.match(timeline.events[0].label, /^Started in /);
  assert.match(timeline.events[1].label, /^Moved to /);
});

test("key dates land in chronological order", () => {
  const timeline = buildMilestoneTimeline({
    asOf: AS_OF,
    launch: launchRow({ outcomeRecordedAt: null }),
    transitions: [
      transition({
        id: "d1",
        kind: "initial_declaration",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
      }),
      transition({ id: "t2", createdAt: new Date("2026-04-01T00:00:00.000Z") }),
    ],
    milestones: [milestoneRow()],
    visionMeetings: [
      {
        id: "m2",
        datetime: new Date("2026-03-10T18:00:00.000Z"),
        actualAttendance: 24,
      },
      {
        id: "m1",
        datetime: new Date("2026-02-10T18:00:00.000Z"),
        actualAttendance: 12,
      },
    ],
    latest: null,
  });

  assert.deepEqual(kinds(timeline.events), [
    "phase_declared",
    "first_vision_meeting",
    "phase_change",
    "launch_readiness",
    "launch_day",
  ]);

  const times = timeline.events.map((e) => e.at.getTime());
  assert.deepEqual(
    [...times].sort((a, b) => a - b),
    times
  );

  // Only the FIRST vision meeting — later ones belong to the attendance trend.
  assert.equal(
    timeline.events.filter((e) => e.kind === "first_vision_meeting").length,
    1
  );
  assert.equal(timeline.events[1].detail, "12 attended.");
});

test("a recorded launch outcome joins the timeline", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    asOf: new Date("2026-09-27T00:00:00.000Z"),
    launch: launchRow({
      status: "completed",
      outcomeRecordedAt: new Date("2026-09-21T10:00:00.000Z"),
      attendanceCount: 148,
    }),
  });

  const recorded = timeline.events.find((e) => e.kind === "launch_recorded");
  assert.ok(recorded);
  assert.equal(recorded.detail, "148 attended.");
});

test("timeline badges come from the engine, per area", () => {
  const timeline = buildMilestoneTimeline({
    ...emptyTimelineInputs(),
    launch: launchRow(),
    transitions: [transition()],
    milestones: [milestoneRow()],
    latest: latestWith([
      insight({
        id: "lr",
        category: "launch_readiness",
        severity: "medium",
        rank: 1,
      }),
      insight({
        id: "pp",
        category: "phase_progress",
        severity: "critical",
        rank: 2,
      }),
    ]),
  });

  const byKind = new Map(timeline.events.map((e) => [e.kind, e]));
  assert.equal(byKind.get("launch_day")!.alert.standing, "watch");
  assert.equal(byKind.get("launch_day")!.alert.insightId, "lr");
  assert.equal(byKind.get("launch_readiness")!.alert.severity, "medium");
  assert.equal(byKind.get("phase_change")!.alert.standing, "attention");
  assert.equal(byKind.get("phase_change")!.alert.insightId, "pp");
});

test("a plant with nothing dated gets an empty timeline, not a fabricated one", () => {
  const timeline = buildMilestoneTimeline(emptyTimelineInputs());

  assert.deepEqual(timeline.events, []);
  assert.equal(timeline.launchDate, null);
  assert.equal(timeline.launchStatus, null);
});
