import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

// ============================================================================
// Methodology RAG store — the embedded church-planting corpus (PE-008).
//
// One row per heading-chunked passage of the methodology corpus (the Launch
// Playbook + the wiki articles). The Phase Engine judge retrieves phase-
// relevant passages from here (pgvector cosine) to ground its insights and
// cite source articles. The rubric is NOT embedded — it is loaded whole into
// the judge prompt.
//
// Tenant note: this corpus is GLOBAL methodology content, not church data, so
// it is intentionally NOT church_id-scoped. No plant-specific text is ever
// stored here.
//
// Owned by the schema unit (single migration owner); populated idempotently by
// the corpus-embed script (PE-rag-infra).
// ============================================================================

/** Origin of a chunk — used for retrieval weighting and provenance. */
export const methodologySources = ["wiki", "playbook"] as const;
export type MethodologySource = (typeof methodologySources)[number];

export const methodologyEmbeddings = pgTable(
  "methodology_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Where the chunk came from (wiki article vs. the Launch Playbook).
    source: varchar("source", { length: 20 })
      .$type<MethodologySource>()
      .notNull(),
    // Stable identity of the source document for idempotent re-embedding:
    // the wiki slug, or a "playbook:<section>" key. Unique with chunkIndex.
    docKey: text("doc_key").notNull(),
    // Citable wiki article slug (null for playbook-only chunks) — the judge
    // surfaces this as a "related article" link on an insight.
    articleSlug: text("article_slug"),
    // Phase tag (0-6) for phase-filtered retrieval; null = phase-agnostic.
    phase: integer("phase"),
    // Heading/section label the chunk was split on.
    section: text("section"),
    // Ordinal of the chunk within its source document.
    chunkIndex: integer("chunk_index").notNull(),
    // The chunk text supplied to the embedder and shown as a retrieved passage.
    content: text("content").notNull(),
    // text-embedding-3-small → 1536 dimensions.
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Idempotent upsert target — re-embedding a doc updates rows, not appends.
    uniqueIndex("methodology_embeddings_doc_chunk_idx").on(
      table.docKey,
      table.chunkIndex
    ),
    // Approximate nearest-neighbour search over the embedding (cosine).
    index("methodology_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // Phase-filtered retrieval ranks phase-relevant passages first.
    index("methodology_embeddings_phase_idx").on(table.phase),
  ]
);

export type MethodologyEmbedding = typeof methodologyEmbeddings.$inferSelect;
export type NewMethodologyEmbedding = typeof methodologyEmbeddings.$inferInsert;
