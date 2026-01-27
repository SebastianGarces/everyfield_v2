import { eq, and, isNull, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  wikiArticles,
  wikiSections,
  type WikiArticle,
  type NewWikiArticle,
  type WikiSection,
  type NewWikiSection,
} from "@/db/schema";
import { revalidatePath } from "next/cache";

// ============================================================================
// Article Queries
// ============================================================================

/**
 * Get a single article by slug
 * For global articles, churchId should be null
 */
export async function getArticleBySlug(
  slug: string,
  churchId: string | null = null
): Promise<WikiArticle | null> {
  const conditions = churchId
    ? and(eq(wikiArticles.slug, slug), eq(wikiArticles.churchId, churchId))
    : and(eq(wikiArticles.slug, slug), isNull(wikiArticles.churchId));

  const result = await db
    .select()
    .from(wikiArticles)
    .where(and(conditions, eq(wikiArticles.status, "published")))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all published articles (for generateStaticParams)
 * Returns only global articles (churchId = null)
 */
export async function getAllPublishedArticles(): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(isNull(wikiArticles.churchId), eq(wikiArticles.status, "published"))
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * Get articles by section
 */
export async function getArticlesBySection(
  sectionId: string
): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.sectionId, sectionId),
        eq(wikiArticles.status, "published")
      )
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

/**
 * Get articles by phase
 */
export async function getArticlesByPhase(phase: number): Promise<WikiArticle[]> {
  return db
    .select()
    .from(wikiArticles)
    .where(
      and(
        eq(wikiArticles.phase, phase),
        eq(wikiArticles.status, "published"),
        isNull(wikiArticles.churchId)
      )
    )
    .orderBy(asc(wikiArticles.sortOrder));
}

// ============================================================================
// Article Mutations
// ============================================================================

/**
 * Create a new article
 */
export async function createArticle(
  data: NewWikiArticle
): Promise<WikiArticle> {
  const result = await db.insert(wikiArticles).values(data).returning();
  return result[0];
}

/**
 * Update an existing article
 */
export async function updateArticle(
  id: string,
  data: Partial<NewWikiArticle>
): Promise<WikiArticle | null> {
  const result = await db
    .update(wikiArticles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(wikiArticles.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Delete an article (soft delete by setting status to archived)
 */
export async function archiveArticle(id: string): Promise<WikiArticle | null> {
  const result = await db
    .update(wikiArticles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(wikiArticles.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Hard delete an article (use with caution)
 */
export async function deleteArticle(id: string): Promise<void> {
  await db.delete(wikiArticles).where(eq(wikiArticles.id, id));
}

// ============================================================================
// Section Queries
// ============================================================================

/**
 * Get all sections
 */
export async function getAllSections(): Promise<WikiSection[]> {
  return db
    .select()
    .from(wikiSections)
    .orderBy(asc(wikiSections.sortOrder));
}

/**
 * Get a section by slug
 */
export async function getSectionBySlug(
  slug: string
): Promise<WikiSection | null> {
  const result = await db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.slug, slug))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get child sections of a parent
 */
export async function getChildSections(
  parentSectionId: string
): Promise<WikiSection[]> {
  return db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.parentSectionId, parentSectionId))
    .orderBy(asc(wikiSections.sortOrder));
}

/**
 * Get root sections (no parent)
 */
export async function getRootSections(): Promise<WikiSection[]> {
  return db
    .select()
    .from(wikiSections)
    .where(isNull(wikiSections.parentSectionId))
    .orderBy(asc(wikiSections.sortOrder));
}

// ============================================================================
// Section Mutations
// ============================================================================

/**
 * Create a new section
 */
export async function createSection(
  data: NewWikiSection
): Promise<WikiSection> {
  const result = await db.insert(wikiSections).values(data).returning();
  return result[0];
}

/**
 * Update an existing section
 */
export async function updateSection(
  id: string,
  data: Partial<NewWikiSection>
): Promise<WikiSection | null> {
  const result = await db
    .update(wikiSections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(wikiSections.id, id))
    .returning();

  return result[0] ?? null;
}

/**
 * Delete a section
 */
export async function deleteSection(id: string): Promise<void> {
  await db.delete(wikiSections).where(eq(wikiSections.id, id));
}

// ============================================================================
// Revalidation Helpers
// ============================================================================

/**
 * Revalidate a specific article page
 */
export function revalidateArticle(slug: string): void {
  revalidatePath(`/wiki/${slug}`);
}

/**
 * Revalidate the wiki index and navigation
 */
export function revalidateWikiIndex(): void {
  revalidatePath("/wiki");
}

/**
 * Revalidate all wiki pages (use sparingly)
 */
export function revalidateAllWiki(): void {
  revalidatePath("/wiki", "layout");
}
