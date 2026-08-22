import assert from "node:assert/strict";
import { test } from "node:test";

import { summariseProgress, type WikiProgressStats } from "./progress-stats";
import type { WikiProgressStatus } from "@/db/schema";

// ----------------------------------------------------------------------------
// /wiki/progress counted two different populations (#631).
//
// The totals came from `getArticles(churchId)` — church scope, `published`, the
// church-override rule — and the counts came from a `wiki_progress` read scoped
// to `user_id` and nothing else. The two only agreed while no article ever left
// the corpus. Unpublish one the reader had finished, or let their church
// override a global slug, and the numerator kept a completion the denominator
// had dropped: "12 of 10 articles completed / 120%".
//
// `summariseProgress` takes both halves at once, so the assertions below are
// about a property rather than about a case list: whatever goes in, the counted
// articles are a SUBSET of the counted-against articles. The generator at the
// bottom is what actually pins it — the named tests above it are the shapes
// worth reading in a diff.
// ----------------------------------------------------------------------------

function article(slug: string) {
  return { slug };
}

function progress(articleSlug: string, status: WikiProgressStatus) {
  return { articleSlug, status };
}

/** Overall numbers exactly as `/wiki/progress` sums its category rows. */
function overall(stats: WikiProgressStats) {
  let total = 0;
  let completed = 0;
  let inProgress = 0;

  for (const bucket of Object.values(stats)) {
    total += bucket.total;
    completed += bucket.completed;
    inProgress += bucket.inProgress;
  }

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, inProgress, percentage };
}

// ============================================================================
// 1. The reported defect
// ============================================================================

test("a completion on an article that left the corpus stops counting", () => {
  // Ten visible articles, twelve completions — two of them on articles the
  // church has since unpublished. This is the "12 of 10 / 120%" report.
  const articles = Array.from({ length: 10 }, (_, i) =>
    article(`discovery/visible-${i}`)
  );
  const completions = [
    ...articles.map((a) => progress(a.slug, "completed")),
    progress("discovery/unpublished-a", "completed"),
    progress("discovery/unpublished-b", "completed"),
  ];

  const stats = summariseProgress(articles, completions);

  assert.deepEqual(overall(stats), {
    total: 10,
    completed: 10,
    inProgress: 0,
    percentage: 100,
  });
});

test("the corpus is checked by SLUG, not by category", () => {
  // The load-bearing half. A stale completion under a category that still has
  // visible articles would otherwise land in that category's bucket, because
  // the bucket exists.
  const stats = summariseProgress(
    [article("discovery/still-here")],
    [
      progress("discovery/still-here", "completed"),
      progress("discovery/gone", "completed"),
      progress("discovery/also-gone", "in_progress"),
    ]
  );

  assert.deepEqual(stats, {
    discovery: { total: 1, completed: 1, inProgress: 0 },
  });
});

test("a church override keeps the completion — same slug, one row", () => {
  // `wiki_articles_slug_church_idx` is unique on (slug, church_id), so a
  // church's own copy of a global slug carries THAT slug and the corpus read
  // returns exactly one row for it. The reader's progress is keyed by slug, so
  // an override neither drops the completion nor counts it twice.
  const stats = summariseProgress(
    [article("discovery/values"), article("discovery/prayer")],
    [progress("discovery/values", "completed")]
  );

  assert.deepEqual(stats, {
    discovery: { total: 2, completed: 1, inProgress: 0 },
  });
});

// ============================================================================
// 2. What the page still needs from the shape
// ============================================================================

test("every category in the corpus gets a row, unread ones included", () => {
  // `/wiki/progress` lists sections at 0%; it does not hide them. Before #631
  // the page got its rows from the article list and defaulted the counts, so
  // dropping unread categories here would empty the "By Section" list.
  const stats = summariseProgress(
    [
      article("discovery/a"),
      article("core-group/vision-meetings/b"),
      article("frameworks/c"),
    ],
    [progress("discovery/a", "in_progress")]
  );

  assert.deepEqual(Object.keys(stats).sort(), [
    "core-group",
    "discovery",
    "frameworks",
  ]);
  assert.deepEqual(stats["core-group"], {
    total: 1,
    completed: 0,
    inProgress: 0,
  });
});

test("an empty corpus reports nothing rather than dividing by zero", () => {
  const stats = summariseProgress([], [progress("discovery/a", "completed")]);

  assert.deepEqual(stats, {});
  assert.equal(overall(stats).percentage, 0);
});

// ============================================================================
// 3. The property — numerator ⊆ denominator, for any input (AC 3)
// ============================================================================

/** Deterministic 32-bit PRNG, so a failure reproduces from the iteration index. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ["discovery", "core-group", "frameworks", "administrative"];
const STATUSES: WikiProgressStatus[] = [
  "not_started",
  "in_progress",
  "completed",
];

test("counted articles are always a subset of counted-against articles", () => {
  const random = mulberry32(631);

  for (let iteration = 0; iteration < 2000; iteration++) {
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(random() * items.length)]!;

    // A pool of slugs, of which only some are in the corpus — the rest stand
    // for articles unpublished, overridden away, or belonging to a church the
    // reader has left. Progress is drawn from the WHOLE pool, exactly as a
    // `wiki_progress` table accumulated over time would be.
    const pool = Array.from(
      { length: 1 + Math.floor(random() * 12) },
      (_, i) => `${pick(CATEGORIES)}/article-${i}`
    );
    const articles = pool
      .filter(() => random() < 0.6)
      .map((slug) => article(slug));
    const rows = Array.from({ length: Math.floor(random() * 20) }, () =>
      progress(pick(pool), pick(STATUSES))
    );

    const stats = summariseProgress(articles, rows);
    const where = `iteration ${iteration}`;

    for (const [category, bucket] of Object.entries(stats)) {
      assert.ok(
        bucket.completed + bucket.inProgress <= bucket.total,
        `${where}: ${category} counted ${bucket.completed + bucket.inProgress} of ${bucket.total} articles`
      );
      assert.ok(bucket.completed >= 0 && bucket.inProgress >= 0, where);
    }

    const summed = overall(stats);
    assert.equal(
      summed.total,
      articles.length,
      `${where}: the denominator is not the corpus`
    );
    assert.ok(
      summed.completed + summed.inProgress <= summed.total,
      `${where}: ${summed.completed + summed.inProgress} of ${summed.total} overall`
    );
    assert.ok(
      summed.percentage <= 100,
      `${where}: ${summed.percentage}% completed`
    );
  }
});

test("the property does not lean on a unique index in another file", () => {
  // `wiki_progress_user_article_idx` is unique on (user_id, article_slug), so
  // two rows for one slug are unconstructible today. Counting per ROW would
  // still leave "never above 100%" a property of that index rather than of this
  // function — one schema edit from false. Counts are per ARTICLE.
  const stats = summariseProgress(
    [article("discovery/a")],
    [progress("discovery/a", "completed"), progress("discovery/a", "completed")]
  );

  assert.deepEqual(stats, {
    discovery: { total: 1, completed: 1, inProgress: 0 },
  });
});
