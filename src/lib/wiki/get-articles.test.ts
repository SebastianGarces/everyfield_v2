import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  articleParentPath,
  byNavigationOrder,
  resolveRelatedArticles,
  resolveSiblingNavigation,
} from "./get-articles";
import type { ArticleMeta } from "./types";

// ----------------------------------------------------------------------------
// Article navigation (W-009, #317) — the resolution half, which needs no
// database and therefore runs everywhere, CI included.
//
// Both affordances are DERIVED from the visible corpus rather than stored, and
// each has a failure mode that still type-checks and still renders:
//
//   - Related articles: `related_article_slugs` is plain text with no
//     foreign key behind it. A slug that was renamed, unpublished, or belongs
//     to another church must vanish, not render a link into a 404 — and must
//     not drag an empty "Related articles" heading onto every article that has
//     no cross-links at all.
//
//   - Prev/next: "the same section" has two plausible readings in this
//     codebase, and the wrong one is invisible. `ArticleMeta.section` collapses
//     to "_root" for every two-segment slug, so using it would make every
//     phase-level article in the wiki a sibling of every other. The parent
//     path is the sidebar tree the reader actually sees.
//
// `getArticleNavigation` itself is just `getArticles` plus these two, so what
// is worth pinning is here.
// ----------------------------------------------------------------------------

function article(slug: string, overrides: Partial<ArticleMeta> = {}) {
  return {
    slug,
    title: slug.split("/").at(-1) ?? slug,
    type: "reference",
    phase: 1,
    section: "_root",
    order: 0,
    readTime: 5,
    description: "",
    category: "journey",
    ...overrides,
  } satisfies ArticleMeta;
}

// ============================================================================
// 1. Sibling resolution — the parent path, not the display section
// ============================================================================

test("parent path is the slug minus its last segment", () => {
  assert.equal(
    articleParentPath("core-group/vision-meetings/agenda"),
    "core-group/vision-meetings"
  );
  assert.equal(articleParentPath("discovery/counting-the-cost"), "discovery");
  assert.equal(articleParentPath("welcome"), "");
});

test("previous/next walk the siblings in sort order", () => {
  const articles = [
    article("discovery/c", { order: 3 }),
    article("discovery/a", { order: 1 }),
    article("discovery/b", { order: 2 }),
  ];

  const { previous, next } = resolveSiblingNavigation(articles, "discovery/b");

  assert.equal(previous?.slug, "discovery/a");
  assert.equal(next?.slug, "discovery/c");
});

test("the first article has no previous and the last has no next", () => {
  const articles = [
    article("discovery/a", { order: 1 }),
    article("discovery/b", { order: 2 }),
    article("discovery/c", { order: 3 }),
  ];

  const first = resolveSiblingNavigation(articles, "discovery/a");
  assert.equal(first.previous, null);
  assert.equal(first.next?.slug, "discovery/b");

  const last = resolveSiblingNavigation(articles, "discovery/c");
  assert.equal(last.previous?.slug, "discovery/b");
  assert.equal(last.next, null);
});

test("a lone article in its section has neither neighbour", () => {
  const { previous, next } = resolveSiblingNavigation(
    [article("discovery/only"), article("core-group/other")],
    "discovery/only"
  );

  assert.equal(previous, null);
  assert.equal(next, null);
});

test("siblings stop at the section boundary", () => {
  // Same phase, different sub-section: `section` would call these siblings.
  const articles = [
    article("core-group/vision-meetings/a", { order: 1 }),
    article("core-group/vision-meetings/b", { order: 2 }),
    article("core-group/gatherings/c", { order: 3 }),
  ];

  const { next } = resolveSiblingNavigation(
    articles,
    "core-group/vision-meetings/b"
  );

  assert.equal(
    next,
    null,
    "gatherings/c is a different section, not the next article"
  );
});

test("descendants of a section are not siblings of its own articles", () => {
  const articles = [
    article("core-group/overview", { order: 1 }),
    article("core-group/vision-meetings/a", { order: 2 }),
    article("core-group/next-steps", { order: 3 }),
  ];

  const { next } = resolveSiblingNavigation(articles, "core-group/overview");

  assert.equal(next?.slug, "core-group/next-steps");
});

test("a slug that is not an article — a section index — has no neighbours", () => {
  const { previous, next } = resolveSiblingNavigation(
    [article("discovery/a"), article("discovery/b")],
    "discovery"
  );

  assert.equal(previous, null);
  assert.equal(next, null);
});

test("equal sort orders fall back to title, not database order", () => {
  // `sort_order` defaults to 999 for every row, so this is the common case.
  const articles = [
    article("discovery/zebra", { order: 999, title: "Zebra" }),
    article("discovery/apple", { order: 999, title: "Apple" }),
    article("discovery/mango", { order: 999, title: "Mango" }),
  ];

  assert.deepEqual(
    [...articles].sort(byNavigationOrder).map((a) => a.title),
    ["Apple", "Mango", "Zebra"]
  );

  const { previous, next } = resolveSiblingNavigation(
    articles,
    "discovery/mango"
  );
  assert.equal(previous?.slug, "discovery/apple");
  assert.equal(next?.slug, "discovery/zebra");
});

