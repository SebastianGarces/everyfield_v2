// ============================================================================
// Methodology RAG layer (PE-008) — public surface.
//
// The Phase Engine judge consumes `retrieve()` to ground its insights in the
// church-planting methodology (Launch Playbook + wiki) and cite source
// articles. Chunking + the swappable embedding provider are exported for the
// one-time corpus-embed script (`scripts/embed-methodology-corpus.ts`).
// ============================================================================

export { chunkMarkdown, estimateTokens } from "./chunk";
export type { MethodologyChunk, ChunkOptions } from "./chunk";

export {
  embedQuery,
  embedBatch,
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
} from "./embed";

export { retrieve } from "./retrieve";
export type { RetrievedPassage, RetrieveOptions } from "./retrieve";
