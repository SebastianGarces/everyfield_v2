import type { ArticleMeta, ArticleCategory, ArticleNavSection, NavGroup } from "./types";
import { toArticleMeta } from "./types";
import { getAllPublishedArticles } from "./service";

/**
 * Get all wiki articles with metadata
 */
export async function getArticles(): Promise<ArticleMeta[]> {
  const dbArticles = await getAllPublishedArticles();

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
 */
export async function getArticlesByPrefix(prefix: string): Promise<ArticleMeta[]> {
  const articles = await getArticles();
  return articles.filter((article) => article.slug.startsWith(prefix + "/"));
}

/**
 * Build navigation structure from articles, grouped by category
 */
export async function getWikiNavigation(): Promise<NavGroup[]> {
  const articles = await getArticles();

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
            href: `/wiki/${article.slug}`,
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
              href: `/wiki/${article.slug}`,
            });
          }
        } else {
          // Has sub-section - create nested group
          items.push({
            title: sectionData.title,
            slug: sectionSlug,
            href: `/wiki/${phaseSlugPrefix}/${sectionSlug}`,
            children: sortedArticles.map((article) => ({
              title: article.title,
              slug: article.slug,
              href: `/wiki/${article.slug}`,
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
            href: `/wiki/${article.slug}`,
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
            href: `/wiki/${article.slug}`,
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
            href: `/wiki/${article.slug}`,
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
