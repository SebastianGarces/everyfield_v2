// ============================================================================
// Phase Engine — buildFactSnapshot
//
// The deterministic Signal layer (PE-004). Given a church id (and an optional
// fixed reference time), this assembles a fully typed `PlantFactSnapshot` from
// church_id-scoped SQL reads. Every value is computed here in plain TypeScript
// from countable DB rows — the LLM never produces a fact (NFR-PE-1).
//
// Determinism (AC-PE-2): all time math is derived from a single `asOf` reference
// captured into `generatedAt`. Given identical DB state and the same `asOf`, the
// output is byte-for-byte identical. The pure assembly (`assembleFactSnapshot`)
// is separated from the I/O (`buildFactSnapshot`) so it can be unit-tested
// without a database.
//
// Cold-start (PE-018): each sub-signal carries explicit `isEmpty` markers and
// nulls instead of throwing, and the top-level `isColdStart` flags a plant with
// essentially no activity so the judge can produce onboarding guidance.
// ============================================================================

import { daysUntilTarget } from "@/lib/launch/countdown";
import {
  getActiveMembershipsByPerson,
  getChurch,
  getCommitments,
  getCompletedVisionMeetings,
  getLeadershipCandidates,
  getMeetingsAttendedByPerson,
  getMinistryTeams,
  getOpenFollowUpContacts,
  getPlantSignals,
  getTeamLeaderPersonIds,
  getTrainingCompletions,
  getLaunch,
  getLaunchMilestoneRows,
  getTrainingPrograms,
  type ChurchRow,
  type CommitmentRow,
  type LaunchRow,
  type LaunchMilestoneRow,
  type FollowUpRow,
  type LeadershipPersonRow,
  type MinistryTeamRow,
  type PersonCountRow,
  type PlantSignalRow,
  type TrainingCompletionRow,
  type TrainingProgramRow,
  type VisionMeetingRow,
} from "./queries";
import { ATTESTATION_REAFFIRM_WINDOW_DAYS } from "@/lib/phase-engine/manual-signals";
import {
  MINISTRY_ROLE_KEYS,
  type BuildFactSnapshotOptions,
  type CoreGroupSignals,
  type FollowUpSignals,
  type LaunchSignals,
  type LeadershipReadinessSignal,
  type LeadershipSignals,
  type ManualSignals,
  type MinistryRoleCoverage,
  type MinistryRoleKey,
  type MinistryRoleSignals,
  type PlantFactSnapshot,
  type TrainingSignals,
  type VisionMeetingSignals,
} from "./types";
import {
  countFollowUpOwnership,
  listOpenFollowUpTasks,
  type OpenFollowUpTask,
} from "@/lib/tasks/follow-up-ownership";

/** Snapshot shape version — bump when the structure changes. */
export const SNAPSHOT_VERSION = "v1";

/** Trailing window for the committed-core-group growth delta. */
const GROWTH_WINDOW_DAYS = 28;

/**
 * The two levels of a flat core group (#471, C02/C22). Bryan: "I'd probably say
 * 'momentum has slowed' sooner, but I wouldn't confidently label growth
 * 'stalled' until roughly four weeks, especially because one vision-meeting
 * cycle can radically change things." v0 flagged stalled at 3 weeks.
 */
const GROWTH_SLOWED_THRESHOLD_DAYS = 21;
const GROWTH_STALLED_THRESHOLD_DAYS = 28;

/**
 * A follow-up contact is "stale" once untouched beyond this many days.
 * Exported since #470: `/tasks`' assignments view labels the same contacts, and
 * a second copy of the number would let the page and the snapshot disagree
 * about who is waiting. (⚠️ in rubric v0 — #486 splits it by contact warmth.)
 */
