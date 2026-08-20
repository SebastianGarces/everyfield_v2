import { db } from "@/db";
import {
  households,
  persons,
  type Household,
  type HouseholdRole,
  type NewHousehold,
  type Person,
} from "@/db/schema";
import type { HouseholdUpdateInput } from "@/lib/validations/people";
import { toPersonForClient, type PersonForClient } from "./types";
import { and, eq, isNull, sql } from "drizzle-orm";

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single household by ID
 */
export async function getHousehold(
  churchId: string,
  householdId: string
): Promise<Household | null> {
  const result = await db
    .select()
    .from(households)
    .where(
      and(eq(households.churchId, churchId), eq(households.id, householdId))
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * List all households for a church
 */
export async function listHouseholds(churchId: string): Promise<Household[]> {
  return db
    .select()
    .from(households)
    .where(eq(households.churchId, churchId))
    .orderBy(households.name);
}

/**
 * Get all members of a household
 * Returns only non-deleted members
 */
export async function getHouseholdMembers(
  churchId: string,
  householdId: string
): Promise<PersonForClient[]> {
  const members = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.householdId, householdId),
        isNull(persons.deletedAt)
      )
    )
    .orderBy(
      // Order by role: head first, then spouse, then others
      sql`CASE 
        WHEN ${persons.householdRole} = 'head' THEN 1 
        WHEN ${persons.householdRole} = 'spouse' THEN 2 
        WHEN ${persons.householdRole} = 'child' THEN 3 
        ELSE 4 
      END`,
      persons.firstName
    );

  // Drawn by `HouseholdMembers`, a client component (#378).
  return members.map(toPersonForClient);
}

/**
 * Get the count of members in a household
 */
export async function getHouseholdMemberCount(
  churchId: string,
  householdId: string
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.householdId, householdId),
        isNull(persons.deletedAt)
      )
    );

  return result?.count ?? 0;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Update an existing household
 */
export async function updateHousehold(
  churchId: string,
  householdId: string,
  data: HouseholdUpdateInput
): Promise<Household> {
  const existing = await getHousehold(churchId, householdId);

  if (!existing) {
    throw new Error("Household not found");
  }

  const updateData: Partial<NewHousehold> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.addressLine1 !== undefined)
    updateData.addressLine1 = data.addressLine1;
  if (data.addressLine2 !== undefined)
    updateData.addressLine2 = data.addressLine2;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
  if (data.country !== undefined) updateData.country = data.country;

  const [updated] = await db
    .update(households)
    .set(updateData)
    .where(
      and(eq(households.churchId, churchId), eq(households.id, householdId))
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update household");
  }

  return updated;
}

/**
 * Delete a household
 * Only allows deletion if the household has no members
 */
export async function deleteHousehold(
  churchId: string,
  householdId: string
): Promise<void> {
  const existing = await getHousehold(churchId, householdId);

  if (!existing) {
    throw new Error("Household not found");
  }

  // Check if household has any members
  const memberCount = await getHouseholdMemberCount(churchId, householdId);

  if (memberCount > 0) {
    throw new Error(
      "Cannot delete household with members. Remove all members first."
    );
  }

  await db
    .delete(households)
    .where(
      and(eq(households.churchId, churchId), eq(households.id, householdId))
    );
}

/**
 * Add a person to a household with a specific role.
 * If the person doesn't have an address but the household does,
 * the household's address will be copied to the person.
 */
export async function addToHousehold(
  churchId: string,
  personId: string,
  householdId: string,
  role: HouseholdRole
): Promise<PersonForClient> {
  // Verify household exists
  const household = await getHousehold(churchId, householdId);
  if (!household) {
    throw new Error("Household not found");
  }

  // Get the person to check if they have an address
  const person = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!person) {
    throw new Error("Person not found");
  }

  // Check if person lacks an address but household has one
  const personHasAddress = !!(
    person.addressLine1 ||
    person.city ||
    person.state ||
    person.postalCode
  );
  const householdHasAddress = !!(
    household.addressLine1 ||
    household.city ||
    household.state ||
    household.postalCode
  );

  // Build update data
  const updateData: Partial<Person> = {
    householdId,
    householdRole: role,
    updatedAt: new Date(),
  };

  // If person doesn't have address but household does, copy it
  if (!personHasAddress && householdHasAddress) {
    updateData.addressLine1 = household.addressLine1;
    updateData.addressLine2 = household.addressLine2;
    updateData.city = household.city;
    updateData.state = household.state;
    updateData.postalCode = household.postalCode;
    updateData.country = household.country;
  }

  // Update person with household assignment (and optionally address)
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

  return toPersonForClient(updated);
}

/**
 * Remove a person from their household
 */
