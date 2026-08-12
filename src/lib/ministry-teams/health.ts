import { db } from "@/db";
import {
  ministryTeams,
  teamRoles,
  teamMemberships,
  churchMeetings,
  meetingAttendance,
  trainingPrograms,
  trainingCompletions,
} from "@/db/schema";
import { and, desc, eq, inArray, sql, asc } from "drizzle-orm";
import { getTeamStaffingCounts } from "./shared";
import { staffingPercent } from "./team-display";

// ============================================================================
// Types
// ============================================================================

export interface StaffingSummary {
  totalTeams: number;
  totalRoles: number;
  filledRoles: number;
  staffingPercentage: number;
}

export interface TeamHealthMetrics {
  teamId: string;
  teamName: string;
  staffingPercent: number;
  trainingPercent: number;
  meetingAttendancePercent: number;
  engagementScore: number;
  alertLevel: "green" | "yellow" | "red";
}

// ============================================================================
// The pure arithmetic
// ============================================================================

/** How many of a team's most recent meetings feed the attendance figure. */
const RECENT_MEETING_WINDOW = 4;

/**
 * Everything the health arithmetic needs, already counted. `memberCount` is
 * active membership ROWS (a person filling two roles counts twice), which is
 * what the training and attendance denominators have always used.
 */
interface TeamHealthInputs {
  teamId: string;
  teamName: string;
  staffing: { filled: number; total: number };
  /** Required programs that apply to this team (its own + church-wide). */
  requiredProgramCount: number;
  memberCount: number;
  /** Completions by current members of those required programs. */
  completedCount: number;
  /** Meetings inside the recent window (≤ RECENT_MEETING_WINDOW). */
  recentMeetingCount: number;
  /**
   * Attendance rows marked 'attended' across those meetings, BY THE TEAM'S
   * ACTIVE MEMBERS only — count them with `countAttendedByMembers`. The
   * denominator is members × meetings, so counting a non-member guest here is
   * what used to push the figure past 100% (ruling 409-4A, 2026-08-12).
   */
  attendedCount: number;
}

/**
 * The attendance numerator: rows marked 'attended' whose person is one of the
 * team's active members. Both `getTeamHealth` and `getAllTeamsHealth` count
 * through this, so an open meeting's guests can never inflate a team's
 * attendance figure (ruling 409-4A, 2026-08-12).
 */
export function countAttendedByMembers(
  rows: { personId: string; status: string }[],
  memberPersonIds: Iterable<string>
): number {
  const memberSet = new Set(memberPersonIds);
  let count = 0;
  for (const row of rows) {
    if (row.status === "attended" && memberSet.has(row.personId)) count++;
  }
  return count;
}

/**
 * The one place the health figures are derived. Both `getTeamHealth` and
 * `getAllTeamsHealth` feed this, so the single-team page and the dashboard
 * cannot drift apart. An empty denominator reads 100 throughout: nothing was
 * required, so nothing is missing. Exported for the unit tests only — the app
 * reaches it through the two reads below.
 */
export function computeTeamHealth(inputs: TeamHealthInputs): TeamHealthMetrics {
  const staffing = staffingPercent(
    inputs.staffing.filled,
    inputs.staffing.total,
    100
  );

  const totalRequired = inputs.requiredProgramCount * inputs.memberCount;
  const trainingPercent =
    totalRequired > 0
      ? Math.round((inputs.completedCount / totalRequired) * 100)
      : 100;

  const totalExpected = inputs.memberCount * inputs.recentMeetingCount;
  const meetingAttendancePercent =
    totalExpected > 0
      ? Math.round((inputs.attendedCount / totalExpected) * 100)
      : 100;

  // Engagement score (weighted average)
  const engagementScore = Math.round(
    staffing * 0.4 + trainingPercent * 0.35 + meetingAttendancePercent * 0.25
  );

  // Alert level
  let alertLevel: "green" | "yellow" | "red" = "green";
  if (staffing < 40) alertLevel = "red";
  else if (staffing < 60 || meetingAttendancePercent < 50)
    alertLevel = "yellow";

  return {
    teamId: inputs.teamId,
    teamName: inputs.teamName,
    staffingPercent: staffing,
    trainingPercent,
    meetingAttendancePercent,
    engagementScore,
    alertLevel,
  };
}

// ============================================================================
// Health / Metrics Functions
// ============================================================================

/**
 * Calculate team health metrics for one team.
 */
