import { db } from "@/db";
import { tasks, churchMeetings } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export interface FollowUpTaskOutcome {
  status: string;
  createdAt: Date;
  followUpStartedAt: Date | null;
  /** Joined meeting ID: null for missing or foreign-plant provenance. */
  followUpMeetingId: string | null;
  completedAt: Date | null;
}

/** All top-level, undeleted follow-up obligations, tenant scoped. */
export function getFollowUpTaskOutcomes(
  churchId: string
): Promise<FollowUpTaskOutcome[]> {
  return followUpTaskOutcomesQuery(churchId);
}

export function followUpTaskOutcomesQuery(churchId: string) {
  return (
    db
      .select({
        status: tasks.status,
        createdAt: tasks.createdAt,
        followUpStartedAt: tasks.followUpStartedAt,
        followUpMeetingId: churchMeetings.id,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      // Keep historical/soft-deleted meetings as evidence; never join across plants.
      .leftJoin(
        churchMeetings,
        and(
          eq(tasks.followUpMeetingId, churchMeetings.id),
          eq(churchMeetings.churchId, churchId)
        )
      )
      .where(
        and(
          eq(tasks.churchId, churchId),
          eq(tasks.category, "follow_up"),
          isNull(tasks.parentTaskId),
          isNull(tasks.deletedAt)
        )
      )
  );
}

/** Matured obligations only: pending work under48h cannot count as failure. */
export function computeFollowUpTaskMetrics(
  rows: FollowUpTaskOutcome[],
  asOf: Date
) {
  let taskMeasurableCount = 0;
  let taskCompletedWithin48HoursCount = 0;
  let taskWaivedCount = 0;
  let taskUnmeasuredCount = 0;
  for (const row of rows) {
    if (row.createdAt > asOf) continue;
    if (row.status === "no_longer_needed") {
      taskWaivedCount++;
      continue;
    }
    if (
      row.followUpMeetingId === null ||
      row.followUpStartedAt === null ||
      !Number.isFinite(row.followUpStartedAt.getTime())
    ) {
      taskUnmeasuredCount++;
      continue;
    }
    const deadline = row.followUpStartedAt.getTime() + 48 * 60 * 60 * 1000;
    if (deadline > asOf.getTime()) continue;
    taskMeasurableCount++;
    if (
      row.status === "complete" &&
      row.completedAt !== null &&
      row.completedAt <= asOf &&
      row.completedAt.getTime() >= row.followUpStartedAt.getTime() &&
      row.completedAt.getTime() >= row.createdAt.getTime() &&
      row.completedAt.getTime() <= deadline
    )
      taskCompletedWithin48HoursCount++;
  }
  return {
    taskMeasurableCount,
    taskCompletedWithin48HoursCount,
    taskWaivedCount,
    taskUnmeasuredCount,
  };
}

/** Dated successful contact evidence only, never a profile edit timestamp. */
export function computeContactFreshness(
  rows: { lastContactAt?: Date | null }[],
  asOf: Date
) {
  const measured = rows.filter(
    (row) =>
      row.lastContactAt != null &&
      Number.isFinite(row.lastContactAt.getTime()) &&
      row.lastContactAt <= asOf
  );
  return {
    contactMeasuredCount: measured.length,
    contactRecentCount: measured.filter(
      (row) =>
        asOf.getTime() - row.lastContactAt!.getTime() < 14 * 24 * 60 * 60 * 1000
    ).length,
    contactUnknownCount: rows.length - measured.length,
  };
}
