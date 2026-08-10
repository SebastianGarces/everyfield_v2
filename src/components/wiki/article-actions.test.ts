import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  columnWidths,
  extractPrintBlocks,
  pdfFileName,
  PRINT_BODY_SELECTOR,
  renderBlock,
  runFontFamily,
  runsText,
  type PrintRun,
  type PrintTableRow,
} from "./article-actions";

// ----------------------------------------------------------------------------
// Print and PDF (W-018, W-020).
//
// The feature is one contract spread over three files, so it is asserted as
// one: `globals.css` says what survives printing, the article page marks WHICH
// element that is, and this component turns the same element into a PDF. Any
// one of the three renamed on its own silently produces a blank sheet or an
// empty file, which is exactly the failure a browser test notices last.
//
// The browser half of the acceptance criteria (print-media emulation, the
// download event) is proved on the branch's Vercel preview by
// `.claude/skills/validate-frontend`. What is asserted here is everything that
// does not need a browser: the extraction, the file name, and the fact that the
// three files still agree about the marker attributes.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");
const GLOBALS_CSS = readFileSync(path.join(SRC, "app", "globals.css"), "utf-8");
const ARTICLE_PAGE = readFileSync(
  path.join(SRC, "app", "(dashboard)", "wiki", "[...slug]", "page.tsx"),
  "utf-8"
);
const ARTICLE_ACTIONS = readFileSync(
  path.join(SRC, "components", "wiki", "article-actions.tsx"),
  "utf-8"
);

/** Everything inside the one `@media print` block. */
const printBlock = (() => {
  const start = GLOBALS_CSS.indexOf("@media print");
  assert.notEqual(start, -1, "globals.css has no @media print block");
  return GLOBALS_CSS.slice(start);
})();

// --- a DOM small enough to assert against -----------------------------------
//
// `extractPrintBlocks` reads only the handful of DOM members listed below, so a
// literal stand-in exercises it without a browser or a DOM library.

type StubChild = Element | Text;

function textNode(value: string): Text {
  return { nodeType: 3, textContent: value } as unknown as Text;
}

function el(
  tagName: string,
  children: StubChild[] = [],
  attributes: Record<string, string> = {}
): Element {
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    children: children.filter(
      (child) => (child as { nodeType: number }).nodeType === 1
    ),
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
    get textContent(): string {
      return children
        .map(
          (child) =>
            (child as { textContent?: string | null }).textContent ?? ""
        )
        .join("");
    },
    querySelectorAll: (selector: string) => descendants(node, selector),
  };
  return node as unknown as Element;
}

function descendants(node: { children: StubChild[] }, tagName: string) {
  const found: Element[] = [];
  for (const child of node.children as Element[]) {
    if (child.tagName === tagName.toUpperCase()) found.push(child);
    found.push(
      ...descendants(child as unknown as { children: StubChild[] }, tagName)
    );
  }
  return found;
}

