import { db } from "@/db";
import { visionMeetingAttendance, visionMeetings } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AttendanceTrendPoint, MeetingSummaryStats } from "./types";

/**
 * Get attendance trend data across meetings
 */
export async function getAttendanceTrend(
  churchId: string,
  limit: number = 12
): Promise<AttendanceTrendPoint[]> {
  const meetings = await db
    .select({
      id: visionMeetings.id,
      meetingNumber: visionMeetings.meetingNumber,
      datetime: visionMeetings.datetime,
      actualAttendance: visionMeetings.actualAttendance,
    })
    .from(visionMeetings)
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.status, "completed")
      )
    )
    .orderBy(desc(visionMeetings.datetime))
    .limit(limit);

  if (meetings.length === 0) return [];

  // Get attendance breakdown per meeting
  const meetingIds = meetings.map((m) => m.id);

  const breakdowns = await db
    .select({
      meetingId: visionMeetingAttendance.meetingId,
      attendanceType: visionMeetingAttendance.attendanceType,
      count: sql<number>`count(*)::int`,
    })
    .from(visionMeetingAttendance)
    .where(
      and(
        eq(visionMeetingAttendance.churchId, churchId),
        sql`${visionMeetingAttendance.meetingId} IN (${sql.join(
          meetingIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      )
    )
    .groupBy(
      visionMeetingAttendance.meetingId,
      visionMeetingAttendance.attendanceType
    );

  // Build breakdown map
  const breakdownMap = new Map<
    string,
    { firstTime: number; returning: number; coreGroup: number }
  >();
  for (const b of breakdowns) {
    if (!breakdownMap.has(b.meetingId)) {
      breakdownMap.set(b.meetingId, {
        firstTime: 0,
        returning: 0,
        coreGroup: 0,
      });
    }
    const entry = breakdownMap.get(b.meetingId)!;
    if (b.attendanceType === "first_time") entry.firstTime = b.count;
    else if (b.attendanceType === "returning") entry.returning = b.count;
    else if (b.attendanceType === "core_group") entry.coreGroup = b.count;
  }

  // Reverse to chronological order
  return meetings.reverse().map((m) => {
    const breakdown = breakdownMap.get(m.id) ?? {
      firstTime: 0,
      returning: 0,
      coreGroup: 0,
    };
    return {
      meetingId: m.id,
      meetingNumber: m.meetingNumber,
      datetime: m.datetime,
      totalAttendance:
        m.actualAttendance ??
        breakdown.firstTime + breakdown.returning + breakdown.coreGroup,
      newAttendees: breakdown.firstTime,
      returningAttendees: breakdown.returning,
      coreGroupAttendees: breakdown.coreGroup,
    };
  });
}

/**
 * Get new vs returning breakdown per meeting
 */
export async function getNewVsReturning(
  churchId: string,
  limit: number = 12
): Promise<AttendanceTrendPoint[]> {
  // Same data as getAttendanceTrend
  return getAttendanceTrend(churchId, limit);
}

/**
 * Get summary statistics across all meetings
 */
export async function getMeetingSummaryStats(
  churchId: string
): Promise<MeetingSummaryStats> {
  const result = await db
    .select({
      totalMeetings: sql<number>`count(*)::int`,
      totalAttendees: sql<number>`COALESCE(sum(${visionMeetings.actualAttendance}), 0)::int`,
      avgAttendance: sql<number>`COALESCE(avg(${visionMeetings.actualAttendance}), 0)::float`,
    })
    .from(visionMeetings)
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.status, "completed")
      )
    );

  const stats = result[0] ?? {
    totalMeetings: 0,
    totalAttendees: 0,
    avgAttendance: 0,
  };

  // Get last two meetings for growth calculation
  const lastTwo = await db
    .select({ actualAttendance: visionMeetings.actualAttendance })
    .from(visionMeetings)
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.status, "completed")
      )
    )
    .orderBy(desc(visionMeetings.datetime))
    .limit(2);

  const lastMeetingAttendance = lastTwo[0]?.actualAttendance ?? null;
  let growthPercent: number | null = null;

  if (
    lastTwo.length >= 2 &&
    lastTwo[0]?.actualAttendance &&
    lastTwo[1]?.actualAttendance
  ) {
    growthPercent =
      ((lastTwo[0].actualAttendance - lastTwo[1].actualAttendance) /
        lastTwo[1].actualAttendance) *
      100;
  }

  return {
    totalMeetings: stats.totalMeetings,
    totalAttendees: stats.totalAttendees,
    avgAttendance: Math.round(stats.avgAttendance * 10) / 10,
    lastMeetingAttendance,
    growthPercent:
      growthPercent !== null ? Math.round(growthPercent * 10) / 10 : null,
  };
}
