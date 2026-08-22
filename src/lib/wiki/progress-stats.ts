// ============================================================================
// ONE POPULATION BEHIND /wiki/progress — THE DENOMINATOR AND THE NUMERATOR ARE
// COUNTED FROM THE SAME ARTICLE LIST, IN ONE PASS.
//
// The page used to build them from two reads that did not agree (#631):
// `getArticles(churchId)` for the totals — church-scoped, published-only,
// church-override applied — and a `wiki_progress` read scoped to `user_id`
// ALONE for the counts. A reader whose church later overrode or unpublished an
// article they had finished kept the completion and lost the article, so
// "12 of 10 articles completed / 120%" was a representable state.
//
// The fix is structural rather than a clamp: `summariseProgress` takes the
// corpus and the progress rows TOGETHER and a completion only counts when its
// slug is still in the corpus, so `completed + inProgress <= total` holds per
// category for ANY input — and, summed, so does the overall percentage. There
// is nowhere left to say "> 100%" from.
//
// THE SLUG SET IS LOAD-BEARING, NOT A REDUNDANT GUARD. Checking the category
// alone would not do it: a reader who completed `discovery/x` before it was
// unpublished still sees `discovery/y`, so the "discovery" bucket exists and
// the stale completion would land in it.
//
// It lives in its own module, apart from the read that calls it, because
// `reads.ts` reaches `./get-article` → `next-mdx-remote/rsc`, which the test
// runner cannot load — the same reason `articleBySlugQuery` sits in
// `get-articles.ts` rather than beside `getArticle` (see the docblock there).
// Pure, so the property above is pinned without a database.
// ============================================================================

import type { WikiProgressStatus } from "@/db/schema";

/** How far one wiki category has been read. */
export interface WikiCategoryProgress {
  /** Articles in this category that the reader's list can actually show. */
  total: number;
  completed: number;
  inProgress: number;
}

/** Every category in the reader's corpus, keyed by category slug. */
export type WikiProgressStats = Record<string, WikiCategoryProgress>;

/**
 * The category an article belongs to — the first segment of its slug.
 *
 * Slugs read `discovery/article-name` or `core-group/section/article`, and this
 * grouping is what `/wiki/progress` shows its "By Section" rows for.
 */
export function articleCategoryOf(slug: string): string {
  return slug.split("/")[0] ?? "other";
}

/**
 * Count `progress` against `articles`, per category.
 *
 * Every category in the corpus gets a row, including those the reader has not
 * opened — the page lists sections at 0%, it does not hide them. A progress row
 * whose article has left the corpus is dropped rather than counted.
 *
 * COUNTS ARE PER ARTICLE, NOT PER ROW, so `completed + inProgress <= total`
 * holds however the rows arrive. `wiki_progress_user_article_idx` is unique on
 * (user_id, article_slug) and so a reader cannot hold two rows for one slug
 * today — but this is the function the "never above 100%" property is read off,
 * and a property that quietly depends on an index in another file is one schema
 * edit from being false. A repeated slug therefore takes its last status rather
 * than counting twice.
 */
export function summariseProgress(
  articles: readonly { slug: string }[],
  progress: readonly { articleSlug: string; status: WikiProgressStatus }[]
): WikiProgressStats {
  const stats: WikiProgressStats = {};
  const corpus = new Set<string>();

  for (const article of articles) {
    corpus.add(article.slug);

    const category = articleCategoryOf(article.slug);
    const bucket = (stats[category] ??= {
      total: 0,
      completed: 0,
      inProgress: 0,
    });
    bucket.total++;
  }

  const statusBySlug = new Map<string, WikiProgressStatus>();
  for (const row of progress) {
    if (!corpus.has(row.articleSlug)) continue;
    statusBySlug.set(row.articleSlug, row.status);
  }

  for (const [slug, status] of statusBySlug) {
    const bucket = stats[articleCategoryOf(slug)];
    if (!bucket) continue;

    if (status === "completed") {
      bucket.completed++;
    } else if (status === "in_progress") {
      bucket.inProgress++;
    }
  }

  return stats;
}
