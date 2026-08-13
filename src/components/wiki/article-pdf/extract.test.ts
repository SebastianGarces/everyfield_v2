import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PRINT_CALLOUT_ATTRIBUTE,
  columnWidths,
  extractPrintBlocks,
  runsText,
  type PrintRun,
  type PrintTableRow,
} from "./extract";
import { calloutEl, el, plain, textNode } from "./test-doubles";

// ----------------------------------------------------------------------------
// Reading the article out of the DOM (W-018, W-020).
//
// `extract.ts` decides WHAT is in the downloaded file; `render.test.ts` covers
// how it looks, and `../article-actions.test.ts` covers the claims the two
// renderers make about each other. Split off from that file once it had grown
// past a thousand lines along a seam the source already drew.
//
// Everything here is behavioural. `extract.ts` is pure — no React, no renderer,
// no browser — so each test is a stand-in DOM in and a block list out, which is
// the whole point of reading the DOM rather than parsing MDX.
// ----------------------------------------------------------------------------

describe("extractPrintBlocks", () => {
  test("keeps headings, prose, lists and code in reading order", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("h2", [textNode("Counting the cost")]),
        el("p", [textNode("A plant is a people project.")]),
        el("ul", [
          el("li", [textNode("Pray")]),
          el("li", [
            textNode("Recruit"),
            el("ul", [el("li", [textNode("Then follow up")])]),
          ]),
        ]),
        el("pre", [el("code", [textNode("pnpm db:migrate\n")])]),
        el("hr"),
      ])
    );

    assert.deepEqual(blocks, [
      { kind: "heading", level: 2, runs: plain("Counting the cost") },
      { kind: "paragraph", runs: plain("A plant is a people project.") },
      { kind: "listItem", depth: 0, marker: "•", runs: plain("Pray") },
      { kind: "listItem", depth: 0, marker: "•", runs: plain("Recruit") },
      {
        kind: "listItem",
        depth: 1,
        marker: "•",
        runs: plain("Then follow up"),
      },
      // A fenced block is mono in its entirety, so it stays one string and
      // keeps its own line breaks — the run model is for INLINE emphasis.
      { kind: "code", text: "pnpm db:migrate" },
      { kind: "divider" },
    ]);
  });

  test("numbers an ordered list", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("ol", [el("li", [textNode("First")]), el("li", [textNode("Then")])]),
      ])
    );

    assert.deepEqual(
      blocks.map((block) => ("marker" in block ? block.marker : block.kind)),
      ["1.", "2."]
    );
  });

  test("carries a link's destination, because paper has no anchors", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [
          textNode("See the "),
          el("a", [textNode("launch guide")], { href: "/wiki/phase-4/launch" }),
          textNode(" first."),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "paragraph",
        runs: plain("See the launch guide (/wiki/phase-4/launch) first."),
      },
    ]);
  });

  test("leaves a same-page anchor bare", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [el("a", [textNode("Back to top")], { href: "#top" })]),
      ])
    );

    assert.deepEqual(blocks, [
      { kind: "paragraph", runs: plain("Back to top") },
    ]);
  });

  test("recurses into an unknown wrapper, so an unlisted MDX component prints", () => {
    // A wrapper nobody taught this extractor about; its prose has to arrive
    // anyway, which is what makes MDX components work here unenumerated.
    const blocks = extractPrintBlocks(
      el("div", [
        el("div", [
          el("svg", [textNode("icon")]),
          el("div", [el("p", [textNode("Do not skip the vision meeting.")])]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      { kind: "paragraph", runs: plain("Do not skip the vision meeting.") },
    ]);
  });

  test("keeps a callout whole, and names the type its icon stood for", () => {
    // The 2026-08-12 ruling on PR #391, option (c). A callout used to fall to
    // the recursive default above and arrive as bare paragraphs — a Warning
    // reaching a launch meeting looking like ordinary prose. It is now its own
    // NESTED block, so the box and its contents travel together.
    const blocks = extractPrintBlocks(
      el("div", [
        calloutEl(
          "Warning",
          el("p", [textNode("Checklists are not optional.")]),
          el("ul", [el("li", [textNode("Confirm the room")])])
        ),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "callout",
        label: "Warning",
        blocks: [
          { kind: "paragraph", runs: plain("Checklists are not optional.") },
          {
            kind: "listItem",
            depth: 0,
            marker: "•",
            runs: plain("Confirm the room"),
          },
        ],
      },
    ]);
  });

  test("takes the type from the marker, never from the icon or the sr-only label", () => {
    // The icon is skipped as an SVG and the `sr-only` span holds no element
    // children, so the word appears exactly once — as the block's label.
    const [block] = extractPrintBlocks(
      el("div", [calloutEl("Insight", el("p", [textNode("Plants grow.")]))])
    );

    assert.ok(block && block.kind === "callout");
    assert.equal(block.label, "Insight");
    assert.deepEqual(block.blocks, [
      { kind: "paragraph", runs: plain("Plants grow.") },
    ]);
  });

  test("never leaks the sr-only type word into a line of prose", () => {
    // The regression. A list item, a blockquote and a table cell are read as
    // ONE LINE by `inlineRuns`, which walks text nodes and skips only
    // `data-print-hide` — so a callout reached through one of them used to
    // contribute its screen-reader label to the sentence, and `tidyRuns`
    // merged it in without so much as a space:
    //
    //   "Confirm the room. WarningChecklists are not optional."
    //
    // A word the printed page shows NOWHERE, in the one path whose whole claim
    // is that the file matches the page.
    const inListItem = extractPrintBlocks(
      el("div", [
        el("ol", [
          el("li", [
            textNode("Confirm the room. "),
            calloutEl(
              "Warning",
              el("p", [textNode("Checklists are not optional.")])
            ),
          ]),
        ]),
      ])
    );

    assert.deepEqual(inListItem, [
      {
        kind: "listItem",
        depth: 0,
        marker: "1.",
        runs: plain("Confirm the room. Checklists are not optional."),
      },
    ]);

    const inQuote = extractPrintBlocks(
      el("div", [
        el("blockquote", [
          calloutEl("Scripture", el("p", [textNode("Go therefore.")])),
        ]),
      ])
    );

    assert.deepEqual(inQuote, [
      { kind: "quote", runs: plain("Go therefore.") },
    ]);
  });

  test("frames a one-line callout, whose child is a bare string", () => {
    // The shape that fell through the floor. `<Callout type="tip">One line
    // here.</Callout>` written on ONE line compiles (verified against this
    // repo's own @mdx-js/mdx) to a bare string child — no `<p>`. `collectBlocks`
    // walks `children`, which is elements only, so the callout's block list came
    // back empty and the early return in `collectCallout` discarded the box, the
    // type AND the words. Divergence 3 promises the weaker failure ("keeps its
    // words and loses its box"); this kept nothing, so the "callouts … all carry
    // across" sentence in `article-actions.tsx` was false.
    const blocks = extractPrintBlocks(
      el("div", [calloutEl("Tip", textNode("One line here."))])
    );

    assert.deepEqual(blocks, [
      {
        kind: "callout",
        label: "Tip",
        blocks: [{ kind: "paragraph", runs: plain("One line here.") }],
      },
    ]);
  });

  test("keeps the emphasis in a one-line callout, since it reads as runs", () => {
    // `<Callout type="warning">Do **not** skip this.</Callout>` on one line
    // compiles to a string, a `<strong>` and a string — still no paragraph, so
    // it takes the same fallback. Reading it through `inlineRuns` rather than
    // through `textContent` is what keeps the bold word bold; emphasis in this
    // corpus marks the step that must not be skipped.
    const [block] = extractPrintBlocks(
      el("div", [
        calloutEl(
          "Warning",
          textNode("Do "),
          el("strong", [textNode("not")]),
          textNode(" skip this.")
        ),
      ])
    );

    assert.ok(block && block.kind === "callout");
    assert.deepEqual(block.blocks, [
      {
        kind: "paragraph",
        runs: [
          { text: "Do " },
          { bold: true, text: "not" },
          { text: " skip this." },
        ],
      },
    ]);
  });

  test("draws no box round an empty callout", () => {
    // A frame with nothing in it is a mark the printed page does not have — and
    // the one-line fallback above must not turn that into an empty box, which is
    // why it asks for TEXT rather than merely for a missing block list.
    assert.deepEqual(extractPrintBlocks(el("div", [calloutEl("Tip")])), []);
  });

  test("still drops an image-only callout, as divergence 2 says", () => {
    // The fallback is deliberately blind to an image: an `<img>` contributes no
    // runs, so a callout holding nothing else stays dropped rather than becoming
    // an empty frame. Divergence 2 is unchanged by the one-line fix.
    assert.deepEqual(
      extractPrintBlocks(
        el("div", [calloutEl("Insight", el("img", [], { src: "/plan.png" }))])
      ),
      []
    );
  });

  test("nests a callout inside a callout, because the contents recurse", () => {
    const [block] = extractPrintBlocks(
      el("div", [
        el("div", [
          el(
            "div",
            [
              el("svg", []),
              el("span", [textNode("Warning")], { "data-print-hide": "" }),
              el("div", [
                el("p", [textNode("Outer.")]),
                calloutEl("Scripture", el("p", [textNode("Inner.")])),
              ]),
            ],
            { [PRINT_CALLOUT_ATTRIBUTE]: "Warning" }
          ),
        ]),
      ])
    );

    assert.ok(block && block.kind === "callout");
    assert.deepEqual(block.blocks[1], {
      kind: "callout",
      label: "Scripture",
      blocks: [{ kind: "paragraph", runs: plain("Inner.") }],
    });
  });

  test("drops anything marked data-print-hide", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [textNode("Kept")]),
        el("p", [textNode("Dropped")], { "data-print-hide": "" }),
      ])
    );

    assert.deepEqual(blocks, [{ kind: "paragraph", runs: plain("Kept") }]);
  });

  test("keeps a table whole, and marks the header row", () => {
    // One block, not one per row: the column widths belong to the table, so a
    // row that arrived on its own could not be laid out against its siblings.
    const blocks = extractPrintBlocks(
      el("div", [
        el("table", [
          el("thead", [
            el("tr", [
              el("th", [textNode("Week")]),
              el("th", [textNode("Focus")]),
            ]),
          ]),
          el("tbody", [
            el("tr", [
              el("td", [textNode("1")]),
              el("td", [textNode("Prayer")]),
            ]),
          ]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "table",
        rows: [
          { cells: [plain("Week"), plain("Focus")], isHeader: true },
          { cells: [plain("1"), plain("Prayer")], isHeader: false },
        ],
      },
    ]);
  });

  test("pads a ragged row so the grid stays rectangular", () => {
    // A short row would otherwise stretch its last cell across the missing
    // columns, and the vertical rules the eye follows would jog mid-table.
    const blocks = extractPrintBlocks(
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [
              el("td", [textNode("a")]),
              el("td", [textNode("b")]),
              el("td", [textNode("c")]),
            ]),
            el("tr", [el("td", [textNode("only")])]),
          ]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "table",
        rows: [
          { cells: [plain("a"), plain("b"), plain("c")], isHeader: false },
          // A padded cell holds no runs at all, not an empty one: nothing was
          // written there.
          { cells: [plain("only"), [], []], isHeader: false },
        ],
      },
    ]);
  });

  test("a nested table's rows stay in the cell they were written in (#411)", () => {
    // `querySelectorAll("tr")` is a DESCENDANT query, so the inner table used to
    // hand its rows to the OUTER one: "Deposit paid" arrived twice — once
    // flattened into the cell, as divergence 3 promises, and once as a row of
    // its own. The walk stops at a nested TABLE now, so nesting flattens
    // without duplicating.
    const blocks = extractPrintBlocks(
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [
              el("td", [textNode("Venue")]),
              el("td", [
                el("table", [
                  el("tbody", [
                    el("tr", [el("td", [textNode("Deposit paid")])]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "table",
        rows: [
          {
            cells: [plain("Venue"), plain("Deposit paid")],
            isHeader: false,
          },
        ],
      },
    ]);
  });

  test("a row marked data-print-hide leaves the file, as it leaves the page", () => {
    // The table walk was the one place the marker was not honoured, because a
    // descendant query never looks at attributes — so a row the printed page
    // drops still reached the download.
    const blocks = extractPrintBlocks(
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [el("td", [textNode("Kept")])]),
            el("tr", [el("td", [textNode("Dropped")])], {
              "data-print-hide": "",
            }),
          ]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      {
        kind: "table",
        rows: [{ cells: [plain("Kept")], isHeader: false }],
      },
    ]);
  });

  test("drops a table with nothing in it", () => {
    const blocks = extractPrintBlocks(
      el("div", [el("table", [el("tbody", [el("tr", [el("td", [])])])])])
    );

    assert.deepEqual(blocks, []);
  });
});

describe("inline emphasis becomes runs", () => {
  // The round-2 ruling on PR #391: a bold word is bold in the downloaded file
  // too. Emphasis is the corpus's way of marking the step that must not be
  // skipped, so flattening it changes what a checklist SAYS, not just how it
  // looks.

  const runsOf = (element: Element): PrintRun[] => {
    const [block] = extractPrintBlocks(el("div", [element]));
    assert.ok(block && "runs" in block, "expected a block carrying runs");
    return block.runs;
  };

  test("marks strong, em and inline code, and leaves the rest plain", () => {
    assert.deepEqual(
      runsOf(
        el("p", [
          textNode("Run "),
          el("code", [textNode("pnpm db:migrate")]),
          textNode(" before the "),
          el("strong", [textNode("vision meeting")]),
          textNode(", "),
          el("em", [textNode("always")]),
          textNode("."),
        ])
      ),
      [
        { text: "Run " },
        { text: "pnpm db:migrate", mono: true },
        { text: " before the " },
        { text: "vision meeting", bold: true },
        { text: ", " },
        { text: "always", italic: true },
        { text: "." },
      ]
    );
  });

  test("keeps the spaces around an emphasized word", () => {
    // Trimming each run in turn — the obvious reading of the old one-string
    // flattening — welds "See the" to "launch".
    const runs = runsOf(
      el("p", [
        textNode("  See the "),
        el("strong", [textNode("launch")]),
        textNode(" guide.  "),
      ])
    );

    assert.equal(runsText(runs), "See the launch guide.");
  });

  test("collapses a double space where two runs meet", () => {
    // `<strong> launch </strong>` written with the spaces INSIDE the tag: each
    // run is already single-spaced, so a per-run squeeze leaves two spaces at
    // the seam. The browser collapses them on the printed page, so the
    // downloaded file has to as well or the two paths differ by a space.
    const runs = runsOf(
      el("p", [
        textNode("See the "),
        el("strong", [textNode(" launch ")]),
        textNode("guide."),
      ])
    );

    assert.equal(runsText(runs), "See the launch guide.");
    assert.deepEqual(runs, [
      { text: "See the " },
      { text: "launch ", bold: true },
      { text: "guide." },
    ]);
  });

  test("keeps the single space that separates two emphasized words", () => {
    // The seam squeeze must not eat a space that is doing work: one space
    // between two bold words is the only thing holding them apart.
    const runs = runsOf(
      el("p", [
        el("strong", [textNode("Set up")]),
        textNode(" "),
        el("em", [textNode("early")]),
      ])
    );

    assert.equal(runsText(runs), "Set up early");
  });

  test("accumulates nesting, so bold italic is both", () => {
    assert.deepEqual(
      runsOf(el("p", [el("strong", [el("em", [textNode("Do not skip")])])])),
      [{ text: "Do not skip", bold: true, italic: true }]
    );
  });

  test("treats raw <b> and <i> as their semantic twins", () => {
    // MDX lets an author write HTML directly, and some of this corpus does.
    assert.deepEqual(
      runsOf(
        el("p", [el("b", [textNode("Bold")]), el("i", [textNode("Italic")])])
      ),
      [
        { text: "Bold", bold: true },
        { text: "Italic", italic: true },
      ]
    );
  });

  test("merges neighbours that read alike into one run", () => {
    // Two text nodes, or a link's label beside the words around it, are one
    // run — otherwise every wrap point becomes a seam.
    assert.deepEqual(
      runsOf(
        el("p", [
          textNode("See the "),
          el("a", [textNode("launch guide")], { href: "/wiki/launch" }),
          textNode(" first."),
        ])
      ),
      [{ text: "See the launch guide (/wiki/launch) first." }]
    );
  });

  test("emphasizes a link's label without emphasizing its URL", () => {
    // The destination is an aside this renderer adds; the author emphasized
    // the words, not the address.
    assert.deepEqual(
      runsOf(
        el("p", [
          el("a", [el("strong", [textNode("Read this")])], {
            href: "/wiki/launch",
          }),
        ])
      ),
      [{ text: "Read this", bold: true }, { text: " (/wiki/launch)" }]
    );
  });

  test("carries emphasis into a table cell", () => {
    const [block] = extractPrintBlocks(
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [
              el("td", [
                textNode("Set up "),
                el("strong", [textNode("before")]),
                textNode(" 8am"),
              ]),
            ]),
          ]),
        ]),
      ])
    );

    assert.ok(block && block.kind === "table");
    assert.deepEqual(block.rows[0].cells[0], [
      { text: "Set up " },
      { text: "before", bold: true },
      { text: " 8am" },
    ]);
  });

  test("measures a column by its words, not its markup", () => {
    // Column widths are driven by the longest cell, and a run list has no
    // single `.length` — reading it plainly is what keeps the grid honest.
    const widths = columnWidths([
      {
        cells: [
          [{ text: "Yes" }],
          [{ text: "A much longer ", bold: true }, { text: "explanation" }],
        ],
        isHeader: false,
      },
    ]);

    assert.ok(widths[1] > widths[0], `${widths[1]} should exceed ${widths[0]}`);
  });
});

