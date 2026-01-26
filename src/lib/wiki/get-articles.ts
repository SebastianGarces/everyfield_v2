import fs from "fs/promises";
import path from "path";
import type { ArticleMeta, ArticleNavSection } from "./types";

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

        articles.push({
          slug,
          title: frontmatter.title || slug,
          type: (frontmatter.type as ArticleMeta["type"]) || "reference",
          phase: parseInt(frontmatter.phase || "0", 10),
          section: frontmatter.section || "",
          order: parseInt(frontmatter.order || "999", 10),
          readTime: parseInt(frontmatter.read_time || "5", 10),
          description: frontmatter.description || "",
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
 * Build navigation structure from articles
 */
export async function getWikiNavigation(): Promise<ArticleNavSection[]> {
  const articles = await getArticles();

  // Group articles by phase and section
  const phaseMap = new Map<
    string,
    Map<string, { title: string; articles: ArticleMeta[] }>
  >();

  for (const article of articles) {
    const phaseKey = `phase-${article.phase}`;

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

  // Convert to navigation structure
  const sections: ArticleNavSection[] = [];

  // Sort phases
  const sortedPhases = Array.from(phaseMap.keys()).sort();

  for (const phaseKey of sortedPhases) {
    const phaseNum = parseInt(phaseKey.replace("phase-", ""), 10);
    const sectionMap = phaseMap.get(phaseKey)!;

    const items: ArticleNavSection["items"] = [];

    for (const [sectionSlug, sectionData] of sectionMap) {
      // Sort articles within section by order, then by title
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

  return sections;
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
