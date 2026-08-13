import { sql, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiArticles } from "@/db/schema";
import { preferChurchOverride, visibleToChurch } from "./get-articles";

// ============================================================================
// Wiki search — the same corpus the reader can open (#317, #411)
//
// Search is a READER-FACING article read, so it obeys the one visibility
// predicate every other reader-facing read obeys — `visibleToChurch` in
// `get-articles.ts`, `church_id IS NULL OR church_id = :current_church_id`
// (`memory/invariants.md` → Wiki Articles). It used to be hardcoded to
// `church_id IS NULL`, which was wrong in two ways at once: a church's own
// article could be reached from the sidebar and from a link but never found by
// searching for it, and where a church holds its OWN copy of a global slug the
// results listed the GLOBAL row — so the title in the result and the article
// the click opened were two different documents.
//
// The church-override rule therefore applies here as it does everywhere else,
// and it is the SAME implementation (`preferChurchOverride`): at most two rows
// can carry one slug, and the church's row wins. Ranking order is preserved,
// because that function keeps insertion order.
//
// Like every other wiki read, `churchId` defaults to `null` — a call site that
// forgets to thread the session under-fetches (global only) instead of leaking
// another church's content.
// ============================================================================

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

/** How many results a caller gets. */
const SEARCH_LIMIT = 10;

/**
 * How many rows the ranked read takes before overrides collapse it.
 *
 * A church's copy of a global slug matches twice, and the pair collapses to one
 * result — so reading exactly `SEARCH_LIMIT` rows would return fewer than ten
 * results for a church that overrides articles. Reading twice as many and
 * slicing after the collapse keeps the page full; the extra rows cost one
 * index scan of the same query.
 */
const SEARCH_READ_LIMIT = SEARCH_LIMIT * 2;

/**
 * The ranked, tenant-scoped search read, as a builder.
 *
 * Exported as a builder (not a result) for the same reason `visibleArticlesQuery`
 * is: the tenancy predicate can then be rendered with `.toSQL()` and asserted
 * without a database (`tenancy.test.ts`).
 */
export function searchArticlesQuery(query: string, churchId: string | null) {
  // Build the tsvector expression (matches the GIN index)
  const searchVector = sql`(
    setweight(to_tsvector('english', ${wikiArticles.title}), 'A') ||
    setweight(to_tsvector('english', coalesce(${wikiArticles.excerpt}, '')), 'B') ||
    setweight(to_tsvector('english', ${wikiArticles.content}), 'C')
  )`;

  // Build the tsquery from user input using websearch syntax
  const searchQuery = sql`websearch_to_tsquery('english', ${query})`;

  return db
    .select({
      id: wikiArticles.id,
      slug: wikiArticles.slug,
      title: wikiArticles.title,
      excerpt: wikiArticles.excerpt,
      phase: wikiArticles.phase,
      contentType: wikiArticles.contentType,
      sectionId: wikiArticles.sectionId,
      readTimeMinutes: wikiArticles.readTimeMinutes,
      // Carried for the override rule below, and dropped before the caller sees
      // the row: which church owns a result is not part of the result.
      churchId: wikiArticles.churchId,
      rank: sql<number>`ts_rank(${searchVector}, ${searchQuery})`,
    })
    .from(wikiArticles)
    .where(
      and(
        sql`${searchVector} @@ ${searchQuery}`,
        eq(wikiArticles.status, "published"),
        visibleToChurch(churchId)
      )
    )
    .orderBy(sql`ts_rank(${searchVector}, ${searchQuery}) DESC`)
    .limit(SEARCH_READ_LIMIT);
}

/**
 * Search wiki articles using PostgreSQL full-text search
 *
 * Uses weighted search: title (A) > excerpt (B) > content (C)
 * Supports websearch syntax:
 * - `word1 word2` → AND (both required)
 * - `word1 or word2` → OR (either matches)
 * - `"exact phrase"` → phrase match
 * - `-word` → exclude word
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function searchArticles(
  query: string,
  churchId: string | null = null
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const rows = await searchArticlesQuery(trimmedQuery, churchId);

  return preferChurchOverride(rows)
    .slice(0, SEARCH_LIMIT)
    .map(({ churchId: _owner, ...result }) => result);
}
