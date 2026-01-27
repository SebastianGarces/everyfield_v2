import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { churches } from "./church";

/**
 * Wiki sections for navigation hierarchy
 */
export const wikiSections = pgTable(
  "wiki_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    parentSectionId: uuid("parent_section_id").references(
      (): AnyPgColumn => wikiSections.id
    ),
    phase: integer("phase"), // 0-6, null for cross-phase sections
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wiki_sections_slug_idx").on(table.slug),
  ]
);

export type WikiSection = typeof wikiSections.$inferSelect;
export type NewWikiSection = typeof wikiSections.$inferInsert;

/**
 * Content type enum values matching FRD
 */
export const wikiContentTypes = [
  "tutorial",
  "how_to",
  "explanation",
  "reference",
  "overview",
  "guide",
] as const;

export type WikiContentType = (typeof wikiContentTypes)[number];

/**
 * Article status enum values
 */
export const wikiArticleStatuses = ["draft", "published", "archived"] as const;

export type WikiArticleStatus = (typeof wikiArticleStatuses)[number];

/**
 * Wiki articles - main content storage
 *
 * church_id = NULL means global article (visible to all)
 * church_id = <uuid> means church-specific article (future feature)
 */
export const wikiArticles = pgTable(
  "wiki_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id").references(() => churches.id), // null = global
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(), // Raw MDX content
    excerpt: text("excerpt"),
    contentType: text("content_type", {
      enum: wikiContentTypes,
    }).notNull(),
    phase: integer("phase"), // 0-6, null for cross-phase content
    sectionId: uuid("section_id").references(() => wikiSections.id),
    readTimeMinutes: integer("read_time_minutes"),
    sortOrder: integer("sort_order").default(999).notNull(),
    relatedArticleSlugs: text("related_article_slugs").array(), // Array of slugs for related articles
    status: text("status", {
      enum: wikiArticleStatuses,
    })
      .default("published")
      .notNull(),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Slug must be unique within a church scope (or globally if church_id is null)
    uniqueIndex("wiki_articles_slug_church_idx").on(table.slug, table.churchId),
    index("wiki_articles_status_idx").on(table.status),
    index("wiki_articles_section_idx").on(table.sectionId),
    index("wiki_articles_phase_idx").on(table.phase),
  ]
);

export type WikiArticle = typeof wikiArticles.$inferSelect;
export type NewWikiArticle = typeof wikiArticles.$inferInsert;
