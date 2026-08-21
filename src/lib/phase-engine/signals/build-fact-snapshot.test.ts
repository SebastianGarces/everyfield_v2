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
import { flattenFacts } from "@/lib/phase-engine/judge/prompt";
import { FACT_PHRASES } from "@/lib/phase-engine/fact-phrases";
import type { OpenFollowUpTask } from "@/lib/tasks/follow-up-ownership.shared";

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
    personSources: [
      { personId: "A", source: "vision_meeting" },
      { personId: "B", source: "partner_church" },
      // C has no recorded source — counted, never dropped (#487).
      { personId: "C", source: null },
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
    interviewsByPerson: [],
    assessmentsByPerson: [],
    attendance: [],
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
    personSources: [],
    visionMeetings: [],
    followUp: [],
    followUpTasks: [],
    ministryTeams: [],
    leadershipCandidates: [],
    meetingsAttendedByPerson: [],
    activeMembershipsByPerson: [],
    teamLeaderPersonIds: [],
    interviewsByPerson: [],
    assessmentsByPerson: [],
    attendance: [],
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

// ----------------------------------------------------------------------------
// Measured follow-up ownership (#470, C01/C13)
//
// Rubric v1's Lens 2 may say who carries follow-up ONLY from these four facts.
// So two things have to hold: the assembler counts them from the follow-up
// TASKS, and they survive the flattening into the judge's fact ledger — a fact
// the judge is never shown is a fact the rubric cannot licence.
// ----------------------------------------------------------------------------

function followUpTask(over: Partial<OpenFollowUpTask> = {}): OpenFollowUpTask {
  return {
    taskId: "ft1",
    title: "Follow up",
    dueDate: null,
    contactId: "p1",
    assignedToId: "u1",
    ownerName: "Ada",
    ownerEmail: "ada@example.com",
    ownerIsCommitted: true,
    ownerIsPlanter: false,
    ...over,
  };
}

test("with no follow-up tasks, every open contact is unowned", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);

  // The three contacts of `baseInputs`, two of them stale (20 and 40 days).
  assert.equal(snap.followUp.unownedCount, 3);
  assert.equal(snap.followUp.staleUnownedCount, 2);
  assert.equal(snap.followUp.distinctOwnerCount, 0);
  assert.equal(snap.followUp.planterOwnedCount, 0);
});

test("an owned contact leaves the unowned count, a demoted owner's does not", () => {
  const inputs = richInputs();
  inputs.followUpTasks = [
    followUpTask({ taskId: "ft1", contactId: "p3", ownerIsPlanter: true }),
    followUpTask({ taskId: "ft2", contactId: "p2", ownerIsCommitted: false }),
    followUpTask({ taskId: "ft3", contactId: "p1", assignedToId: "u2" }),
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);

  // p3 (stale) and p1 are covered; p2 is stale and its owner was demoted.
  assert.equal(snap.followUp.unownedCount, 1);
  assert.equal(snap.followUp.staleUnownedCount, 1);
  assert.equal(snap.followUp.distinctOwnerCount, 2);
  assert.equal(snap.followUp.planterOwnedCount, 1);
});

test("the four owner facts reach the judge's fact ledger", () => {
  const inputs = richInputs();
  inputs.followUpTasks = [
    followUpTask({ contactId: "p1", ownerIsPlanter: true }),
  ];

  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, inputs, AS_OF)).map((line) => [
      line.key,
      line.value,
    ])
  );

  assert.equal(ledger.get("followUp.unownedCount"), "2");
  assert.equal(ledger.get("followUp.staleUnownedCount"), "2");
  assert.equal(ledger.get("followUp.distinctOwnerCount"), "1");
  assert.equal(ledger.get("followUp.planterOwnedCount"), "1");
});

