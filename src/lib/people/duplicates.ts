import { db } from "@/db";
import { persons, type Person } from "@/db/schema";
import { and, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { getTagsForPeople } from "./tags";
import type { DuplicateCheck } from "./types";

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
  const baseConditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];

  if (excludePersonId) {
    baseConditions.push(ne(persons.id, excludePersonId));
  }

  // 1. Check for exact email match
  let exactRow: Person | null = null;
  const normalizedEmail = input.email?.trim().toLowerCase();
  if (normalizedEmail && normalizedEmail !== "") {
    const emailMatches = await db
      .select()
      .from(persons)
      .where(and(...baseConditions, ilike(persons.email, normalizedEmail)))
      .limit(1);

    exactRow = emailMatches[0] ?? null;
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

  let fuzzyRows: Person[] = [];
  if (fuzzyConditions.length > 0) {
    fuzzyRows = await db
      .select()
      .from(persons)
      .where(
        and(
          ...baseConditions,
          // Exclude the exact match from potential matches
          exactRow ? ne(persons.id, exactRow.id) : undefined,
          or(...fuzzyConditions)
        )
      )
      .limit(5);
  }

  // 3. Resolve tags for every match with ONE batched query — the canonical
  // helper in tags.ts — instead of a per-match round trip.
  const tagMap = await getTagsForPeople(churchId, [
    ...(exactRow ? [exactRow.id] : []),
    ...fuzzyRows.map((m) => m.id),
  ]);

  return {
    exactMatch: exactRow
      ? { ...exactRow, tags: tagMap.get(exactRow.id) ?? [] }
      : null,
    potentialMatches: fuzzyRows.map((match) => ({
      ...match,
      tags: tagMap.get(match.id) ?? [],
    })),
  };
}