export async function getTeamHealth(
  churchId: string,
  teamId: string
): Promise<TeamHealthMetrics> {
  const [team] = await db
    .select({ id: ministryTeams.id, name: ministryTeams.name })
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .limit(1);

  if (!team) throw new Error("Team not found");

  // The four independent reads run together; on neon-http each await is its
  // own HTTP round trip, so serializing them was pure latency.
  const [staffing, programs, members, recentMeetings] = await Promise.all([
    getTeamStaffingCounts(churchId, teamId),
    db
      .select({ id: trainingPrograms.id })
      .from(trainingPrograms)
      .where(
        and(
          eq(trainingPrograms.churchId, churchId),
          eq(trainingPrograms.isRequired, true),
          sql`(${trainingPrograms.teamId} = ${teamId} OR ${trainingPrograms.teamId} IS NULL)`
        )
      ),
    db
      .select({ personId: teamMemberships.personId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.status, "active")
        )
      ),
    db
      .select({ id: churchMeetings.id })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
          eq(churchMeetings.teamId, teamId)
        )
      )
      .orderBy(desc(churchMeetings.datetime))
      .limit(RECENT_MEETING_WINDOW),
  ]);

  let completedCount = 0;
  if (programs.length > 0 && members.length > 0) {
    const [row] = await db
      .select({ completedCount: sql<number>`count(*)::int` })
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          inArray(
            trainingCompletions.personId,
            members.map((m) => m.personId)
          ),
          inArray(
            trainingCompletions.trainingProgramId,
            programs.map((p) => p.id)
          )
        )
      );
    completedCount = row?.completedCount ?? 0;
  }

  // ONE read across the recent meetings instead of one per meeting. The rows
  // carry personId so the numerator can be restricted to the team's active
  // members (ruling 409-4A) — a guest at an open meeting is not attendance.
  let attendedCount = 0;
  if (recentMeetings.length > 0 && members.length > 0) {
    const attendance = await db
      .select({
        personId: meetingAttendance.personId,
        status: meetingAttendance.status,
      })
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.churchId, churchId),
          inArray(
            meetingAttendance.meetingId,
            recentMeetings.map((m) => m.id)
          )
        )
      );
    attendedCount = countAttendedByMembers(
      attendance,
      members.map((m) => m.personId)
    );
  }

  return computeTeamHealth({
    teamId,
    teamName: team.name,
    staffing,
    requiredProgramCount: programs.length,
    memberCount: members.length,
    completedCount,
    recentMeetingCount: recentMeetings.length,
    attendedCount,
  });
}

/**
 * Get health metrics for all teams (dashboard).
 *
 * A fixed number of church-wide grouped queries regardless of team count —
 * this used to call `getTeamHealth` once per team in a sequential loop, which
 * on neon-http meant roughly 7 serialized HTTP round trips per team. The
 * per-team arithmetic is `computeTeamHealth`, shared with `getTeamHealth`.
 */
