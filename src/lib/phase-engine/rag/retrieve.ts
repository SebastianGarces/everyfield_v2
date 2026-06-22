// ============================================================================
// Hybrid methodology retrieval (PE-008 / AC-PE-6).
//
// Given a query and the plant's current phase, return the methodology passages
// most relevant to grounding a judge insight. Retrieval is *hybrid*:
//
//   1. Dense: pgvector cosine similarity over `methodology_embeddings.embedding`
//      (the embedded playbook + wiki corpus).
//   2. Sparse: the existing weighted wiki `tsvector` FTS over `wiki_articles`.
//
// Results are fused (reciprocal-rank fusion) and phase-filtered so phase-
// relevant passages rank first. Every returned passage carries its source
// `articleSlug` (when known) so the judge can cite/link the wiki article.
// ============================================================================

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { db } from "@/db";
import { methodologyEmbeddings } from "@/db/schema";
import { wikiArticles } from "@/db/schema";
import { embedQuery } from "./embed";

/** A retrieved methodology passage with provenance for citing. */
export interface RetrievedPassage {
  /** Stable source-document key (`<wiki-slug>` or `playbook:<section>`). */
  docKey: string;
  /** Citable wiki article slug, when the passage maps to one (null otherwise). */
  articleSlug: string | null;
  /** Origin corpus. */
  source: string;
  /** Heading/section label the chunk was split on. */
  section: string | null;
  /** Phase tag (0-6), or null for phase-agnostic content. */
  phase: number | null;
  /** The passage text to feed the judge. */
  content: string;
  /** Fused relevance score (higher = more relevant). */
  score: number;
}

export interface RetrieveOptions {
  /** The plant's current phase; phase-matching passages are boosted/ranked first. */
  phase?: number | null;
  /** Max passages to return after fusion. */
  limit?: number;
  /** How many candidates to pull from each retriever before fusing. */
  candidatesPerRetriever?: number;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_CANDIDATES = 20;
// Reciprocal-rank-fusion constant; 60 is the value from the original RRF paper.
const RRF_K = 60;

interface Candidate {
  docKey: string;
  articleSlug: string | null;
  source: string;
  section: string | null;
  phase: number | null;
  content: string;
}

/**
 * Phase-filtered hybrid retrieval.
 *
 * @returns ranked passages, each carrying its `articleSlug` for citation.
 */
export async function retrieve(
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedPassage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const {
    phase = null,
    limit = DEFAULT_LIMIT,
    candidatesPerRetriever = DEFAULT_CANDIDATES,
  } = options;

  const [dense, sparse] = await Promise.all([
    denseSearch(trimmed, phase, candidatesPerRetriever),
    sparseSearch(trimmed, candidatesPerRetriever),
  ]);

  return fuse(dense, sparse, phase, limit);
}

// ----------------------------------------------------------------------------
// Dense retrieval — pgvector cosine over the embedded corpus.
//
// `phase` is applied as a soft preference: passages matching the plant's phase
// (or phase-agnostic, null) are retrieved first. We embed the query through the
// same provider module the corpus was embedded with, so the spaces align.
// ----------------------------------------------------------------------------
async function denseSearch(
  query: string,
  phase: number | null,
  candidates: number
): Promise<Candidate[]> {
  const queryEmbedding = await embedQuery(query);

  const distance = cosineDistance(
    methodologyEmbeddings.embedding,
    queryEmbedding
  );

  // When a phase is supplied, restrict to that phase + phase-agnostic chunks so
  // off-phase methodology can't outrank on-phase guidance.
  const phaseFilter =
    phase === null
      ? undefined
      : or(
          eq(methodologyEmbeddings.phase, phase),
          isNull(methodologyEmbeddings.phase)
        );

  const rows = await db
    .select({
      docKey: methodologyEmbeddings.docKey,
      articleSlug: methodologyEmbeddings.articleSlug,
      source: methodologyEmbeddings.source,
      section: methodologyEmbeddings.section,
      phase: methodologyEmbeddings.phase,
      content: methodologyEmbeddings.content,
    })
    .from(methodologyEmbeddings)
    .where(phaseFilter)
    .orderBy(distance)
    .limit(candidates);

  return rows;
}

// ----------------------------------------------------------------------------
// Sparse retrieval — reuse the existing weighted wiki FTS (title A > excerpt B
// > content C). Returns wiki articles as methodology candidates carrying their
// own slug for citation. Playbook chunks have no FTS index, so the sparse arm
// is wiki-only by design; the dense arm covers the playbook.
// ----------------------------------------------------------------------------
async function sparseSearch(
  query: string,
  candidates: number
): Promise<Candidate[]> {
  const searchVector = sql`(
    setweight(to_tsvector('english', ${wikiArticles.title}), 'A') ||
    setweight(to_tsvector('english', coalesce(${wikiArticles.excerpt}, '')), 'B') ||
    setweight(to_tsvector('english', ${wikiArticles.content}), 'C')
  )`;
  const searchQuery = sql`websearch_to_tsquery('english', ${query})`;

  const rows = await db
    .select({
      slug: wikiArticles.slug,
      title: wikiArticles.title,
      excerpt: wikiArticles.excerpt,
      content: wikiArticles.content,
      phase: wikiArticles.phase,
    })
    .from(wikiArticles)
    .where(
      and(
        sql`${searchVector} @@ ${searchQuery}`,
        eq(wikiArticles.status, "published"),
        isNull(wikiArticles.churchId)
      )
    )
    .orderBy(sql`ts_rank(${searchVector}, ${searchQuery}) DESC`)
    .limit(candidates);

  return rows.map((r) => ({
    docKey: r.slug,
    articleSlug: r.slug,
    source: "wiki",
    section: r.title,
    phase: r.phase,
    // Prefer the excerpt as the citable passage; fall back to the body head.
    content: r.excerpt ?? r.content.slice(0, 1200),
  }));
}

// ----------------------------------------------------------------------------
// Fusion — reciprocal-rank fusion across the two retrievers, plus a phase
// boost so on-phase passages rank first (AC: "phase-relevant passages rank
// first"). Deduped by docKey, keeping the best-scoring candidate.
// ----------------------------------------------------------------------------
function fuse(
  dense: Candidate[],
  sparse: Candidate[],
  phase: number | null,
  limit: number
): RetrievedPassage[] {
  const scores = new Map<string, RetrievedPassage>();

  const accumulate = (list: Candidate[]) => {
    list.forEach((cand, rank) => {
      const rrf = 1 / (RRF_K + rank + 1);
      const existing = scores.get(cand.docKey);
      if (existing) {
        existing.score += rrf;
      } else {
        scores.set(cand.docKey, {
          docKey: cand.docKey,
          articleSlug: cand.articleSlug,
          source: cand.source,
          section: cand.section,
          phase: cand.phase,
          content: cand.content,
          score: rrf,
        });
      }
    });
  };

  accumulate(dense);
  accumulate(sparse);

  // Phase boost: exact phase match floats to the top, phase-agnostic next.
  if (phase !== null) {
    for (const passage of scores.values()) {
      if (passage.phase === phase) passage.score += 0.05;
    }
  }

  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
