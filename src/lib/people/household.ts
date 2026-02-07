import { db } from "@/db";
import {
  households,
  persons,
  type Household,
  type HouseholdRole,
  type NewHousehold,
  type Person,
} from "@/db/schema";
import type {
  HouseholdCreateInput,
  HouseholdUpdateInput,
} from "@/lib/validations/people";
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
): Promise<Person[]> {
  return db
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
 * Create a new household
 */
export async function createHousehold(
  churchId: string,
  data: HouseholdCreateInput
): Promise<Household> {
  const values: NewHousehold = {
    churchId,
    name: data.name,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    state: data.state,
    postalCode: data.postalCode,
    country: data.country,
  };

  const [household] = await db.insert(households).values(values).returning();

  return household;
}

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
): Promise<Person> {
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

  return updated;
}

/**
 * Remove a person from their household
 */
export async function removeFromHousehold(
  churchId: string,
  personId: string
): Promise<Person> {
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

  return updated;
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
 * Create a household from a person's current address
 * Automatically adds the person as the head of the household
 */
export async function createHouseholdFromPerson(
  churchId: string,
  personId: string,
  householdName: string
): Promise<{ household: Household; person: Person }> {
  // Get the person
  const [person] = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);

  if (!person) {
    throw new Error("Person not found");
  }

  // Build household data from person's address, only including defined values
  const householdData: HouseholdCreateInput = {
    name: householdName,
    country: person.country ?? "US",
  };
  if (person.addressLine1) householdData.addressLine1 = person.addressLine1;
  if (person.addressLine2) householdData.addressLine2 = person.addressLine2;
  if (person.city) householdData.city = person.city;
  if (person.state) householdData.state = person.state;
  if (person.postalCode) householdData.postalCode = person.postalCode;

  // Create household with person's address
  const household = await createHousehold(churchId, householdData);

  // Add person to household as head
  const updatedPerson = await addToHousehold(
    churchId,
    personId,
    household.id,
    "head"
  );

  return { household, person: updatedPerson };
}
