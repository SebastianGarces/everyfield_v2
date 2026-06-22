CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "methodology_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(20) NOT NULL,
	"doc_key" text NOT NULL,
	"article_slug" text,
	"phase" integer,
	"section" text,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "methodology_embeddings_doc_chunk_idx" ON "methodology_embeddings" USING btree ("doc_key","chunk_index");--> statement-breakpoint
CREATE INDEX "methodology_embeddings_embedding_idx" ON "methodology_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "methodology_embeddings_phase_idx" ON "methodology_embeddings" USING btree ("phase");