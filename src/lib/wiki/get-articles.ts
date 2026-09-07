import {
  and,
  asc,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { db } from "@/db";
import { wikiArticles } from "@/db/schema";
import type {
  ArticleMeta,
  ArticleCategory,
  ArticleNavSection,
  NavGroup,
} from "./types";
import { toArticleMeta } from "./types";
import { wikiHref } from "./href";

// ============================================================================
// Tenancy — every wiki read starts here (#317, from #16)
//
// `wiki_articles.church_id` is nullable and means two different things:
// NULL = global content every plant sees, a uuid = content belonging to that
// one church (FRD `product-docs/features/wiki/frd.md`, data model). The read
// the FRD specifies is therefore
//
//     WHERE church_id IS NULL OR church_id = :current_church_id
//
// and NOT "church_id = :id" — a church sees the global corpus PLUS its own,
// never only its own. Isolation here is application-layer; there is no RLS
// behind these queries (`memory/invariants.md` → Multi-Tenancy), so this
// predicate IS the boundary and it is asserted at the SQL level in
// `tenancy.test.ts` rather than trusted.
//
// The reads default to `churchId = null` (global only) so that a call site
// which forgets to thread a church fails CLOSED — it under-fetches its own
// content instead of leaking somebody else's.
// ============================================================================

/**
 * The visibility predicate: global articles, plus this church's own.
 *
 * `null` narrows to the global corpus alone — never "everything".
 */
export function visibleToChurch(churchId: string | null): SQL {
  if (!churchId) {
    return isNull(wikiArticles.churchId);
  }

  return or(
    isNull(wikiArticles.churchId),
    eq(wikiArticles.churchId, churchId)
  ) as SQL;
}

// ============================================================================
// The church override — ONE decision, in the statement (#411 round 3)
//
// `wiki_articles_slug_church_idx` is unique on (slug, church_id), so a church
// may hold its own row for a global slug, and the visibility predicate above
// admits both scopes — so both rows come back and one of them has to win. The
// church's row does: it is an override (`memory/invariants.md` → Wiki
// Articles), and two rows under one slug otherwise duplicate the article in
// lists, in navigation and in React keys.
//
// THAT DECISION HAD TWO IMPLEMENTATIONS AND NOW HAS ONE. The lists and the
// single-article read collapsed the pair in JS afterwards
// (`preferChurchOverride`), while search suppressed the global row inside the
// statement — and the two could not be made to agree, because a JS collapse is
// unusable on a RANKED read: it only ever sees the rows that survived the
// `ts_rank` cut, and a rewritten church copy need not be among them (see
// `search.ts`, and `tenancy-live.test.ts`, where that disagreement was
// reproduced against a real database). Only the SQL form answers on both kinds
// of read, so the SQL form is the survivor and the JS copy is gone rather than
// kept in parallel: one implementation, so the lists, the detail route and
// search cannot drift apart about which row a reader gets.
//
// Every reader-facing builder below therefore carries BOTH predicates —
// `visibleToChurch` says what this reader may see, `notOverriddenByChurch` says
// which of two visible rows survives.
// ============================================================================

/**
 * Suppress a global row whose slug the reader's church has overridden.
 *
 * `undefined` for a churchless read — `and()` drops it — because there is no
 * church to override anything and the global corpus is the whole corpus.
 *
 * The church's OWN rows are exempt (`church_id IS NOT NULL`, which under
 * `visibleToChurch` can only be the reader's church): without that exemption
 * the override would suppress itself and the slug would vanish entirely.
 *
 * The subquery's `published` term matches the `status` filter on every read it
 * guards. A looser one would suppress a global article in favour of a DRAFT the
 * reader cannot open — the same disagreement in the other direction.
 */
export function notOverriddenByChurch(
  churchId: string | null
): SQL | undefined {
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
 * Every published article visible to `churchId`, in navigation order.
 *
 * Exported as a builder (not a result) so the tenancy predicate can be
 * rendered with `.toSQL()` and asserted without a database — the same shape
 * `src/lib/notifications/queries.ts` uses for its church boundary.
 */
export function visibleArticlesQuery(churchId: string | null) {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        visibleToChurch(churchId),
        eq(wikiArticles.status, "published"),
        notOverriddenByChurch(churchId)
      )
    )
    .orderBy(
      asc(wikiArticles.sortOrder),
      asc(wikiArticles.slug),
      asc(wikiArticles.id)
    );
}

