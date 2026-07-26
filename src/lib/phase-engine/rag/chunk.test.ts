import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkMarkdown, estimateTokens } from "./chunk";

// ----------------------------------------------------------------------------
// Heading/section chunking contract (PE-008).
//
// The chunker is the pure, deterministic core of the RAG layer: embedding and
// persistence are integration-tested against live OpenAI + Postgres, but the
// chunk boundaries / metadata that everything downstream depends on are pinned
// here.
// ----------------------------------------------------------------------------

const para = (tokens: number) => "word ".repeat(tokens).trim();

test("splits a document into one chunk per heading", () => {
  const md = [
    "# Title",
    "",
    "## Alpha",
    "",
    para(400),
    "",
    "## Beta",
    "",
    para(400),
  ].join("\n");

  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].section, "Alpha");
  assert.equal(chunks[1].section, "Beta");
});

test("assigns sequential, 0-based chunk indices", () => {
  const md = ["## A", para(400), "## B", para(400), "## C", para(400)].join(
    "\n\n"
  );

  const chunks = chunkMarkdown(md);
  assert.deepEqual(
    chunks.map((c) => c.chunkIndex),
    [0, 1, 2]
  );
});

test("prepends the heading to each chunk's content for context", () => {
  const md = `## Vision Meeting\n\n${para(400)}`;
  const [chunk] = chunkMarkdown(md);
  assert.match(chunk.content, /^## Vision Meeting/);
});

test("sub-splits an over-long section into multiple chunks", () => {
  // ~2000 tokens across distinct paragraphs, well over the 800-token ceiling.
  const big = [para(700), para(700), para(700)].join("\n\n");
  const md = `## Big\n\n${big}`;

  const chunks = chunkMarkdown(md, { maxTokens: 800, overlapTokens: 0 });
  assert.ok(chunks.length > 1, "expected the long section to be sub-split");
  // Every sub-chunk keeps the section label.
  assert.ok(chunks.every((c) => c.section === "Big"));
  // No chunk wildly exceeds the ceiling (allow heading + one paragraph slack).
  assert.ok(chunks.every((c) => estimateTokens(c.content) <= 800 + 750));
});

test("merges tiny adjacent sections so no sub-minTokens chunk is emitted alone", () => {
  const md = ["## Tiny One", "short.", "## Tiny Two", "also short."].join(
    "\n\n"
  );

  const chunks = chunkMarkdown(md, { minTokens: 300, maxTokens: 800 });
  assert.equal(chunks.length, 1);
  // The merged block keeps the first section's heading.
  assert.equal(chunks[0].section, "Tiny One");
  assert.match(chunks[0].content, /also short/);
});

test("is deterministic — identical input yields identical chunks", () => {
  const md = `## A\n\n${para(400)}\n\n## B\n\n${para(400)}`;
  assert.deepEqual(chunkMarkdown(md), chunkMarkdown(md));
});

test("returns no chunks for empty or whitespace input", () => {
  assert.deepEqual(chunkMarkdown(""), []);
  assert.deepEqual(chunkMarkdown("\n\n   \n"), []);
});
