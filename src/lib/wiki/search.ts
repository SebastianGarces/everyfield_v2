import { sql, and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { wikiArticles, wikiSections } from "@/db/schema";

/**
 * Search result with relevance rank
 */
export type SearchResult = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  phase: number | null;
  contentType: string;
  sectionId: string | null;
  readTimeMinutes: number | null;
  rank: number;
};

/**
 * Search wiki articles using PostgreSQL full-text search
 *
 * Uses weighted search: title (A) > excerpt (B) > content (C)
 * Supports websearch syntax:
 * - `word1 word2` → AND (both required)
 * - `word1 or word2` → OR (either matches)
 * - `"exact phrase"` → phrase match
 * - `-word` → exclude word
 */
export async function searchArticles(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  // Build the tsvector expression (matches the GIN index)
  const searchVector = sql`(
    setweight(to_tsvector('english', ${wikiArticles.title}), 'A') ||
    setweight(to_tsvector('english', coalesce(${wikiArticles.excerpt}, '')), 'B') ||
    setweight(to_tsvector('english', ${wikiArticles.content}), 'C')
  )`;

  // Build the tsquery from user input using websearch syntax
  const searchQuery = sql`websearch_to_tsquery('english', ${trimmedQuery})`;

  const results = await db
    .select({
      id: wikiArticles.id,
      slug: wikiArticles.slug,
      title: wikiArticles.title,
      excerpt: wikiArticles.excerpt,
      phase: wikiArticles.phase,
      contentType: wikiArticles.contentType,
      sectionId: wikiArticles.sectionId,
      readTimeMinutes: wikiArticles.readTimeMinutes,
      rank: sql<number>`ts_rank(${searchVector}, ${searchQuery})`,
    })
    .from(wikiArticles)
    .where(
      and(
        sql`${searchVector} @@ ${searchQuery}`,
        eq(wikiArticles.status, "published"),
        isNull(wikiArticles.churchId)
      )
    )
    .orderBy(sql`ts_rank(${searchVector}, ${searchQuery}) DESC`)
    .limit(10);

  return results;
}

/**
 * Search result with section name for display
 */
export type SearchResultWithSection = SearchResult & {
  sectionName: string | null;
};

/**
 * Search articles and include section names
 */
export async function searchArticlesWithSections(
  query: string
): Promise<SearchResultWithSection[]> {
  const results = await searchArticles(query);

  if (results.length === 0) return [];

  // Get unique section IDs
  const sectionIds = [
    ...new Set(results.map((r) => r.sectionId).filter(Boolean)),
  ] as string[];

  // Fetch section names
  const sections =
    sectionIds.length > 0
      ? await db
          .select({ id: wikiSections.id, name: wikiSections.name })
          .from(wikiSections)
          .where(sql`${wikiSections.id} IN ${sectionIds}`)
      : [];

  const sectionMap = new Map(sections.map((s) => [s.id, s.name]));

  return results.map((result) => ({
    ...result,
    sectionName: result.sectionId ? sectionMap.get(result.sectionId) ?? null : null,
  }));
}
