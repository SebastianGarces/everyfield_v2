import { db } from "@/db";
import { personActivities, users } from "@/db/schema";
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
