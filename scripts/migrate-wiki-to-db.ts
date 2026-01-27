/**
 * Wiki MDX to Database Migration Script
 *
 * This script migrates all wiki articles from MDX files to the database.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-wiki-to-db.ts
 *
 * Options:
 *   --dry-run    Preview changes without inserting into database
 */

import { config } from "dotenv";
import fs from "fs/promises";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import {
  wikiArticles,
  wikiSections,
  type NewWikiArticle,
  type NewWikiSection,
  type WikiContentType,
} from "../src/db/schema/wiki";

// Load environment variables
config({ path: ".env.local" });

const WIKI_DIR = path.join(process.cwd(), "wiki");
const DRY_RUN = process.argv.includes("--dry-run");

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

// ============================================================================
// Types
// ============================================================================

interface ParsedArticle {
  slug: string;
  title: string;
  content: string;
  contentType: WikiContentType;
  phase: number | null;
  section: string;
  readTimeMinutes: number;
  sortOrder: number;
  excerpt: string;
}

interface MigrationResult {
  sectionsCreated: number;
  articlesCreated: number;
  errors: string[];
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse the comment-style frontmatter from MDX files
 */
function parseFrontmatter(content: string): {
  data: Record<string, string>;
  content: string;
} {
  const match = content.match(/^\{\/\*\s*([\s\S]*?)\s*\*\/\}/);
  if (!match) {
    return { data: {}, content };
  }

  const frontmatterText = match[1];
  const data: Record<string, string> = {};

  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      data[key] = value;
    }
  }

  // Remove frontmatter from content
  const contentWithoutFrontmatter = content.slice(match[0].length).trim();

  return { data, content: contentWithoutFrontmatter };
}

/**
 * Map MDX type to database content type
 */
function mapContentType(type: string): WikiContentType {
  const mapping: Record<string, WikiContentType> = {
    tutorial: "tutorial",
    "how-to": "how_to",
    how_to: "how_to",
    explanation: "explanation",
    reference: "reference",
    overview: "overview",
    guide: "guide",
  };
  return mapping[type.toLowerCase()] ?? "reference";
}

/**
 * Extract phase number from directory path or frontmatter
 */
