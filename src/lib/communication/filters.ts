// ============================================================================
// Communication History Filters
// ============================================================================
//
// Pure `where`-clause construction for the message history query. Kept apart
// from `service.ts` so it can be unit-tested without a database connection
// (service.ts pulls in the db client, Resend and the email renderer).
// ============================================================================

import { and, eq, ilike, or, type SQL } from "drizzle-orm";

import { communications } from "@/db/schema/communication";
import type { CommunicationFilters } from "@/lib/validations/communication";

export type CommunicationQueryFilters = Partial<
  Pick<CommunicationFilters, "channel" | "status" | "search">
>;

/**
 * Escape the LIKE metacharacters so a search for "50%" means the literal
 * characters, not "anything". Postgres LIKE uses backslash as the default
 * escape character, so no ESCAPE clause is needed.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Build the tenant-scoped `where` clause for a communications query.
 * The church scope is always applied first — filters narrow, never widen.
 */
export function buildCommunicationsWhere(
  churchId: string,
  filters: CommunicationQueryFilters = {}
): SQL {
  const conditions: SQL[] = [eq(communications.churchId, churchId)];

  if (filters.channel) {
    conditions.push(eq(communications.channel, filters.channel));
  }

  if (filters.status) {
    conditions.push(eq(communications.status, filters.status));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    const matchesText = or(
      ilike(communications.subject, pattern),
      ilike(communications.body, pattern)
    );
    if (matchesText) conditions.push(matchesText);
  }

  // `and()` only returns undefined for an empty list; the church scope is
  // always present, so the cast is safe.
  return and(...conditions) as SQL;
}