// ============================================================================
// 2. Related articles — stored slugs resolved against the visible corpus
// ============================================================================

test("related slugs resolve in the order they were authored", () => {
  const articles = [
    article("discovery/a", { title: "A" }),
    article("discovery/b", { title: "B" }),
    article("discovery/c", { title: "C" }),
  ];

  const related = resolveRelatedArticles(
    articles,
    ["discovery/c", "discovery/a"],
    "discovery/b"
  );

  assert.deepEqual(
    related.map((a) => a.slug),
    ["discovery/c", "discovery/a"]
  );
});

test("no related slugs means no section at all", () => {
  const articles = [article("discovery/a")];

  assert.deepEqual(resolveRelatedArticles(articles, null, "discovery/b"), []);
  assert.deepEqual(
    resolveRelatedArticles(articles, undefined, "discovery/b"),
    []
  );
  assert.deepEqual(resolveRelatedArticles(articles, [], "discovery/b"), []);
});

test("a slug the reader cannot see is dropped, not rendered dead", () => {
  // `articles` IS the visible corpus — unpublished, renamed and other-church
  // articles are simply absent from it.
  const related = resolveRelatedArticles(
    [article("discovery/a")],
    ["discovery/a", "discovery/gone", "another-church/private"],
    "discovery/b"
  );

  assert.deepEqual(
    related.map((a) => a.slug),
    ["discovery/a"]
  );
});

test("every related slug being unresolvable yields an empty list", () => {
  assert.deepEqual(
    resolveRelatedArticles([article("discovery/a")], ["discovery/gone"], "x"),
    []
  );
});

test("an article never links to itself, and repeats collapse", () => {
  const articles = [article("discovery/a"), article("discovery/b")];

  const related = resolveRelatedArticles(
    articles,
    ["discovery/b", "discovery/a", "discovery/a"],
    "discovery/b"
  );

  assert.deepEqual(
    related.map((a) => a.slug),
    ["discovery/a"]
  );
});

// ============================================================================
// 3. Call-site wiring — the article page actually renders both affordances
// ============================================================================

/**
 * The page is an RSC that pulls in MDX compilation and `next/link`, so it
 * cannot be imported here. The wiring is pinned on the source instead — the
 * technique `tenancy.test.ts` and `service.test.ts` both use for call sites
 * the test runner cannot load.
 */
const ARTICLE_PAGE = "src/app/(dashboard)/wiki/[...slug]/page.tsx";

test("the article page renders related articles and the pager", () => {
  const source = readFileSync(path.join(process.cwd(), ARTICLE_PAGE), "utf8");

  assert.match(
    source,
    /<RelatedArticles\b/,
    `${ARTICLE_PAGE} does not render <RelatedArticles> (W-009)`
  );
  assert.match(
    source,
    /<ArticlePager\b/,
    `${ARTICLE_PAGE} does not render <ArticlePager> (W-009)`
  );
  assert.match(
    source,
    /getArticleNavigation\([^)]*churchId/,
    `${ARTICLE_PAGE} resolves article navigation without passing a church — the footer would advertise the wrong corpus (#317)`
  );
});

// ============================================================================
// 4. Where the cross-links come from — the corpus, not a fixture
// ============================================================================

/**
 * Every article in the corpus authored its own "## Related Articles" section in
 * prose, so shipping `RelatedArticles` on top of it showed the reader the same
 * list twice. The ruling was that the derived component is canonical:
 * `scripts/migrate-wiki-related-sections.ts` lifted those 358 links into
 * `related_article_slugs` and deleted the prose (#317).
 *
 * That makes the column REAL data now, which is what these two assertions
 * protect. The parser itself is unit-tested in `related-sections.test.ts`; what
 * cannot be caught there is someone re-adding a hardcoded fixture, which would
 * overwrite an article's genuine cross-links with invented ones — the previous
 * fixture wrote deliberately dead slugs, and it ran on every `pnpm db:seed`.
 */
const MIGRATION = "scripts/migrate-wiki-related-sections.ts";
const DEV_SEED = "scripts/seed-dev-db.ts";

test("the prose-to-column migration both fills the column and strips the section", () => {
  const source = readFileSync(path.join(process.cwd(), MIGRATION), "utf8");

  assert.match(
    source,
    /relatedArticleSlugs:/,
    `${MIGRATION} no longer writes related_article_slugs — nothing populates the column the Related Articles section reads (#317 / W-009)`
  );
  assert.match(
    source,
    /parseRelatedSection/,
    `${MIGRATION} no longer strips the authored section — the reader would see Related Articles twice (#317)`
  );
});

test("the dev seed does not overwrite the corpus's own cross-links", () => {
  const source = readFileSync(path.join(process.cwd(), DEV_SEED), "utf8");

  assert.doesNotMatch(
    source,
    /relatedArticleSlugs/,
    `${DEV_SEED} writes related_article_slugs again — a fixture there replaces an article's real cross-links with invented ones (#317)`
  );
});
