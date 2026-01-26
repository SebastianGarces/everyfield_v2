import fs from "fs/promises";
import path from "path";
import type { ArticleMeta, ArticleCategory, ArticleNavSection, NavGroup } from "./types";

const WIKI_DIR = path.join(process.cwd(), "wiki");

/**
 * Parse the comment-style frontmatter from MDX files
 * Format: {/* key: value */
// */}
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^\{\/\*\s*([\s\S]*?)\s*\*\/\}/);
  if (!match) return {};

  const frontmatterText = match[1];
  const result: Record<string, string> = {};

  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert filename to URL-friendly slug
 */
function fileToSlug(filename: string): string {
  return filename.replace(/\.mdx?$/, "");
}

/**
 * Infer category from article metadata
 */
function inferCategory(phase: number | null, section: string): ArticleCategory {
  if (section === "getting-started") return "getting-started";
  if (section === "frameworks") return "frameworks";

  // Reference sections
  const referenceSections = ["ministry-teams", "administrative"];
  if (referenceSections.includes(section)) return "reference";

  // Resources sections
  const resourceSections = ["templates", "training-library"];
  if (resourceSections.includes(section)) return "resources";

  // Phases 0-6 are journey content
  return "journey";
}

/**
 * Recursively scan directory for MDX files
 */
async function scanDirectory(
  dir: string,
  basePath: string = ""
): Promise<ArticleMeta[]> {
  const articles: ArticleMeta[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const nested = await scanDirectory(fullPath, relativePath);
        articles.push(...nested);
      } else if (entry.name.endsWith(".mdx")) {
        const content = await fs.readFile(fullPath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        const slug = fileToSlug(relativePath);
        const phase = parseInt(frontmatter.phase || "0", 10);
        const section = frontmatter.section || "";

        articles.push({
          slug,
          title: frontmatter.title || slug,
          type: (frontmatter.type as ArticleMeta["type"]) || "reference",
          phase,
          section,
          order: parseInt(frontmatter.order || "999", 10),
          readTime: parseInt(frontmatter.read_time || "5", 10),
          description: frontmatter.description || "",
          category:
            (frontmatter.category as ArticleCategory) ||
            inferCategory(phase, section),
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }

  return articles;
}

/**
 * Get all wiki articles with metadata
 */
export async function getArticles(): Promise<ArticleMeta[]> {
  return scanDirectory(WIKI_DIR);
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

      const items: ArticleNavSection["items"] = [];

      for (const [sectionSlug, sectionData] of sectionMap) {
        const sortedArticles = sectionData.articles.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });

        items.push({
          title: sectionData.title,
          slug: sectionSlug,
          href: `/wiki/${phaseKey}/${sectionSlug}`,
          children: sortedArticles.map((article) => ({
            title: article.title,
            slug: article.slug,
            href: `/wiki/${article.slug}`,
          })),
        });
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
