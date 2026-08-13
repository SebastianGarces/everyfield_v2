import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PrintRun } from "./extract";
import { renderBlock, runFontFamily } from "./render";
import { childrenOf, plain, primitives, type Rendered } from "./test-doubles";

// ----------------------------------------------------------------------------
// Turning extracted blocks into a page (W-018, W-020).
//
// `render.tsx` decides how the downloaded file LOOKS; `extract.test.ts` covers
// what is in it, and `../article-actions.test.ts` covers the claims the printed
// page and the file make about each other. Split off from that file once it had
// grown past a thousand lines along a seam the source already drew.
//
// The tree is asserted, never a rendered PDF: `renderBlock` takes its `Text`
// and `View` from the caller, so proving it draws a border — or sets a word in
// the bold face — needs no `@react-pdf/renderer`, no browser and no file.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");
const WIKI = path.join(SRC, "components", "wiki");
const PDF_RENDER = readFileSync(
  path.join(WIKI, "article-pdf", "render.tsx"),
  "utf-8"
);

/**
 * Every file the download path is spread over, for "this shape is absent".
 *
 * A flattened row would be a defect wherever it were written, so the search is
 * as wide as the path — narrowing it to this file would let the same rendering
 * come back one import away.
 */
const PDF_SOURCE = [
  readFileSync(path.join(WIKI, "article-actions.tsx"), "utf-8"),
  readFileSync(path.join(WIKI, "article-pdf", "extract.ts"), "utf-8"),
  PDF_RENDER,
].join("\n");

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
      !PDF_SOURCE.includes('cells.join("  |  ")'),
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

  test("styles an emphasized run with a face and nothing else", () => {
    // The guard behind the two tests above, asserted on what is RENDERED rather
    // than on the source text: a `fontWeight`/`fontStyle` pair on a nested Text
    // is the shape that throws under a single-source family. Every emphasis
    // combination is walked, so no one corner can reintroduce an axis.
    for (const bold of [undefined, true] as const) {
      for (const italic of [undefined, true] as const) {
        for (const mono of [undefined, true] as const) {
          if (!bold && !italic && !mono) continue;

          const run = { text: "x", bold, italic, mono } as PrintRun;
          const [emphasized] = childrenOf(
            paragraph([run]) as Rendered
          ) as unknown as Rendered[];

          assert.deepEqual(
            Object.keys(emphasized.props.style ?? {}),
            ["fontFamily"],
            `emphasis must be a face alone, got ${JSON.stringify(emphasized.props.style)}`
          );
        }
      }
    }
  });
});

describe("renderBlock — the callout box in the downloaded PDF", () => {
  // A callout renders `{label}{blocks}`, so its children arrive as a Text
  // beside an ARRAY of blocks. React flattens that; the assertions here do too.
  const partsOf = (node: Rendered): Rendered[] =>
    (childrenOf(node) as unknown as (Rendered | Rendered[] | null)[])
      .flat()
      .filter((child): child is Rendered => Boolean(child));

  const callout = renderBlock(
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
    0,
    primitives
  ) as unknown as Rendered;

  test("draws the frame the printed page draws", () => {
    // The ruling on PR #391 (2026-08-12): the file must match the page. On
    // paper the box is a border; here it is one too, on all four sides —
    // a callout is a separate object, not a rule inside one.
    assert.equal(callout.type, "View");
    assert.equal(callout.props.style?.borderWidth, 1);
    assert.ok(callout.props.style?.borderColor, "the box has no colour");
  });

  test("prints the type as a word, above the callout's own prose", () => {
    // In place of the lucide icon, which no text renderer can carry.
    const [label, ...rest] = partsOf(callout);
    assert.equal(label.type, "Text");
    assert.equal(label.props.children, "Warning");
    assert.equal(label.props.style?.fontFamily, "Helvetica-Bold");
    assert.equal(rest.length, 2);
  });

  test("renders what is inside with the same renderer as everything else", () => {
    // A list inside a callout keeps its marker: there is no second, poorer
    // renderer for framed content.
    const [, paragraph, item] = partsOf(callout);
    assert.deepEqual(childrenOf(paragraph), ["Checklists are not optional."]);
    assert.equal(item.type, "View");
    assert.equal(childrenOf(item)[0].props.children, "•");
  });

  test("omits the label rather than printing an empty line", () => {
    const unlabelled = renderBlock(
      {
        kind: "callout",
        label: "",
        blocks: [{ kind: "paragraph", runs: plain("Just prose.") }],
      },
      0,
      primitives
    ) as unknown as Rendered;

    const [only] = partsOf(unlabelled);
    assert.deepEqual(childrenOf(only), ["Just prose."]);
    assert.equal(partsOf(unlabelled).length, 1);
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
        colorOf(PDF_RENDER, new RegExp(`const ${name} = "(#[0-9a-f]{6})"`)),
        colorOf(SHARED_STYLES, new RegExp(`${name}: "(#[0-9a-f]{6})"`))
      );
    });
  }
});
