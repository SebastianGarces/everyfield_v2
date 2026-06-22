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
import { MINISTRY_ROLE_KEYS } from "@/lib/phase-engine/signals/types";

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const AS_OF = new Date("2026-06-22T00:00:00.000Z");

function daysBefore(ref: Date, days: number): Date {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

/** A populated input bundle exercising every signal section. */
function richInputs(): SnapshotInputs {
  return {
    church: { id: CHURCH_ID, currentPhase: 2, launchDate: "2026-09-20" },
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
    church: { id: CHURCH_ID, currentPhase: 0, launchDate: null },
    commitments: [],
    visionMeetings: [],
    followUp: [],
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
  inputs.church = { ...inputs.church, launchDate: "2026-05-01" };
  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.launch.isPastDue, true);
  assert.ok((snap.launch.daysUntilLaunch ?? 0) < 0);
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
