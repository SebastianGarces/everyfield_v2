import { db } from "@/db";
import {
  persons,
  type Person,
  type PersonSource,
  type PersonStatus,
} from "@/db/schema";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface SearchPeopleParams {
  query?: string; // Search in name, email, phone
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[]; // Filter by tags (AND logic - person must have ALL tags)
  cursor?: string;
  limit?: number; // default 25, max 100
}

export interface SearchPeopleResult {
  people: Person[];
  total: number;
  nextCursor: string | null;
}

// ============================================================================
// Search
// ============================================================================

/**
 * Search people with filters
 * - query: searches first_name, last_name, email, phone (case-insensitive)
 * - status: filter by status (multi-select)
 * - source: filter by source (multi-select)
 * - Excludes soft-deleted records
 *
 * Uses cursor-based pagination with (created_at, id) tuple for stable ordering.
 */
export async function searchPeople(
  churchId: string,
  params: SearchPeopleParams = {}
): Promise<SearchPeopleResult> {
  const { query, status, source, tagIds, cursor, limit = 25 } = params;

  // Clamp limit to max 100
  const safeLimit = Math.min(Math.max(1, limit), 100);

  // Build base conditions
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(persons.churchId, churchId),
  ];

  // Always exclude deleted
  baseConditions.push(isNull(persons.deletedAt));

  // Text search condition
  if (query && query.trim().length > 0) {
    const searchTerm = query.trim();
    const searchPattern = `%${searchTerm}%`;

    const searchCondition = or(
      ilike(persons.firstName, searchPattern),
      ilike(persons.lastName, searchPattern),
      ilike(persons.email, searchPattern),
      ilike(persons.phone, searchPattern),
      // Search full name (first + last)
      sql`concat(${persons.firstName}, ' ', ${persons.lastName}) ilike ${searchPattern}`
    );

    if (searchCondition) {
      baseConditions.push(searchCondition);
    }
  }

  // Filter by status if provided
  if (status && status.length > 0) {
    baseConditions.push(inArray(persons.status, status));
  }

  // Filter by source if provided
  if (source && source.length > 0) {
    baseConditions.push(inArray(persons.source, source));
  }

  // Filter by tags (AND logic - person must have ALL specified tags)
  if (tagIds && tagIds.length > 0) {
    // Using a subquery to find people who have ALL the specified tags
    // This counts the matching tags and ensures it equals the number of requested tags
    const tagSubquery = sql`(
      SELECT COUNT(DISTINCT pt.tag_id)::int 
      FROM person_tags pt 
      WHERE pt.person_id = ${persons.id} 
        AND pt.church_id = ${churchId}
        AND pt.tag_id IN (${sql.join(
          tagIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})
    ) = ${tagIds.length}`;
    baseConditions.push(tagSubquery);
  }

  // Get total count (without pagination)
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(persons)
    .where(and(...baseConditions));

  const total = countResult?.count ?? 0;

  // Build query conditions with cursor
  const queryConditions = [...baseConditions];
  if (cursor) {
    // Cursor is the last person's id
    // We need to get that person's createdAt to use for comparison
    // IMPORTANT: Scope cursor lookup to churchId to prevent cross-tenant cursor manipulation
    const cursorPerson = await db
      .select({ createdAt: persons.createdAt })
      .from(persons)
      .where(and(eq(persons.id, cursor), eq(persons.churchId, churchId)))
      .limit(1);

    if (cursorPerson[0]) {
      // Get people created before or at the same time but with a different id
      // Using (created_at, id) as a stable cursor
      queryConditions.push(
        sql`(${persons.createdAt}, ${persons.id}) < (${cursorPerson[0].createdAt}, ${cursor})`
      );
    }
  }

  // Fetch one extra to determine if there are more results
  const people = await db
    .select()
    .from(persons)
    .where(and(...queryConditions))
    .orderBy(desc(persons.createdAt), desc(persons.id))
    .limit(safeLimit + 1);

  // Determine if there are more results
  const hasMore = people.length > safeLimit;
  const resultPeople = hasMore ? people.slice(0, safeLimit) : people;
  const nextCursor = hasMore
    ? (resultPeople[resultPeople.length - 1]?.id ?? null)
    : null;

  return {
    people: resultPeople,
    total,
    nextCursor,
  };
}