test("every owner fact has a phrase, so a citation of one can be read back", () => {
  for (const key of [
    "followUp.unownedCount",
    "followUp.staleUnownedCount",
    "followUp.distinctOwnerCount",
    "followUp.planterOwnedCount",
  ]) {
    assert.ok(FACT_PHRASES.has(key), `${key} has no phrase`);
    assert.equal(typeof FACT_PHRASES.get(key)!("2"), "string");
  }
});

// ----------------------------------------------------------------------------
// The flat streak, and what resets it (#471, C02/C22)
//
// v0 let the judge eyeball "3 weeks flat" off `growthDelta`, and there was no
// fact a +1 could reset. Bryan: do not confidently say STALLED before about
// four weeks, and one extra adult should change the reading. Both halves are
// the definition of `daysSinceLastNewCommitment`, so these tests are the proof
// that the definition holds rather than that the judge behaves.
// ----------------------------------------------------------------------------

test("the streak is measured from the LATEST first commitment", () => {
  const inputs = coldStartInputs();
  inputs.commitments = [
    {
      personId: "a",
      commitmentType: "core_group",
      signedDate: "2026-05-01",
    },
    {
      personId: "b",
      commitmentType: "core_group",
      signedDate: "2026-06-01",
    },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF); // 2026-06-22
  assert.equal(snap.coreGroup.daysSinceLastNewCommitment, 21);
  assert.equal(snap.coreGroup.slowedThresholdDays, 21);
  assert.equal(snap.coreGroup.stalledThresholdDays, 28);
});

test("AC-2: one new committed adult resets the streak to 0", () => {
  const inputs = coldStartInputs();
  inputs.commitments = [
    { personId: "a", commitmentType: "core_group", signedDate: "2026-05-01" },
  ];
  assert.equal(
    assembleFactSnapshot(CHURCH_ID, inputs, AS_OF).coreGroup
      .daysSinceLastNewCommitment,
    52
  );

  inputs.commitments.push({
    personId: "b",
    commitmentType: "core_group",
    signedDate: "2026-06-22",
  });
  assert.equal(
    assembleFactSnapshot(CHURCH_ID, inputs, AS_OF).coreGroup
      .daysSinceLastNewCommitment,
    0
  );
});

test("AC-2: somebody's SECOND commitment is not a new adult", () => {
  const inputs = coldStartInputs();
  inputs.commitments = [
    { personId: "a", commitmentType: "core_group", signedDate: "2026-05-01" },
    // The same person signing a launch-team card today. The plant did not grow.
    { personId: "a", commitmentType: "launch_team", signedDate: "2026-06-22" },
    // And a re-signed core-group card, which is not growth either.
    { personId: "a", commitmentType: "core_group", signedDate: "2026-06-22" },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.coreGroup.committedCount, 1);
  assert.equal(snap.coreGroup.launchTeamCount, 1);
  assert.equal(snap.coreGroup.daysSinceLastNewCommitment, 52);
});

test("a cold-start plant has no streak rather than a streak of zero", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, coldStartInputs(), AS_OF);
  assert.equal(snap.coreGroup.daysSinceLastNewCommitment, null);
  // The thresholds are still there — the judge cites them even when the streak
  // is unknown, and a missing threshold is a number it would have to invent.
  assert.equal(snap.coreGroup.slowedThresholdDays, 21);
  assert.equal(snap.coreGroup.stalledThresholdDays, 28);
});

test("AC-4: the streak and both thresholds reach the judge's fact ledger", () => {
  const inputs = coldStartInputs();
  inputs.commitments = [
    { personId: "a", commitmentType: "core_group", signedDate: "2026-05-01" },
  ];

  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, inputs, AS_OF)).map((line) => [
      line.key,
      line.value,
    ])
  );

  assert.equal(ledger.get("coreGroup.daysSinceLastNewCommitment"), "52");
  assert.equal(ledger.get("coreGroup.slowedThresholdDays"), "21");
  assert.equal(ledger.get("coreGroup.stalledThresholdDays"), "28");

  for (const key of [
    "coreGroup.daysSinceLastNewCommitment",
    "coreGroup.slowedThresholdDays",
    "coreGroup.stalledThresholdDays",
  ]) {
    assert.ok(FACT_PHRASES.has(key), `${key} has no phrase`);
  }
});

