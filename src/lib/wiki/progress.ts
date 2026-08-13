"use server";

import { db } from "@/db";
import { wikiProgress, type WikiProgressStatus } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getArticle } from "./get-article";

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
 * ONE statement, not a read followed by a write. `wiki_progress_user_article_idx`
 * is unique on (user_id, article_slug), and a SELECT-then-INSERT is not a
 * concurrency guard (`memory/invariants.md` → Transactions / Atomicity): two
 * scroll saves racing on a first view — two tabs, a double-click, React's
 * development double-invoke — both saw no row and the second INSERT died on the
 * unique index, which surfaces as an unhandled server-action rejection in the
 * reader's tab (#411). `ON CONFLICT DO UPDATE` makes the duplicate impossible
 * instead of unlikely, and it costs one round trip rather than two.
 *
 * The conflicting write applies exactly the fields the caller passed, which is
 * what the UPDATE branch did before: an intermediate scroll save must not
 * rewrite `status`, and marking an article complete must not reset the scroll
 * position it was read to.
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

  const now = new Date();
  const completedAt = data.status === "completed" ? { completedAt: now } : {};

  const [saved] = await db
    .insert(wikiProgress)
    .values({
      userId: session.user.id,
      articleSlug: slug,
      status: data.status ?? "in_progress",
      scrollPosition: data.scrollPosition ?? 0,
      lastViewedAt: now,
      ...completedAt,
    })
    .onConflictDoUpdate({
      target: [wikiProgress.userId, wikiProgress.articleSlug],
      set: {
        ...data,
        lastViewedAt: now,
        updatedAt: now,
        ...completedAt,
      },
    })
    .returning();

  return saved ?? null;
}

/**
 * Mark an article as completed
 */
export async function markCompleted(slug: string) {
  return updateProgress(slug, { status: "completed", scrollPosition: 1 });
}

/**
 * Record a view (sets to in_progress if not already completed)
 */
export async function recordView(slug: string) {
  const existing = await getArticleProgress(slug);

  let result;
  // Don't downgrade from completed to in_progress
  if (existing?.status === "completed") {
    // Just update lastViewedAt
    result = await updateProgress(slug, {});
  } else {
    result = await updateProgress(slug, { status: "in_progress" });
  }

  // Revalidate wiki layout to update "Recently Viewed" sidebar
  revalidatePath("/wiki", "layout");

  return result;
}
