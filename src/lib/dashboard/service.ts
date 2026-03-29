import { db } from "@/db";
import {
  churchMeetings,
  personActivities,
  persons,
  tasks,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getTaskCounts } from "@/lib/tasks/service";

// ============================================================================
// Types
// ============================================================================

export type DashboardMetrics = {
  coreGroupSize: number;
  totalPeople: number;
  overdueTasks: number;
  visionMeetingsHeld: number;
};

export type ActivityItem = {
  id: string;
  type:
    | "person_created"
    | "status_changed"
    | "commitment_recorded"
    | "note_added"
    | "meeting_completed"
    | "task_completed";
  description: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get aggregated dashboard metrics for a church.
 * All metrics are computed from existing tables, no new schema needed.
 */
export async function getDashboardMetrics(
  churchId: string,
  userId: string
): Promise<DashboardMetrics> {
  const [coreGroupResult, totalPeopleResult, taskCounts, meetingsResult] =
    await Promise.all([
      // Core Group Size: persons with status in (core_group, launch_team, leader)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(persons)
        .where(
          and(
            eq(persons.churchId, churchId),
            inArray(persons.status, ["core_group", "launch_team", "leader"]),
            isNull(persons.deletedAt)
          )
        ),

      // Total People (non-deleted)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(persons)
        .where(
          and(eq(persons.churchId, churchId), isNull(persons.deletedAt))
        ),

      // Overdue Tasks (existing function)
      getTaskCounts(churchId, userId),

      // Vision Meetings Held (completed)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.churchId, churchId),
            eq(churchMeetings.type, "vision_meeting"),
            eq(churchMeetings.status, "completed")
          )
        ),
    ]);

  return {
    coreGroupSize: coreGroupResult[0]?.count ?? 0,
    totalPeople: totalPeopleResult[0]?.count ?? 0,
    overdueTasks: taskCounts.overdue,
    visionMeetingsHeld: meetingsResult[0]?.count ?? 0,
  };
}

/**
 * Get recent cross-feature activity for the dashboard feed.
 * Queries person_activities, completed meetings, and completed tasks separately,
 * then merges and sorts by timestamp.
 */
export async function getRecentActivity(
  churchId: string,
  limit: number = 20
): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];

  // 1. Person activities (status_changed, person_created, commitment_recorded, note_added)
  const personActivityRows = await db
    .select({
      id: personActivities.id,
      activityType: personActivities.activityType,
      metadata: personActivities.metadata,
      createdAt: personActivities.createdAt,
      personId: personActivities.personId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(personActivities)
    .innerJoin(persons, eq(personActivities.personId, persons.id))
    .where(
      and(
        eq(personActivities.churchId, churchId),
        inArray(personActivities.activityType, [
          "person_created",
          "status_changed",
          "commitment_recorded",
          "note_added",
        ])
      )
    )
    .orderBy(desc(personActivities.createdAt))
    .limit(limit);

  for (const row of personActivityRows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const name = `${row.firstName} ${row.lastName}`;
    let description = "";

    switch (row.activityType) {
      case "person_created":
        description = `${name} was added as a new contact`;
        break;
      case "status_changed": {
        const newStatus = meta.newStatus as string | undefined;
        description = newStatus
          ? `${name} moved to ${formatStatus(newStatus)}`
          : `${name}'s status was updated`;
        break;
      }
      case "commitment_recorded":
        description = `${name} signed a commitment`;
        break;
      case "note_added":
        description = `Note added for ${name}`;
        break;
      default:
        description = `Activity recorded for ${name}`;
    }

    items.push({
      id: row.id,
      type: row.activityType as ActivityItem["type"],
      description,
      timestamp: row.createdAt,
      metadata: { personId: row.personId, personName: name, ...meta },
    });
  }

  // 2. Completed meetings
  const completedMeetings = await db
    .select({
      id: churchMeetings.id,
      type: churchMeetings.type,
      title: churchMeetings.title,
      meetingNumber: churchMeetings.meetingNumber,
      actualAttendance: churchMeetings.actualAttendance,
      updatedAt: churchMeetings.updatedAt,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.status, "completed")
      )
    )
    .orderBy(desc(churchMeetings.updatedAt))
    .limit(limit);

  for (const meeting of completedMeetings) {
    const label =
      meeting.type === "vision_meeting"
        ? `Vision Meeting #${meeting.meetingNumber ?? "?"}`
        : meeting.title ?? formatMeetingType(meeting.type);
    const attendance = meeting.actualAttendance;
    const description = attendance
      ? `${label} completed with ${attendance} attendees`
      : `${label} completed`;

    items.push({
      id: `meeting-${meeting.id}`,
      type: "meeting_completed",
      description,
      timestamp: meeting.updatedAt,
      metadata: {
        meetingId: meeting.id,
        meetingType: meeting.type,
        meetingNumber: meeting.meetingNumber,
        attendance,
      },
    });
  }

  // 3. Completed tasks
  const completedTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      category: tasks.category,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.status, "complete"),
        isNull(tasks.deletedAt),
        sql`${tasks.completedAt} IS NOT NULL`
      )
    )
    .orderBy(desc(tasks.completedAt))
    .limit(limit);

  for (const task of completedTasks) {
    items.push({
      id: `task-${task.id}`,
      type: "task_completed",
      description: `Task completed: ${task.title}`,
      timestamp: task.completedAt!,
      metadata: {
        taskId: task.id,
        category: task.category,
      },
    });
  }

  // Sort all items by timestamp descending, take top N
  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return items.slice(0, limit);
}

// ============================================================================
// Helpers
// ============================================================================

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    prospect: "Prospect",
    attendee: "Attendee",
    following_up: "Following Up",
    interviewed: "Interviewed",
    core_group: "Core Group",
    launch_team: "Launch Team",
    leader: "Leader",
  };
  return map[status] ?? status.replace(/_/g, " ");
}

function formatMeetingType(type: string): string {
  const map: Record<string, string> = {
    vision_meeting: "Vision Meeting",
    orientation: "Orientation",
    team_meeting: "Team Meeting",
  };
  return map[type] ?? type.replace(/_/g, " ");
}