// ----------------------------------------------------------------------------
// Attestation freshness (#474, C21)
//
// Bryan asked three prayer questions. The second — "has that gathering/rhythm
// actually happened in the last 30 days?" — is not a third toggle: every
// attestation already records WHEN it was answered, so the answer was in the
// row. These tests pin that the age is computed and handed to the judge, since
// an age the judge never sees is a question still unanswered.
// ----------------------------------------------------------------------------

test("every attestation carries how many days ago it was answered", () => {
  const inputs = coldStartInputs();
  inputs.plantSignals = [
    {
      signalKey: "prayer_rhythm_established",
      value: true,
      attestedAt: daysBefore(AS_OF, 45),
    },
    {
      signalKey: "prayer_in_gatherings",
      value: true,
      attestedAt: AS_OF,
    },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  const ages = Object.fromEntries(
    snap.manual.attestations.map((a) => [a.signalKey, a.attestedDaysAgo])
  );

  assert.equal(ages.prayer_rhythm_established, 45);
  assert.equal(ages.prayer_in_gatherings, 0);
  assert.equal(snap.manual.reaffirmWindowDays, 30);
});

test("a future attestation reads as 0 days ago, never as a negative age", () => {
  // Clock skew, or a hand-written row. "-3 days ago" is a sentence the judge
  // would say out loud.
  const inputs = coldStartInputs();
  inputs.plantSignals = [
    {
      signalKey: "prayer_rhythm_established",
      value: true,
      attestedAt: new Date(AS_OF.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
  ];

  assert.equal(
    assembleFactSnapshot(CHURCH_ID, inputs, AS_OF).manual.attestations[0]
      .attestedDaysAgo,
    0
  );
});

test("the age and the window reach the judge's fact ledger", () => {
  const inputs = coldStartInputs();
  inputs.plantSignals = [
    {
      signalKey: "prayer_rhythm_established",
      value: true,
      attestedAt: daysBefore(AS_OF, 45),
    },
  ];

  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, inputs, AS_OF)).map((line) => [
      line.key,
      line.value,
    ])
  );

  assert.equal(ledger.get("manual.attestations.0.attestedDaysAgo"), "45");
  assert.equal(ledger.get("manual.attestations.0.value"), "true");
  assert.equal(ledger.get("manual.reaffirmWindowDays"), "30");
});

test("generosity and solvency reach the judge as two separate facts (#475)", () => {
  // Bryan's case: solvent on outside support, core group giving nothing. The
  // judge can only report that apart if it arrives apart.
  const inputs = coldStartInputs();
  inputs.plantSignals = [
    {
      signalKey: "financial_base_established",
      value: true,
      attestedAt: daysBefore(AS_OF, 5),
    },
    {
      signalKey: "core_group_giving",
      value: false,
      attestedAt: daysBefore(AS_OF, 40),
    },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.manual.byKey.financial_base_established, true);
  assert.equal(snap.manual.byKey.core_group_giving, false);

  const ledger = new Map(
    flattenFacts(snap).map((line) => [line.key, line.value])
  );
  assert.equal(ledger.get("manual.byKey.financial_base_established"), "true");
  assert.equal(ledger.get("manual.byKey.core_group_giving"), "false");
  // And the giving attestation carries its age, so a stale "yes" cannot pass
  // for a current one.
  assert.equal(
    snap.manual.attestations.find((a) => a.signalKey === "core_group_giving")
      ?.attestedDaysAgo,
    40
  );
});

// ----------------------------------------------------------------------------
// The candidate signal, and the human judgments beside it (#476, C07)
// ----------------------------------------------------------------------------

