import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { PRINT_BODY_SELECTOR, pdfFileName } from "./article-actions";
import {
  PRINT_CALLOUT_ATTRIBUTE,
  extractPrintBlocks,
} from "./article-pdf/extract";
import { renderBlock, runFontFamily } from "./article-pdf/render";
import {
  calloutEl,
  childrenOf,
  el,
  plain,
  primitives,
  textNode,
  type Rendered,
} from "./article-pdf/test-doubles";
import { Callout } from "./callout";

// ----------------------------------------------------------------------------
// Print and PDF (W-018, W-020) — the contract BETWEEN the files.
//
// The feature is one contract spread over several files, so it is asserted as
// one: `globals.css` says what survives printing, the article page marks WHICH
// element that is, `callout.tsx` names a callout's type in words, and the
// `article-pdf/` pair turns the same element into a PDF behind the toolbar. Any
// one of them renamed on its own silently produces a blank sheet or an empty
// file, which is exactly the failure a browser test notices last.
//
// The two halves are asserted on their own next door — `article-pdf/
// extract.test.ts` for what is in the file, `article-pdf/render.test.ts` for
// how it looks. What is left here is the part neither of them can hold alone:
// the file name, the download control, and every place the printed page and the
// downloaded file have to agree.
//
// The browser half of the acceptance criteria (print-media emulation, the
// download event) is proved on the branch's Vercel preview by
// `.claude/skills/validate-frontend`.
//
// PREFER A BEHAVIOURAL ASSERTION TO A SOURCE GREP. Reading a file and matching
// its prose pins the CODE'S COMMENTS, not the code, so it breaks on a rename or
// a file split for reasons that have nothing to do with the reader's PDF. The
// source is read below for three things only: the marker attributes and the
// print stylesheet (which have no runtime surface here), the shape a bundle
// must not have (a static import), and the one place where a stale COMMENT is
// itself the defect — the divergence count.
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
const PDF_EXTRACT = readFileSync(
  path.join(SRC, "components", "wiki", "article-pdf", "extract.ts"),
  "utf-8"
);
const PDF_RENDER = readFileSync(
  path.join(SRC, "components", "wiki", "article-pdf", "render.tsx"),
  "utf-8"
);

/** Every file the download path is spread over, for "this shape is absent". */
const PDF_SOURCE = [ARTICLE_ACTIONS, PDF_EXTRACT, PDF_RENDER].join("\n");

/** Everything inside the one `@media print` block. */
const printBlock = (() => {
  const start = GLOBALS_CSS.indexOf("@media print");
  assert.notEqual(start, -1, "globals.css has no @media print block");
  return GLOBALS_CSS.slice(start);
})();

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