describe("columnWidths", () => {
  const row = (...cells: string[]): PrintTableRow => ({
    cells: cells.map(plain),
    isHeader: false,
  });

  test("always fills the table exactly", () => {
    for (const rows of [
      [row("Week", "Focus")],
      [row("a", "b", "c"), row("longer content here", "b", "c")],
      [row("one")],
      [row("a", "b", "c", "d", "e", "f")],
    ]) {
      const widths = columnWidths(rows);
      const total = widths.reduce((sum, width) => sum + width, 0);
      assert.ok(
        Math.abs(total - 100) < 0.001,
        `widths ${widths.join()} sum to ${total}`
      );
    }
  });

  test("gives the wordier column more room", () => {
    const [narrow, wide] = columnWidths([
      row("Yes", "A much longer explanation of the same thing"),
    ]);
    assert.ok(wide > narrow, `${wide} should exceed ${narrow}`);
  });

  test("never starves a column below a readable floor", () => {
    // Without a floor, "1" against a paragraph collapses to a hairline and
    // wraps one character per line.
    const [narrow, wide] = columnWidths([
      row(
        "1",
        "A cell holding a whole sentence of guidance for the reader to follow"
      ),
    ]);
    assert.ok(narrow > 15, `a one-character column got ${narrow}%`);
    // The clamp holds the widest-to-narrowest ratio at ~5.5:1.
    assert.ok(wide / narrow < 5.6, `ratio ${wide / narrow} is unbounded`);
  });

  test("has no columns when there are no rows", () => {
    assert.deepEqual(columnWidths([]), []);
  });
});
