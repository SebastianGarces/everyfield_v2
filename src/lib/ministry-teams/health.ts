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
// Health / Metrics Functions
// ============================================================================

/**
 * Calculate team health metrics
 */
export async function getTeamHealth(
  churchId: string,
  teamId: string
): Promise<TeamHealthMetrics> {
  const [team] = await db
    .select()
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .limit(1);

  if (!team) throw new Error("Team not found");

  // Staffing %
  const staffing = await getTeamStaffingCounts(churchId, teamId);
  const staffingPercent =
    staffing.total > 0
      ? Math.round((staffing.filled / staffing.total) * 100)
      : 100;

  // Training %
  const programs = await db
    .select()
    .from(trainingPrograms)
    .where(
      and(
        eq(trainingPrograms.churchId, churchId),
        eq(trainingPrograms.isRequired, true),
        sql`(${trainingPrograms.teamId} = ${teamId} OR ${trainingPrograms.teamId} IS NULL)`
      )
    );

  const members = await db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active")
      )
    );

  let trainingPercent = 100;
  const totalRequired = programs.length * members.length;
  if (totalRequired > 0) {
    const memberPersonIds = members.map((m) => m.personId);
    const programIds = programs.map((p) => p.id);

    const [{ completedCount }] = await db
      .select({ completedCount: sql<number>`count(*)::int` })
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          inArray(trainingCompletions.personId, memberPersonIds),
          inArray(trainingCompletions.trainingProgramId, programIds)
        )
      );

    trainingPercent = Math.round(((completedCount ?? 0) / totalRequired) * 100);
  }

  // Meeting attendance (last 4 meetings)
  const recentMeetings = await db
    .select()
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.teamId, teamId)
      )
    )
    .orderBy(desc(churchMeetings.datetime))
    .limit(4);

  let meetingAttendancePercent = 100;
  if (recentMeetings.length > 0 && members.length > 0) {
    let totalAttended = 0;
    let totalExpected = 0;

    for (const meeting of recentMeetings) {
      const attendances = await db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, churchId),
            eq(meetingAttendance.meetingId, meeting.id)
          )
        );

      totalExpected += members.length;
      totalAttended += attendances.filter(
        (a) => a.status === "attended"
      ).length;
    }

    meetingAttendancePercent =
      totalExpected > 0
        ? Math.round((totalAttended / totalExpected) * 100)
        : 100;
  }

  // Engagement score (weighted average)
  const engagementScore = Math.round(
    staffingPercent * 0.4 +
      trainingPercent * 0.35 +
      meetingAttendancePercent * 0.25
  );

  // Alert level
  let alertLevel: "green" | "yellow" | "red" = "green";
  if (staffingPercent < 40) alertLevel = "red";
  else if (staffingPercent < 60 || meetingAttendancePercent < 50)
    alertLevel = "yellow";

  return {
    teamId,
    teamName: team.name,
    staffingPercent,
    trainingPercent,
    meetingAttendancePercent,
    engagementScore,
    alertLevel,
  };
}

/**
 * Get health metrics for all teams (dashboard)
 */
export async function getAllTeamsHealth(
  churchId: string
): Promise<TeamHealthMetrics[]> {
  const teams = await db
    .select()
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(asc(ministryTeams.sortOrder));

  const healthMetrics: TeamHealthMetrics[] = [];

  for (const team of teams) {
    const metrics = await getTeamHealth(churchId, team.id);
    healthMetrics.push(metrics);
  }

  return healthMetrics;
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