test("a candidate with recorded judgments carries them; one without carries nulls", () => {
  const inputs = coldStartInputs();
  inputs.leadershipCandidates = [
    { id: "A", status: "core_group", createdAt: daysBefore(AS_OF, 90) },
    { id: "B", status: "core_group", createdAt: daysBefore(AS_OF, 70) },
  ];
  inputs.interviewsByPerson = [
    {
      personId: "A",
      count: 2,
      lastResult: "ready",
      lastDate: "2026-04-11",
    },
  ];
  inputs.assessmentsByPerson = [
    { personId: "A", count: 1, lastTotal: 17, lastDate: "2026-04-12" },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  const [a, b] = snap.leadership.candidates;

  assert.equal(a.interviewCount, 2);
  assert.equal(a.lastInterviewResult, "ready");
  assert.equal(a.lastInterviewDate, "2026-04-11");
  assert.equal(a.assessmentCount, 1);
  assert.equal(a.lastAssessmentTotal, 17);

  // NOT a bad interview — no interview. The rubric turns this into a next step,
  // and it can only do that if the fact says "none" rather than nothing.
  assert.equal(b.interviewCount, 0);
  assert.equal(b.lastInterviewResult, null);
  assert.equal(b.lastAssessmentTotal, null);

  assert.equal(snap.leadership.candidateThresholdDays, 60);
});

test("the candidate threshold and the recorded verdict reach the judge's ledger", () => {
  const inputs = coldStartInputs();
  inputs.leadershipCandidates = [
    { id: "A", status: "core_group", createdAt: daysBefore(AS_OF, 90) },
  ];
  inputs.interviewsByPerson = [
    { personId: "A", count: 1, lastResult: "ready", lastDate: "2026-04-11" },
  ];

  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, inputs, AS_OF)).map((line) => [
      line.key,
      line.value,
    ])
  );

  assert.equal(ledger.get("leadership.candidateThresholdDays"), "60");
  assert.equal(
    ledger.get("leadership.candidates.0.lastInterviewResult"),
    "ready"
  );
  assert.equal(ledger.get("leadership.candidates.0.interviewCount"), "1");

  for (const key of [
    "leadership.candidateThresholdDays",
    "leadership.candidates.#.interviewCount",
    "leadership.candidates.#.lastInterviewResult",
    "leadership.candidates.#.lastAssessmentTotal",
  ]) {
    assert.ok(FACT_PHRASES.has(key), `${key} has no phrase`);
  }
});

test("the evidence profile reaches the judge's fact ledger (#483)", () => {
  // The judge cannot apply "unknown is not healthy" to a lens whose evidence it
  // was never shown.
  const inputs = coldStartInputs();
  inputs.plantSignals = [
    {
      signalKey: "prayer_rhythm_established",
      value: true,
      attestedAt: daysBefore(AS_OF, 45),
    },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.evidence?.prayer.quality, "attested");
  assert.equal(snap.evidence?.generosity.quality, "unknown");

  const ledger = new Map(
    flattenFacts(snap).map((line) => [line.key, line.value])
  );
  assert.equal(ledger.get("evidence.prayer.quality"), "attested");
  assert.equal(ledger.get("evidence.prayer.attestedDaysAgo"), "45");
  assert.equal(ledger.get("evidence.generosity.quality"), "unknown");
  assert.equal(ledger.get("evidence.critical_mass.quality"), "unknown");
});

// ----------------------------------------------------------------------------
// The threshold pack (#486, C22/C23)
// ----------------------------------------------------------------------------

function attended(personId: string, daysAgo: number, type = "team_meeting") {
  return { personId, meetingType: type, datetime: daysBefore(AS_OF, daysAgo) };
}

test("the cadence slip has two levels, both handed to the judge", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);
  assert.equal(snap.visionMeetings.cadenceWatchDays, 21);
  assert.equal(snap.visionMeetings.cadenceDirectDays, 28);

  const ledger = new Map(
    flattenFacts(snap).map((line) => [line.key, line.value])
  );
  assert.equal(ledger.get("visionMeetings.cadenceWatchDays"), "21");
  assert.equal(ledger.get("visionMeetings.cadenceDirectDays"), "28");
});

