import { db } from "@/db";
import { persons, type Person } from "@/db/schema";
import { and, asc, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { literalCaseInsensitiveDuplicateMatch } from "./duplicate-match";
import { getTagsForPeople } from "./tags";
import {
  toPersonForClient,
  type DuplicateCheck,
  type DuplicateMatches,
} from "./types";

/**
 * Find duplicate persons in a church — the two SELECTs, nothing more.
 *
 * - Exact match: same email address (case-insensitive)
 * - Potential match: similar name AND/OR last 4 digits of phone match
 *
 * The import preview calls this directly (ruling 410-3C): it only needs
 * `id` + name to explain a match, so it never pays for the tag join that
 * `checkForDuplicates` adds for the quick-add dialog.
 */
export async function findDuplicateMatches(
  churchId: string,
  input: {
    email?: string | null;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
  },
  excludePersonId?: string
): Promise<DuplicateMatches> {
  const baseConditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];

  if (excludePersonId) {
    baseConditions.push(ne(persons.id, excludePersonId));
  }

  // 1. Check for exact email match
  let exactRow: Person | null = null;
  const normalizedEmail = input.email?.trim();
  if (normalizedEmail && normalizedEmail !== "") {
    const emailMatches = await db
      .select()
      .from(persons)
      .where(
        and(
          ...baseConditions,
          literalCaseInsensitiveDuplicateMatch(persons.email, normalizedEmail)
        )
      )
      .orderBy(asc(persons.id))
      .limit(1);

    exactRow = emailMatches[0] ?? null;
  }

  // 2. Check for potential matches (fuzzy name + phone)
  const fuzzyConditions: SQL[] = [];

  // Name match: same first AND last name (case-insensitive)
  if (input.firstName && input.lastName) {
    const nameMatch = and(
      literalCaseInsensitiveDuplicateMatch(persons.firstName, input.firstName),
      literalCaseInsensitiveDuplicateMatch(persons.lastName, input.lastName)
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
      .orderBy(asc(persons.id))
      .limit(5);
  }

  return { exactMatch: exactRow, potentialMatches: fuzzyRows };
}

/**
 * Find duplicates and decorate every match with its tags — for the
 * quick-add dialog (`checkForDuplicatesAction`), the one consumer that
 * renders them. Tag resolution is ONE batched query via the canonical
 * helper in tags.ts, not a per-match round trip.
 *
 * The decoration goes THROUGH the strip rather than around it (#378). Spreading
 * a full row into a value typed `PersonWithTags` is what shipped the account
 * link to the browser the first time: `Person` is structurally assignable to
 * the narrow type, so the spread compiled and the object carried `user_id`
 * into the dialog while the signature said it could not.
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
  const { exactMatch, potentialMatches } = await findDuplicateMatches(
    churchId,
    input,
    excludePersonId
  );

  const tagMap = await getTagsForPeople(churchId, [
    ...(exactMatch ? [exactMatch.id] : []),
    ...potentialMatches.map((m) => m.id),
  ]);

  return {
    exactMatch: exactMatch
      ? toPersonForClient({
          ...exactMatch,
          tags: tagMap.get(exactMatch.id) ?? [],
        })
      : null,
    potentialMatches: potentialMatches.map((match) =>
      toPersonForClient({ ...match, tags: tagMap.get(match.id) ?? [] })
    ),
  };
}
