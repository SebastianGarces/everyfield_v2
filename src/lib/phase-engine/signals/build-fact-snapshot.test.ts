// ============================================================================
// Phase Engine — Signal layer tests
//
// Runs with the Node built-in test runner (no extra deps):
//   DATABASE_URL=postgres://x tsx --test src/lib/phase-engine/signals/build-fact-snapshot.test.ts
//
// A dummy DATABASE_URL is only needed because importing the builder transitively
// loads the db client at module init; these tests exercise the PURE assembler
// (`assembleFactSnapshot`) and never touch the database.
//
// Coverage maps to the unit's acceptance criteria:
//   - AC-PE-2  : identical inputs + asOf → identical snapshot (reproducibility)
//   - PE-004   : every required signal section is present and computed
//   - PE-005   : manual attestations merged; no computed fact read from signals
//   - PE-018   : cold-start returns a well-formed snapshot with emptiness markers
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleFactSnapshot,
  SNAPSHOT_VERSION,
  type SnapshotInputs,
} from "@/lib/phase-engine/signals/build-fact-snapshot";
import type {
  LaunchMilestoneRow,
  LaunchRow,
} from "@/lib/phase-engine/signals/queries";
import { MINISTRY_ROLE_KEYS } from "@/lib/phase-engine/signals/types";

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const AS_OF = new Date("2026-06-22T00:00:00.000Z");

