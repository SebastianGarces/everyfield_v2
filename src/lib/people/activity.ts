import { db } from "@/db";
import { personActivities, users, type ActivityType } from "@/db/schema";
import { and, desc, eq, lt, type SQL } from "drizzle-orm";
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
 *
 * Takes a single named-field object: three of the fields are interchangeable
 * UUID strings, and positional slots let a transposed churchId/personId/
 * performedBy type-check silently while writing a corrupt timeline row.
 */
export async function logPersonActivity(entry: {
  churchId: string;
  personId: string;
  activityType: ActivityType;
  metadata: Record<string, unknown>;
  performedBy: string;
}): Promise<void> {
  await db.insert(personActivities).values(entry);
}

/**
 * THE PREDICATE THAT SAYS "THIS NOTE IS YOURS TO CHANGE" (P-010e).
 *
 * Four terms, and every one of them is load-bearing:
 *
 *  - the id, which is a value the CLIENT chose;
 *  - the church, which is therefore the tenancy boundary — without it an
 *    `activityId` from another plant matches;
 *  - `note_added`, so a status change or a tag entry cannot be rewritten
 *    through the note endpoints;
 *  - the performer, because a note is its author's sentence.
 *
 * Declared once because the edit and the delete must not be able to disagree
 * about who may act: a second copy is a second place to forget the church term.
 * A row that does not match reads as MISSING, which is the same answer a
 * deleted note gets.
 */
export function authoredNoteCondition(
  churchId: string,
  activityId: string,
  userId: string
): SQL {
  return and(
    eq(personActivities.id, activityId),
    eq(personActivities.churchId, churchId),
    eq(personActivities.activityType, "note_added"),
    eq(personActivities.performedBy, userId)
  )!;
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
