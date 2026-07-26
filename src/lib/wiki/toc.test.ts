import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHeadings, slugifyHeading, TOC_MIN_HEADINGS } from "./toc";

// ----------------------------------------------------------------------------
// TOC extraction contract (W-014).
//
// The rendered TOC is only as good as this pass: the anchor ids it produces
// have to match the ids `mdx-components.tsx` stamps on the rendered headings,
// and the entries have to be the headings a reader actually sees — not the
// `## …` line inside a shell sample. Both are pinned here.
// ----------------------------------------------------------------------------

test("collects H2 and H3 headings in document order", () => {
  const md = [
    "# Article title",
    "",
    "Intro paragraph.",
    "",
    "## Count the cost",
    "",
    "Body.",
    "",
    "### Money",
    "",
    "Body.",
    "",
    "## Gather a core group",
  ].join("\n");

  assert.deepEqual(extractHeadings(md), [
    { id: "count-the-cost", text: "Count the cost", level: 2 },
    { id: "money", text: "Money", level: 3 },
    { id: "gather-a-core-group", text: "Gather a core group", level: 2 },
  ]);
});

test("ignores H1 and H4+ — the TOC is H2/H3 only", () => {
  const md = ["# One", "#### Four", "##### Five", "## Two"].join("\n\n");

  const headings = extractHeadings(md);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, "Two");
});

test("skips headings inside fenced code blocks", () => {
  const md = [
    "## Real heading",
    "",
    "```bash",
    "## not a heading",
    "```",
    "",
    "~~~",
    "### also not a heading",
    "~~~",
    "",
    "## Second real heading",
  ].join("\n");

  assert.deepEqual(
    extractHeadings(md).map((h) => h.text),
    ["Real heading", "Second real heading"]
  );
});

test("requires a space after the hashes", () => {
  assert.deepEqual(extractHeadings("##NotAHeading\n\n## A heading"), [
    { id: "a-heading", text: "A heading", level: 2 },
  ]);
});

test("strips inline markdown so the label matches the rendered text", () => {
  const md = [
    "## **Pray** first",
    "## Use `pnpm db:migrate`",
    "## Read the [FRD](/wiki/frd)",
    "## Closing hashes ##",
  ].join("\n\n");

  assert.deepEqual(
    extractHeadings(md).map((h) => h.text),
    ["Pray first", "Use pnpm db:migrate", "Read the FRD", "Closing hashes"]
  );
});

test("slugs are lowercase, punctuation-free, and hyphen-joined", () => {
  assert.equal(slugifyHeading("Count the Cost"), "count-the-cost");
  assert.equal(slugifyHeading("Step 1: Pray!"), "step-1-pray");
  assert.equal(slugifyHeading("  Spaced   out  "), "spaced-out");
  assert.equal(slugifyHeading("Café résumé"), "cafe-resume");
  assert.equal(slugifyHeading("Already-hyphenated"), "already-hyphenated");
});

test("a slug is never empty, so an anchor is never href='#'", () => {
  assert.equal(slugifyHeading("???"), "section");
  assert.equal(slugifyHeading(""), "section");
});

test("headings that slugify identically share an anchor", () => {
  // Accepted: the second entry links to the first occurrence. A dead link
  // would be worse than a link that lands one section early.
  const headings = extractHeadings("## Overview\n\n## Overview");
  assert.equal(headings.length, 2);
  assert.equal(headings[0].id, headings[1].id);
});

test("an article with a single heading is below the render threshold", () => {
  assert.equal(TOC_MIN_HEADINGS, 2);
  assert.ok(extractHeadings("## Only one").length < TOC_MIN_HEADINGS);
  assert.ok(extractHeadings("Just prose, no headings.").length === 0);
});

test("indented-by-four is a code block, not a heading", () => {
  const md = [
    "   ## Three spaces is fine",
    "",
    "    ## Four spaces is code",
  ].join("\n");

  assert.deepEqual(
    extractHeadings(md).map((h) => h.text),
    ["Three spaces is fine"]
  );
});
