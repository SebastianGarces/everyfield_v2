import { db } from "@/db";
import { personActivities, personTags, tags } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { Tag } from "./types";

/**
 * List all tags for a church
 */
export async function listTags(churchId: string): Promise<Tag[]> {
  return db.query.tags.findMany({
    where: eq(tags.churchId, churchId),
    orderBy: (tags, { asc }) => [asc(tags.name)],
  });
}

/**
 * Get tags for a specific person
 */
export async function getPersonTags(
  churchId: string,
  personId: string
): Promise<Tag[]> {
  const results = await db
    .select({
      id: tags.id,
      churchId: tags.churchId,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
    })
    .from(tags)
    .innerJoin(personTags, eq(tags.id, personTags.tagId))
    .where(and(eq(tags.churchId, churchId), eq(personTags.personId, personId)));

  return results;
}

/**
 * Create a new tag
 */
export async function createTag(
  churchId: string,
  name: string,
  color?: string | null
): Promise<Tag> {
  const [tag] = await db
    .insert(tags)
    .values({
      churchId,
      name,
      color,
    })
    .returning();

  return tag;
}

/**
 * Assign a tag to a person
 */
export async function assignTag(
  churchId: string,
  personId: string,
  tagId: string,
  userId: string
): Promise<void> {
  // Check if tag exists and belongs to church
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.churchId, churchId)),
  });

  if (!tag) {
    throw new Error("Tag not found");
  }

  // Assign tag
  await db
    .insert(personTags)
    .values({
      churchId,
      personId,
      tagId,
    })
    .onConflictDoNothing();

  // Record activity
  await db.insert(personActivities).values({
    churchId,
    personId,
    activityType: "tag_added",
    metadata: {
      tagId: tag.id,
      tagName: tag.name,
      tagColor: tag.color,
    },
    performedBy: userId,
  });
}

/**
 * Remove a tag from a person
 */
export async function removeTag(
  churchId: string,
  personId: string,
  tagId: string,
  userId: string
): Promise<void> {
  // Get tag info for activity log
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.churchId, churchId)),
  });

  if (!tag) {
    // If tag doesn't exist, just return (maybe it was already deleted)
    return;
  }

  // Remove tag
  await db
    .delete(personTags)
    .where(
      and(
        eq(personTags.churchId, churchId),
        eq(personTags.personId, personId),
        eq(personTags.tagId, tagId)
      )
    );

  // Record activity
  await db.insert(personActivities).values({
    churchId,
    personId,
    activityType: "tag_removed",
    metadata: {
      tagId: tag.id,
      tagName: tag.name,
      tagColor: tag.color,
    },
    performedBy: userId,
  });
}

/**
 * Delete a tag completely
 */
export async function deleteTag(
  churchId: string,
  tagId: string
): Promise<void> {
  await db
    .delete(tags)
    .where(and(eq(tags.churchId, churchId), eq(tags.id, tagId)));
}

/**
 * Get a single tag by ID (scoped to church)
 */
export async function getTag(
  churchId: string,
  tagId: string
): Promise<Tag | null> {
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.churchId, churchId), eq(tags.id, tagId)),
  });

  return tag ?? null;
}

/**
 * Update a tag
 */
export async function updateTag(
  churchId: string,
  tagId: string,
  data: { name?: string; color?: string }
): Promise<Tag> {
  const [updated] = await db
    .update(tags)
    .set(data)
    .where(and(eq(tags.churchId, churchId), eq(tags.id, tagId)))
    .returning();

  if (!updated) {
    throw new Error("Tag not found");
  }

  return updated;
}

/**
 * Check if a tag is currently assigned to any person
 * Useful for showing warnings before deletion
 */
export async function isTagInUse(
  churchId: string,
  tagId: string
): Promise<boolean> {
  const result = await db.query.personTags.findFirst({
    where: and(eq(personTags.churchId, churchId), eq(personTags.tagId, tagId)),
    columns: { id: true },
  });

  return !!result;
}

/**
 * Get tags for multiple people in a single query (for list views)
 * Returns a map of personId -> Tag[]
 */
export async function getTagsForPeople(
  churchId: string,
  personIds: string[]
): Promise<Map<string, Tag[]>> {
  if (personIds.length === 0) {
    return new Map();
  }

  const results = await db
    .select({
      personId: personTags.personId,
      tag: {
        id: tags.id,
        churchId: tags.churchId,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
      },
    })
    .from(personTags)
    .innerJoin(tags, eq(personTags.tagId, tags.id))
    .where(
      and(
        eq(personTags.churchId, churchId),
        inArray(personTags.personId, personIds)
      )
    )
    .orderBy(tags.name);

  // Group by personId
  const tagMap = new Map<string, Tag[]>();
  for (const row of results) {
    const existing = tagMap.get(row.personId) ?? [];
    existing.push(row.tag);
    tagMap.set(row.personId, existing);
  }

  return tagMap;
}
