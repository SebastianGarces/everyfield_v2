import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { wikiArticles, type WikiArticle } from "@/db/schema";
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
    .where(and(visibleToChurch(churchId), eq(wikiArticles.status, "published")))
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * One slug, resolved against what `churchId` may see.
 *
 * At most two rows can match: `wiki_articles_slug_church_idx` is unique on
 * (slug, church_id), and the predicate admits exactly two church scopes — the
 * global one and the caller's.
 *
 * This builder backs `getArticle` but lives here, next to the predicate it
 * shares, because `get-article.ts` imports the MDX compiler and so cannot be
 * loaded by the test runner — the tenancy assertions in `tenancy.test.ts`
 * would have nothing to inspect.
 */
export function articleBySlugQuery(slug: string, churchId: string | null) {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.slug, slug),
        visibleToChurch(churchId),
        eq(wikiArticles.status, "published")
      )
    )
    .limit(2);
}

/**
 * Collapse a global article and a church's article of the SAME slug to one.
 *
 * `wiki_articles_slug_church_idx` is unique on (slug, church_id), so a church
 * may hold its own version of a global slug; the church's copy wins (it is an
 * override, and two rows with one slug would otherwise duplicate the article
 * in lists, navigation and React keys). Insertion order — sort order — is
 * preserved.
 */
export function preferChurchOverride(articles: WikiArticle[]): WikiArticle[] {
  const bySlug = new Map<string, WikiArticle>();

  for (const article of articles) {
    const held = bySlug.get(article.slug);
    if (!held || (held.churchId === null && article.churchId !== null)) {
      bySlug.set(article.slug, article);
    }
  }

  return Array.from(bySlug.values());
}

/**
 * Get all wiki articles with metadata, scoped to a church.
 *
 * @param churchId - the reader's church; omit (or pass null) for global only.
 */
export async function getArticles(
  churchId: string | null = null
): Promise<ArticleMeta[]> {
  const dbArticles = preferChurchOverride(await visibleArticlesQuery(churchId));

  return dbArticles.map((article) => {
    // Extract section from slug:
    // - "discovery/article-name" (2 parts) -> section = "_root" (no sub-section)
    // - "core-group/vision-meetings/article" (3 parts) -> section = "vision-meetings"
    const slugParts = article.slug.split("/");
    const sectionSlug = slugParts.length > 2 ? slugParts[1] : "_root";
    return toArticleMeta(article, sectionSlug ?? "_root");
  });
}

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
