import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  extractPrintBlocks,
  pdfFileName,
  PRINT_BODY_SELECTOR,
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
      { kind: "heading", level: 2, text: "Counting the cost" },
      { kind: "paragraph", text: "A plant is a people project." },
      { kind: "listItem", depth: 0, marker: "•", text: "Pray" },
      { kind: "listItem", depth: 0, marker: "•", text: "Recruit" },
      { kind: "listItem", depth: 1, marker: "•", text: "Then follow up" },
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
        text: "See the launch guide (/wiki/phase-4/launch) first.",
      },
    ]);
  });

  test("leaves a same-page anchor bare", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [el("a", [textNode("Back to top")], { href: "#top" })]),
      ])
    );

    assert.deepEqual(blocks, [{ kind: "paragraph", text: "Back to top" }]);
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
      { kind: "paragraph", text: "Do not skip the vision meeting." },
    ]);
  });

  test("drops anything marked data-print-hide", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("p", [textNode("Kept")]),
        el("p", [textNode("Dropped")], { "data-print-hide": "" }),
      ])
    );

    assert.deepEqual(blocks, [{ kind: "paragraph", text: "Kept" }]);
  });

  test("flattens a table to rows", () => {
    const blocks = extractPrintBlocks(
      el("div", [
        el("table", [
          el("tbody", [
            el("tr", [
              el("th", [textNode("Week")]),
              el("th", [textNode("Focus")]),
            ]),
            el("tr", [
              el("td", [textNode("1")]),
              el("td", [textNode("Prayer")]),
            ]),
          ]),
        ]),
      ])
    );

    assert.deepEqual(blocks, [
      { kind: "tableRow", cells: ["Week", "Focus"] },
      { kind: "tableRow", cells: ["1", "Prayer"] },
    ]);
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