export async function removeFromHousehold(
  churchId: string,
  personId: string
): Promise<PersonForClient> {
  const [updated] = await db
    .update(persons)
    .set({
      householdId: null,
      householdRole: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Person not found");
  }

  return toPersonForClient(updated);
}

/**
 * Propagate household address to all members
 * Copies the household's address fields to all members of the household
 */
export async function propagateAddress(
  churchId: string,
  householdId: string
): Promise<number> {
  const household = await getHousehold(churchId, householdId);

  if (!household) {
    throw new Error("Household not found");
  }

  // Update all members with the household address
  const result = await db
    .update(persons)
    .set({
      addressLine1: household.addressLine1,
      addressLine2: household.addressLine2,
      city: household.city,
      state: household.state,
      postalCode: household.postalCode,
      country: household.country,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.householdId, householdId),
        isNull(persons.deletedAt)
      )
    )
    .returning({ id: persons.id });

  return result.length;
}

/**
 * Build the two statements `createHouseholdWithHead` batches, exported so
 * tests can pin the rendered SQL (the create-church.test.ts precedent).
 *
 * The household INSERT is an `insert … select` sourced FROM the person row
 * itself: the person existence check IS the insert's row source, so a bad
 * personId (wrong tenant, soft-deleted, forged) selects zero rows and no
 * household is written — there is no pre-flight SELECT for a delete to slip
 * behind. With `usePersonAddress`, the person's address columns feed the
 * household's (empty strings become null, like the old skip-if-falsy build);
 * without it, the household gets no address, which is also why
 * `addToHousehold`'s copy-the-household-address branch stays collapsed:
 * a brand-new address-less household has nothing to copy back.
 *
 * drizzle's insert-from-select emits the FULL insertable column list in
 * table-definition order, so the select must supply every `households`
 * column, in that exact order.
 */
export function buildCreateHouseholdWithHeadStatements(
  churchId: string,
  personId: string,
  householdName: string,
  usePersonAddress: boolean,
  householdId: string
) {
  const personPredicate = and(
    eq(persons.churchId, churchId),
    eq(persons.id, personId),
    isNull(persons.deletedAt)
  );

  const insertHousehold = db
    .insert(households)
    .select((qb) =>
      qb
        .select({
          id: sql`${householdId}::uuid`,
          churchId: persons.churchId,
          name: sql`${householdName}`,
          addressLine1: usePersonAddress
            ? sql`nullif(${persons.addressLine1}, '')`
            : sql`null`,
          addressLine2: usePersonAddress
            ? sql`nullif(${persons.addressLine2}, '')`
            : sql`null`,
          city: usePersonAddress ? sql`nullif(${persons.city}, '')` : sql`null`,
          state: usePersonAddress
            ? sql`nullif(${persons.state}, '')`
            : sql`null`,
          postalCode: usePersonAddress
            ? sql`nullif(${persons.postalCode}, '')`
            : sql`null`,
          country: usePersonAddress
            ? sql`coalesce(${persons.country}, 'US')`
            : sql`${"US"}`,
          createdAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .from(persons)
        .where(personPredicate)
        .getSQL()
    )
    .returning();

  const updatePerson = db
    .update(persons)
    .set({
      householdId,
      householdRole: "head",
      updatedAt: new Date(),
    })
    .where(personPredicate)
    .returning();

  return { insertHousehold, updatePerson };
}

/**
 * Create a household and add the person as its head — in ONE `db.batch`, so
 * "created the household but failed to add the person" cannot leave an
 * orphan household row on EITHER address mode (ruling 410-4B, fix round 2).
 * This replaces the client's old two-action sequence (create, then add) and
 * the from-person two-write helper alike.
 *
 * `db.transaction()` throws on neon-http; both writes are known up front, so
 * the sanctioned shape is one `db.batch` (memory/invariants.md → Transactions
 * / Atomicity), with the household id minted here so the person update can
 * reference it in the same round trip. Zero rows back means the person was
 * not found — and nothing was written.
 */
export async function createHouseholdWithHead(
  churchId: string,
  personId: string,
  householdName: string,
  usePersonAddress: boolean
): Promise<{ household: Household; person: PersonForClient }> {
  const { insertHousehold, updatePerson } =
    buildCreateHouseholdWithHeadStatements(
      churchId,
      personId,
      householdName,
      usePersonAddress,
      crypto.randomUUID()
    );

  const [insertedHouseholds, updatedPersons] = await db.batch([
    insertHousehold,
    updatePerson,
  ]);

  const household = insertedHouseholds[0];
  const updatedPerson = updatedPersons[0];

  if (!household || !updatedPerson) {
    throw new Error("Person not found");
  }

  return { household, person: toPersonForClient(updatedPerson) };
}
