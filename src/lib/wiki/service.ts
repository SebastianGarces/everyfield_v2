import { eq, and, isNull, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  wikiArticles,
  wikiSections,
  type WikiArticle,
  type NewWikiArticle,
  type WikiSection,
  type NewWikiSection,
} from "@/db/schema";
import { revalidatePath } from "next/cache";
import { cache } from "react";

// ============================================================================
// Article Queries
// ============================================================================

/** The minimum an article needs to be linked to: where it lives and its name. */
export interface WikiArticleRef {
  slug: string;
  title: string;
}

/**
 * Slug → title index of every published global article.
 *
 * Deliberately projects only `slug` + `title` (no `content`), so callers that
 * merely need to know whether a slug resolves — e.g. Plant Intelligence
 * insights linking to the methodology that backs them, PE-024 — can check
 * without pulling the corpus body. Deduped per request with `React.cache`, so
 * rendering many insight cards costs one query, not one per card.
 */
export const getPublishedArticleRefs = cache(
  async (): Promise<WikiArticleRef[]> => {
    return db
      .select({ slug: wikiArticles.slug, title: wikiArticles.title })
      .from(wikiArticles)
      .where(
        and(isNull(wikiArticles.churchId), eq(wikiArticles.status, "published"))
      )
      .orderBy(asc(wikiArticles.sortOrder));
  }
);

/**
 * Get a single article by slug
 * For global articles, churchId should be null
 */
export async function getArticleBySlug(
  slug: string,
  churchId: string | null = null
): Promise<WikiArticle | null> {
  const conditions = churchId
    ? and(eq(wikiArticles.slug, slug), eq(wikiArticles.churchId, churchId))
    : and(eq(wikiArticles.slug, slug), isNull(wikiArticles.churchId));

  const result = await db
    .select()
    .from(wikiArticles)
    .where(and(conditions, eq(wikiArticles.status, "published")))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all published articles (navigation, section indexes, search)
 * Returns only global articles (churchId = null)
 */
export async function getAllPublishedArticles(): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(isNull(wikiArticles.churchId), eq(wikiArticles.status, "published"))
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * Get articles by section
 */
export async function getArticlesBySection(
  sectionId: string
): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.sectionId, sectionId),
        eq(wikiArticles.status, "published")
      )
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * Get articles by phase
 */
export async function getArticlesByPhase(
  phase: number
): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.phase, phase),
        eq(wikiArticles.status, "published"),
        isNull(wikiArticles.churchId)
      )
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

// ============================================================================
// Article Mutations
// ============================================================================

/**
 * Create a new article
 */
export async function createArticle(
  data: NewWikiArticle
): Promise<WikiArticle> {
  const result = await db.insert(wikiArticles).values(data).returning();
  return result[0];
}

/**
 * Update an existing article
 */
