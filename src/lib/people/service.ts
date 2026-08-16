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
import { logPersonActivity } from "./activity";
import { emitPersonCreated } from "./events";
import type { PersonCreationSource } from "./types";

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
 */
export interface PeopleFilterOptions {
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[]; // Filter by tags (AND logic - person must have ALL tags)
  includeDeleted?: boolean;
  search?: string;
}

/**
 * The one place the people filter predicate list (tenant scope, soft-delete,
 * status, source, text search, tag-count subquery) is built.
 */
export function buildPeopleConditions(
  churchId: string,
  options: PeopleFilterOptions = {}
): SQL[] {
  const { status, source, tagIds, includeDeleted = false, search } = options;

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

  // Filter by search term if provided
  if (search && search.trim().length > 0) {
    const textSearch = peopleTextSearch(search);
    if (textSearch) {
      conditions.push(textSearch);
    }
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
 * The ONE people text predicate (ruling 410-1B): case-insensitive match over
 * first name, last name, email, phone, PLUS the concatenated full name so
 * "Jane Smith" matches across first/last. Every text search (list, export,
 * recipient pickers) goes through `buildPeopleConditions`, which calls this.
 */
export function peopleTextSearch(search: string): SQL | undefined {
  const searchLike = `%${search.trim()}%`;
  return or(
    ilike(persons.firstName, searchLike),
    ilike(persons.lastName, searchLike),
    ilike(persons.email, searchLike),
    ilike(persons.phone, searchLike),
    // Search full name (first + last)
    sql`concat(${persons.firstName}, ' ', ${persons.lastName}) ilike ${searchLike}`
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
    search,
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
    search,
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
 *
 * CHURCH-SCOPED, AND THE SCOPE IS NOT DECORATION (#411). `personId` reaches
 * this function from `tasks.related_id`, which is a client-supplied uuid: the
 * task create action takes `relatedType: "person"` and any uuid beside it, so
 * `/tasks` could be made to render another tenant's note by creating a task
 * that points at their person. `person_activities` carries no `church_id` of
 * its own, so the scope has to come through the person row — which is why this
 * joins rather than filtering. A person outside `churchId` reads as "no note",
 * the same answer a person with no notes gets (`memory/invariants.md` →
 * Multi-Tenancy: isolation is application-layer, and this predicate IS the
 * boundary).
 */
export async function getLatestPersonNote(
  churchId: string,
  personId: string
): Promise<{
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
    .innerJoin(persons, eq(persons.id, personActivities.personId))
    .where(
      and(
        eq(personActivities.personId, personId),
        eq(personActivities.activityType, "note_added"),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
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
 *
 * Every creation path (full form, quick add, bulk import, meeting guest
 * flows) goes through here, so this is also the ONE place the
 * `person_created` timeline entry is written (ruling 410-2A).
 * `activitySource` names the path in the activity metadata — a closed union
 * with NO default, so a new creation path that forgets to name itself is a
 * compile error, not a silent "form" label.
 */
export async function createPerson(
  churchId: string,
  userId: string,
  data: PersonCreateInput,
  activitySource: PersonCreationSource
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
    backgroundCheckStatus: data.backgroundCheckStatus,
    source: data.source,
    sourceDetails: data.sourceDetails,
    notes: data.notes,
    householdId: data.householdId,
    householdRole: data.householdRole,
  };

  const [person] = await db.insert(persons).values(values).returning();

  await emitPersonCreated(person);

  await logPersonActivity({
    churchId,
    personId: person.id,
    activityType: "person_created",
    metadata: { source: activitySource },
    performedBy: userId,
  });

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
  if (data.backgroundCheckStatus !== undefined)
    updateData.backgroundCheckStatus = data.backgroundCheckStatus;
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