/**
 * One slug, resolved against what `churchId` may see — AT MOST ONE ROW.
 *
 * Two rows can satisfy the visibility predicate alone
 * (`wiki_articles_slug_church_idx` is unique on (slug, church_id) and the
 * predicate admits exactly two church scopes), which is why this read used to
 * take two and collapse them in JS. It carries the override predicate now, so
 * the statement returns the winner and `LIMIT 1` states that: the church's row
 * when it has a published one, the global row otherwise.
 *
 * This builder backs `getArticle` but lives here, next to the predicates it
 * shares, because `get-article.ts` imports the MDX compiler and so cannot be
 * loaded by the test runner — the tenancy assertions in `tenancy.test.ts`
 * would have nothing to inspect.
 */
export function articleBySlugQuery(slug: string, churchId: string | null) {
  return db
    .select({
      ...getTableColumns(wikiArticles),
      // Drizzle's Date mapping truncates Postgres's microseconds. Effects
      // persist this exact database token so the atomic mutation predicate
      // cannot mistake two writes in the same JavaScript millisecond.
      updatedAtExact: sql<string>`${wikiArticles.updatedAt}::text`,
    })
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.slug, slug),
        visibleToChurch(churchId),
        eq(wikiArticles.status, "published"),
        notOverriddenByChurch(churchId)
      )
    )
    .limit(1);
}

/** The minimum an article needs to be linked to: where it lives and its name. */
export interface WikiArticleRef {
  slug: string;
  title: string;
}

/**
 * Slug → title index of every published article `churchId` may see.
 *
 * Projects `slug` + `title` only (no `content`), so a caller that merely needs
 * to know whether a slug still resolves — Plant Intelligence insights linking to
 * the methodology behind them, PE-024 — can check without pulling the corpus
 * body.
 *
 * IT LIVED IN `service.ts` AND WAS GLOBAL-ONLY (`church_id IS NULL`), which was
 * the last reader-facing read outside this module (#411 round 6). That is not a
 * quiet under-fetch like the rest of the fail-closed defaults: an insight card
 * resolves a stored slug to a TITLE and renders it as a link, while the click
 * goes to `/wiki/<slug>`, which the detail route resolves through
 * `articleBySlugQuery` — the church's own row when it has one. So for a church
 * that overrides a global slug the card advertised the GLOBAL title on a link
 * that opened the CHURCH's article: verbatim the two-documents mismatch #411
 * exists to kill, one component over from where search had it.
 *
 * It carries both predicates now and joins `readerFacingReads()` in
 * `tenancy.test.ts`, so the claim that loop makes about covering EVERY
 * reader-facing read is true of this one too.
 */
