import { db } from "@/db";
import { persons } from "@/db/schema";
import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { duplicatePredicates } from "./duplicate-match";
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

  const match = duplicatePredicates(
    {
      email: sql`${persons.email}`,
      firstName: sql`${persons.firstName}`,
      lastName: sql`${persons.lastName}`,
      phone: sql`${persons.phone}`,
    },
    {
      email: sql`${input.email ?? null}`,
      firstName: sql`${input.firstName ?? null}`,
      lastName: sql`${input.lastName ?? null}`,
      phone: sql`${input.phone ?? null}`,
    }
  );
  const [exactRow = null] = await db
    .select()
    .from(persons)
    .where(and(...baseConditions, match.email))
    .orderBy(asc(persons.id))
    .limit(1);
  const fuzzyRows = await db
    .select()
    .from(persons)
    .where(
      and(
        ...baseConditions,
        exactRow ? ne(persons.id, exactRow.id) : undefined,
        or(match.name, match.phone)
      )
    )
    .orderBy(asc(persons.id))
    .limit(5);

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

/** Stable pair ordering and bounded pages, without leaking account/photo keys. */
export async function listDuplicatePairs(
  churchId: string,
  after?: string,
  personId?: string
) {
  const other = alias(persons, "duplicate_person");
  const match = duplicatePredicates(
    {
      email: sql`${persons.email}`,
      firstName: sql`${persons.firstName}`,
      lastName: sql`${persons.lastName}`,
      phone: sql`${persons.phone}`,
    },
    {
      email: sql`${other.email}`,
      firstName: sql`${other.firstName}`,
      lastName: sql`${other.lastName}`,
      phone: sql`${other.phone}`,
    }
  );
  const key = sql<string>`${persons.id}::text || '/' || ${other.id}::text`;
  const rows = await db
    .select({
      left: persons,
      right: other,
      email: sql<boolean>`coalesce(${match.email}, false)`,
      name: sql<boolean>`coalesce(${match.name}, false)`,
      phone: sql<boolean>`coalesce(${match.phone}, false)`,
      key,
    })
    .from(persons)
    .innerJoin(
      other,
      and(
        eq(other.churchId, churchId),
        isNull(other.deletedAt),
        gt(other.id, persons.id),
        match.any
      )
    )
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        after ? gt(key, after) : undefined,
        personId
          ? or(eq(persons.id, personId), eq(other.id, personId))
          : undefined
      )
    )
    .orderBy(asc(persons.id), asc(other.id))
    .limit(26);
  const page = rows.slice(0, 25);
  return {
    pairs: page.map(({ left, right, ...row }) => ({
      ...row,
      left: toPersonForClient(left),
      right: toPersonForClient(right),
    })),
    next: rows.length > 25 ? page.at(-1)!.key : null,
  };
}