function extractPhase(slug: string, frontmatterPhase?: string): number | null {
  // First check frontmatter
  if (frontmatterPhase) {
    const parsed = parseInt(frontmatterPhase, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Try to extract from directory structure
  // e.g., "discovery" -> phase 0, "core-group" -> phase 1
  const topDir = slug.split("/")[0];
  const phaseMapping: Record<string, number> = {
    discovery: 0,
    "core-group": 1,
    "launch-team": 2,
    training: 3,
    "pre-launch": 4,
    "launch-sunday": 5,
    "post-launch": 6,
    // Non-phase sections
    "getting-started": 0,
    frameworks: 0,
    administrative: 0,
  };

  return phaseMapping[topDir] ?? null;
}

// ============================================================================
// Directory Scanning
// ============================================================================

/**
 * Recursively scan directory for MDX files
 */
async function scanDirectory(
  dir: string,
  basePath: string = ""
): Promise<ParsedArticle[]> {
  const articles: ParsedArticle[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const nested = await scanDirectory(fullPath, relativePath);
        articles.push(...nested);
      } else if (entry.name.endsWith(".mdx")) {
        const fileContent = await fs.readFile(fullPath, "utf-8");
        const { data, content } = parseFrontmatter(fileContent);

        const slug = relativePath.replace(/\.mdx$/, "");
        const section = data.section || slug.split("/")[0] || "";

        articles.push({
          slug,
          title: data.title || slug.split("/").pop() || slug,
          content,
          contentType: mapContentType(data.type || "reference"),
          phase: extractPhase(slug, data.phase),
          section,
          readTimeMinutes: parseInt(data.read_time || "5", 10),
          sortOrder: parseInt(data.order || "999", 10),
          excerpt: data.description || "",
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }

  return articles;
}

/**
 * Extract unique sections from articles
 */
function extractSections(articles: ParsedArticle[]): NewWikiSection[] {
  const sectionMap = new Map<string, NewWikiSection>();

  for (const article of articles) {
    const parts = article.slug.split("/");

    // Add each level of the path as a section
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!sectionMap.has(currentPath)) {
        const parentPath = currentPath.includes("/")
          ? currentPath.split("/").slice(0, -1).join("/")
          : null;

        sectionMap.set(currentPath, {
          slug: currentPath,
          name: formatSectionName(part),
          phase: extractPhase(currentPath),
          parentSectionId: parentPath ? undefined : undefined, // Will be linked later
          sortOrder: getSectionSortOrder(currentPath),
        });
      }
    }
  }

  return Array.from(sectionMap.values());
}

function formatSectionName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getSectionSortOrder(slug: string): number {
  const topDir = slug.split("/")[0];
  const order: Record<string, number> = {
    "getting-started": 0,
    discovery: 1,
    "core-group": 2,
    "launch-team": 3,
    training: 4,
    "pre-launch": 5,
    "launch-sunday": 6,
    "post-launch": 7,
    frameworks: 8,
    administrative: 9,
  };
  return order[topDir] ?? 99;
}

// ============================================================================
// Migration
// ============================================================================

async function migrate(): Promise<MigrationResult> {
  const result: MigrationResult = {
    sectionsCreated: 0,
    articlesCreated: 0,
    errors: [],
  };

  console.log("🔍 Scanning wiki directory...");
  const articles = await scanDirectory(WIKI_DIR);
  console.log(`   Found ${articles.length} articles`);

  // Extract sections
  const sections = extractSections(articles);
  console.log(`   Found ${sections.length} sections`);

  if (DRY_RUN) {
    console.log("\n📋 DRY RUN - No changes will be made\n");

    console.log("Sections to create:");
    for (const section of sections) {
      console.log(`  - ${section.slug} (${section.name})`);
    }

    console.log("\nArticles to create:");
    for (const article of articles) {
      console.log(
        `  - ${article.slug} (${article.title}) [${article.contentType}]`
      );
    }

    return result;
  }

  // Create sections
  console.log("\n📁 Creating sections...");
  const sectionIdMap = new Map<string, string>();

  for (const section of sections) {
    try {
      // Check if section already exists
      const existing = await db
        .select()
        .from(wikiSections)
        .where(eq(wikiSections.slug, section.slug))
        .limit(1);

      if (existing.length > 0) {
        sectionIdMap.set(section.slug, existing[0].id);
        console.log(`   ⏭️  Section exists: ${section.slug}`);
        continue;
      }

      // Resolve parent section ID
      const parentSlug = section.slug.includes("/")
        ? section.slug.split("/").slice(0, -1).join("/")
        : null;

      const sectionData: NewWikiSection = {
        ...section,
        parentSectionId: parentSlug ? sectionIdMap.get(parentSlug) : undefined,
      };

      const [created] = await db
        .insert(wikiSections)
        .values(sectionData)
        .returning();

      sectionIdMap.set(section.slug, created.id);
      result.sectionsCreated++;
      console.log(`   ✅ Created section: ${section.slug}`);
    } catch (error) {
      const message = `Failed to create section ${section.slug}: ${error}`;
      result.errors.push(message);
      console.error(`   ❌ ${message}`);
    }
  }

  // Create articles
  console.log("\n📄 Creating articles...");
  for (const article of articles) {
    try {
      // Check if article already exists
      const existing = await db
        .select()
        .from(wikiArticles)
        .where(eq(wikiArticles.slug, article.slug))
        .limit(1);

      if (existing.length > 0) {
        console.log(`   ⏭️  Article exists: ${article.slug}`);
        continue;
      }

      // Resolve section ID
      const sectionSlug = article.slug.split("/").slice(0, -1).join("/");
      const sectionId = sectionSlug ? sectionIdMap.get(sectionSlug) : undefined;

      const articleData: NewWikiArticle = {
        slug: article.slug,
        title: article.title,
        content: article.content,
        contentType: article.contentType,
        phase: article.phase,
        sectionId,
        readTimeMinutes: article.readTimeMinutes,
        sortOrder: article.sortOrder,
        excerpt: article.excerpt,
        status: "published",
        publishedAt: new Date(),
        // churchId is null for global articles
      };

      await db.insert(wikiArticles).values(articleData);
      result.articlesCreated++;
      console.log(`   ✅ Created article: ${article.slug}`);
    } catch (error) {
      const message = `Failed to create article ${article.slug}: ${error}`;
      result.errors.push(message);
      console.error(`   ❌ ${message}`);
    }
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         Wiki MDX to Database Migration Script            ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  try {
    const result = await migrate();

    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║                    Migration Complete                     ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log(`   Sections created: ${result.sectionsCreated}`);
    console.log(`   Articles created: ${result.articlesCreated}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠️  Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`   - ${error}`);
      }
    } else {
      console.log("\n✅ Migration completed successfully!");
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

main();
