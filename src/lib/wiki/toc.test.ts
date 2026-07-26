import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeHeadingId,
  extractHeadings,
  slugifyHeading,
  TOC_ACTIVE_LINE_FALLBACK_PX,
  TOC_MIN_HEADINGS,
} from "./toc";

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

// ----------------------------------------------------------------------------
// Which entry is active (W-014, AC2 + AC3).
//
// The active line is a viewport offset, and the number that matters is where a
// heading *lands* when the browser scrolls to its fragment: the top of the
// scroll container plus the heading's own `scroll-margin-top`. In the wiki
// layout that is the ~64px sticky topbar plus `scroll-m-20` (80px) = 144px.
// A line at or below 144 excludes the heading the reader just clicked and
// leaves the previous entry highlighted — the exact bug these pin.
// ----------------------------------------------------------------------------

/** Where a clicked heading comes to rest in the wiki layout. */
const LANDING_PX = 64 + 80;
/** The line the component derives from that landing position, plus tolerance. */
const ACTIVE_LINE_PX = LANDING_PX + 8;

test("the heading just clicked is the active one, not the one above it", () => {
  // Reader clicked "Money": it sits exactly on its landing position, while the
  // section above has scrolled off the top.
  const headings = [
    { id: "count-the-cost", top: -420 },
    { id: "money", top: LANDING_PX },
    { id: "gather-a-core-group", top: 980 },
  ];

  assert.equal(
    activeHeadingId(headings, { activeLinePx: ACTIVE_LINE_PX }),
    "money"
  );
});

test("a heading resting one pixel below the line is still reached", () => {
  const headings = [
    { id: "first", top: -100 },
    { id: "second", top: ACTIVE_LINE_PX },
  ];

  assert.equal(
    activeHeadingId(headings, { activeLinePx: ACTIVE_LINE_PX }),
    "second"
  );
  assert.equal(
    activeHeadingId([headings[0], { id: "second", top: ACTIVE_LINE_PX + 1 }], {
      activeLinePx: ACTIVE_LINE_PX,
    }),
    "first"
  );
});

test("plain scroll-reading still highlights the section in view", () => {
  const headings = [
    { id: "first", top: -300 },
    { id: "second", top: 60 },
    { id: "third", top: 800 },
  ];

  assert.equal(
    activeHeadingId(headings, { activeLinePx: ACTIVE_LINE_PX }),
    "second"
  );
});

test("before any heading is reached, the first entry is active", () => {
  const headings = [
    { id: "first", top: 400 },
    { id: "second", top: 1200 },
  ];

  assert.equal(
    activeHeadingId(headings, { activeLinePx: ACTIVE_LINE_PX }),
    "first"
  );
});

test("at the bottom of the article the last entry is active", () => {
  // The final section can be too short to push its heading up to the line, so
  // scroll-end decides instead.
  const headings = [
    { id: "first", top: -900 },
    { id: "last", top: 600 },
  ];

  assert.equal(
    activeHeadingId(headings, {
      activeLinePx: ACTIVE_LINE_PX,
      atScrollEnd: true,
    }),
    "last"
  );
});

test("no rendered headings means no active entry", () => {
  assert.equal(activeHeadingId([], { activeLinePx: ACTIVE_LINE_PX }), null);
  assert.equal(
    activeHeadingId([], { activeLinePx: ACTIVE_LINE_PX, atScrollEnd: true }),
    null
  );
});

test("the unmeasurable-layout fallback still clears the landing position", () => {
  assert.ok(
    TOC_ACTIVE_LINE_FALLBACK_PX > LANDING_PX,
    `fallback ${TOC_ACTIVE_LINE_FALLBACK_PX}px must sit below a heading landing at ${LANDING_PX}px`
  );

  assert.equal(
    activeHeadingId(
      [
        { id: "first", top: -10 },
        { id: "clicked", top: LANDING_PX },
      ],
      {
        activeLinePx: TOC_ACTIVE_LINE_FALLBACK_PX,
      }
    ),
    "clicked"
  );
});
