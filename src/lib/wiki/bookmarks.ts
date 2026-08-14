"use server";

import { db } from "@/db";
import { wikiBookmarks } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getArticle } from "./get-article";
import { bookmarkDeleteQuery, bookmarkInsertQuery } from "./write-queries";

/**
 * Check if an article is bookmarked by the current user
 */
export async function isBookmarked(slug: string): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session?.user) return false;

  const [bookmark] = await db
    .select({ id: wikiBookmarks.id })
    .from(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, session.user.id),
        eq(wikiBookmarks.articleSlug, slug)
      )
    )
    .limit(1);

  return !!bookmark;
}

/**
 * Get bookmarked status for multiple articles (batch query)
 * Returns a Set of bookmarked slugs
 */
export async function getBookmarkedSlugs(
  slugs: string[]
): Promise<Set<string>> {
  const session = await getCurrentSession();
  if (!session?.user || slugs.length === 0) return new Set();

  const bookmarks = await db
    .select({ articleSlug: wikiBookmarks.articleSlug })
    .from(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, session.user.id),
        inArray(wikiBookmarks.articleSlug, slugs)
      )
    );

  return new Set(bookmarks.map((b) => b.articleSlug));
}

/**
 * Get all bookmarks for the current user
 */
export async function getBookmarks(limit: number = 10) {
  const session = await getCurrentSession();
  if (!session?.user) return [];

  const safeLimit = Math.min(limit, 50);

  const bookmarks = await db
    .select({
      articleSlug: wikiBookmarks.articleSlug,
      createdAt: wikiBookmarks.createdAt,
    })
    .from(wikiBookmarks)
    .where(eq(wikiBookmarks.userId, session.user.id))
    .orderBy(desc(wikiBookmarks.createdAt))
    .limit(safeLimit);

  // Fetch article metadata for each bookmark, scoped to the bookmarker's own
  // church (#317). Bookmarks are stored by slug with no church on them, so an
  // unscoped lookup resolves a church-scoped article to null and the row is
  // dropped by the filter below — the bookmark would silently vanish from the
  // sidebar rather than fail loudly.
  const bookmarksWithArticles = await Promise.all(
    bookmarks.map(async (bookmark) => {
      const article = await getArticle(
        bookmark.articleSlug,
        session.user.churchId ?? null
      );
      if (!article) return null;
      return {
        slug: bookmark.articleSlug,
        title: article.title,
        createdAt: bookmark.createdAt,
      };
    })
  );

  return bookmarksWithArticles.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
}

/**
 * Toggle bookmark for an article
 * Returns the new bookmarked state
 *
 * The DIRECTION comes from the write, not from a read (#411): the delete runs
 * first and reports the rows it removed, so "there was a bookmark" is something
 * Postgres decided at write time. The previous shape opened with a SELECT and
 * branched on it, which meant two presses in the same instant could both read
 * "bookmarked" and both delete — the star ended up off after an even number of
 * presses that should have left it on.
 */
export async function toggleBookmark(slug: string): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const removed = await bookmarkDeleteQuery(session.user.id, slug);

  if (removed.length > 0) {
    revalidatePath("/wiki", "layout");
    return false;
  }

  // Nothing to remove, so the press adds. `bookmarkInsertQuery` tolerates the
  // row already being there, so a press that raced another press's insert is a
  // no-op rather than a unique-index violation thrown at the reader.
  await bookmarkInsertQuery(session.user.id, slug);
  revalidatePath("/wiki", "layout");
  return true;
}

// `addBookmark` and `removeBookmark` used to sit here — the two halves of the
// toggle above, exported separately and called by nothing. Every export of a
// `"use server"` module is a POSTable endpoint with no session cookie and no UI
// in front of it (`memory/invariants.md` → Authentication), so two dead WRITES
// were two live endpoints: post a slug, get a bookmark row. Deleted with #411,
// the same rule that emptied four dead reads out of `service.ts`.
//
// The star's one behaviour is `toggleBookmark`, whose direction comes from the
// write. A caller that genuinely needs a one-directional bookmark adds it back
// WITH that caller — `write-paths.test.ts` fails on an export of this module
// that nothing calls.