test("disengagement is a share of the ACTIVE committed group", () => {
  const inputs = coldStartInputs();
  inputs.commitments = ["a", "b", "c", "d", "e"].map((personId) => ({
    personId,
    commitmentType: "core_group",
    signedDate: "2026-01-01",
  }));
  inputs.attendance = [
    // Everybody came in the PRIOR window…
    ...["a", "b", "c", "d", "e"].map((id) => attended(id, 40)),
    // …only two came in the RECENT one.
    attended("a", 5),
    attended("b", 5),
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.cohesion.activeCommittedCount, 5);
  assert.equal(snap.cohesion.disengagedCount, 3);
  assert.equal(snap.cohesion.disengagedShare, 0.6);
  assert.equal(snap.cohesion.disengagedIncludesLeader, false);
});

test("somebody who never came is not 'disengaging'", () => {
  // The definition is ATTENDED THEN STOPPED. Never having come is a different
  // fact and belongs to a different lens.
  const inputs = coldStartInputs();
  inputs.commitments = ["a", "b"].map((personId) => ({
    personId,
    commitmentType: "core_group",
    signedDate: "2026-01-01",
  }));
  inputs.attendance = [attended("a", 40), attended("a", 5)];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  // `b` never appears, so they are not active and not disengaged.
  assert.equal(snap.cohesion.activeCommittedCount, 1);
  assert.equal(snap.cohesion.disengagedCount, 0);
});

test("a leader among the disengaged is flagged, not weighted", () => {
  const inputs = coldStartInputs();
  inputs.commitments = ["a", "b"].map((personId) => ({
    personId,
    commitmentType: "core_group",
    signedDate: "2026-01-01",
  }));
  inputs.attendance = [attended("a", 40), attended("b", 40), attended("b", 5)];
  inputs.teamLeaderPersonIds = ["a"];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.cohesion.disengagedCount, 1);
  assert.equal(snap.cohesion.disengagedIncludesLeader, true);
  // The share is untouched by who they are — the flag is qualitative.
  assert.equal(snap.cohesion.disengagedShare, 0.5);
});

test("follow-up staleness splits by warmth", () => {
  const inputs = coldStartInputs();
  inputs.followUp = [
    // Warm (came to a vision meeting 3 days ago), untouched 9 days: past the
    // 7-day warm window but not seriously stale.
    { id: "warm-flagged", status: "attendee", updatedAt: daysBefore(AS_OF, 9) },
    // Warm and untouched for 20 days: seriously stale.
    { id: "warm-bad", status: "attendee", updatedAt: daysBefore(AS_OF, 20) },
    // Warm and touched yesterday: fine.
    { id: "warm-ok", status: "attendee", updatedAt: daysBefore(AS_OF, 1) },
    // Cold and untouched 20 days: stale on the 14-day rule.
    {
      id: "cold-bad",
      status: "following_up",
      updatedAt: daysBefore(AS_OF, 20),
    },
    // Cold and untouched 9 days: NOT stale — this is the case the universal
    // 14-day rule got wrong in the other direction.
    { id: "cold-ok", status: "following_up", updatedAt: daysBefore(AS_OF, 9) },
  ];
  inputs.attendance = ["warm-flagged", "warm-bad", "warm-ok"].map((id) =>
    attended(id, 3, "vision_meeting")
  );

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.followUp.warmCount, 3);
  assert.equal(snap.followUp.staleWarmCount, 2);
  assert.equal(snap.followUp.seriouslyStaleWarmCount, 1);
  assert.equal(snap.followUp.staleColdCount, 1);
  assert.equal(snap.followUp.warmWindowDays, 14);
  assert.equal(snap.followUp.warmStaleThresholdDays, 7);
});

