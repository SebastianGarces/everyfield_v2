// ============================================================================
// Methodology corpus chunking (PE-008).
//
// Splits markdown/MDX documents (the Launch Playbook + wiki articles) into
// retrieval passages by heading, targeting ~300–800 tokens per chunk with a
// small overlap. Each chunk carries section/heading + phase + article_slug
// metadata so retrieval can phase-filter and the judge can cite the source
// article.
//
// Pure, deterministic, and side-effect-free — this is the unit-tested core of
// the RAG layer. Embedding + persistence live in `embed.ts` / the corpus-embed
// script.
// ============================================================================

/** A heading-delimited passage ready to embed. */
export interface MethodologyChunk {
  /** Ordinal of the chunk within its source document (0-based). */
  chunkIndex: number;
  /** Heading/section label the chunk was split on (null for a preamble). */
  section: string | null;
  /** The passage text supplied to the embedder. */
  content: string;
}

/** Tuning knobs for {@link chunkMarkdown}. All sizes are in *estimated tokens*. */
export interface ChunkOptions {
  /** Target lower bound; sections shorter than this merge into a neighbour. */
  minTokens?: number;
  /** Target upper bound; sections longer than this are sub-split by paragraph. */
  maxTokens?: number;
  /** Token overlap carried between adjacent sub-splits of one section. */
  overlapTokens?: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  minTokens: 300,
  maxTokens: 800,
  overlapTokens: 50,
};

// Heading lines from level 2 (##) down to level 4 (####). Level-1 (#) is the
// document title and is treated as preamble context, not a chunk boundary.
const HEADING_RE = /^(#{2,4})\s+(.+?)\s*#*$/;

/**
 * Rough token estimate. We intentionally avoid a tokenizer dependency: chunk
 * boundaries only need to be approximately right, and ~4 chars/token is the
 * standard OpenAI heuristic for English prose.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface HeadingSection {
  section: string | null;
  content: string;
}

/** Split raw markdown into heading-delimited sections (preamble first). */
function splitByHeading(markdown: string): HeadingSection[] {
  const lines = markdown.split("\n");
  const sections: HeadingSection[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content.length > 0) {
      sections.push({ section: currentHeading, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      flush();
      currentHeading = match[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Sub-split an over-long section by paragraph, packing paragraphs up to
 * `maxTokens` and carrying `overlapTokens` of trailing text into the next part
 * so context isn't severed mid-idea.
 */
function packParagraphs(
  content: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const parts: string[] = [];
  let current: string[] = [];

  const currentTokens = () => estimateTokens(current.join("\n\n"));

  for (const para of paragraphs) {
    if (
      current.length > 0 &&
      currentTokens() + estimateTokens(para) > maxTokens
    ) {
      const text = current.join("\n\n");
      parts.push(text);
      // Seed the next part with a small trailing overlap from this one.
      const overlap = tailByTokens(text, overlapTokens);
      current = overlap ? [overlap] : [];
    }
    current.push(para);
  }
  if (current.length > 0) parts.push(current.join("\n\n"));

  return parts;
}

/** Return the trailing slice of `text` that is roughly `tokens` long. */
function tailByTokens(text: string, tokens: number): string {
  if (tokens <= 0) return "";
  const chars = tokens * 4;
  if (text.length <= chars) return "";
  return text.slice(text.length - chars).trimStart();
}

/**
 * Chunk a markdown/MDX document into heading-delimited passages.
 *
 * - Sections at or above `maxTokens` are sub-split by paragraph (with overlap).
 * - Adjacent sections below `minTokens` are merged forward to avoid tiny,
 *   low-signal chunks.
 * - The leading heading is prepended to each chunk's text so the embedding and
 *   the retrieved passage both carry the section context.
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions = {}
): MethodologyChunk[] {
  const { minTokens, maxTokens, overlapTokens } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const sections = splitByHeading(markdown);

  // Merge runs of small sections forward so we don't emit sub-minTokens chunks.
  const merged: HeadingSection[] = [];
  for (const sec of sections) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      estimateTokens(prev.content) < minTokens &&
      estimateTokens(prev.content) + estimateTokens(sec.content) <= maxTokens
    ) {
      prev.content = `${prev.content}\n\n${sec.content}`;
      // Keep the first heading as the section label for the merged block.
      prev.section = prev.section ?? sec.section;
    } else {
      merged.push({ ...sec });
    }
  }

  const chunks: MethodologyChunk[] = [];
  let index = 0;

  for (const sec of merged) {
    const heading = sec.section ? `## ${sec.section}\n\n` : "";
    const parts =
      estimateTokens(sec.content) > maxTokens
        ? packParagraphs(sec.content, maxTokens, overlapTokens)
        : [sec.content];

    for (const part of parts) {
      const content = `${heading}${part}`.trim();
      if (content.length === 0) continue;
      chunks.push({ chunkIndex: index, section: sec.section, content });
      index += 1;
    }
  }

  return chunks;
}
