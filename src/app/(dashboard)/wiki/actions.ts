"use server";

import { searchArticles, type SearchResult } from "@/lib/wiki";

/**
 * Server action to search wiki articles
 */
export async function searchWikiArticles(query: string): Promise<SearchResult[]> {
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
    return await searchArticles(sanitizedQuery);
  } catch (error) {
    console.error("Wiki search error:", error);
    return [];
  }
}
