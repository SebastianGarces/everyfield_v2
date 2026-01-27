import type { WikiArticle, WikiContentType } from "@/db/schema";

// Re-export database types for convenience
export type { WikiArticle, WikiSection, WikiContentType } from "@/db/schema";

// Legacy type aliases for backward compatibility during migration
export type ArticleType = WikiContentType | "overview" | "guide" | "how-to";

export type ArticleCategory =
  | "journey"
  | "reference"
  | "resources"
  | "getting-started"
  | "frameworks";

/**
 * Lightweight article metadata (for lists, navigation)
 */
export type ArticleMeta = {
  slug: string;
  title: string;
  type: ArticleType;
  phase: number | null;
  section: string;
  order: number;
  readTime: number;
  description: string;
  category: ArticleCategory;
};

/**
 * Full article with content
 */
export type Article = ArticleMeta & {
  content: string;
};

/**
 * Convert database WikiArticle to legacy Article format
 */
export function toArticle(dbArticle: WikiArticle, sectionSlug: string): Article {
  return {
    slug: dbArticle.slug,
    title: dbArticle.title,
    type: normalizeContentType(dbArticle.contentType),
    phase: dbArticle.phase ?? 0,
    section: sectionSlug,
    order: dbArticle.sortOrder,
    readTime: dbArticle.readTimeMinutes ?? 5,
    description: dbArticle.excerpt ?? "",
    category: inferCategory(dbArticle.phase, sectionSlug),
    content: dbArticle.content,
  };
}

/**
 * Convert database WikiArticle to ArticleMeta (without content)
 */
export function toArticleMeta(dbArticle: WikiArticle, sectionSlug: string): ArticleMeta {
  // Use the first part of slug for category inference
  const topLevelFolder = dbArticle.slug.split("/")[0] ?? "";
  return {
    slug: dbArticle.slug,
    title: dbArticle.title,
    type: normalizeContentType(dbArticle.contentType),
    phase: dbArticle.phase ?? 0,
    section: sectionSlug,
    order: dbArticle.sortOrder,
    readTime: dbArticle.readTimeMinutes ?? 5,
    description: dbArticle.excerpt ?? "",
    category: inferCategory(dbArticle.phase, topLevelFolder),
  };
}

/**
 * Normalize content type from DB to legacy format
 */
function normalizeContentType(contentType: WikiContentType): ArticleType {
  // Map DB content types to legacy types
  const mapping: Record<WikiContentType, ArticleType> = {
    tutorial: "tutorial",
    how_to: "how-to",
    explanation: "reference",
    reference: "reference",
    overview: "overview",
    guide: "guide",
  };
  return mapping[contentType] ?? "reference";
}

/**
 * Infer category from phase and top-level folder
 */
function inferCategory(phase: number | null, topLevelFolder: string): ArticleCategory {
  if (topLevelFolder === "getting-started") return "getting-started";
  if (topLevelFolder === "frameworks") return "frameworks";

  const referenceFolders = ["ministry-teams", "administrative"];
  if (referenceFolders.includes(topLevelFolder)) return "reference";

  const resourceFolders = ["templates", "training-library"];
  if (resourceFolders.includes(topLevelFolder)) return "resources";

  return "journey";
}

export type ArticleNavItem = {
  title: string;
  slug: string;
  href: string;
  phase?: number;
  section?: string;
  children?: ArticleNavItem[];
};

export type ArticleNavSection = {
  title: string;
  slug: string;
  items: ArticleNavItem[];
};

export type NavGroup = {
  title: string;
  slug: string;
  sections: ArticleNavSection[];
};
