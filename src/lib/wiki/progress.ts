"use server";

import { db } from "@/db";
import { wikiProgress, type WikiProgressStatus } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getArticle } from "./get-article";
import { progressUpsertQuery, recordViewUpsertQuery } from "./write-queries";

/**
 * Get progress for a single article
 */
export async function getArticleProgress(slug: string) {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  const [progress] = await db
    .select()
    .from(wikiProgress)
    .where(
      and(
        eq(wikiProgress.userId, session.user.id),
        eq(wikiProgress.articleSlug, slug)
      )
    )
    .limit(1);

  return progress ?? null;
}

/**
 * Get progress for multiple articles (batch query)
 * Returns a map of slug -> progress
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

/**
 * Get recently viewed articles (last 5)
 */
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
 * Get progress stats (counts per category) - lightweight query
 * Returns completed/in_progress counts per category based on user progress
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

/**
 * Get the last in-progress article for "Continue Reading"
 */
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

/**
 * Update progress for an article (upsert).
 *
 * ONE statement, not a read followed by a write — the statement itself is
 * `progressUpsertQuery` in `write-queries.ts`, which is where every wiki write
 * path is built and where the reason is written down.
 */
export async function updateProgress(
  slug: string,
  data: {
    status?: WikiProgressStatus;
    scrollPosition?: number;
  }
) {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  const [saved] = await progressUpsertQuery(
    session.user.id,
    slug,
    data,
    new Date()
  );

  return saved ?? null;
}

/**
 * Mark an article as completed
 */
export async function markCompleted(slug: string) {
  return updateProgress(slug, { status: "completed", scrollPosition: 1 });
}

/**
 * Record a view (sets to in_progress unless the reader already finished it).
 *
 * The "don't downgrade a completed article" rule travels INSIDE the statement
 * (`recordViewUpsertQuery`), not in a branch over a row read a moment earlier:
 * a completion that landed between the read and the write was overwritten, so
 * finishing an article in one tab while another reported the view reset it to
 * in_progress (#411).
 */
export async function recordView(slug: string) {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  const [saved] = await recordViewUpsertQuery(
    session.user.id,
    slug,
    new Date()
  );

  // Revalidate wiki layout to update "Recently Viewed" sidebar
  revalidatePath("/wiki", "layout");

  return saved ?? null;
}