/** One unemphasized run — what most prose reduces to. */
const plain = (text: string): PrintRun[] => [{ text }];

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

  test("recurses into an unknown wrapper, so an MDX callout still prints", () => {
    // A `Callout` is a div nobody taught this extractor about; its prose has to
    // arrive anyway, which is what makes MDX components work here unlisted.
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

// `renderBlock` takes its `Text`/`View` from the caller, so the tree can be
// built with plain host tags and inspected here. That seam is why proving the
// PDF draws borders — or sets a word in the bold face — does not need
// `@react-pdf/renderer`, a browser, or a rendered file.
type Rendered = {
  type: unknown;
  props: {
    style?: Record<string, unknown>;
    wrap?: boolean;
    children?: unknown;
  };
};

const primitives = { Text: "Text", View: "View" } as unknown as Parameters<
  typeof renderBlock
>[2];

const childrenOf = (node: Rendered): Rendered[] =>
  (Array.isArray(node.props.children)
    ? node.props.children
    : [node.props.children]) as Rendered[];

describe("renderBlock — the table grid in the downloaded PDF", () => {
  const table = renderBlock(
    {
      kind: "table",
      rows: [
        {
          cells: [plain("Ministry Area"), plain("Key Checklist Items")],
          isHeader: true,
        },
        {
          cells: [
            plain("Set-up/Tear-down"),
            plain("Equipment staging, room configuration"),
          ],
          isHeader: false,
        },
      ],
    },
    0,
    primitives
  ) as unknown as Rendered;

  const rows = childrenOf(table);

  test("draws a collapsed grid: the table owns two edges, each cell the other two", () => {
    // Four borders per cell would double every interior rule to 1pt while the
    // outer edge stayed 0.5pt.
    assert.equal(table.props.style?.borderTopWidth, 0.5);
    assert.equal(table.props.style?.borderLeftWidth, 0.5);

    for (const cell of rows.flatMap(childrenOf)) {
      assert.equal(cell.type, "View");
      assert.equal(cell.props.style?.borderRightWidth, 0.5);
      assert.equal(cell.props.style?.borderBottomWidth, 0.5);
      assert.equal(cell.props.style?.borderTopWidth, undefined);
      assert.equal(cell.props.style?.borderLeftWidth, undefined);
    }
  });

  test("lays cells out as a row of fixed columns, aligned down the table", () => {
    const widths = rows.map((tableRow) =>
      childrenOf(tableRow).map((cell) => cell.props.style?.width)
    );

    assert.equal(rows.length, 2);
    for (const tableRow of rows) {
      assert.equal(tableRow.props.style?.flexDirection, "row");
    }
    // Every column is the same width in every row — that is what makes the
    // reader able to follow a column down the page.
    assert.deepEqual(widths[0], widths[1]);
    assert.equal(widths[0]?.length, 2);
    for (const width of widths[0] ?? []) {
      assert.match(String(width), /^\d+(\.\d+)?%$/);
    }
  });

  test("keeps a row on one sheet", () => {
    // Half a row on each page reads as two wrong rows.
    for (const tableRow of rows) assert.equal(tableRow.props.wrap, false);
  });

  test("sets the header row bold and the body row plain", () => {
    const textOf = (tableRow: Rendered) =>
      childrenOf(tableRow).flatMap(childrenOf);

    for (const cell of textOf(rows[0])) {
      assert.equal(cell.props.style?.fontFamily, "Helvetica-Bold");
    }
    for (const cell of textOf(rows[1])) {
      assert.equal(cell.props.style?.fontFamily, undefined);
    }
  });

  test("no longer flattens a row into pipe-joined text", () => {
    // The ruling on PR #391: the download renders the grid the print path does.
    assert.ok(
      !ARTICLE_ACTIONS.includes('cells.join("  |  ")'),
      "a pipe-joined row is the flattened rendering that was ruled out"
    );
  });
});

describe("renderBlock — styled emphasis in the downloaded PDF", () => {
  const paragraph = (runs: PrintRun[]) =>
    renderBlock({ kind: "paragraph", runs }, 0, primitives) as unknown as
      | Rendered
      | undefined;

  test("gives every emphasized span its own Text, and leaves plain text bare", () => {
    const children = childrenOf(
      paragraph([
        { text: "Confirm the " },
        { text: "room", bold: true },
        { text: " with " },
        { text: "pnpm db:seed", mono: true },
      ]) as Rendered
    ) as unknown as (string | Rendered)[];

    assert.equal(children.length, 4);
    // A run with no emphasis stays the string it was — no wrapper, so an
    // unemphasized paragraph renders exactly as it did before.
    assert.equal(children[0], "Confirm the ");
    assert.equal(children[2], " with ");

    const bold = children[1] as Rendered;
    const mono = children[3] as Rendered;
    assert.equal(bold.type, "Text");
    assert.equal(bold.props.style?.fontFamily, "Helvetica-Bold");
    assert.equal(mono.props.style?.fontFamily, "Courier");
  });

  test("names the combined face inside a bold block, never a second axis", () => {
    // A heading is already set in `Helvetica-Bold`, a single-source family:
    // asking it for an italic CHILD resolves nothing and throws in
    // `@react-pdf/font`, so the italic word has to name `Helvetica-BoldOblique`
    // outright.
    const heading = renderBlock(
      {
        kind: "heading",
        level: 2,
        runs: [{ text: "Counting " }, { text: "the cost", italic: true }],
      },
      0,
      primitives
    ) as unknown as Rendered;

    const [, emphasized] = childrenOf(heading);
    assert.equal(emphasized.props.style?.fontFamily, "Helvetica-BoldOblique");
  });

  test("keeps a header cell bold when a word inside it is emphasized", () => {
    const table = renderBlock(
      {
        kind: "table",
        rows: [
          {
            cells: [[{ text: "Week", italic: true }]],
            isHeader: true,
          },
          { cells: [[{ text: "one", italic: true }]], isHeader: false },
        ],
      },
      0,
      primitives
    ) as unknown as Rendered;

    // table → row → cell → the cell's Text → the run's own Text.
    const faceOf = (rowIndex: number) => {
      const cell = childrenOf(childrenOf(table)[rowIndex])[0];
      const [run] = childrenOf(childrenOf(cell)[0]);
      return run.props.style?.fontFamily;
    };

    assert.equal(faceOf(0), "Helvetica-BoldOblique");
    assert.equal(faceOf(1), "Helvetica-Oblique");
  });

  test("resolves every combination to a standard-14 face", () => {
    // Standard-14 only: the fix carries no font asset, which is what kept it
    // inside the ruling. Anything outside this set would need one.
    const standard14 = new Set([
      "Helvetica",
      "Helvetica-Bold",
      "Helvetica-Oblique",
      "Helvetica-BoldOblique",
      "Courier",
      "Courier-Bold",
      "Courier-Oblique",
      "Courier-BoldOblique",
    ]);

    for (const bold of [undefined, true] as const) {
      for (const italic of [undefined, true] as const) {
        for (const mono of [undefined, true] as const) {
          for (const inheritedBold of [false, true]) {
            const run = { text: "x", bold, italic, mono } as PrintRun;
            const face = runFontFamily(run, inheritedBold);
            if (!bold && !italic && !mono) {
              assert.equal(face, undefined, "a plain run inherits its block");
              continue;
            }
            assert.ok(face && standard14.has(face), `unknown face ${face}`);
          }
        }
      }
    }
  });

  test("expresses emphasis as a face, never as fontWeight or fontStyle", () => {
    // The guard behind the two tests above: a `fontWeight`/`fontStyle` pair on
    // a nested Text is the shape that throws under a single-source family.
    // The property form, so the header comment may still name the two axes it
    // explains staying away from.
    assert.ok(
      !/font(Weight|Style):/.test(ARTICLE_ACTIONS),
      "emphasis must be a font NAME here — see the header comment"
    );
  });
});

describe("pdfFileName", () => {
  test("flattens a nested slug to one safe name", () => {
    assert.equal(
      pdfFileName("phase-4/pre-launch/launch-team"),
      "phase-4-pre-launch-launch-team.pdf"
    );
  });

  test("survives a slug holding characters a file name cannot", () => {
    // Slugs are authored content, not sanitized identifiers
    // (`src/lib/wiki/href.ts`).
    assert.equal(pdfFileName("50% off / notes #2"), "50-off-notes-2.pdf");
  });

  test("never produces a bare extension", () => {
    assert.equal(pdfFileName("///"), "article.pdf");
  });
});

describe("the print contract across the three files", () => {
  test("the article page marks the print root and the printable body", () => {
    assert.match(ARTICLE_PAGE, /<article data-print-root=""/);
    assert.match(ARTICLE_PAGE, /data-print-body=""/);
    assert.equal(PRINT_BODY_SELECTOR, "[data-print-body]");
  });

  test("navigation chrome inside the article is marked hidden", () => {
    // The breadcrumb, the action row and the related/pager block: three marks,
    // one per non-prose region of the article.
    const marks = ARTICLE_PAGE.match(/data-print-hide=""/g) ?? [];
    assert.equal(marks.length, 3);
  });

  test("the print block is inert on pages with no print root", () => {
    // Every rule is gated on the marker being present. Without the gate, the
    // "hide everything that is not the article" rule would blank the printed
    // page of every other screen in the app.
    assert.ok(printBlock.includes("body:has([data-print-root])"));
    assert.ok(
      !/\n\s*body\s*\*/.test(printBlock),
      "an ungated body rule would hide unrelated pages"
    );
  });

  test("the shell is dropped and the article's own furniture with it", () => {
    assert.ok(
      printBlock.includes(
        ":not(:has([data-print-root])):not([data-print-root]):not("
      ),
      "the keep-the-path rule is what drops the sidebar, header and guide"
    );
    assert.match(printBlock, /\[data-print-hide\]\s*\{\s*display:\s*none/);
  });

  test("nothing inside the article can clip or scroll on paper", () => {
    const unwind = printBlock.slice(
      printBlock.indexOf("[data-print-root],"),
      printBlock.indexOf("[data-print-hide]")
    );
    assert.match(unwind, /overflow:\s*visible\s*!important/);
    assert.match(printBlock, /white-space:\s*pre-wrap\s*!important/);
  });

  test("print is set as ink on paper, not in the reader's theme", () => {
    // A dark-theme reader would otherwise print near-white text onto white
    // paper: the printer drops backgrounds, not foregrounds.
    assert.match(printBlock, /color:\s*#000\s*!important/);
  });

  test("both paths draw the table as a bordered grid", () => {
    // The ruling on PR #391: the downloaded file has to match the printed page
    // here, so the header comment's "same article" claim is true of tables too.
    assert.match(printBlock, /:is\(th, td\)\s*\{\s*border:\s*0\.5pt solid/);
    assert.ok(
      ARTICLE_ACTIONS.includes("const TABLE_BORDER = 0.5"),
      "the PDF's hairline is the print stylesheet's 0.5pt"
    );
    assert.ok(
      ARTICLE_ACTIONS.includes("bordered grid on both paths"),
      "the header comment has to state the parity it now keeps"
    );
  });

  test("both paths keep bold, italic and inline code emphasized", () => {
    // The round-2 ruling on PR #391. Print keeps emphasis by doing nothing —
    // the browser sets `<strong>` bold on its own — so the parity claim breaks
    // only if the print block starts flattening it, or if the PDF stops naming
    // the emphasized faces. Both halves are asserted, because either one alone
    // would let the two renderers drift apart again.
    assert.ok(
      !/font-(weight|style):\s*normal\s*!important/.test(printBlock),
      "the print path must not flatten emphasis"
    );
    for (const face of [
      "Helvetica-Bold",
      "Helvetica-Oblique",
      "Helvetica-BoldOblique",
      "Courier",
    ]) {
      assert.ok(
        ARTICLE_ACTIONS.includes(`"${face}"`),
        `the PDF path has no ${face} face to set an emphasized run in`
      );
    }
    assert.ok(
      ARTICLE_ACTIONS.includes("INLINE EMPHASIS"),
      "the header comment has to state the parity it now keeps"
    );
  });

  test("the header comment counts the divergences it actually has", () => {
    // The comment claims "the same article" on both paths, so every place the
    // two renderers disagree has to be named next to that claim. It said "ONE
    // KNOWN DIVERGENCE" while images were a second one, which is the same shape
    // of untrue claim the table fix corrected.
    assert.ok(
      ARTICLE_ACTIONS.includes("TWO KNOWN DIVERGENCES"),
      "the divergence count must match the list below it"
    );
    assert.ok(ARTICLE_ACTIONS.includes("#398"), "the arrow gap is named");
    assert.ok(
      /Images print and do not download/.test(ARTICLE_ACTIONS),
      "the image gap is named"
    );
  });

  test("an image is dropped from the PDF, as the comment now says", () => {
    // The print stylesheet keeps `img`; the extractor has no IMG case, so the
    // image falls to the recursive default and contributes nothing. This test
    // is what makes divergence 2 a documented fact rather than a surprise.
    assert.match(printBlock, /\[data-print-root\] img \{/);

    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [textNode("before")]),
        el("img", [], { src: "/diagram.png", alt: "a diagram" }),
        el("p", [textNode("after")]),
      ])
    );

    assert.deepEqual(blocks, [
      { kind: "paragraph", runs: plain("before") },
      { kind: "paragraph", runs: plain("after") },
    ]);
  });

  test("a link's URL survives into print", () => {
    assert.match(printBlock, /a\[href\]::after/);
    assert.match(printBlock, /content:\s*" \("\s*attr\(href\)\s*"\)"/);
    assert.match(printBlock, /a\[href\^="#"\]::after/);
  });
});

describe("the PDF palette", () => {
  // The file says it matches the F6 template palette. It said so once while
  // `muted` had drifted two shades darker than the templates, which is a claim
  // nothing could catch — the two files never meet at runtime.
  const SHARED_STYLES = readFileSync(
    path.join(SRC, "lib", "documents", "pdf", "styles.ts"),
    "utf-8"
  );

  const colorOf = (source: string, pattern: RegExp) => {
    const found = source.match(pattern);
    assert.ok(found, `no colour matched ${pattern}`);
    return found[1];
  };

  for (const name of ["ink", "muted", "line"]) {
    test(`${name} is the value the templates use`, () => {
      assert.equal(
        colorOf(
          ARTICLE_ACTIONS,
          new RegExp(`const ${name} = "(#[0-9a-f]{6})"`)
        ),
        colorOf(SHARED_STYLES, new RegExp(`${name}: "(#[0-9a-f]{6})"`))
      );
    });
  }
});

describe("the download control", () => {
  test("both controls carry cursor-pointer", () => {
    // Project hard rule (AGENTS.md): every clickable says so.
    const buttons = ARTICLE_ACTIONS.match(/<Button/g) ?? [];
    const pointers = ARTICLE_ACTIONS.match(/className="cursor-pointer"/g) ?? [];
    assert.equal(buttons.length, 2);
    assert.equal(pointers.length, buttons.length);
  });

  test("the renderer is loaded on click, not on every wiki page view", () => {
    assert.ok(
      !/^import .* from "@react-pdf\/renderer";$/m.test(ARTICLE_ACTIONS),
      "a static import puts the whole PDF renderer in every reader's bundle"
    );
    assert.match(
      ARTICLE_ACTIONS,
      /await import\(\s*"@react-pdf\/renderer"\s*\)/
    );
  });

  test("the blob is saved under the article's name", () => {
    assert.match(ARTICLE_ACTIONS, /anchor\.download = fileName/);
    assert.match(ARTICLE_ACTIONS, /pdfFileName\(slug\)/);
  });

  test("the PDF's source line is built with wikiHref, never interpolated", () => {
    // `memory/invariants.md` → Wiki Articles: never interpolate a slug into a
    // wiki path.
    assert.match(ARTICLE_ACTIONS, /wikiHref\(slug\)/);
    assert.ok(!ARTICLE_ACTIONS.includes("/wiki/${"));
  });
});
