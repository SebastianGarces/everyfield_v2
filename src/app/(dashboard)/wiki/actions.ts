"use server";

import { getCurrentSession } from "@/lib/auth";
import { searchArticles, type SearchResult } from "@/lib/wiki";

/**
 * Server action to search wiki articles
 *
 * The church is read off the SESSION, never taken as an argument: an entity
 * implied by the actor is not a parameter (`memory/invariants.md` →
 * Authentication), and every export of a `"use server"` module is a public POST
 * endpoint — a caller-supplied church here would be a cross-tenant read.
 *
 * A reader with no session (or no church) searches the global corpus, which is
 * what `searchArticles` does with `null` (#411).
 */
export async function searchWikiArticles(
  query: string
): Promise<SearchResult[]> {
  // Basic input validation
  if (!query || typeof query !== "string") {
    return [];
  }

  // Limit query length to prevent abuse
  const sanitizedQuery = query.slice(0, 200).trim();

  if (!sanitizedQuery) {
    return [];
  }

  try {
    const { user } = await getCurrentSession();
    return await searchArticles(sanitizedQuery, user?.churchId ?? null);
  } catch (error) {
    console.error("Wiki search error:", error);
    return [];
  }
}
