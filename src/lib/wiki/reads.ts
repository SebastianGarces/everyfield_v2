// ============================================================================
// THE WIKI'S PER-READER READS — bookmarks and progress, for a reader who may
// not exist.
//
// DELIBERATELY NOT A `"use server"` MODULE, and that is the whole reason this
// file is separate from `./bookmarks` and `./progress`. Every function here is
// called DURING RENDER by `/wiki`'s layout and its three pages, and `/wiki` is
// the one prefix in `CRAWLER_PREVIEWABLE_ROUTE_PREFIXES` (`@/lib/crawler`) —
// which is a promise that the route produces a SESSION-LESS render worth
// previewing. So every read below has to answer a caller with no session, and
// answer with an empty one rather than a throw.
//
// #297 IS THE PRECEDENT AND IT WAS PAID FOR ONCE ALREADY. `/dashboard` was on
// that list while its page called `verifySession()`, which throws with no
// session: every crawler-UA request 500'd, and the ruling of 2026-08-04 was to
// take the prefix off the list rather than to keep a page that could not keep
// the promise. `/wiki` is still on the list, so the fix here is the other half
// of the same rule — the reads keep `getCurrentSession()`, whose failure shape
// is a null user.
//
// The WRITES are the opposite kind of thing and live in the two `"use server"`
// modules beside this one, behind `requireSeat` (#498): a bookmark or a
// progress row is a POSTable endpoint, and an anonymous caller has no business
// reaching one.
// ============================================================================

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  wikiBookmarks,
  wikiProgress,
  type WikiProgressStatus,
} from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";

import { getArticle } from "./get-article";

// ----------------------------------------------------------------------------
// Bookmarks
// ----------------------------------------------------------------------------

/** Check if an article is bookmarked by the current user. */
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
 * Get bookmarked status for multiple articles (batch query).
 * Returns a Set of bookmarked slugs.
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

/** Get all bookmarks for the current user. */
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

// ----------------------------------------------------------------------------
// Reading progress
// ----------------------------------------------------------------------------

/**
 * Get progress for multiple articles (batch query).
 * Returns a map of slug -> progress.
 */
export async function getArticlesProgress(slugs: string[]) {
  const session = await getCurrentSession();
  if (!session?.user || slugs.length === 0) return new Map();

  const progressList = await db
    .select()
    .from(wikiProgress)
    .where(
      and(
        eq(wikiProgress.userId, session.user.id),
        inArray(wikiProgress.articleSlug, slugs)
      )
    );

  const progressMap = new Map<
    string,
    { status: WikiProgressStatus; scrollPosition: number | null }
  >();

  for (const p of progressList) {
    progressMap.set(p.articleSlug, {
      status: p.status,
      scrollPosition: p.scrollPosition,
    });
  }

  return progressMap;
}

/** Get recently viewed articles (last 5). */
export async function getRecentlyViewed(limit: number = 5) {
  const session = await getCurrentSession();
  if (!session?.user) return [];

  // Enforce max limit
  const safeLimit = Math.min(limit, 10);

  const recentProgress = await db
    .select({
      articleSlug: wikiProgress.articleSlug,
      status: wikiProgress.status,
      scrollPosition: wikiProgress.scrollPosition,
      lastViewedAt: wikiProgress.lastViewedAt,
    })
    .from(wikiProgress)
    .where(eq(wikiProgress.userId, session.user.id))
    .orderBy(desc(wikiProgress.lastViewedAt))
    .limit(safeLimit);

  // Fetch article metadata for each, scoped to the reader's own church (#317).
  // Progress rows are stored by slug with no church on them, so an unscoped
  // lookup resolves a church-scoped article to null and the entry is dropped by
  // the filter below — it would disappear from "Recently Viewed" rather than
  // fail loudly.
  const articlesWithProgress = await Promise.all(
    recentProgress.map(async (progress) => {
      const article = await getArticle(
        progress.articleSlug,
        session.user.churchId ?? null
      );
      if (!article) return null;
      return {
        slug: progress.articleSlug,
        title: article.title,
        status: progress.status,
        scrollPosition: progress.scrollPosition,
        lastViewedAt: progress.lastViewedAt,
      };
    })
  );

  // Filter out nulls with proper typing
  return articlesWithProgress.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
}

/**
 * Get progress stats (counts per category) — lightweight query.
 * Returns completed/in_progress counts per category based on user progress.
 */
export async function getProgressStats() {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  // Get all user progress
  const userProgress = await db
    .select({
      articleSlug: wikiProgress.articleSlug,
      status: wikiProgress.status,
    })
    .from(wikiProgress)
    .where(eq(wikiProgress.userId, session.user.id));

  // Group by extracting category from slug
  // Slugs are like "discovery/article-name" or "core-group/section/article"
  const statsByCategory: Record<
    string,
    { completed: number; inProgress: number }
  > = {};

  for (const p of userProgress) {
    const category = p.articleSlug.split("/")[0] ?? "other";
    if (!statsByCategory[category]) {
      statsByCategory[category] = { completed: 0, inProgress: 0 };
    }
    if (p.status === "completed") {
      statsByCategory[category].completed++;
    } else if (p.status === "in_progress") {
      statsByCategory[category].inProgress++;
    }
  }

  return statsByCategory;
}

/** Get the last in-progress article for "Continue Reading". */
export async function getLastInProgress() {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  const [progress] = await db
    .select()
    .from(wikiProgress)
    .where(
      and(
        eq(wikiProgress.userId, session.user.id),
        eq(wikiProgress.status, "in_progress")
      )
    )
    .orderBy(desc(wikiProgress.lastViewedAt))
    .limit(1);

  if (!progress) return null;

  // Same church scope as "Recently Viewed" above (#317) — otherwise a church's
  // own article, once started, can never be the one "Continue Reading" offers.
  const article = await getArticle(
    progress.articleSlug,
    session.user.churchId ?? null
  );
  if (!article) return null;

  return {
    slug: progress.articleSlug,
    title: article.title,
    description: article.description,
    type: article.type,
    readTime: article.readTime,
    scrollPosition: progress.scrollPosition,
    lastViewedAt: progress.lastViewedAt,
  };
}