function daysBefore(ref: Date, days: number): Date {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * A launch row, scheduled and not yet recorded unless a test says otherwise.
 * The outcome fields (LS-006/LS-008) default to "not recorded", which is a
 * DIFFERENT fact from zero — several tests below turn on that distinction.
 */
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

/** `count` readiness milestones, of which `completed` are done (LS-003). */
function milestoneRows(count: number, completed: number): LaunchMilestoneRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ms${index}`,
    completedAt:
      index < completed ? new Date("2026-06-01T00:00:00.000Z") : null,
  }));
}

/** A populated input bundle exercising every signal section. */
function richInputs(): SnapshotInputs {
  return {
    church: { id: CHURCH_ID, currentPhase: 2 },
    // The launch is its own row now (LS-001) — `churches.launch_date` is gone.
    launch: launchRow(),
    launchMilestones: milestoneRows(4, 1),
    commitments: [
      // person A committed long ago (prior baseline)
      { personId: "A", commitmentType: "core_group", signedDate: "2026-01-10" },
      // persons B,C committed within the trailing 28-day window
      { personId: "B", commitmentType: "core_group", signedDate: "2026-06-10" },
      { personId: "C", commitmentType: "core_group", signedDate: "2026-06-12" },
      // duplicate commitment for A — must not double-count
      {
        personId: "A",
        commitmentType: "launch_team",
        signedDate: "2026-06-01",
      },
    ],
    visionMeetings: [
      // most-recent first (as queried)
      {
        id: "m3",
        datetime: new Date("2026-06-08T18:00:00.000Z"),
        actualAttendance: 30,
      },
      {
        id: "m2",
        datetime: new Date("2026-05-25T18:00:00.000Z"),
        actualAttendance: 22,
      },
      {
        id: "m1",
        datetime: new Date("2026-05-11T18:00:00.000Z"),
        actualAttendance: 18,
      },
    ],
    followUp: [
      { id: "p1", status: "attendee", updatedAt: daysBefore(AS_OF, 3) },
      { id: "p2", status: "following_up", updatedAt: daysBefore(AS_OF, 20) },
      { id: "p3", status: "interviewed", updatedAt: daysBefore(AS_OF, 40) },
    ],
    followUpTasks: [],
    ministryTeams: [
      { id: "t1", name: "Worship Team", leaderId: "A" }, // filled
      { id: "t2", name: "Kids Ministry", leaderId: null }, // present, unfilled
      { id: "t3", name: "Tech / AV", leaderId: "B" }, // filled
    ],
    leadershipCandidates: [
      { id: "A", status: "leader", createdAt: daysBefore(AS_OF, 200) },
      { id: "B", status: "core_group", createdAt: daysBefore(AS_OF, 90) },
    ],
    meetingsAttendedByPerson: [
      { personId: "A", count: 3 },
      { personId: "B", count: 2 },
    ],
    activeMembershipsByPerson: [{ personId: "B", count: 1 }],
    teamLeaderPersonIds: ["A", "B"],
    trainingPrograms: [
      { id: "tp1", isRequired: true },
      { id: "tp2", isRequired: false },
    ],
    trainingCompletions: [
      { personId: "A", trainingProgramId: "tp1" },
      { personId: "B", trainingProgramId: "tp1" },
    ],
    plantSignals: [
      {
        signalKey: "values_documented",
        value: true,
        attestedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        signalKey: "financial_base",
        value: { amount: 5000 },
        attestedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ],
  };
}

/** An empty input bundle for the cold-start case. */
function coldStartInputs(): SnapshotInputs {
  return {
    church: { id: CHURCH_ID, currentPhase: 0 },
    // A cold-start plant has no launch row at all — not a launch with no date.
    launch: null,
    launchMilestones: [],
    commitments: [],
    visionMeetings: [],
    followUp: [],
    followUpTasks: [],
    ministryTeams: [],
    leadershipCandidates: [],
    meetingsAttendedByPerson: [],
    activeMembershipsByPerson: [],
    teamLeaderPersonIds: [],
    trainingPrograms: [],
    trainingCompletions: [],
    plantSignals: [],
  };
}

test("AC-PE-2: identical inputs + asOf yield byte-for-byte identical snapshots", () => {
  const a = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  const b = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("snapshot carries version, church id, phase, and reference time", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.snapshotVersion, SNAPSHOT_VERSION);
  assert.equal(snap.churchId, CHURCH_ID);
  assert.equal(snap.currentPhase, 2);
  assert.equal(snap.generatedAt, AS_OF.toISOString());
  assert.equal(snap.isColdStart, false);
});

test("PE-004: core-group count + growth delta are deterministic and dedup by person", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  // A, B, C have a core_group commitment (A's duplicate launch_team ignored here).
  assert.equal(snap.coreGroup.committedCount, 3);
  assert.equal(snap.coreGroup.launchTeamCount, 1);
  // B and C committed within the trailing 28 days; none in the prior window.
  assert.equal(snap.coreGroup.growthDelta, 2);
  assert.equal(snap.coreGroup.isEmpty, false);
});

test("PE-004: vision-meeting cadence and attendance trend", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.visionMeetings.totalCompleted, 3);
  assert.equal(snap.visionMeetings.daysSinceLastMeeting, 13); // Jun 8 → Jun 22 (floored)
  assert.equal(snap.visionMeetings.averageCadenceDays, 14); // two 14-day gaps
  assert.equal(snap.visionMeetings.latestAttendance, 30);
  assert.equal(snap.visionMeetings.previousAttendance, 22);
  assert.equal(snap.visionMeetings.attendanceTrend, "up");
});

test("PE-004: follow-up staleness", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.followUp.openCount, 3);
  assert.equal(snap.followUp.stalestDays, 40);
  // 20-day and 40-day contacts exceed the 14-day threshold; 3-day does not.
  assert.equal(snap.followUp.staleCount, 2);
});

test("PE-004: ministry-role coverage counts which of the 8 are filled", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.ministryRoles.totalRoles, 8);
  assert.equal(snap.ministryRoles.roles.length, MINISTRY_ROLE_KEYS.length);
  // Worship (leader A) and Technology (leader B) filled; Children's present but unfilled.
  assert.equal(snap.ministryRoles.filledCount, 2);

  const worship = snap.ministryRoles.roles.find((r) => r.key === "worship");
  assert.equal(worship?.filled, true);
  const childrens = snap.ministryRoles.roles.find((r) => r.key === "childrens");
  assert.equal(childrens?.teamPresent, true);
  assert.equal(childrens?.filled, false);
  const facilities = snap.ministryRoles.roles.find(
    (r) => r.key === "facilities"
  );
  assert.equal(facilities?.teamPresent, false);
  assert.equal(facilities?.filled, false);
});

test("PE-004: per-person leadership-readiness signals", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.leadership.candidates.length, 2);
  const a = snap.leadership.candidates.find((c) => c.personId === "A");
  assert.equal(a?.tenureDays, 200);
  assert.equal(a?.meetingsAttended, 3);
  assert.equal(a?.hasCommitment, true);
  assert.equal(a?.leadsTeam, true);
});

test("PE-004: training completion rate over required-program slots", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.training.programCount, 2);
  assert.equal(snap.training.requiredProgramCount, 1);
  // 1 required program × 3 committed people = 3 slots; A and B completed = 2/3.
  assert.equal(snap.training.requiredCompletionRate, 0.667);
});

test("PE-004: launch countdown is computed from asOf", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.launch.launchDate, "2026-09-20");
  assert.equal(snap.launch.daysUntilLaunch, 90); // Jun 22 → Sep 20
  assert.equal(snap.launch.isPastDue, false);
});

test("launch in the past is flagged isPastDue", () => {
  const inputs = richInputs();
  inputs.launch = launchRow({ targetDate: "2026-05-01" });
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.launch.isPastDue, true);
  assert.ok((snap.launch.daysUntilLaunch ?? 0) < 0);
});

test("a plant with no launch row has an empty countdown, not a zero one", () => {
  const inputs = richInputs();
  inputs.launch = null;
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.launch.launchDate, null);
  assert.equal(snap.launch.daysUntilLaunch, null);
  assert.equal(snap.launch.isPastDue, false);
  assert.equal(snap.launch.isEmpty, true);
});

test("a launch still in `planning` has no day, so no countdown", () => {
  const inputs = richInputs();
  inputs.launch = launchRow({ targetDate: null, status: "planning" });
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.launch.launchDate, null);
  assert.equal(snap.launch.isEmpty, true);
});

// ---------------------------------------------------------------------------
// #338 — the countdown is DAY-vs-DAY, at every hour of the day.
//
// The old implementation subtracted a UTC-midnight target from the RAW `asOf`
// instant and floored, so the answer was a full day short from 00:00:01 UTC
// onward: a plant read "Launched 1 day ago" on the morning of its own launch,
// and `/oversight/health` disagreed with `/oversight/plants` (fixed in PR #339)
// about the same plant. Three times of day on the launch date itself, plus the
// day either side, are what pin it — one assertion at midnight passes under
// BOTH implementations, which is why the bug survived review the first time.
// ---------------------------------------------------------------------------

const LAUNCH_DAY = "2026-09-20";

function countdownAt(iso: string): number | null {
  const inputs = richInputs();
  inputs.launch = launchRow({ targetDate: LAUNCH_DAY });
  return assembleFactSnapshot(CHURCH_ID, inputs, new Date(iso)).launch
    .daysUntilLaunch;
}

test("#338: the countdown reads 0 all day on launch day, not −1 after midnight", () => {
  assert.equal(countdownAt("2026-09-20T00:00:00.000Z"), 0);
  assert.equal(countdownAt("2026-09-20T09:30:00.000Z"), 0);
  assert.equal(countdownAt("2026-09-20T23:59:59.000Z"), 0);
});

test("#338: the day either side is ±1 at every hour", () => {
  assert.equal(countdownAt("2026-09-19T00:00:00.000Z"), 1);
  assert.equal(countdownAt("2026-09-19T18:45:00.000Z"), 1);
  assert.equal(countdownAt("2026-09-21T00:00:00.000Z"), -1);
  assert.equal(countdownAt("2026-09-21T06:15:00.000Z"), -1);
});

test("#338: isPastDue does not turn true until the day after the launch", () => {
  const onTheDay = richInputs();
  onTheDay.launch = launchRow({ targetDate: LAUNCH_DAY });
  assert.equal(
    assembleFactSnapshot(
      CHURCH_ID,
      onTheDay,
      new Date("2026-09-20T22:00:00.000Z")
    ).launch.isPastDue,
    false,
    "a plant was past due on the morning of its own launch"
  );
  assert.equal(
    assembleFactSnapshot(
      CHURCH_ID,
      onTheDay,
      new Date("2026-09-21T00:00:01.000Z")
    ).launch.isPastDue,
    true
  );
});

// ---------------------------------------------------------------------------
// LS-008 — launch status, readiness and outcome are FACTS, and only facts.
//
// The ruling of 2026-08-04: the phase engine stays ADVISORY. Recording a
// completed launch is a material event that the snapshot must SEE; it is not an
// advancement, and nothing in the signal layer may move `current_phase`.
// ---------------------------------------------------------------------------

/** A launch that happened and was written up. */
function recordedLaunch(): LaunchRow {
  return launchRow({
    targetDate: "2026-05-01",
    status: "completed",
    outcomeRecordedAt: new Date("2026-05-01T18:00:00.000Z"),
    attendanceCount: 128,
    decisionsCount: 0,
  });
}

test("LS-008: the snapshot carries launch status and outcome facts", () => {
  const inputs = richInputs();
  inputs.launch = recordedLaunch();
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  assert.equal(snap.launch.status, "completed");
  assert.equal(snap.launch.isCompleted, true);
  assert.equal(snap.launch.isPostponed, false);
  assert.equal(snap.launch.outcomeRecorded, true);
  assert.equal(snap.launch.attendanceCount, 128);
  // 0 decisions is a RECORDED answer, not a missing one.
  assert.equal(snap.launch.decisionsCount, 0);
});

test("LS-008: 'not recorded' is null, never zero", () => {
  // The judge must never be told nobody came when nobody counted — the
  // nullable counts exist precisely so the two cannot be confused.
  const inputs = richInputs();
  inputs.launch = launchRow({ status: "scheduled" });
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  assert.equal(snap.launch.outcomeRecorded, false);
  assert.equal(snap.launch.attendanceCount, null);
  assert.equal(snap.launch.decisionsCount, null);
});

test("LS-008: readiness progress joins the snapshot", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.launch.readinessTotalCount, 4);
  assert.equal(snap.launch.readinessCompletedCount, 1);
  assert.equal(snap.launch.readinessCompletionRate, 0.25);
});

test("LS-008: no readiness list is not a 0% readiness list", () => {
  // PE-018's cold-start rule, applied to readiness: a plant that has not been
  // seeded has no list, which is different guidance from a list untouched.
  const inputs = richInputs();
  inputs.launchMilestones = [];
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.launch.readinessTotalCount, 0);
  assert.equal(snap.launch.readinessCompletionRate, null);
});

test("LS-008 RULING: recording a launch does NOT advance current_phase", () => {
  // The pin for "the engine stays advisory". Two snapshots of the same plant,
  // identical in every input except that the launch went from scheduled to
  // recorded-as-completed: the phase must be the church row's, untouched.
  const before = richInputs();
  before.launch = launchRow({ targetDate: "2026-05-01" });
  const after = richInputs();
  after.launch = recordedLaunch();

  const scheduled = assembleFactSnapshot(CHURCH_ID, before, AS_OF);
  const completed = assembleFactSnapshot(CHURCH_ID, after, AS_OF);

  assert.equal(scheduled.currentPhase, 2);
  assert.equal(completed.currentPhase, 2, "a launch must not move the phase");
  assert.equal(completed.currentPhase, before.church.currentPhase);

  // And nothing ELSE moved either: the recording changes the launch section and
  // that section alone. Comparing whole snapshots minus `launch` catches a
  // future "helpful" derivation — a bumped phase, a flipped cold-start flag —
  // that a per-field assertion would sail past.
  const withoutLaunch = ({ launch: _launch, ...rest }: typeof scheduled) =>
    rest;
  assert.deepEqual(withoutLaunch(completed), withoutLaunch(scheduled));
});

test("LS-008: a launch that HAPPENED is never past due", () => {
  // `isPastDue` reads as "the day came and went with nothing to show for it".
  // Left literal, every plant that launches successfully would accrue an
  // escalating warning for the rest of its life.
  const inputs = richInputs();
  inputs.launch = recordedLaunch();
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  assert.ok((snap.launch.daysUntilLaunch ?? 0) < 0, "the day is in the past");
  assert.equal(snap.launch.isPastDue, false);
  assert.equal(snap.launch.isCompleted, true);
});

test("LS-008: a postponed launch says so, and is still counted down to", () => {
  const inputs = richInputs();
  inputs.launch = launchRow({ targetDate: "2026-09-20", status: "postponed" });
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  assert.equal(snap.launch.isPostponed, true);
  assert.equal(snap.launch.isCompleted, false);
  assert.equal(snap.launch.daysUntilLaunch, 90);
  assert.equal(snap.launch.isEmpty, false);
});

test("LS-008: a plant with no launch row has a null status, not 'planning'", () => {
  // "No launch at all" and "a launch being planned" are different facts; the
  // countdown collapses them and the status must not.
  const inputs = richInputs();
  inputs.launch = null;
  const noRow = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(noRow.launch.status, null);

  inputs.launch = launchRow({ targetDate: null, status: "planning" });
  const planning = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(planning.launch.status, "planning");
  assert.equal(planning.launch.isEmpty, true);
});

test("PE-005: manual attestations are merged; only attested keys appear", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.manual.isEmpty, false);
  assert.equal(snap.manual.attestations.length, 2);
  assert.equal(snap.manual.byKey["values_documented"], true);
  assert.deepEqual(snap.manual.byKey["financial_base"], { amount: 5000 });
  // No computed fact leaks into the manual section.
  assert.equal(snap.manual.byKey["committedCount"], undefined);
  assert.equal(snap.manual.byKey["daysUntilLaunch"], undefined);
});

test("PE-005: a prototype-named signal key is an own property, not a mutation", () => {
  // The WRITE half of the untrusted-key rule (memory/invariants.md → Phase
  // Engine). The four reads that WALK `manual.byKey` are `Object.hasOwn`-gated;
  // the object they walk is assembled here, keyed by a stored string. On a
  // plain `{}` accumulator `byKey["__proto__"] = …` creates no own property, so
  // the row disappears from the snapshot with nothing failing.
  const inputs = richInputs();
  inputs.plantSignals = [
    {
      signalKey: "__proto__",
      value: true,
      attestedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    {
      signalKey: "constructor",
      value: "shadowed",
      attestedAt: new Date("2026-06-02T00:00:00.000Z"),
    },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  assert.equal(Object.hasOwn(snap.manual.byKey, "__proto__"), true);
  assert.equal(snap.manual.byKey["__proto__"], true);
  assert.equal(Object.hasOwn(snap.manual.byKey, "constructor"), true);
  assert.equal(snap.manual.byKey["constructor"], "shadowed");

  // Nothing was written THROUGH the object either — it has no prototype to
  // reach, and a plain object still reports the stock constructor.
  assert.equal(Object.getPrototypeOf(snap.manual.byKey), null);
  assert.equal({}.constructor, Object);
});

test("PE-018: cold-start returns a well-formed snapshot with emptiness markers, no throw", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, coldStartInputs(), AS_OF);

  assert.equal(snap.isColdStart, true);

  // Counts are zeroed, deltas/trends are explicitly null.
  assert.equal(snap.coreGroup.committedCount, 0);
  assert.equal(snap.coreGroup.growthDelta, null);
  assert.equal(snap.coreGroup.isEmpty, true);

  assert.equal(snap.visionMeetings.totalCompleted, 0);
  assert.equal(snap.visionMeetings.lastMeetingAt, null);
  assert.equal(snap.visionMeetings.attendanceTrend, null);
  assert.equal(snap.visionMeetings.isEmpty, true);

  assert.equal(snap.followUp.openCount, 0);
  assert.equal(snap.followUp.stalestDays, null);
  assert.equal(snap.followUp.isEmpty, true);

  // All 8 roles still enumerated, none filled.
  assert.equal(snap.ministryRoles.roles.length, 8);
  assert.equal(snap.ministryRoles.filledCount, 0);
  assert.equal(snap.ministryRoles.isEmpty, true);

  assert.equal(snap.leadership.candidates.length, 0);
  assert.equal(snap.training.requiredCompletionRate, null);
  assert.equal(snap.launch.launchDate, null);
  assert.equal(snap.launch.daysUntilLaunch, null);
  assert.equal(snap.manual.isEmpty, true);
});

test("training rate is null when there are required programs but no committed people", () => {
  const inputs = coldStartInputs();
  inputs.trainingPrograms = [{ id: "tp1", isRequired: true }];
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.training.requiredCompletionRate, null);
  assert.equal(snap.training.isEmpty, false);
});
