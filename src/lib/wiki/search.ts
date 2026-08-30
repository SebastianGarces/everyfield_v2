import { sql, and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiArticles } from "@/db/schema";
import { notOverriddenByChurch, visibleToChurch } from "./get-articles";

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
// THE OVERRIDE RULE IS A PREDICATE, NOT A COLLAPSE AFTERWARDS (#411 r2), AND
// IT IS THE SAME PREDICATE EVERY OTHER READ USES (#411 r3) —
// `notOverriddenByChurch`, declared beside `visibleToChurch` in
// `get-articles.ts` and imported here.
//
// Search is why the decision has to live in the statement. The lists read the
// WHOLE visible corpus, so a JS collapse afterwards sees both halves of a
// (slug, church_id) pair and can pick the winner. A ranked search does not read
// the whole corpus: it reads the top N by `ts_rank`, so a collapse only ever
// sees rows that survived the cut, and the church's copy need not be among
// them —
//
//   * the church's copy is a REWRITE, so the words the reader searched for may
//     not be in it at all and it never matches the tsquery; or
//   * it matches but ranks below the read cut.
//
// Either way the global row is returned alone and the collapse has nothing to
// collapse it against, so the exact failure above — the result row and the
// article the click opens being two different documents — survived. Reproduced
// against a real database (`tenancy-live.test.ts`), not reasoned about.
//
// So the statement suppresses a global row the reader's church overrides:
// `NOT EXISTS (church's published row of this slug)`. The church's copy then
// competes on its own merits and the global one it replaces is not in the
// corpus being ranked — which is also why there is no read-more-than-you-need
// limit here.
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
export const SEARCH_LIMIT = 10;

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
      rank: sql<number>`ts_rank(${searchVector}, ${searchQuery})`,
    })
    .from(wikiArticles)
    .where(
      and(
        sql`${searchVector} @@ ${searchQuery}`,
        eq(wikiArticles.status, "published"),
        visibleToChurch(churchId),
        notOverriddenByChurch(churchId)
      )
    )
    .orderBy(
      sql`ts_rank(${searchVector}, ${searchQuery}) DESC`,
      asc(wikiArticles.slug),
      asc(wikiArticles.id)
    )
    .limit(SEARCH_LIMIT)
    .$dynamic();
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

  return searchArticlesQuery(trimmedQuery, churchId);
}

/** Stable, lossless ranked page for Evry's explicit continuation contract. */
export async function searchArticlePage(
  query: string,
  churchId: string,
  page: number
): Promise<{ items: SearchResult[]; hasNextPage: boolean }> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return { items: [], hasNextPage: false };
  const rows = await searchArticlesQuery(trimmedQuery, churchId)
    .limit(SEARCH_LIMIT + 1)
    .offset((page - 1) * SEARCH_LIMIT);
  return {
    items: rows.slice(0, SEARCH_LIMIT),
    hasNextPage: rows.length > SEARCH_LIMIT,
  };
}