export const FOLLOW_UP_STALE_THRESHOLD_DAYS = 14;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole-day difference `to - from` (positive when `to` is later). */
function diffInDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Parse a yyyy-mm-dd DB date string at UTC midnight (timezone-stable). */
function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// ----------------------------------------------------------------------------
// Ministry-role matching
//
// Each of the 8 canonical roles is matched against a team by name via a small
// synonym table. This is deterministic (lowercased substring match in canonical
// order); no judgment is involved.
// ----------------------------------------------------------------------------

const ROLE_DEFINITIONS: {
  key: MinistryRoleKey;
  label: string;
  matchers: string[];
}[] = [
  { key: "worship", label: "Worship", matchers: ["worship", "music"] },
  {
    key: "childrens",
    label: "Children's",
    matchers: ["children", "kids", "child"],
  },
  {
    key: "assimilation",
    label: "Assimilation",
    matchers: ["assimilation", "welcome", "hospitality", "guest", "connect"],
  },
  {
    key: "small_groups",
    label: "Small Groups",
    matchers: ["small group", "groups", "discipleship"],
  },
  {
    key: "admin_finance",
    label: "Admin/Finance",
    matchers: ["admin", "finance", "financial", "treasur"],
  },
  {
    key: "facilities",
    label: "Facilities",
    matchers: ["facilit", "setup", "set-up", "venue"],
  },
  {
    key: "promotion",
    label: "Promotion",
    matchers: ["promotion", "marketing", "communication", "outreach"],
  },
  {
    key: "technology",
    label: "Technology",
    matchers: ["tech", "technology", "av", "media", "production"],
  },
];

