import { db } from "@/db";
import { personActivities, users, type ActivityType } from "@/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  type ActivityWithPerformer,
  type GetActivitiesOptions,
} from "./activity.shared";

// Re-export shared types and functions for server-side use
export {
  formatActivityMessage,
  type ActivityWithPerformer,
  type GetActivitiesOptions,
  type GetActivitiesResult,
} from "./activity.shared";

/**
 * The one writer of person_activities rows — every timeline entry (notes,
 * tags, skills, assessments, household moves, status changes) goes through
 * here instead of a hand-rolled db.insert at each call site.
 */
export async function logPersonActivity(
  churchId: string,
  personId: string,
  activityType: ActivityType,
  metadata: Record<string, unknown>,
  performedBy: string
): Promise<void> {
  await db.insert(personActivities).values({
    churchId,
    personId,
    activityType,
    metadata,
    performedBy,
  });
}

export async function getActivities(
  churchId: string,
  personId: string,
  options: GetActivitiesOptions = {}
): Promise<{ activities: ActivityWithPerformer[]; nextCursor?: Date }> {
  const limit = options.limit || 20;
  const cursor = options.cursor;

  const whereClause = and(
    eq(personActivities.churchId, churchId),
    eq(personActivities.personId, personId),
    cursor ? lt(personActivities.createdAt, cursor) : undefined
  );

  const activities = await db
    .select({
      id: personActivities.id,
      churchId: personActivities.churchId,
      personId: personActivities.personId,
      activityType: personActivities.activityType,
      metadata: personActivities.metadata,
      performedBy: personActivities.performedBy,
      createdAt: personActivities.createdAt,
      performer: {
        name: users.name,
        email: users.email,
      },
    })
    .from(personActivities)
    .leftJoin(users, eq(personActivities.performedBy, users.id))
    .where(whereClause)
    .orderBy(desc(personActivities.createdAt))
    .limit(limit + 1); // Fetch one more to check for next page

  let nextCursor: Date | undefined = undefined;
  if (activities.length > limit) {
    const nextItem = activities.pop();
    nextCursor = nextItem?.createdAt;
  }

  return {
    activities,
    nextCursor,
  };
}
