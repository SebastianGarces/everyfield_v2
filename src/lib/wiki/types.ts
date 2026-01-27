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
 * Infer category from phase and section
 */
function inferCategory(phase: number | null, section: string): ArticleCategory {
  if (section === "getting-started") return "getting-started";
  if (section === "frameworks") return "frameworks";

  const referenceSections = ["ministry-teams", "administrative"];
  if (referenceSections.includes(section)) return "reference";

  const resourceSections = ["templates", "training-library"];
  if (resourceSections.includes(section)) return "resources";

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
