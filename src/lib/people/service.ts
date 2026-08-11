import { db } from "@/db";
import {
  personActivities,
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
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { cache } from "react";
import { emitPersonCreated } from "./events";

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
 *
 * Wrapped in React.cache() (the getCurrentSession precedent —
 * memory/invariants.md → Request Deduplication) so the [id] layout and the
 * page under it, which both need the same row every navigation, issue one
 * query per request instead of two.
 */
export const getPerson = cache(
  async (
    churchId: string,
    personId: string,
    options: GetPersonOptions = {}
  ): Promise<Person | null> => {
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
);

/**
 * Assert that `personId` names a live person in `churchId`.
 *
 * The guard person-scoped actions call before writing rows (or uploading
 * files) stamped with the caller's church: a client-supplied personId from
 * another tenant must fail here, never surface as a cross-tenant write.
 * Throws the "Person not found" the rest of the domain already maps to its
 * standard error message.
 */
export async function assertPersonInChurch(
  churchId: string,
  personId: string
): Promise<void> {
  const person = await getPerson(churchId, personId);
  if (!person) {
    throw new Error("Person not found");
  }
}

// ============================================================================
// Shared Filter & Cursor Building Blocks
// ============================================================================

/**
 * Filters shared by the people list, search and export queries.
 *
 * `textSearch` is passed IN as a predicate rather than derived here — the
 * list/export use a four-column ilike while the search adds a concatenated
 * full-name column, and this keeps those different behaviors with ONE
 * condition builder.
 */
export interface PeopleFilterOptions {
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[]; // Filter by tags (AND logic - person must have ALL tags)
  includeDeleted?: boolean;
  textSearch?: SQL;
}

/**
 * The one place the people filter predicate list (tenant scope, soft-delete,
 * status, source, text search, tag-count subquery) is built.
 */
export function buildPeopleConditions(
  churchId: string,
  options: PeopleFilterOptions = {}
): SQL[] {
  const {
    status,
    source,
    tagIds,
    includeDeleted = false,
    textSearch,
  } = options;

  const conditions: SQL[] = [eq(persons.churchId, churchId)];

  // Exclude deleted unless requested
  if (!includeDeleted) {
    conditions.push(isNull(persons.deletedAt));
  }

  // Filter by status if provided
  if (status && status.length > 0) {
    conditions.push(inArray(persons.status, status));
  }

  // Filter by source if provided
  if (source && source.length > 0) {
    conditions.push(inArray(persons.source, source));
  }

  // Filter by search term if provided (predicate built by the caller)
  if (textSearch) {
    conditions.push(textSearch);
  }

  // Filter by tags (AND logic - person must have ALL specified tags):
  // a subquery counts the matching tags and requires it to equal the number
  // of requested tags
  if (tagIds && tagIds.length > 0) {
    conditions.push(sql`(
      SELECT COUNT(DISTINCT pt.tag_id)::int
      FROM person_tags pt
      WHERE pt.person_id = ${persons.id}
        AND pt.church_id = ${churchId}
        AND pt.tag_id IN (${sql.join(
          tagIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})
    ) = ${tagIds.length}`);
  }

  return conditions;
}

/**
 * The list/export text predicate: case-insensitive match over first name,
 * last name, email and phone.
 */
function listTextSearch(search: string): SQL | undefined {
  const searchLike = `%${search}%`;
  return or(
    ilike(persons.firstName, searchLike),
    ilike(persons.lastName, searchLike),
    ilike(persons.email, searchLike),
    ilike(persons.phone, searchLike)
  );
}

/**
 * The one `(created_at, id)` cursor pagination implementation: counts the
 * filtered set, resolves the cursor id to its `created_at` (scoped to
 * churchId so a cursor cannot be aimed across tenants), fetches one extra
 * row to detect more results, and returns the next cursor.
 */
export async function paginatePeopleByCreatedAtCursor(
  churchId: string,
  baseConditions: SQL[],
  cursor: string | undefined,
  limit: number
): Promise<ListPeopleResult> {
  // Clamp limit to max 100
  const safeLimit = Math.min(Math.max(1, limit), 100);

  // Get total count (without pagination)
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(persons)
    .where(and(...baseConditions));

  const total = countResult?.count ?? 0;

  // Build query conditions with cursor
  const queryConditions = [...baseConditions];
  if (cursor) {
    // Cursor is the last person's id — resolve its createdAt for comparison.
    // IMPORTANT: Scope cursor lookup to churchId to prevent cross-tenant
    // cursor manipulation
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

  const conditions = buildPeopleConditions(churchId, {
    status,
    source,
    tagIds,
    includeDeleted,
    textSearch: search ? listTextSearch(search) : undefined,
  });

  return paginatePeopleByCreatedAtCursor(churchId, conditions, cursor, limit);
}

/**
 * Filters for the people export. Mirrors the list filters (status, source,
 * search, tags) but without pagination — every matching person is returned.
 */
export interface ExportPeopleOptions {
  status?: PersonStatus[];
  source?: PersonSource[];
  search?: string;
  tagIds?: string[];
  includeDeleted?: boolean;
}

/**
 * Fetch ALL people for a church matching the given filters, for CSV export.
 *
 * Scoped to churchId (tenancy invariant) and excludes soft-deleted by default.
 * No pagination: this is intended for export, where the full filtered set is
 * needed. Reuses the same filter semantics as {@link listPeople}.
 */
export async function getPeopleForExport(
  churchId: string,
  options: ExportPeopleOptions = {}
): Promise<Person[]> {
  const { status, source, search, tagIds, includeDeleted = false } = options;

  const conditions = buildPeopleConditions(churchId, {
    status,
    source,
    tagIds,
    includeDeleted,
    textSearch: search ? listTextSearch(search) : undefined,
  });

  return db
    .select()
    .from(persons)
    .where(and(...conditions))
    .orderBy(desc(persons.createdAt), desc(persons.id));
}

// ============================================================================
// Note Queries
// ============================================================================

/**
 * Get the latest note for a person from person_activities.
 * Returns the note text and metadata, or null if no notes exist.
 */
export async function getLatestPersonNote(personId: string): Promise<{
  note: string;
  meetingId?: string;
  meetingType?: string;
  createdAt: Date;
} | null> {
  const [row] = await db
    .select({
      metadata: personActivities.metadata,
      createdAt: personActivities.createdAt,
    })
    .from(personActivities)
    .where(
      and(
        eq(personActivities.personId, personId),
        eq(personActivities.activityType, "note_added")
      )
    )
    .orderBy(desc(personActivities.createdAt))
    .limit(1);

  if (!row) return null;

  const meta = row.metadata as Record<string, unknown> | null;
  const noteText = (meta?.note as string) ?? (meta?.content as string) ?? "";

  if (!noteText) return null;

  return {
    note: noteText,
    meetingId: meta?.meetingId as string | undefined,
    meetingType: meta?.meetingType as string | undefined,
    createdAt: row.createdAt,
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

  await emitPersonCreated(person);

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
