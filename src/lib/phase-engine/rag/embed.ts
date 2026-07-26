// ============================================================================
// Embedding provider (PE-008).
//
// The methodology RAG layer's embedding model lives behind this single module
// so the provider/model is a one-line swap (FRD §10 "provider stays behind a
// module for one-line swaps"). Today: OpenAI `text-embedding-3-small` (1536
// dims) via the Vercel AI SDK, matching the `vector(1536)` column on
// `methodology_embeddings`.
//
// Both `retrieve()` (one query embedding) and the corpus-embed script (batched
// passage embeddings) go through here, so they can never drift apart.
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

/** The embedding model id of record. Recorded conceptually as part of the RAG contract. */
export const EMBEDDING_MODEL_ID = "text-embedding-3-small" as const;

/** Output dimensionality — must match the `vector(1536)` schema column. */
export const EMBEDDING_DIMENSIONS = 1536 as const;

/**
 * Swap point. Reads `OPENAI_API_KEY` from the environment (set in `.env.local`).
 * Created lazily so importing this module never throws when the key is absent
 * (e.g. in unit tests that don't embed).
 */
function getEmbeddingModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — required to embed the methodology corpus."
    );
  }
  return createOpenAI({ apiKey }).embedding(EMBEDDING_MODEL_ID);
}

/** Embed a single value (used by retrieval to embed the incoming query). */
export async function embedQuery(value: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value,
  });
  return embedding;
}

/**
 * Embed many values at once (used by the corpus-embed script). Returns vectors
 * in the same order as the input, so callers can zip them back onto chunks.
 */
export async function embedBatch(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values,
  });
  return embeddings;
}
