import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { DocumentFormat } from "@/lib/documents/types";
import { churches } from "./church";
import { inList } from "./sql";
import { users } from "./user";

// ============================================================================
// Generated document artifacts (DOC-008)
// ============================================================================
//
// Templates themselves stay code-defined (audit decision #15). This table is a
// generation LOG: one row per file a planter actually produced, pointing at
// the bytes in the private Tigris bucket. Re-download reads those bytes; it
// does not re-render.
//
// `church_id` is NOT NULL. Null on a feature table means global content
// (wiki); a generated plant document is never that. Isolation is
// application-layer — there is no RLS — so every read and the signed-URL
// lookup re-assert `church_id` in the WHERE. The storage key is church-scoped
// by prefix (`documents/{churchId}/{uuid}.{ext}`) and is never accepted from
// the client.
//
// `format` is `varchar` plus a CHECK, not a pg ENUM: `.$type<>()` is a
// compile-time brand and nothing else. Widening the vocabulary means widening
// this CHECK in a new migration.
// ============================================================================

/**
 * Output formats a generated artifact may be stored as. Kept in lockstep with
 * `DocumentFormat` via `satisfies` — a new catalog format that is not listed
 * here will not compile, and a CHECK value the catalog does not know is the
 * same failure the other way.
 */
export const generatedDocumentFormats = [
  "pdf",
  "docx",
  "xlsx",
] as const satisfies readonly DocumentFormat[];

export type GeneratedDocumentFormat = (typeof generatedDocumentFormats)[number];

export const generatedDocuments = pgTable(
  "generated_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    /** Catalog template id (code-defined; not a FK). */
    templateId: varchar("template_id", { length: 64 }).notNull(),
    format: varchar("format", { length: 8 })
      .$type<GeneratedDocumentFormat>()
      .notNull(),
    /**
     * Private-bucket object key, never a URL.
     * Shape: `documents/{churchId}/{id}.{ext}`.
     */
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("generated_documents_church_created_at_idx").on(
      table.churchId,
      table.createdAt
    ),
    uniqueIndex("generated_documents_storage_key_idx").on(table.storageKey),
    check(
      "generated_documents_format_check",
      sql`${table.format} in (${inList(generatedDocumentFormats)})`
    ),
  ]
);

export type GeneratedDocument = typeof generatedDocuments.$inferSelect;
export type NewGeneratedDocument = typeof generatedDocuments.$inferInsert;
