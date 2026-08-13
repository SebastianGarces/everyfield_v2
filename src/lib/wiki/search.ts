import { sql, and, eq, isNotNull, notExists, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { wikiArticles } from "@/db/schema";
import { visibleToChurch } from "./get-articles";

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
// THE OVERRIDE RULE IS A PREDICATE HERE, NOT A COLLAPSE AFTERWARDS (#411 r2).
// The lists collapse (slug, church_id) pairs in JS (`preferChurchOverride`)
// because they read the WHOLE visible corpus — nothing can be missing from the
// set being collapsed. A ranked search does not read the whole corpus: it reads
// the top N by `ts_rank`, so a JS collapse only ever sees the rows that
// survived the cut. Both halves of the pair have to be inside it for the
// church's row to win, and neither is guaranteed —
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
// So the statement itself suppresses a global row the reader's church
// overrides: `NOT EXISTS (church's published row of this slug)`. The church's
// copy then competes on its own merits and the global one it replaces is not in
// the corpus being ranked — which is also why there is no read-more-than-you-
// need limit here any more. The `published` term matches `articleBySlugQuery`
// exactly; a looser one would suppress a global row in favour of a DRAFT the
// reader cannot open, which is the same disagreement in the other direction.
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
 * Suppress a global row whose slug the reader's church has overridden.
 *
 * `undefined` for a churchless read — `and()` drops it — because there is no
 * church to override anything and the global corpus is the whole corpus.
 *
 * The church's OWN rows are exempt (`church_id IS NOT NULL`, which under
 * `visibleToChurch` can only be the reader's church): without that exemption
 * the override would suppress itself and the slug would vanish from search
 * entirely.
 */
function notOverriddenByChurch(churchId: string | null): SQL | undefined {
  if (!churchId) return undefined;

  const override = alias(wikiArticles, "override");

  return or(
    isNotNull(wikiArticles.churchId),
    notExists(
      db
        .select({ one: sql`1` })
        .from(override)
        .where(
          and(
            eq(override.slug, wikiArticles.slug),
            eq(override.churchId, churchId),
            eq(override.status, "published")
          )
        )
    )
  );
}

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
    .orderBy(sql`ts_rank(${searchVector}, ${searchQuery}) DESC`)
    .limit(SEARCH_LIMIT);
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
