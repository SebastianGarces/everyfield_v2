import {
  persons,
  type Person,
  type PersonSource,
  type PersonStatus,
} from "@/db/schema";
import { ilike, or, sql, type SQL } from "drizzle-orm";
import {
  buildPeopleConditions,
  paginatePeopleByCreatedAtCursor,
} from "./service";

// ============================================================================
// Types
// ============================================================================

export interface SearchPeopleParams {
  query?: string; // Search in name, email, phone
  status?: PersonStatus[];
  source?: PersonSource[];
  tagIds?: string[]; // Filter by tags (AND logic - person must have ALL tags)
  cursor?: string;
  limit?: number; // default 25, max 100
}

export interface SearchPeopleResult {
  people: Person[];
  total: number;
  nextCursor: string | null;
}

// ============================================================================
// Search
// ============================================================================

/**
 * The search text predicate: the list's four columns PLUS the concatenated
 * full name, so "Jane Doe" matches across first/last.
 */
function searchTextSearch(query: string): SQL | undefined {
  const searchPattern = `%${query.trim()}%`;
  return or(
    ilike(persons.firstName, searchPattern),
    ilike(persons.lastName, searchPattern),
    ilike(persons.email, searchPattern),
    ilike(persons.phone, searchPattern),
    // Search full name (first + last)
    sql`concat(${persons.firstName}, ' ', ${persons.lastName}) ilike ${searchPattern}`
  );
}

/**
 * Search people with filters
 * - query: searches first_name, last_name, email, phone (case-insensitive)
 * - status: filter by status (multi-select)
 * - source: filter by source (multi-select)
 * - Excludes soft-deleted records
 *
 * Conditions and the (created_at, id) cursor pagination are shared with
 * listPeople via service.ts — only the text predicate differs.
 */
export async function searchPeople(
  churchId: string,
  params: SearchPeopleParams = {}
): Promise<SearchPeopleResult> {
  const { query, status, source, tagIds, cursor, limit = 25 } = params;

  const conditions = buildPeopleConditions(churchId, {
    status,
    source,
    tagIds,
    textSearch:
      query && query.trim().length > 0 ? searchTextSearch(query) : undefined,
  });

  return paginatePeopleByCreatedAtCursor(churchId, conditions, cursor, limit);
}
