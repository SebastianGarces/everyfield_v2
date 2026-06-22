/**
 * Methodology corpus embed (PE-008).
 *
 * One-time / re-runnable script that populates `methodology_embeddings` from
 * the church-planting methodology corpus:
 *
 *   - the Launch Playbook  (product-docs/launch-playbook.md)
 *   - the wiki articles    (published, global rows in `wiki_articles`)
 *
 * Each document is heading-chunked (~300–800 tok) into passages tagged with
 * phase / section / article_slug, embedded with `text-embedding-3-small`
 * (1536 dims) via the swappable provider module, and UPSERTed on the unique
 * (doc_key, chunk_index) index so re-running UPDATES rows instead of
 * duplicating them.
 *
 * The rubric is intentionally NOT embedded (FRD §10) — it is loaded whole into
 * the judge prompt at assessment time.
 *
 * Usage:
 *   pnpm exec tsx scripts/embed-methodology-corpus.ts
 *   pnpm exec tsx scripts/embed-methodology-corpus.ts --source=playbook
 *   pnpm exec tsx scripts/embed-methodology-corpus.ts --source=wiki
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { methodologyEmbeddings, wikiArticles } from "../src/db/schema";
import {
  chunkMarkdown,
  type MethodologyChunk,
} from "../src/lib/phase-engine/rag/chunk";
import { embedBatch } from "../src/lib/phase-engine/rag/embed";

// Load env (OPENAI_API_KEY, DATABASE_URL) for the standalone script context.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL is required");
  process.exit(1);
}
const db = drizzle(neon(connectionString), {
  schema: { methodologyEmbeddings, wikiArticles },
});

const PLAYBOOK_PATH = path.join(
  process.cwd(),
  "product-docs",
  "launch-playbook.md"
);

// Embed in batches so we cap request size and surface progress.
const EMBED_BATCH = 64;

// --------------------------------------------------------------------------
// Playbook → phase mapping.
//
// The Launch Playbook is one document organised by top-level (`##`) sections.
// We tag each section's chunks with the phase its content maps to, so phase-
// filtered retrieval ranks on-phase playbook guidance first. Unmapped sections
// stay phase-agnostic (null) and are retrievable from any phase.
// --------------------------------------------------------------------------
const PLAYBOOK_SECTION_PHASE: Record<string, number> = {
  introduction: 0,
  "launch process goals": 0,
  "critical success factors": 0,
  "core group development overview": 1,
  "vision meeting": 1,
  "follow up": 1,
  "formalize commitment": 1,
  "core group assignments": 2,
  "targeted launch date": 2,
  "mission focus: training and preparation": 3,
  "gantt chart / timeline": 3,
  "preparation for launch sunday": 4,
  "launch sunday": 5,
  administrative: 6,
};

function playbookPhaseFor(section: string | null): number | null {
  if (!section) return null;
  return PLAYBOOK_SECTION_PHASE[section.trim().toLowerCase()] ?? null;
}

interface PendingRow {
  source: "wiki" | "playbook";
  docKey: string;
  articleSlug: string | null;
  phase: number | null;
  section: string | null;
  chunkIndex: number;
  content: string;
}

// --------------------------------------------------------------------------
// Source loaders → flat list of pending rows (pre-embedding).
// --------------------------------------------------------------------------

async function loadPlaybookRows(): Promise<PendingRow[]> {
  const markdown = await readFile(PLAYBOOK_PATH, "utf-8");
  const chunks = chunkMarkdown(markdown);
  return chunks.map((chunk: MethodologyChunk) => ({
    source: "playbook" as const,
    // Stable per-section doc key keeps chunk indices stable across re-runs.
    docKey: `playbook:${slugifySection(chunk.section)}`,
    articleSlug: null,
    phase: playbookPhaseFor(chunk.section),
    section: chunk.section,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
  }));
}

async function loadWikiRows(): Promise<PendingRow[]> {
  const articles = await db
    .select({
      slug: wikiArticles.slug,
      content: wikiArticles.content,
      phase: wikiArticles.phase,
    })
    .from(wikiArticles)
    .where(
      and(eq(wikiArticles.status, "published"), isNull(wikiArticles.churchId))
    );

  const rows: PendingRow[] = [];
  for (const article of articles) {
    const chunks = chunkMarkdown(article.content);
    for (const chunk of chunks) {
      rows.push({
        source: "wiki",
        docKey: article.slug,
        articleSlug: article.slug,
        // Article-level phase wins; chunk inherits it for phase-filtering.
        phase: article.phase,
        section: chunk.section,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      });
    }
  }
  return rows;
}

function slugifySection(section: string | null): string {
  if (!section) return "preamble";
  return section
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --------------------------------------------------------------------------
// Embed + idempotent upsert.
// --------------------------------------------------------------------------

async function upsertRows(rows: PendingRow[]): Promise<void> {
  let embedded = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((r) => r.content));

    const values = batch.map((row, j) => ({
      source: row.source,
      docKey: row.docKey,
      articleSlug: row.articleSlug,
      phase: row.phase,
      section: row.section,
      chunkIndex: row.chunkIndex,
      content: row.content,
      embedding: vectors[j],
    }));

    await db
      .insert(methodologyEmbeddings)
      .values(values)
      .onConflictDoUpdate({
        // Idempotent: re-running updates the existing (doc_key, chunk_index) row.
        target: [
          methodologyEmbeddings.docKey,
          methodologyEmbeddings.chunkIndex,
        ],
        set: {
          source: sql`excluded.source`,
          articleSlug: sql`excluded.article_slug`,
          phase: sql`excluded.phase`,
          section: sql`excluded.section`,
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
          updatedAt: sql`now()`,
        },
      });

    embedded += batch.length;
    console.log(`  …embedded ${embedded}/${rows.length}`);
  }
}

// --------------------------------------------------------------------------
// Entry point.
// --------------------------------------------------------------------------

async function main() {
  const sourceArg = process.argv
    .find((a) => a.startsWith("--source="))
    ?.split("=")[1];

  const doPlaybook = !sourceArg || sourceArg === "playbook";
  const doWiki = !sourceArg || sourceArg === "wiki";

  const rows: PendingRow[] = [];
  if (doPlaybook) {
    console.log("📖 Chunking Launch Playbook…");
    const playbook = await loadPlaybookRows();
    console.log(`   ${playbook.length} chunks`);
    rows.push(...playbook);
  }
  if (doWiki) {
    console.log("📚 Chunking wiki articles…");
    const wiki = await loadWikiRows();
    console.log(`   ${wiki.length} chunks`);
    rows.push(...wiki);
  }

  if (rows.length === 0) {
    console.log("Nothing to embed.");
    return;
  }

  console.log(`🧮 Embedding + upserting ${rows.length} chunks…`);
  await upsertRows(rows);
  console.log("✅ Methodology corpus embedded.");
}

main().catch((err) => {
  console.error("❌ embed-methodology-corpus failed:", err);
  process.exit(1);
});