function buildMinistryRoleSignals(
  teams: MinistryTeamRow[]
): MinistryRoleSignals {
  const roles: MinistryRoleCoverage[] = ROLE_DEFINITIONS.map((def) => {
    // First team (already ordered by name, id) whose name matches this role.
    const match = teams.find((team) => {
      const name = team.name.toLowerCase();
      return def.matchers.some((m) => name.includes(m));
    });

    return {
      key: def.key,
      label: def.label,
      teamPresent: match !== undefined,
      filled: match?.leaderId != null,
    };
  });

  const filledCount = roles.filter((r) => r.filled).length;

  return {
    filledCount,
    totalRoles: MINISTRY_ROLE_KEYS.length,
    roles,
    isEmpty: teams.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Core group
// ----------------------------------------------------------------------------

function buildCoreGroupSignals(
  commitmentRows: CommitmentRow[],
  asOf: Date
): CoreGroupSignals {
  // First (earliest) commitment per person per type — order is signed_date asc.
  const firstCoreByPerson = new Map<string, Date>();
  const launchTeamPeople = new Set<string>();

  for (const row of commitmentRows) {
    const signed = parseDateOnly(row.signedDate);
    if (row.commitmentType === "core_group") {
      if (!firstCoreByPerson.has(row.personId)) {
        firstCoreByPerson.set(row.personId, signed);
      }
    } else if (row.commitmentType === "launch_team") {
      launchTeamPeople.add(row.personId);
    }
  }

  const committedCount = firstCoreByPerson.size;
  const launchTeamCount = launchTeamPeople.size;

  // Growth delta: people whose first core-group commitment landed in the
  // trailing window minus those in the prior window of equal length.
  const windowStart = new Date(
    asOf.getTime() - GROWTH_WINDOW_DAYS * MS_PER_DAY
  );
  const priorStart = new Date(
    asOf.getTime() - 2 * GROWTH_WINDOW_DAYS * MS_PER_DAY
  );

  let inWindow = 0;
  let inPrior = 0;
  for (const firstDate of firstCoreByPerson.values()) {
    if (firstDate > windowStart && firstDate <= asOf) inWindow += 1;
    else if (firstDate > priorStart && firstDate <= windowStart) inPrior += 1;
  }

  // The flat streak, measured from the LATEST first-commitment (#471). Reading
  // it off `firstCoreByPerson` is what makes the +1 reset structural: a second
  // commitment for somebody already in that map never becomes the maximum,
  // because the map only ever holds their earliest.
  let lastNewCommitment: Date | null = null;
  for (const firstDate of firstCoreByPerson.values()) {
    if (lastNewCommitment === null || firstDate > lastNewCommitment) {
      lastNewCommitment = firstDate;
    }
  }

  const isEmpty = commitmentRows.length === 0;

  return {
    committedCount,
    launchTeamCount,
    growthDelta: isEmpty ? null : inWindow - inPrior,
    growthWindowDays: GROWTH_WINDOW_DAYS,
    daysSinceLastNewCommitment:
      lastNewCommitment === null
        ? null
        : Math.max(0, diffInDays(lastNewCommitment, asOf)),
    slowedThresholdDays: GROWTH_SLOWED_THRESHOLD_DAYS,
    stalledThresholdDays: GROWTH_STALLED_THRESHOLD_DAYS,
    isEmpty,
  };
}

// ----------------------------------------------------------------------------
// Vision meetings
// ----------------------------------------------------------------------------

function buildVisionMeetingSignals(
  meetings: VisionMeetingRow[],
  asOf: Date
): VisionMeetingSignals {
  if (meetings.length === 0) {
    return {
      totalCompleted: 0,
      lastMeetingAt: null,
      daysSinceLastMeeting: null,
      averageCadenceDays: null,
      latestAttendance: null,
      previousAttendance: null,
      attendanceTrend: null,
      isEmpty: true,
    };
  }

  // Rows are ordered most-recent first.
  const latest = meetings[0];
  const previous = meetings[1] ?? null;

  // Average cadence across the most recent gaps (up to 6 meetings → 5 gaps).
  const recent = meetings.slice(0, 6);
  let averageCadenceDays: number | null = null;
  if (recent.length >= 2) {
    let totalGap = 0;
    for (let i = 0; i < recent.length - 1; i += 1) {
      totalGap += diffInDays(recent[i + 1].datetime, recent[i].datetime);
    }
    const gaps = recent.length - 1;
    averageCadenceDays = Math.round((totalGap / gaps) * 10) / 10;
  }

  const latestAttendance = latest.actualAttendance;
  const previousAttendance = previous?.actualAttendance ?? null;

  let attendanceTrend: VisionMeetingSignals["attendanceTrend"] = null;
  if (latestAttendance != null && previousAttendance != null) {
    if (latestAttendance > previousAttendance) attendanceTrend = "up";
    else if (latestAttendance < previousAttendance) attendanceTrend = "down";
    else attendanceTrend = "flat";
  }

  return {
    totalCompleted: meetings.length,
    lastMeetingAt: latest.datetime.toISOString(),
    daysSinceLastMeeting: diffInDays(latest.datetime, asOf),
    averageCadenceDays,
    latestAttendance,
    previousAttendance,
    attendanceTrend,
    isEmpty: false,
  };
}

// ----------------------------------------------------------------------------
// Follow-up staleness
// ----------------------------------------------------------------------------
//
// HOW TO READ THESE NUMBERS, and whose follow-up they are about (#323 WS2).
// `openCount` is people in the three open follow-up statuses — attendee,
// following_up, interviewed — and the only door into that cohort is
// `prospect -> attendee`, stamped when somebody attends a vision meeting they
// had never attended before. So the denominator is the plant's FIRST-TIME
// attendees who have not yet committed, never "everyone the planter means to
// follow up".
//
// That matters more since VM-007: the follow-up TASKS finalization generates
// now go to first-time attendees and to nobody else, so the prompted work and
// the measured cohort are the same people. Before, the tasks covered every
// attendee while this rate covered a narrower set, and "follow-up completion"
// silently meant two different populations depending on which screen you were
// on. The trend that renders it is labelled `First-time follow-up completion`
// (`trends.ts`) for the same reason.
//
// STALENESS IS THE PROXY FOR COMPLETION, and the threshold below is the whole
// definition of "reached": a contact untouched for longer than
// FOLLOW_UP_STALE_THRESHOLD_DAYS counts against the rate. It measures the
// person row's `updated_at`, not whether the generated task was ticked.

// OWNERSHIP IS MEASURED, NEVER INFERRED (#470, C01/C13). Rubric v0's Lens 2
// read "8 stale follow-ups" and told the planter they were carrying all of it.
// They may equally have distributed it badly, or handed it to people who did
// not do it. So the four owner facts below are counted from the follow-up
// TASKS' assignees, and rubric v1 gives the judge no other licence to say who
// carries follow-up. `countFollowUpOwnership` is shared with `/tasks`, which
// groups the same rows by the same definition of "owned".

function buildFollowUpSignals(
  rows: FollowUpRow[],
  openTasks: OpenFollowUpTask[],
  asOf: Date
): FollowUpSignals {
  const ownership = countFollowUpOwnership(
    rows.map((row) => ({
      id: row.id,
      isStale:
        diffInDays(row.updatedAt, asOf) >= FOLLOW_UP_STALE_THRESHOLD_DAYS,
    })),
    openTasks
  );

  if (rows.length === 0) {
    return {
      openCount: 0,
      stalestDays: null,
      staleCount: 0,
      staleThresholdDays: FOLLOW_UP_STALE_THRESHOLD_DAYS,
      ...ownership,
      isEmpty: true,
    };
  }

  let stalestDays = 0;
  let staleCount = 0;
  for (const row of rows) {
    const idleDays = diffInDays(row.updatedAt, asOf);
    if (idleDays > stalestDays) stalestDays = idleDays;
    if (idleDays >= FOLLOW_UP_STALE_THRESHOLD_DAYS) staleCount += 1;
  }

  return {
    openCount: rows.length,
    stalestDays,
    staleCount,
    staleThresholdDays: FOLLOW_UP_STALE_THRESHOLD_DAYS,
    ...ownership,
    isEmpty: false,
  };
}

// ----------------------------------------------------------------------------
// Leadership readiness
// ----------------------------------------------------------------------------

function buildLeadershipSignals(
  candidateRows: LeadershipPersonRow[],
  meetingsAttended: PersonCountRow[],
  activeMemberships: PersonCountRow[],
  committedPeople: Set<string>,
  teamLeaderIds: string[],
  asOf: Date
): LeadershipSignals {
  const meetingsByPerson = new Map(
    meetingsAttended.map((r) => [r.personId, r.count])
  );
  const membershipsByPerson = new Map(
    activeMemberships.map((r) => [r.personId, r.count])
  );
  const leaderPeople = new Set(teamLeaderIds);

  const candidates: LeadershipReadinessSignal[] = candidateRows.map((p) => ({
    personId: p.id,
    status: p.status,
    tenureDays: Math.max(0, diffInDays(p.createdAt, asOf)),
    meetingsAttended: meetingsByPerson.get(p.id) ?? 0,
    activeMemberships: membershipsByPerson.get(p.id) ?? 0,
    hasCommitment: committedPeople.has(p.id),
    leadsTeam: leaderPeople.has(p.id),
  }));

  return {
    candidates,
    isEmpty: candidates.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Training progress (CSF-8)
// ----------------------------------------------------------------------------

function buildTrainingSignals(
  programRows: TrainingProgramRow[],
  completionRows: TrainingCompletionRow[],
  committedPeople: Set<string>,
  committedCount: number
): TrainingSignals {
  const requiredPrograms = programRows.filter((p) => p.isRequired);
  const requiredProgramIds = new Set(requiredPrograms.map((p) => p.id));

  // A "slot" = one committed person × one required program.
  let requiredCompletionRate: number | null = null;
  if (requiredPrograms.length > 0 && committedCount > 0) {
    const totalSlots = requiredPrograms.length * committedCount;
    const completedRequiredSlots = completionRows.filter(
      (c) =>
        requiredProgramIds.has(c.trainingProgramId) &&
        committedPeople.has(c.personId)
    ).length;
    requiredCompletionRate =
      Math.round((completedRequiredSlots / totalSlots) * 1000) / 1000;
  }

  return {
    programCount: programRows.length,
    requiredProgramCount: requiredPrograms.length,
    completionCount: completionRows.length,
    requiredCompletionRate,
    isEmpty: programRows.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Launch countdown
// ----------------------------------------------------------------------------

/**
 * PE-004's countdown, now sourced from the LAUNCH ENTITY (`launches.target_date`)
 * rather than the dropped `churches.launch_date` column (LS-001, migration 0032).
 * A launch with no row, and a `planning` launch with no day named, both produce
 * the same empty countdown — the signal's question is only ever "which day".
 *
 * FIXED HERE: #338, the off-by-one #303 hit first. This used to be
 * `diffInDays(asOf, target)`, which subtracts a wall-clock DAY from an INSTANT
 * and floors the leftover fraction away — so from 00:00:01 UTC onward the answer
 * was a full day short and a plant read "past due" on the morning of its own
 * launch, while `/oversight/plants` (fixed in PR #339) read it correctly. Both
 * sides are floored to a UTC midnight before subtracting, and the one
 * implementation lives in `src/lib/launch/countdown.ts` so the two surfaces
 * cannot drift again.
 *
 * Note the sibling `diffInDays` call sites in this file are NOT the same bug and
 * must not be "fixed": days-since-last-meeting, idle days and tenure compare two
 * genuine instants, where flooring is correct.
 */
/**
 * STATUS, READINESS AND OUTCOME JOINED THE COUNTDOWN with LS-008: the snapshot
 * now carries what the launch IS (planning / scheduled / postponed / completed),
 * how far its Playbook readiness list has got, and — once the day is on the
 * record — the counts the planter wrote down.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not touch `currentPhase`, and
 * nothing downstream of it may: recording a completed launch is a MATERIAL
 * event, not an advancement (ruled 2026-08-04 — the engine stays ADVISORY).
 * `assembleFactSnapshot` copies `currentPhase` straight off the church row, so
 * two snapshots that differ only by a recorded launch differ only in this
 * section — pinned by `build-fact-snapshot.test.ts`.
 *
 * `isEmpty` still means "no day named", unchanged, because that is what every
 * existing consumer reads it as. A launch that exists in `planning` with no date
 * is still an empty countdown; `status` is what tells the two apart now.
 */
function buildLaunchSignals(
  launch: LaunchRow | null,
  milestones: LaunchMilestoneRow[],
  asOf: Date
): LaunchSignals {
  const targetDate = launch?.targetDate ?? null;
  const daysUntilLaunch = daysUntilTarget(targetDate, asOf);

  const readinessTotalCount = milestones.length;
  const readinessCompletedCount = milestones.filter(
    (milestone) => milestone.completedAt !== null
  ).length;

  const facts = {
    status: launch?.status ?? null,
    isCompleted: launch?.status === "completed",
    isPostponed: launch?.status === "postponed",
    outcomeRecorded: launch?.outcomeRecordedAt != null,
    attendanceCount: launch?.attendanceCount ?? null,
    decisionsCount: launch?.decisionsCount ?? null,
    readinessTotalCount,
    readinessCompletedCount,
    // No list is not 0% ready — it is no list, which is a different instruction
    // to the judge (PE-018's cold-start rule, applied to readiness).
    readinessCompletionRate:
      readinessTotalCount === 0
        ? null
        : readinessCompletedCount / readinessTotalCount,
  } satisfies Partial<LaunchSignals>;

  if (targetDate === null || daysUntilLaunch === null) {
    return {
      launchDate: null,
      daysUntilLaunch: null,
      isPastDue: false,
      isEmpty: true,
      ...facts,
    };
  }

  return {
    launchDate: targetDate,
    daysUntilLaunch,
    // A launch that HAPPENED is not overdue. `isPastDue` is read as "the day
    // came and went with nothing to show for it", so a completed launch is
    // false here however long ago it was — otherwise every plant that launches
    // successfully accrues an escalating warning for the rest of its life.
    isPastDue: daysUntilLaunch < 0 && launch?.status !== "completed",
    isEmpty: false,
    ...facts,
  };
}

// ----------------------------------------------------------------------------
// Manual attestations (PE-005)
// ----------------------------------------------------------------------------

function buildManualSignals(rows: PlantSignalRow[], asOf: Date): ManualSignals {
  // PROTOTYPE-FREE, because `row.signalKey` is a stored string and this is the
  // WRITE half of the untrusted-key rule (memory/invariants.md → Phase Engine —
  // Cited Facts & Attestation Citations). On a plain `{}`, `byKey["__proto__"]`
  // creates no own property at all — the row vanishes from the snapshot with
  // nothing failing — and `byKey["constructor"]` shadows a prototype member on
  // the very object every later citation is resolved against.
  const byKey: Record<string, unknown> = Object.create(null);
  const attestations = rows.map((row) => {
    byKey[row.signalKey] = row.value;
    return {
      signalKey: row.signalKey,
      value: row.value,
      attestedAt: row.attestedAt.toISOString(),
      // Clamped at 0: `attested_at` is stamped server-side, but a clock skew or
      // a hand-written row must not produce a negative age the judge would then
      // read out loud as "-3 days ago".
      attestedDaysAgo: Math.max(0, diffInDays(row.attestedAt, asOf)),
    };
  });

  return {
    attestations,
    byKey,
    reaffirmWindowDays: ATTESTATION_REAFFIRM_WINDOW_DAYS,
    isEmpty: attestations.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Pure assembly
// ----------------------------------------------------------------------------

/** All church_id-scoped raw rows needed to assemble a snapshot. */
export interface SnapshotInputs {
  church: ChurchRow;
  /**
   * The plant's launch entity, or `null` when it has none (LS-001). Separate
   * from `church` because it is a separate row now — the countdown used to read
   * `church.launchDate`, and the whole point of migration 0032 is that it no
   * longer can.
   */
  launch: LaunchRow | null;
  /**
   * The launch's Playbook readiness milestones (LS-003/LS-008). Empty when
   * nothing has been seeded — which is not the same as nothing being done, and
   * the builder keeps the two apart.
   */
  launchMilestones: LaunchMilestoneRow[];
  commitments: CommitmentRow[];
  visionMeetings: VisionMeetingRow[];
  followUp: FollowUpRow[];
  /**
   * The open follow-up TASKS, owners already resolved to their current status
   * (#470). Separate from `followUp` because they answer a different question:
   * that cohort is who is waiting, this one is who is on it.
   */
  followUpTasks: OpenFollowUpTask[];
  ministryTeams: MinistryTeamRow[];
  leadershipCandidates: LeadershipPersonRow[];
  meetingsAttendedByPerson: PersonCountRow[];
  activeMembershipsByPerson: PersonCountRow[];
  teamLeaderPersonIds: string[];
  trainingPrograms: TrainingProgramRow[];
  trainingCompletions: TrainingCompletionRow[];
  plantSignals: PlantSignalRow[];
}

/**
 * Pure, deterministic assembly of the fact snapshot from already-fetched rows.
 * Side-effect free and DB-free — given identical inputs and `asOf`, the output
 * is identical (AC-PE-2). Exported for unit testing.
 */
export function assembleFactSnapshot(
  churchId: string,
  inputs: SnapshotInputs,
  asOf: Date
): PlantFactSnapshot {
  const committedPeople = new Set(inputs.commitments.map((r) => r.personId));

  const coreGroup = buildCoreGroupSignals(inputs.commitments, asOf);
  const visionMeetings = buildVisionMeetingSignals(inputs.visionMeetings, asOf);
  const followUp = buildFollowUpSignals(
    inputs.followUp,
    inputs.followUpTasks,
    asOf
  );
  const ministryRoles = buildMinistryRoleSignals(inputs.ministryTeams);
  const leadership = buildLeadershipSignals(
    inputs.leadershipCandidates,
    inputs.meetingsAttendedByPerson,
    inputs.activeMembershipsByPerson,
    committedPeople,
    inputs.teamLeaderPersonIds,
    asOf
  );
  const training = buildTrainingSignals(
    inputs.trainingPrograms,
    inputs.trainingCompletions,
    committedPeople,
    coreGroup.committedCount
  );
  const launch = buildLaunchSignals(
    inputs.launch ?? null,
    inputs.launchMilestones,
    asOf
  );
  const manual = buildManualSignals(inputs.plantSignals, asOf);

  // Cold-start (PE-018): no meaningful activity anywhere in the system.
  const isColdStart =
    coreGroup.isEmpty &&
    visionMeetings.isEmpty &&
    followUp.isEmpty &&
    ministryRoles.isEmpty &&
    leadership.isEmpty &&
    training.isEmpty;

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    churchId,
    currentPhase: inputs.church.currentPhase,
    generatedAt: asOf.toISOString(),
    isColdStart,
    coreGroup,
    visionMeetings,
    followUp,
    ministryRoles,
    leadership,
    training,
    launch,
    manual,
  };
}

// ----------------------------------------------------------------------------
// Public entrypoint (I/O)
// ----------------------------------------------------------------------------

/**
 * Compute the deterministic plant fact snapshot for a church.
 *
 * All reads are church_id-scoped (NFR-PE-6) and run in parallel. The snapshot
 * contains no LLM-generated value (NFR-PE-1).
 *
 * @throws if the church does not exist — the caller is expected to pass a valid,
 *   access-checked church id. (Cold-start = a real church with sparse data, which
 *   is handled gracefully; a missing church is a programming/authorization error.)
 */
export async function buildFactSnapshot(
  churchId: string,
  options: BuildFactSnapshotOptions = {}
): Promise<PlantFactSnapshot> {
  // Single reference time → reproducible time-relative facts (AC-PE-2).
  const asOf = options.asOf ?? new Date();

  const church = await getChurch(churchId);
  if (!church) {
    throw new Error(`buildFactSnapshot: church not found: ${churchId}`);
  }

  // Independent church_id-scoped reads (NFR-PE-6), run concurrently. The launch
  // joined this list with LS-001: it is a row of its own now, not a column on
  // the church, so it is one more parallel read rather than one more column.
  const [
    launch,
    launchMilestones,
    commitments,
    visionMeetings,
    followUp,
    followUpTasks,
    ministryTeams,
    leadershipCandidates,
    meetingsAttendedByPerson,
    activeMembershipsByPerson,
    teamLeaderPersonIds,
    trainingPrograms,
    trainingCompletions,
    plantSignals,
  ] = await Promise.all([
    getLaunch(churchId),
    getLaunchMilestoneRows(churchId),
    getCommitments(churchId),
    getCompletedVisionMeetings(churchId),
    getOpenFollowUpContacts(churchId),
    listOpenFollowUpTasks(churchId),
    getMinistryTeams(churchId),
    getLeadershipCandidates(churchId),
    getMeetingsAttendedByPerson(churchId),
    getActiveMembershipsByPerson(churchId),
    getTeamLeaderPersonIds(churchId),
    getTrainingPrograms(churchId),
    getTrainingCompletions(churchId),
    getPlantSignals(churchId),
  ]);

  return assembleFactSnapshot(
    churchId,
    {
      church,
      launch,
      launchMilestones,
      commitments,
      visionMeetings,
      followUp,
      followUpTasks,
      ministryTeams,
      leadershipCandidates,
      meetingsAttendedByPerson,
      activeMembershipsByPerson,
      teamLeaderPersonIds,
      trainingPrograms,
      trainingCompletions,
      plantSignals,
    },
    asOf
  );
}
