import { db } from "@/db";
import {
  persons,
  type NewPerson,
  type Person,
  type PersonSource,
  type PersonStatus,
} from "@/db/schema";
import type {
  PersonCreateInput,
  PersonUpdateInput,
} from "@/lib/validations/people";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface ListPeopleOptions {
  cursor?: string;
  limit?: number; // default 25, max 100
  status?: PersonStatus[];
  source?: PersonSource[];
  search?: string;
  tagIds?: string[]; // Filter by tags (AND logic - person must have ALL tags)
  includeDeleted?: boolean;
}

export interface ListPeopleResult {
  people: Person[];
  total: number;
  nextCursor: string | null;
}

export interface GetPersonOptions {
  includeDeleted?: boolean;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single person by ID
 * Returns null if not found or if deleted (unless includeDeleted is true)
 */
export async function getPerson(
  churchId: string,
  personId: string,
  options: GetPersonOptions = {}
): Promise<Person | null> {
  const { includeDeleted = false } = options;

  const conditions = includeDeleted
    ? and(eq(persons.churchId, churchId), eq(persons.id, personId))
    : and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      );

  const result = await db.select().from(persons).where(conditions).limit(1);

  return result[0] ?? null;
}

/**
 * List people with cursor-based pagination
 * Excludes soft-deleted by default
 * Order by created_at desc
 */
export async function listPeople(
  churchId: string,
  options: ListPeopleOptions = {}
): Promise<ListPeopleResult> {
  const {
    cursor,
    limit = 25,
    status,
    source,
    search,
    tagIds,
    includeDeleted = false,
  } = options;

  // Clamp limit to max 100
  const safeLimit = Math.min(Math.max(1, limit), 100);

  // Build base conditions
  const baseConditions = [eq(persons.churchId, churchId)];

  // Exclude deleted unless requested
  if (!includeDeleted) {
    baseConditions.push(isNull(persons.deletedAt));
  }

  // Filter by status if provided
  if (status && status.length > 0) {
    baseConditions.push(inArray(persons.status, status));
  }

  // Filter by source if provided
  if (source && source.length > 0) {
    baseConditions.push(inArray(persons.source, source));
  }

  // Filter by search term if provided
  if (search) {
    const searchLike = `%${search}%`;
    const searchCondition = or(
      ilike(persons.firstName, searchLike),
      ilike(persons.lastName, searchLike),
      ilike(persons.email, searchLike),
      ilike(persons.phone, searchLike)
    );

    if (searchCondition) {
      baseConditions.push(searchCondition);
    }
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

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new person
 * Transforms empty string email to null
 */
export async function createPerson(
  churchId: string,
  userId: string,
  data: PersonCreateInput
): Promise<Person> {
  // Transform empty string email to null
  const email = data.email === "" ? null : data.email;

  const values: NewPerson = {
    churchId,
    createdBy: userId,
    firstName: data.firstName,
    lastName: data.lastName,
    email: email ?? null,
    phone: data.phone,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    state: data.state,
    postalCode: data.postalCode,
    country: data.country,
    status: data.status,
    source: data.source,
    sourceDetails: data.sourceDetails,
    notes: data.notes,
    householdId: data.householdId,
    householdRole: data.householdRole,
  };

  const [person] = await db.insert(persons).values(values).returning();

  return person;
}

/**
 * Update an existing person
 * Throws error if person not found or already deleted
 */
export async function updatePerson(
  churchId: string,
  personId: string,
  data: PersonUpdateInput
): Promise<Person> {
  // First check if person exists and is not deleted
  const existing = await getPerson(churchId, personId);

  if (!existing) {
    throw new Error("Person not found");
  }

  // Transform empty string email to null
  const updateData: Partial<NewPerson> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  // Only include fields that are provided
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.email !== undefined) {
    updateData.email = data.email === "" ? null : data.email;
  }
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.addressLine1 !== undefined)
    updateData.addressLine1 = data.addressLine1;
  if (data.addressLine2 !== undefined)
    updateData.addressLine2 = data.addressLine2;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.sourceDetails !== undefined)
    updateData.sourceDetails = data.sourceDetails;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.photoUrl !== undefined) updateData.photoUrl = data.photoUrl;
  if (data.householdId !== undefined) updateData.householdId = data.householdId;
  if (data.householdRole !== undefined)
    updateData.householdRole = data.householdRole;

  const [updated] = await db
    .update(persons)
    .set(updateData)
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update person");
  }

  return updated;
}

/**
 * Soft delete a person by setting deleted_at
 * Does not actually delete the row
 */
export async function deletePerson(
  churchId: string,
  personId: string
): Promise<void> {
  // First check if person exists and is not already deleted
  const existing = await getPerson(churchId, personId);

  if (!existing) {
    throw new Error("Person not found");
  }

  await db
    .update(persons)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    );
}

/**
 * Restore a soft-deleted person
 */
export async function restorePerson(
  churchId: string,
  personId: string
): Promise<Person> {
  const existing = await getPerson(churchId, personId, {
    includeDeleted: true,
  });

  if (!existing) {
    throw new Error("Person not found");
  }

  if (!existing.deletedAt) {
    throw new Error("Person is not deleted");
  }

  const [restored] = await db
    .update(persons)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(persons.churchId, churchId), eq(persons.id, personId)))
    .returning();

  if (!restored) {
    throw new Error("Failed to restore person");
  }

  return restored;
}