export async function updateArticle(
  id: string,
  data: Partial<NewWikiArticle>
): Promise<WikiArticle | null> {
  const result = await db
    .update(wikiArticles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(wikiArticles.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Delete an article (soft delete by setting status to archived)
 */
export async function archiveArticle(id: string): Promise<WikiArticle | null> {
  const result = await db
    .update(wikiArticles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(wikiArticles.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Hard delete an article (use with caution)
 */
export async function deleteArticle(id: string): Promise<void> {
  await db.delete(wikiArticles).where(eq(wikiArticles.id, id));
}

// ============================================================================
// Section Queries
// ============================================================================

/**
 * Get all sections
 */
export async function getAllSections(): Promise<WikiSection[]> {
  return db.select().from(wikiSections).orderBy(asc(wikiSections.sortOrder));
}

/**
 * Get a section by slug
 */
export async function getSectionBySlug(
  slug: string
): Promise<WikiSection | null> {
  const result = await db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.slug, slug))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get child sections of a parent
 */
export async function getChildSections(
  parentSectionId: string
): Promise<WikiSection[]> {
  return db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.parentSectionId, parentSectionId))
    .orderBy(asc(wikiSections.sortOrder));
}

/**
 * Get root sections (no parent)
 */
export async function getRootSections(): Promise<WikiSection[]> {
  return db
    .select()
    .from(wikiSections)
    .where(isNull(wikiSections.parentSectionId))
    .orderBy(asc(wikiSections.sortOrder));
}

// ============================================================================
// Section Mutations
// ============================================================================

/**
 * Create a new section
 */
export async function createSection(
  data: NewWikiSection
): Promise<WikiSection> {
  const result = await db.insert(wikiSections).values(data).returning();
  return result[0];
}

/**
 * Update an existing section
 */
export async function updateSection(
  id: string,
  data: Partial<NewWikiSection>
): Promise<WikiSection | null> {
  const result = await db
    .update(wikiSections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(wikiSections.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Delete a section
 */
export async function deleteSection(id: string): Promise<void> {
  await db.delete(wikiSections).where(eq(wikiSections.id, id));
}

// ============================================================================
// Revalidation Helpers
//
// `revalidatePath()` does NOT take the same string as an `href` (#310, from
// #172). The two used to be built with the same `wikiHref()` on the assumption
// that they were interchangeable; the Next docs never say so, and reading the
// implementation shows they are not. The evidence, in next@16.1.4:
//
//  1. `revalidatePath(path)` uses `path` VERBATIM. It builds the cache tag
//     `` `${NEXT_CACHE_IMPLICIT_TAG_ID}${removeTrailingSlash(path)}` `` and never
//     encodes or decodes it — `node_modules/next/dist/server/web/spec-extension/
//     revalidate.js`, `function revalidatePath`.
//  2. The tag a RENDERED page carries comes from `getImplicitTags(page,
//     pathname, …)` (`next/dist/server/lib/implicit-tags.js`), which likewise
//     concatenates the pathname it is handed.
//  3. That pathname is `resolvedPathname` from request metadata
//     (`next/dist/server/app-render/app-render.js`), and
//     `next/dist/server/route-modules/route-module.js` builds it in three steps,
//     with its own comment "we decode for cache key/manifest usage, encoded is
//     for URL building":
//       - `interpolateDynamicPath` fills `/wiki/[...slug]` with the params,
//         `encodeURIComponent`-ing each one (`next/dist/server/server-utils.js`);
//       - `decodePathParams` splits on `/` and, per segment,
//         `escapePathDelimiters(decodeURIComponent(seg), true)`
//         (`next/dist/server/lib/router-utils/decode-path-params.js`);
//       - `removeTrailingSlash`.
//     `escapePathDelimiters(seg, true)` re-encodes only `/`, `#`, `?` and the
//     literal sequences `%2f`, `%23`, `%3f`, `%5c`
//     (`next/dist/shared/lib/router/utils/escape-path-delimiters.js`).
//
// So the form `revalidatePath` matches is neither the fully-encoded href nor the
// raw slug: it is the slug with ONLY the path delimiters escaped. Observed
// against Next's own `decodePathParams` (this is what `service.test.ts` pins):
//
//   slug "faq/what now?"  href "/wiki/faq/what%20now%3F"  tag "/wiki/faq/what now%3F"
//   slug "guías/año"      href "/wiki/gu%C3%ADas/a%C3%B1o" tag "/wiki/guías/año"
//
// The encoded form was therefore WRONG, and silently so: for every URL-safe slug
// (`A-Z a-z 0-9 - _ . ~` and `/`) both encodings are the identity, so the two
// forms coincide and every article we ship today revalidated correctly. The
// moment a slug contains a space, `#`, `?`, `%` or a non-ASCII character the tag
// missed and the article stayed stale until its own TTL — a no-op with a 200
// response, which is why nothing noticed. Fixed here rather than left latent.
//
// `wikiHref()` is still the ONLY way to build an href/`router.push`/OG url —
// this helper is for `revalidatePath` and nothing else.
// ============================================================================

/**
 * The path form `revalidatePath()` must be given for a wiki article slug.
 *
 * Mirrors Next's `escapePathDelimiters(decodeURIComponent(seg), true)` per
 * segment. Since `encodeURIComponent`/`decodeURIComponent` round-trip exactly,
 * that composition reduces to "escape the delimiters in the raw segment", which
 * is what this does — the regex is Next's, character for character.
 *
 * @example
 * wikiRevalidationPath("core-group/building-momentum") // "/wiki/core-group/building-momentum"
 * wikiRevalidationPath("faq/what now?")                // "/wiki/faq/what now%3F"
 */
export function wikiRevalidationPath(slug: string): string {
  const escaped = slug
    .split("/")
    // `/` cannot appear inside a segment after the split; it is kept in the
    // class so this stays a byte-for-byte copy of Next's own expression.
    .map((segment) =>
      segment.replace(/[/#?]|%(?:2f|23|3f|5c)/gi, (delimiter) =>
        encodeURIComponent(delimiter)
      )
    )
    .join("/");

  return `/wiki/${escaped}`;
}

/**
 * Revalidate a specific article page
 */
export function revalidateArticle(slug: string): void {
  revalidatePath(wikiRevalidationPath(slug));
}

/**
 * Revalidate the wiki index and navigation
 */
export function revalidateWikiIndex(): void {
  revalidatePath("/wiki");
}

/**
 * Revalidate all wiki pages (use sparingly)
 */
export function revalidateAllWiki(): void {
  revalidatePath("/wiki", "layout");
}