test("a team meeting does not make a contact warm", () => {
  // Warmth is "they just came to a VISION MEETING" — the event that creates a
  // follow-up in the first place.
  const inputs = coldStartInputs();
  inputs.followUp = [
    { id: "p1", status: "attendee", updatedAt: daysBefore(AS_OF, 9) },
  ];
  inputs.attendance = [attended("p1", 3, "team_meeting")];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.followUp.warmCount, 0);
  assert.equal(snap.followUp.staleColdCount, 0);
});

test("the cohesion and warmth facts reach the judge's ledger", () => {
  const inputs = coldStartInputs();
  inputs.commitments = ["a", "b"].map((personId) => ({
    personId,
    commitmentType: "core_group",
    signedDate: "2026-01-01",
  }));
  inputs.attendance = [attended("a", 40), attended("b", 40), attended("b", 5)];

  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, inputs, AS_OF)).map((line) => [
      line.key,
      line.value,
    ])
  );

  assert.equal(ledger.get("cohesion.disengagedCount"), "1");
  assert.equal(ledger.get("cohesion.disengagedShareThreshold"), "0.2");
  assert.equal(ledger.get("cohesion.disengagedMinimumCount"), "3");
  assert.equal(ledger.get("followUp.warmStaleThresholdDays"), "7");

  for (const key of [
    "cohesion.disengagedShare",
    "cohesion.disengagedIncludesLeader",
    "followUp.staleWarmCount",
    "followUp.staleColdCount",
    "visionMeetings.cadenceWatchDays",
  ]) {
    assert.ok(FACT_PHRASES.has(key), `${key} has no phrase`);
  }
});

// ----------------------------------------------------------------------------
// Where the growth came from (#487, C26)
//
// Bryan: "A plant could grow from 20 to 60 entirely by attracting Christians
// from neighboring churches. From a launch standpoint, that's growth. From a
// Great Commission standpoint, that's telling me something very different."
//
// The field records HOW SOMEBODY REACHED THE PLANT. It is not a conversion, not
// a spiritual background, and the rubric bans both readings — what it supports
// is "most of your growth came through a partner church", which is a real
// conversation the engine could not previously start.
// ----------------------------------------------------------------------------

test("composition counts the COMMITTED, by their recorded source", () => {
  const snap = assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF);

  assert.deepEqual(snap.coreGroup.sourceComposition, {
    vision_meeting: 1,
    partner_church: 1,
  });
  assert.equal(snap.coreGroup.unknownSourceCount, 1);
  // The three counted are exactly the three committed people.
  assert.equal(snap.coreGroup.committedCount, 3);
});

test("a person who never committed is not in the composition", () => {
  // The question is about growth of the CORE GROUP. A prospect's source says
  // nothing about that yet.
  const inputs = richInputs();
  inputs.personSources = [
    ...inputs.personSources,
    { personId: "Z", source: "website" },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.equal(snap.coreGroup.sourceComposition.website, undefined);
});

test("a plant with no recorded sources says so rather than showing nothing", () => {
  // Unseen is SAID (§5b). An empty composition with a real count is what lets
  // the rubric produce "we cannot see where your growth is coming from yet".
  const inputs = richInputs();
  inputs.personSources = [
    { personId: "A", source: null },
    { personId: "B", source: null },
    { personId: "C", source: null },
  ];

  const snap = assembleFactSnapshot(CHURCH_ID, inputs, AS_OF);
  assert.deepEqual(snap.coreGroup.sourceComposition, {});
  assert.equal(snap.coreGroup.unknownSourceCount, 3);
});

test("composition reaches the judge's fact ledger", () => {
  const ledger = new Map(
    flattenFacts(assembleFactSnapshot(CHURCH_ID, richInputs(), AS_OF)).map(
      (line) => [line.key, line.value]
    )
  );

  assert.equal(ledger.get("coreGroup.sourceComposition.vision_meeting"), "1");
  assert.equal(ledger.get("coreGroup.sourceComposition.partner_church"), "1");
  assert.equal(ledger.get("coreGroup.unknownSourceCount"), "1");
});