export async function getAllTeamsHealth(
  churchId: string
): Promise<TeamHealthMetrics[]> {
  const teams = await db
    .select({ id: ministryTeams.id, name: ministryTeams.name })
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(asc(ministryTeams.sortOrder));

  if (teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id);

  const [roleCounts, requiredPrograms, memberRows, meetingRows] =
    await Promise.all([
      db
        .select({
          teamId: teamRoles.teamId,
          total: sql<number>`count(*)::int`,
          filled: sql<number>`count(*) filter (where ${teamRoles.status} = 'filled')::int`,
        })
        .from(teamRoles)
        .where(
          and(
            eq(teamRoles.churchId, churchId),
            inArray(teamRoles.teamId, teamIds)
          )
        )
        .groupBy(teamRoles.teamId),
      db
        .select({ id: trainingPrograms.id, teamId: trainingPrograms.teamId })
        .from(trainingPrograms)
        .where(
          and(
            eq(trainingPrograms.churchId, churchId),
            eq(trainingPrograms.isRequired, true)
          )
        ),
      db
        .select({
          teamId: teamMemberships.teamId,
          personId: teamMemberships.personId,
        })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.churchId, churchId),
            eq(teamMemberships.status, "active"),
            inArray(teamMemberships.teamId, teamIds)
          )
        ),
      db
        .select({ id: churchMeetings.id, teamId: churchMeetings.teamId })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.churchId, churchId),
            inArray(churchMeetings.teamId, teamIds)
          )
        )
        .orderBy(desc(churchMeetings.datetime)),
    ]);

  // Each team's recent window: the rows arrive newest-first, so the first
  // RECENT_MEETING_WINDOW per team are exactly what the per-team query took.
  const recentMeetingsByTeam = new Map<string, string[]>();
  for (const meeting of meetingRows) {
    if (!meeting.teamId) continue;
    const window = recentMeetingsByTeam.get(meeting.teamId) ?? [];
    if (window.length < RECENT_MEETING_WINDOW) {
      window.push(meeting.id);
      recentMeetingsByTeam.set(meeting.teamId, window);
    }
  }

  const selectedMeetingIds = [...recentMeetingsByTeam.values()].flat();

  const [completionRows, attendanceRows] = await Promise.all([
    requiredPrograms.length > 0 && memberRows.length > 0
      ? db
          .select({
            personId: trainingCompletions.personId,
            trainingProgramId: trainingCompletions.trainingProgramId,
          })
          .from(trainingCompletions)
          .where(
            and(
              eq(trainingCompletions.churchId, churchId),
              inArray(
                trainingCompletions.trainingProgramId,
                requiredPrograms.map((p) => p.id)
              )
            )
          )
      : [],
    selectedMeetingIds.length > 0
      ? db
          .select({
            meetingId: meetingAttendance.meetingId,
            personId: meetingAttendance.personId,
            status: meetingAttendance.status,
          })
          .from(meetingAttendance)
          .where(
            and(
              eq(meetingAttendance.churchId, churchId),
              inArray(meetingAttendance.meetingId, selectedMeetingIds)
            )
          )
      : [],
  ]);

  const staffingByTeam = new Map(
    roleCounts.map((r) => [r.teamId, { filled: r.filled, total: r.total }])
  );

  const membersByTeam = new Map<string, string[]>();
  for (const membership of memberRows) {
    const list = membersByTeam.get(membership.teamId) ?? [];
    list.push(membership.personId);
    membersByTeam.set(membership.teamId, list);
  }

  // Grouped by meeting, persons kept: the numerator is restricted per team to
  // its own active members (ruling 409-4A), and only the team knows who those
  // are — so the count happens inside the team loop, not here.
  const attendanceByMeeting = new Map<
    string,
    { personId: string; status: string }[]
  >();
  for (const row of attendanceRows) {
    const list = attendanceByMeeting.get(row.meetingId) ?? [];
    list.push({ personId: row.personId, status: row.status });
    attendanceByMeeting.set(row.meetingId, list);
  }

  return teams.map((team) => {
    const members = membersByTeam.get(team.id) ?? [];
    const memberSet = new Set(members);
    const applicableProgramIds = new Set(
      requiredPrograms
        .filter((p) => p.teamId === null || p.teamId === team.id)
        .map((p) => p.id)
    );
    const completedCount =
      members.length > 0
        ? completionRows.filter(
            (c) =>
              memberSet.has(c.personId) &&
              applicableProgramIds.has(c.trainingProgramId)
          ).length
        : 0;
    const recentMeetingIds = recentMeetingsByTeam.get(team.id) ?? [];
    const attendedCount = countAttendedByMembers(
      recentMeetingIds.flatMap(
        (meetingId) => attendanceByMeeting.get(meetingId) ?? []
      ),
      members
    );

    return computeTeamHealth({
      teamId: team.id,
      teamName: team.name,
      staffing: staffingByTeam.get(team.id) ?? { filled: 0, total: 0 },
      requiredProgramCount: applicableProgramIds.size,
      memberCount: members.length,
      completedCount,
      recentMeetingCount: recentMeetingIds.length,
      attendedCount,
    });
  });
}

/**
 * Get overall staffing summary
 */
export async function getStaffingSummary(
  churchId: string
): Promise<StaffingSummary> {
  const [teamCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId));

  const [roleStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      filled: sql<number>`count(*) filter (where ${teamRoles.status} = 'filled')::int`,
    })
    .from(teamRoles)
    .where(eq(teamRoles.churchId, churchId));

  const totalTeams = teamCountResult?.count ?? 0;
  const totalRoles = roleStats?.total ?? 0;
  const filledRoles = roleStats?.filled ?? 0;

  return {
    totalTeams,
    totalRoles,
    filledRoles,
    staffingPercentage:
      totalRoles > 0 ? Math.round((filledRoles / totalRoles) * 100) : 0,
  };
}
