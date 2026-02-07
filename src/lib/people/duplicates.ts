import { db } from "@/db";
import { persons, personTags, tags, type Tag } from "@/db/schema";
import { and, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DuplicateCheck, PersonWithTags } from "./types";

/**
 * Check for duplicate persons in a church
 *
 * - Exact match: same email address (case-insensitive)
 * - Potential match: similar name AND/OR last 4 digits of phone match
 */
export async function checkForDuplicates(
  churchId: string,
  input: {
    email?: string | null;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
  },
  excludePersonId?: string
): Promise<DuplicateCheck> {
  let exactMatch: PersonWithTags | null = null;
  const potentialMatches: PersonWithTags[] = [];

  const baseConditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];

  if (excludePersonId) {
    baseConditions.push(ne(persons.id, excludePersonId));
  }

  // 1. Check for exact email match
  const normalizedEmail = input.email?.trim().toLowerCase();
  if (normalizedEmail && normalizedEmail !== "") {
    const emailMatches = await db
      .select()
      .from(persons)
      .where(and(...baseConditions, ilike(persons.email, normalizedEmail)))
      .limit(1);

    if (emailMatches[0]) {
      const personTags_ = await getPersonTags(churchId, emailMatches[0].id);
      exactMatch = { ...emailMatches[0], tags: personTags_ };
    }
  }

  // 2. Check for potential matches (fuzzy name + phone)
  const fuzzyConditions: ReturnType<typeof ilike>[] = [];

  // Name match: same first AND last name (case-insensitive)
  if (input.firstName && input.lastName) {
    const nameMatch = and(
      ilike(persons.firstName, input.firstName.trim()),
      ilike(persons.lastName, input.lastName.trim())
    );
    if (nameMatch) {
      fuzzyConditions.push(nameMatch);
    }
  }

  // Phone match: last 4 digits
  const normalizedPhone = input.phone?.replace(/\D/g, "");
  if (normalizedPhone && normalizedPhone.length >= 4) {
    const last4 = normalizedPhone.slice(-4);
    fuzzyConditions.push(
      sql`RIGHT(REGEXP_REPLACE(${persons.phone}, '[^0-9]', '', 'g'), 4) = ${last4}`
    );
  }

  if (fuzzyConditions.length > 0) {
    const fuzzyMatches = await db
      .select()
      .from(persons)
      .where(
        and(
          ...baseConditions,
          // Exclude the exact match from potential matches
          exactMatch ? ne(persons.id, exactMatch.id) : undefined,
          or(...fuzzyConditions)
        )
      )
      .limit(5);

    for (const match of fuzzyMatches) {
      const matchTags = await getPersonTags(churchId, match.id);
      potentialMatches.push({ ...match, tags: matchTags });
    }
  }

  return { exactMatch, potentialMatches };
}

/**
 * Helper: get tags for a person
 */
async function getPersonTags(
  churchId: string,
  personId: string
): Promise<Tag[]> {
  const rows = await db
    .select({
      id: tags.id,
      churchId: tags.churchId,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
    })
    .from(personTags)
    .innerJoin(tags, eq(personTags.tagId, tags.id))
    .where(and(eq(personTags.personId, personId), eq(tags.churchId, churchId)));

  return rows;
}
