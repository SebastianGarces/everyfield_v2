"use server";

import { db } from "@/db";
import { wikiBookmarks } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getArticle } from "./get-article";

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
 */
export async function toggleBookmark(slug: string): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  // Check if already bookmarked
  const [existing] = await db
    .select({ id: wikiBookmarks.id })
    .from(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, session.user.id),
        eq(wikiBookmarks.articleSlug, slug)
      )
    )
    .limit(1);

  if (existing) {
    // Remove bookmark
    await db.delete(wikiBookmarks).where(eq(wikiBookmarks.id, existing.id));
    revalidatePath("/wiki", "layout");
    return false;
  } else {
    // Add bookmark.
    //
    // `wiki_bookmarks_user_article_idx` is unique on (user_id, article_slug),
    // and the SELECT above is not a concurrency guard (`memory/invariants.md` →
    // Transactions / Atomicity): two clicks of the star in the same instant both
    // saw no row, and the second INSERT died on the unique index — a thrown
    // server action for a button the reader pressed twice. Adding a bookmark
    // that is already there is a no-op, which is what `addBookmark` below has
    // always said with the same clause (#411).
    await db
      .insert(wikiBookmarks)
      .values({
        userId: session.user.id,
        articleSlug: slug,
      })
      .onConflictDoNothing();
    revalidatePath("/wiki", "layout");
    return true;
  }
}

/**
 * Add a bookmark
 */
export async function addBookmark(slug: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  await db
    .insert(wikiBookmarks)
    .values({
      userId: session.user.id,
      articleSlug: slug,
    })
    .onConflictDoNothing();

  revalidatePath("/wiki", "layout");
}

/**
 * Remove a bookmark
 */
export async function removeBookmark(slug: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  await db
    .delete(wikiBookmarks)
    .where(
      and(
        eq(wikiBookmarks.userId, session.user.id),
        eq(wikiBookmarks.articleSlug, slug)
      )
    );

  revalidatePath("/wiki", "layout");
}