describe("the print contract, across every file that holds a piece of it", () => {
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

  test("both paths draw the table as a bordered grid, at the same weight", () => {
    // The ruling on PR #391: the downloaded file has to match the printed page
    // here. Both halves are read out as NUMBERS and compared — the stylesheet's
    // pt value against the width the renderer actually puts on the tree — so
    // changing one alone fails here rather than shipping two different grids.
    const printed = printBlock.match(
      /:is\(th, td\)\s*\{\s*border:\s*([\d.]+)pt solid/
    );
    assert.ok(printed, "the print stylesheet draws no cell border");

    const drawn = renderBlock(
      {
        kind: "table",
        rows: [{ cells: [plain("Week")], isHeader: true }],
      },
      0,
      primitives
    ) as unknown as Rendered;
    const [cell] = childrenOf(childrenOf(drawn)[0]);

    assert.equal(drawn.props.style?.borderTopWidth, Number(printed[1]));
    assert.equal(cell.props.style?.borderBottomWidth, Number(printed[1]));
  });

  test("both paths keep bold, italic and inline code emphasized", () => {
    // The round-2 ruling on PR #391. Print keeps emphasis by doing nothing —
    // the browser sets `<strong>` bold on its own — so the parity claim breaks
    // only if the print block starts flattening it, or if the PDF stops
    // resolving an emphasized run to a face of its own. Both halves are
    // asserted, because either one alone would let the two renderers drift
    // apart again.
    assert.ok(
      !/font-(weight|style):\s*normal\s*!important/.test(printBlock),
      "the print path must not flatten emphasis"
    );

    // Each of the three distinctions this corpus makes resolves to its own
    // face, and a plain run to none — which is what "emphasized" can mean in a
    // document that carries no font asset.
    assert.deepEqual(
      {
        bold: runFontFamily({ text: "x", bold: true }),
        italic: runFontFamily({ text: "x", italic: true }),
        mono: runFontFamily({ text: "x", mono: true }),
        plain: runFontFamily({ text: "x" }),
      },
      {
        bold: "Helvetica-Bold",
        italic: "Helvetica-Oblique",
        mono: "Courier",
        plain: undefined,
      }
    );
    assert.equal(
      runFontFamily({ text: "x", italic: true }, true),
      "Helvetica-BoldOblique",
      "an italic word in a bold heading keeps both"
    );
  });

  test("the header comment counts the divergences it actually has", () => {
    // The one place a prose assertion is the point: the comment claims "the
    // same article" on both paths, so every place the two renderers disagree
    // has to be named next to that claim. It said "ONE KNOWN DIVERGENCE" while
    // images were a second one, which is the same shape of untrue claim the
    // table fix corrected.
    //
    // Note what this can and cannot do: it catches a STALE count — a divergence
    // that got fixed or renamed while the header kept claiming it — and never a
    // NEW one, because nothing here knows about a gap nobody has written down.
    // A new divergence is caught by the behavioural test that pins it (images,
    // below) or not at all.
    assert.ok(
      ARTICLE_ACTIONS.includes("THREE KNOWN DIVERGENCES"),
      "the divergence count must match the list below it"
    );
    assert.ok(ARTICLE_ACTIONS.includes("#398"), "the arrow gap is named");
    assert.ok(
      /Images print and do not download/.test(ARTICLE_ACTIONS),
      "the image gap is named"
    );
    assert.ok(
      /Nesting inside a list item, a blockquote or a table cell FLATTENS/.test(
        ARTICLE_ACTIONS
      ),
      "the nesting gap is named"
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

  test("a callout carries its framing into the PDF, box and type both", () => {
    // Ruled on PR #391, 2026-08-12 (option (c)) — and pinned the way the image
    // gap above is pinned, so this is a fact the suite holds rather than a
    // sentence in a comment. It failed before the fix: a callout fell to the
    // recursive default and its paragraphs arrived unframed, indistinguishable
    // from the prose around them.
    //
    // The two halves of the contract are asserted separately, because either
    // one alone puts the reader back where they started: the component has to
    // NAME its type, and the download path has to draw what it names.
    const marked = Callout({ type: "warning", children: null }) as unknown as {
      props: Record<string, unknown>;
    };
    assert.equal(
      marked.props[PRINT_CALLOUT_ATTRIBUTE],
      "Warning",
      "the callout must write its type out for readers that have no icons"
    );

    const [block] = extractPrintBlocks(
      el("div", [
        calloutEl(
          String(marked.props[PRINT_CALLOUT_ATTRIBUTE]),
          el("p", [textNode("Checklists are not optional.")])
        ),
      ])
    );
    assert.ok(block && block.kind === "callout", "a callout is its own block");

    const drawn = renderBlock(block, 0, primitives) as unknown as Rendered;
    assert.equal(drawn.type, "View");
    assert.ok(drawn.props.style?.borderWidth, "the box lost its border");
    assert.equal(childrenOf(drawn)[0].props.children, "Warning");
  });

  test("the component's sr-only type label is hidden from both paper paths", () => {
    // Third half of the same contract, and the one the stub above cannot hold
    // on its own: the component says the type TWICE — once in the marker, once
    // in a visually hidden span for a screen reader — and only the marker is
    // meant to travel. The span is `data-print-hide`, so `@media print` drops
    // it and `collectRuns` skips it.
    //
    // Asserted against the component itself, because the failure this replaces
    // was a stub that had drifted from the markup: the span was not marked, and
    // wherever a callout was nested the word joined the sentence.
    const rendered = Callout({
      type: "warning",
      children: null,
    }) as unknown as { props: { children: unknown } };

    const children = rendered.props.children as {
      props?: Record<string, unknown>;
    }[];
    const label = children.find(
      (child) => child?.props?.children === "Warning"
    );

    assert.ok(
      label,
      "the callout no longer names its type for a screen reader"
    );
    assert.equal(
      label.props?.["data-print-hide"],
      "",
      "an unmarked sr-only label reaches the PDF as a word the page never shows"
    );
    assert.match(printBlock, /\[data-print-hide\]\s*\{\s*display:\s*none/);
  });

  test("a callout nested in a list item flattens, as divergence 3 says", () => {
    // Pinned beside the image gap, for the same reason: a limitation nobody
    // asserts is a limitation nobody notices has changed. `inlineRuns` reads a
    // list item, a blockquote and a table cell as ONE LINE, so a callout inside
    // one keeps its words and loses its box — while the browser prints the box.
    //
    // What must NOT happen is the words changing too: the type word belongs to
    // the box, and where there is no box there is no word.
    const [block] = extractPrintBlocks(
      el("div", [
        el("ul", [
          el("li", [
            textNode("Book the room. "),
            calloutEl("Warning", el("p", [textNode("Confirm the date.")])),
          ]),
        ]),
      ])
    );

    assert.equal(block?.kind, "listItem", "the callout did not stay a block");
    assert.deepEqual(
      block,
      {
        kind: "listItem",
        depth: 0,
        marker: "•",
        runs: plain("Book the room. Confirm the date."),
      },
      "the flattened callout must read as the sentence, and nothing more"
    );
  });

  test("a link's URL survives into print", () => {
    assert.match(printBlock, /a\[href\]::after/);
    assert.match(printBlock, /content:\s*" \("\s*attr\(href\)\s*"\)"/);
    assert.match(printBlock, /a\[href\^="#"\]::after/);
  });
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
    // Every file on the download path, not just this one: `render.tsx` is
    // imported statically FROM here, so a static import of the renderer over
    // there would reach the bundle just the same. It may name the module in a
    // type position (`typeof import(...)`), which ships nothing.
    //
    // The pattern spans lines. `^import .* from "…";$` only ever saw an import
    // written on ONE line, and prettier wraps an import the moment it names
    // more than a couple of things — which is exactly the shape this one would
    // take, so the guard could have stayed green while every wiki reader
    // downloaded the renderer. `[^;]*` crosses newlines and stops at the first
    // statement end, so it cannot run on into an unrelated line either.
    const STATIC_IMPORT = /^import[^;]*from "@react-pdf\/renderer";/m;

    assert.ok(
      !STATIC_IMPORT.test(PDF_SOURCE),
      "a static import puts the whole PDF renderer in every reader's bundle"
    );

    // The guard proves it can SEE the shape it forbids, in both spellings.
    assert.ok(
      STATIC_IMPORT.test('import { pdf } from "@react-pdf/renderer";'),
      "the guard misses a single-line static import"
    );
    assert.ok(
      STATIC_IMPORT.test(
        'const before = 1;\nimport {\n  Document,\n  Page,\n  Text,\n  View,\n} from "@react-pdf/renderer";\nconst after = 2;'
      ),
      "the guard misses a wrapped static import — the shape prettier writes"
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
