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
  getTrainingPrograms,
  type ChurchRow,
  type CommitmentRow,
  type FollowUpRow,
  type LeadershipPersonRow,
  type MinistryTeamRow,
  type PersonCountRow,
  type PlantSignalRow,
  type TrainingCompletionRow,
  type TrainingProgramRow,
  type VisionMeetingRow,
} from "./queries";
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

/** Snapshot shape version — bump when the structure changes. */
export const SNAPSHOT_VERSION = "v1";

/** Trailing window for the committed-core-group growth delta. */
const GROWTH_WINDOW_DAYS = 28;

/** A follow-up contact is "stale" once untouched beyond this many days. */
const FOLLOW_UP_STALE_THRESHOLD_DAYS = 14;

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

  const isEmpty = commitmentRows.length === 0;

  return {
    committedCount,
    launchTeamCount,
    growthDelta: isEmpty ? null : inWindow - inPrior,
    growthWindowDays: GROWTH_WINDOW_DAYS,
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

function buildFollowUpSignals(
  rows: FollowUpRow[],
  asOf: Date
): FollowUpSignals {
  if (rows.length === 0) {
    return {
      openCount: 0,
      stalestDays: null,
      staleCount: 0,
      staleThresholdDays: FOLLOW_UP_STALE_THRESHOLD_DAYS,
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

function buildLaunchSignals(
  launchDate: string | null,
  asOf: Date
): LaunchSignals {
  if (!launchDate) {
    return {
      launchDate: null,
      daysUntilLaunch: null,
      isPastDue: false,
      isEmpty: true,
    };
  }

  const target = parseDateOnly(launchDate);
  const daysUntilLaunch = diffInDays(asOf, target);

  return {
    launchDate,
    daysUntilLaunch,
    isPastDue: daysUntilLaunch < 0,
    isEmpty: false,
  };
}

// ----------------------------------------------------------------------------
// Manual attestations (PE-005)
// ----------------------------------------------------------------------------

function buildManualSignals(rows: PlantSignalRow[]): ManualSignals {
  const byKey: Record<string, unknown> = {};
  const attestations = rows.map((row) => {
    byKey[row.signalKey] = row.value;
    return {
      signalKey: row.signalKey,
      value: row.value,
      attestedAt: row.attestedAt.toISOString(),
    };
  });

  return {
    attestations,
    byKey,
    isEmpty: attestations.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Pure assembly
// ----------------------------------------------------------------------------

/** All church_id-scoped raw rows needed to assemble a snapshot. */
export interface SnapshotInputs {
  church: ChurchRow;
  commitments: CommitmentRow[];
  visionMeetings: VisionMeetingRow[];
  followUp: FollowUpRow[];
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
  const followUp = buildFollowUpSignals(inputs.followUp, asOf);
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
  const launch = buildLaunchSignals(inputs.church.launchDate, asOf);
  const manual = buildManualSignals(inputs.plantSignals);

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

  // Independent church_id-scoped reads (NFR-PE-6), run concurrently.
  const [
    commitments,
    visionMeetings,
    followUp,
    ministryTeams,
    leadershipCandidates,
    meetingsAttendedByPerson,
    activeMembershipsByPerson,
    teamLeaderPersonIds,
    trainingPrograms,
    trainingCompletions,
    plantSignals,
  ] = await Promise.all([
    getCommitments(churchId),
    getCompletedVisionMeetings(churchId),
    getOpenFollowUpContacts(churchId),
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
      commitments,
      visionMeetings,
      followUp,
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