export function publishedArticleRefsQuery(churchId: string | null) {
  return db
    .select({ slug: wikiArticles.slug, title: wikiArticles.title })
    .from(wikiArticles)
    .where(
      and(
        visibleToChurch(churchId),
        eq(wikiArticles.status, "published"),
        notOverriddenByChurch(churchId)
      )
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * The slug index, deduped per request with `React.cache` and keyed on
 * `churchId`, so a panel of insight cards costs one query rather than one per
 * card. A plain DB read, never an LLM call.
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export const getPublishedArticleRefs = cache(
  async function getPublishedArticleRefs(
    churchId: string | null = null
  ): Promise<WikiArticleRef[]> {
    return publishedArticleRefsQuery(churchId);
  }
);

/**
 * Get all wiki articles with metadata, scoped to a church.
 *
 * Deduped per request with `React.cache`, keyed on `churchId` — the same
 * pattern `getPublishedArticleRefs` above uses. Rendering one article
 * reads the whole visible corpus at least twice (the sidebar's
 * `getWikiNavigation` in the wiki layout, and `getArticleNavigation` in the
 * page), and every read is the identical ~90-row query; without this each
 * derived affordance costs its own round trip. Outside a React request scope —
 * the test runner — `cache` calls straight through, so nothing is memoised
 * across the fixtures a live test sets up between reads.
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export const getArticles = cache(async function getArticles(
  churchId: string | null = null
): Promise<ArticleMeta[]> {
  const dbArticles = await visibleArticlesQuery(churchId);

  return dbArticles.map((article) => {
    // Extract section from slug:
    // - "discovery/article-name" (2 parts) -> section = "_root" (no sub-section)
    // - "core-group/vision-meetings/article" (3 parts) -> section = "vision-meetings"
    const slugParts = article.slug.split("/");
    const sectionSlug = slugParts.length > 2 ? slugParts[1] : "_root";
    return toArticleMeta(article, sectionSlug ?? "_root");
  });
});

/**
 * Get articles that match a path prefix
 * e.g., "phase-1" returns all articles in phase 1
 * e.g., "phase-1/introduction" returns all articles in that section
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function getArticlesByPrefix(
  prefix: string,
  churchId: string | null = null
): Promise<ArticleMeta[]> {
  const articles = await getArticles(churchId);
  return articles.filter((article) => article.slug.startsWith(prefix + "/"));
}

/**
 * Build navigation structure from articles, grouped by category
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function getWikiNavigation(
  churchId: string | null = null
): Promise<NavGroup[]> {
  const articles = await getArticles(churchId);

  // Group articles by category, then phase/section
  const categoryMap = new Map<
    ArticleCategory,
    Map<string, Map<string, { title: string; articles: ArticleMeta[] }>>
  >();

  for (const article of articles) {
    const category = article.category;
    const phaseKey = `phase-${article.phase}`;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, new Map());
    }

    const phaseMap = categoryMap.get(category)!;
    if (!phaseMap.has(phaseKey)) {
      phaseMap.set(phaseKey, new Map());
    }

    const sectionMap = phaseMap.get(phaseKey)!;
    if (!sectionMap.has(article.section)) {
      sectionMap.set(article.section, {
        title: formatSectionTitle(article.section),
        articles: [],
      });
    }

    sectionMap.get(article.section)!.articles.push(article);
  }

  // Build NavGroup array
  const groups: NavGroup[] = [];

  // GETTING STARTED - meta content about the wiki
  const gettingStartedContent = categoryMap.get("getting-started");
  if (gettingStartedContent && gettingStartedContent.size > 0) {
    const items: ArticleNavSection["items"] = [];

    for (const [, sectionMap] of gettingStartedContent) {
      for (const [, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        for (const article of sortedArticles) {
          items.push({
            title: article.title,
            slug: article.slug,
            href: wikiHref(article.slug),
          });
        }
      }
    }

    if (items.length > 0) {
      groups.push({
        title: "Getting Started",
        slug: "getting-started",
        sections: [
          {
            title: "Introduction",
            slug: "getting-started",
            items,
          },
        ],
      });
    }
  }

  // THE JOURNEY - phases 0-6
  const journeyPhases = categoryMap.get("journey");
  if (journeyPhases && journeyPhases.size > 0) {
    const sections: ArticleNavSection[] = [];
    const sortedPhases = Array.from(journeyPhases.keys()).sort();

    for (const phaseKey of sortedPhases) {
      const phaseNum = parseInt(phaseKey.replace("phase-", ""), 10);
      const sectionMap = journeyPhases.get(phaseKey)!;
      const phaseSlugPrefix = getPhaseSlugPrefix(phaseNum);

      const items: ArticleNavSection["items"] = [];

      for (const [sectionSlug, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        if (sectionSlug === "_root") {
          // No sub-section - add articles directly to items
          for (const article of sortedArticles) {
            items.push({
              title: article.title,
              slug: article.slug,
              href: wikiHref(article.slug),
            });
          }
        } else {
          // Has sub-section - create nested group
          items.push({
            title: sectionData.title,
            slug: sectionSlug,
            href: wikiHref(`${phaseSlugPrefix}/${sectionSlug}`),
            children: sortedArticles.map((article) => ({
              title: article.title,
              slug: article.slug,
              href: wikiHref(article.slug),
            })),
          });
        }
      }

      sections.push({
        title: `Phase ${phaseNum}: ${getPhaseName(phaseNum)}`,
        slug: phaseKey,
        items,
      });
    }

    groups.push({
      title: "The Journey",
      slug: "journey",
      sections,
    });
  }

  // FRAMEWORKS & CONCEPTS
  const frameworksContent = categoryMap.get("frameworks");
  if (frameworksContent && frameworksContent.size > 0) {
    const items: ArticleNavSection["items"] = [];

    for (const [, sectionMap] of frameworksContent) {
      for (const [, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        for (const article of sortedArticles) {
          items.push({
            title: article.title,
            slug: article.slug,
            href: wikiHref(article.slug),
          });
        }
      }
    }

    if (items.length > 0) {
      groups.push({
        title: "Frameworks & Concepts",
        slug: "frameworks",
        sections: [
          {
            title: "Core Frameworks",
            slug: "frameworks",
            items,
          },
        ],
      });
    }
  }

  // REFERENCE - ministry teams, administrative
  const referenceContent = categoryMap.get("reference");
  if (referenceContent && referenceContent.size > 0) {
    const sections: ArticleNavSection[] = [];

    for (const [, sectionMap] of referenceContent) {
      for (const [sectionSlug, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        sections.push({
          title: sectionData.title,
          slug: sectionSlug,
          items: sortedArticles.map((article) => ({
            title: article.title,
            slug: article.slug,
            href: wikiHref(article.slug),
          })),
        });
      }
    }

    if (sections.length > 0) {
      groups.push({
        title: "Reference",
        slug: "reference",
        sections,
      });
    }
  }

  // RESOURCES - templates, training library
  const resourcesContent = categoryMap.get("resources");
  if (resourcesContent && resourcesContent.size > 0) {
    const sections: ArticleNavSection[] = [];

    for (const [, sectionMap] of resourcesContent) {
      for (const [sectionSlug, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        sections.push({
          title: sectionData.title,
          slug: sectionSlug,
          items: sortedArticles.map((article) => ({
            title: article.title,
            slug: article.slug,
            href: wikiHref(article.slug),
          })),
        });
      }
    }

    if (sections.length > 0) {
      groups.push({
        title: "Resources",
        slug: "resources",
        sections,
      });
    }
  }

  return groups;
}

// ============================================================================
// Article navigation — related articles and prev/next (W-009, #317)
//
// Both affordances are derived, not stored: `related_article_slugs` is an
// authored list of slugs (it carries no titles, and nothing enforces that a
// slug still resolves), and "previous/next" is simply where an article sits
// among its siblings. So both resolve against the SAME visible corpus the rest
// of the wiki reads — `getArticles(churchId)` — which is what makes them obey
// tenancy, publication status and the church-override rule for free.
//
// The resolution steps are pure functions over `ArticleMeta[]` so they can be
// asserted without a database; `getArticleNavigation` is the one call site
// that touches Postgres, and it does so ONCE for both.
// ============================================================================

/**
 * The path an article hangs off — `""` for a top-level slug.
 *
 * This, not `ArticleMeta.section`, is what "the same section" means for
 * prev/next: `section` is a display grouping that collapses to `"_root"` for
 * two-segment slugs, so every phase-level article in the wiki would count as
 * one another's siblings. The parent path is the navigation tree the reader
 * actually sees in the sidebar.
 */
export function articleParentPath(slug: string): string {
  return slug.split("/").slice(0, -1).join("/");
}

/**
 * Navigation order: `sortOrder` first, title as the stable tie-break.
 *
 * The tie-break is not the load-bearing part, and an earlier version of this
 * comment overstated it: `sort_order` DEFAULTS to 999, but every row in the
 * corpus carries an explicit 1–11 authored per section, so ties are the
 * exception rather than the rule. The tie-break is here for the rows that
 * arrive without one — an article inserted straight into the table, or a
 * church's own copy — where the alternative is whatever order Postgres
 * happened to return, which would make "next" non-deterministic.
 */
export function byNavigationOrder(a: ArticleMeta, b: ArticleMeta): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.title.localeCompare(b.title);
}

export type ArticleNavigation = {
  /** Authored cross-links, in the order they were authored. */
  related: ArticleMeta[];
  /** The sibling before this one, or null when this is the first. */
  previous: ArticleMeta | null;
  /** The sibling after this one, or null when this is the last. */
  next: ArticleMeta | null;
};

/**
 * Resolve `related_article_slugs` against the corpus the reader can see.
 *
 * A slug that resolves to nothing is DROPPED rather than rendered dead: the
 * column is authored content with no foreign key behind it, so it accumulates
 * slugs that were renamed, unpublished, or belong to another church. Dropping
 * is also the tenancy behaviour — an article may not advertise a title the
 * reader is not allowed to open.
 *
 * The article's own slug is excluded, and repeats collapse, so a hand-edited
 * list cannot produce a self-link or duplicate React keys.
 */
export function resolveRelatedArticles(
  articles: ArticleMeta[],
  relatedSlugs: readonly string[] | null | undefined,
  currentSlug: string
): ArticleMeta[] {
  if (!relatedSlugs || relatedSlugs.length === 0) {
    return [];
  }

  const bySlug = new Map(articles.map((article) => [article.slug, article]));
  const taken = new Set<string>([currentSlug]);
  const related: ArticleMeta[] = [];

  for (const slug of relatedSlugs) {
    if (taken.has(slug)) continue;

    const article = bySlug.get(slug);
    if (!article) continue;

    taken.add(slug);
    related.push(article);
  }

  return related;
}

/**
 * Where `slug` sits among its siblings — the previous and next article.
 *
 * A slug that is not in `articles` (a section index, an unpublished article)
 * has no position, and therefore no neighbours, rather than borrowing the
 * first pair.
 */
export function resolveSiblingNavigation(
  articles: ArticleMeta[],
  slug: string
): Pick<ArticleNavigation, "previous" | "next"> {
  const parent = articleParentPath(slug);
  const siblings = articles
    .filter((article) => articleParentPath(article.slug) === parent)
    .sort(byNavigationOrder);

  const index = siblings.findIndex((article) => article.slug === slug);
  if (index === -1) {
    return { previous: null, next: null };
  }

  return {
    previous: siblings[index - 1] ?? null,
    next: siblings[index + 1] ?? null,
  };
}

/**
 * Everything the article footer needs, from one read of the visible corpus.
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function getArticleNavigation(
  slug: string,
  relatedSlugs: readonly string[] | null | undefined,
  churchId: string | null = null
): Promise<ArticleNavigation> {
  const articles = await getArticles(churchId);

  return {
    related: resolveRelatedArticles(articles, relatedSlugs, slug),
    ...resolveSiblingNavigation(articles, slug),
  };
}

function formatSectionTitle(section: string): string {
  return section
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getPhaseName(phase: number): string {
  const names: Record<number, string> = {
    0: "Discovery",
    1: "Core Group Development",
    2: "Launch Team Formation",
    3: "Training & Preparation",
    4: "Pre-Launch",
    5: "Launch Sunday",
    6: "Post-Launch",
  };
  return names[phase] || "Unknown";
}

function getPhaseSlugPrefix(phase: number): string {
  const prefixes: Record<number, string> = {
    0: "discovery",
    1: "core-group",
    2: "launch-team",
    3: "training",
    4: "pre-launch",
    5: "launch-sunday",
    6: "post-launch",
  };
  return prefixes[phase] || "unknown";
}
