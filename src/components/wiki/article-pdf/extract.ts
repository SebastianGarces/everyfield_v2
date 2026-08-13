// ============================================================================
// Article PDF — reading the rendered article out of the DOM (W-018, W-020)
// ============================================================================
//
// Pure, browser-free, and the only half of the download path that decides WHAT
// is in the file. `render.tsx` decides how it looks; `article-actions.tsx` is
// the control that joins them. Nothing here imports React or
// `@react-pdf/renderer`, which is what lets a plain unit test drive it.
//
// Reading the DOM under `[data-print-body]` — rather than parsing MDX — is what
// makes the file agree with the screen: an MDX component nobody remembered to
// teach a parser about still arrives here as text, because an unknown element
// is RECURSED INTO rather than skipped.
//
// A block of prose is not one string but an ordered list of RUNS — a piece of
// text plus the emphasis it carries — so `<strong>`, `<em>` and inline `<code>`
// survive as their own spans instead of dissolving into the sentence. Emphasis
// in this corpus is what marks the one step in a checklist that must not be
// skipped, so flattening it changes what an article SAYS (ruling on PR #391,
// 2026-08-10).
//
// A BLOCK-LEVEL CALLOUT KEEPS ITS FRAME, AND ITS TYPE ARRIVES AS A WORD.
//
// `callout.tsx` draws a callout's type as an ICON and nothing else, and an icon
// is the one thing a document built from text cannot carry — so a callout used
// to fall to the recursive default and land in the file as ordinary prose. A
// **Warning** could reach a launch-team meeting looking like a paragraph.
// `PRINT_CALLOUT_ATTRIBUTE` is how the component names its type in words for
// this reader; a marked element reached by `collectBlocks` becomes a `callout`
// block holding its own blocks, and `render.tsx` draws the border and prints
// the word in place of the icon (ruling on PR #391, 2026-08-12, option (c)).
//
// ONLY `collectBlocks` builds blocks. A list item, a blockquote and a table
// cell are read out by `inlineRuns` as ONE LINE of text, so a callout reached
// through one of them is not a block at all: its words join the line and its
// box is lost. That is divergence 3 below, not a missing case here.
//
// A callout that is itself a block but holds NO blocks — the one-line
// `<Callout>text</Callout>`, which MDX compiles to a bare string child — is a
// different thing and IS handled: `collectCallout` falls back to reading it as
// one line of runs, so the frame, the type and the words all survive. Without
// that fallback the whole callout vanished, which is worse than divergence 3
// promises and is why the "callouts … all carry across" sentence in
// `article-actions.tsx` was false.
//
// DIVERGENCES 2 AND 3 FROM THE PRINTED PAGE are owned here. The numbering is
// `article-actions.tsx`'s list, which is the ONE place that states how many
// divergences there are — cite an item by number from here, never restate the
// total, or two files can disagree about it.
//
//   2. `collectBlocks` has no `IMG` case, so an image falls to the recursive
//      default, has no children, and drops silently while the print stylesheet
//      keeps it. Carrying it across means fetching and embedding the bytes.
//   3. Nesting inside a list item, a blockquote or a table cell flattens, as
//      above. Unflattening means those three becoming block containers the way
//      a callout is, which changes the block model rather than adding a case.
// ============================================================================

/**
 * `Node.ELEMENT_NODE` / `Node.TEXT_NODE` by value.
 *
 * The constants are read during extraction, and reading them off the `Node`
 * global would tie a pure function to a browser environment for no gain — the
 * numbers are fixed by the DOM specification and this way the extraction is
 * exercised by a plain unit test.
 */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The attribute a callout names its TYPE in, for readers that have no icons.
 *
 * `callout.tsx` sets it to the type's own title ("Warning", "Insight", …) — the
 * same string its `calloutConfig` labels the icon with — so the word in the PDF
 * and the icon on the screen cannot drift apart. The component writes the
 * attribute out literally rather than importing this constant, which would pull
 * the extractor into every wiki reader's bundle for one string; what holds the
 * two spellings together is a test that CALLS the component and reads the
 * attribute off it (`article-actions.test.ts`). A marker misspelled on one side
 * alone is a silent loss of the framing, so it is asserted rather than assumed.
 *
 * It sits in the `data-print-*` family with `data-print-root`,
 * `data-print-body` and `data-print-hide`, but it is the only one of the four
 * this extractor reads ALONE: the print stylesheet needs no callout marker,
 * because the browser prints the box the screen already draws.
 */
export const PRINT_CALLOUT_ATTRIBUTE = "data-print-callout";

// --- the shape the article is reduced to ------------------------------------

/**
 * A stretch of text and the emphasis it carries.
 *
 * The flags are the three inline distinctions this corpus makes — `<strong>`,
 * `<em>` and inline `<code>` — and they are set only when TRUE, so two runs
 * that read the same compare the same.
 */
export type PrintRun = {
  text: string;
  bold?: true;
  italic?: true;
  mono?: true;
};

/** The plain reading of a run list, for measuring and for emptiness. */
export function runsText(runs: PrintRun[]): string {
  return runs.map((run) => run.text).join("");
}

/**
 * One row of a table, kept with its siblings rather than emitted alone.
 *
 * A row cannot be laid out on its own: its column widths are a property of the
 * whole table, and whether it is bold is a property of where it sat in it.
 */
export type PrintTableRow = { cells: PrintRun[][]; isHeader: boolean };

/**
 * A framed aside, and the blocks inside it.
 *
 * The only block that NESTS. A callout is a box around whatever an author put
 * in it — usually a paragraph, sometimes a list — so flattening it to runs
 * would lose the list and the box in one move. `label` is the type in words
 * ("Warning"), which is what the reader loses when the icon cannot travel.
 */
export type PrintCallout = {
  kind: "callout";
  label: string;
  blocks: PrintBlock[];
};

export type PrintBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; runs: PrintRun[] }
  | { kind: "paragraph"; runs: PrintRun[] }
  | { kind: "listItem"; depth: number; marker: string; runs: PrintRun[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; runs: PrintRun[] }
  | { kind: "table"; rows: PrintTableRow[] }
  | PrintCallout
  | { kind: "divider" };

/**
 * Elements that are not prose, wherever they are reached.
 *
 * An icon, a control and a script tag carry nothing a reader would call part of
 * the article — and `<svg>` is the one that matters here, because a callout's
 * type is drawn as one. The set is consulted on BOTH walks: skipping a tag when
 * it is a block and reading its text when it is inline is how a word the page
 * never shows reaches the file, which is exactly what the `sr-only` type label
 * did before it was marked `data-print-hide`. An `<svg>` holding a `<title>` or
 * a `<text>` is the same defect waiting on a raw-SVG author.
 *
 * `svg` is matched in both cases because `tagName` is lower case for an SVG
 * element in a real DOM and upper case for an HTML one.
 */
const NON_PROSE_TAGS = new Set(["SVG", "svg", "BUTTON", "SCRIPT", "STYLE"]);

// --- blocks -----------------------------------------------------------------

/**
 * Reduce rendered prose to an ordered list of printable blocks.
 *
 * Unknown elements are RECURSED INTO rather than skipped, which is what keeps
 * MDX components working without being enumerated here: an MDX wrapper is a
 * `div` around paragraphs, so its paragraphs arrive on their own.
 *
 * The one MDX component this reader does know is a callout, and it says so
 * itself — see `PRINT_CALLOUT_ATTRIBUTE`. Everything else stays anonymous.
 */
export function extractPrintBlocks(root: Element): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  collectBlocks(root, blocks);
  return blocks;
}

function collectBlocks(parent: Element, out: PrintBlock[]): void {
  for (const child of Array.from(parent.children)) {
    if (child.hasAttribute("data-print-hide")) continue;

    // Checked before the tag, because a callout is a plain `div` and would
    // otherwise fall to the recursive default — which is exactly how it used to
    // arrive as unframed prose.
    const calloutLabel = child.getAttribute(PRINT_CALLOUT_ATTRIBUTE);
    if (calloutLabel !== null) {
      collectCallout(child, calloutLabel, out);
      continue;
    }

    switch (child.tagName) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const level = Math.min(Number(child.tagName[1]), 4) as 1 | 2 | 3 | 4;
        pushBlock(out, { kind: "heading", level, runs: inlineRuns(child) });
        break;
      }
      case "P":
        pushBlock(out, { kind: "paragraph", runs: inlineRuns(child) });
        break;
      case "UL":
      case "OL":
        collectList(child, out, 0);
        break;
      case "PRE":
        // A fenced block is mono in its entirety, and its own line breaks are
        // the content — so it stays one string, and the run model above never
        // touches it.
        pushBlock(out, {
          kind: "code",
          text: (child.textContent ?? "").replace(/\s+$/, ""),
        });
        break;
      case "BLOCKQUOTE":
        pushBlock(out, { kind: "quote", runs: inlineRuns(child) });
        break;
      case "TABLE":
        collectTable(child, out);
        break;
      case "HR":
        out.push({ kind: "divider" });
        break;
      default:
        if (NON_PROSE_TAGS.has(child.tagName)) break;
        collectBlocks(child, out);
    }
  }
}

function collectList(list: Element, out: PrintBlock[], depth: number): void {
  const ordered = list.tagName === "OL";
  let index = 1;

  for (const item of Array.from(list.children)) {
    if (item.tagName !== "LI") continue;

    const marker = ordered ? `${index++}.` : "•";
    pushBlock(out, {
      kind: "listItem",
      depth,
      marker,
      runs: inlineRuns(item, { skipLists: true }),
    });

    for (const nested of Array.from(item.children)) {
      if (nested.tagName === "UL" || nested.tagName === "OL") {
        collectList(nested, out, depth + 1);
      }
    }
  }
}

/**
 * Collect a callout as ONE nested block, keeping what is inside it whole.
 *
 * The contents go through `collectBlocks` unchanged, so a callout holding a
 * list, a table or a second callout keeps all of it — and its icon still
 * disappears, because the `SVG` case above already drops it and the label now
 * says in words what the icon said in a picture. The component's `sr-only` copy
 * of that same word carries `data-print-hide`, so the type is printed once,
 * here, and never a second time inside the box.
 *
 * A CALLOUT WRITTEN ON ONE LINE HAS NO BLOCKS AND IS STILL NOT EMPTY. MDX
 * compiles `<Callout type="tip">One line.</Callout>` — open tag, text and close
 * tag on a single line — to a BARE STRING child with no `<p>` around it; put
 * emphasis in it and the children are a string and a `<strong>`, still with no
 * paragraph. `collectBlocks` walks `children`, which is ELEMENTS only, so that
 * callout's block list comes back empty although it has words, and returning
 * here dropped the box, the type AND the sentence. Reading the element as one
 * LINE of runs recovers all three, and it is the whole remaining shape: MDX
 * refuses a callout that opens with text and then contains a block ("Expected a
 * closing tag … before the end of `paragraph`"), so an author gets either all
 * blocks or all inline — never a mixture this fallback would have to merge.
 *
 * An empty callout is still not framed: a box drawn around nothing is a mark on
 * the page that the printed article does not have. The fallback preserves that,
 * and preserves divergence 2 with it — an image-only callout contributes no
 * runs either, so it stays dropped rather than becoming an empty box.
 */
function collectCallout(
  element: Element,
  label: string,
  out: PrintBlock[]
): void {
  const blocks: PrintBlock[] = [];
  collectBlocks(element, blocks);

  if (blocks.length === 0) {
    const runs = inlineRuns(element);
    if (runsText(runs).length === 0) return;
    blocks.push({ kind: "paragraph", runs });
  }

  out.push({ kind: "callout", label: label.trim(), blocks });
}

/**
 * Collect a table as ONE block, with its rows intact.
 *
 * A header row is one whose cells are all `th` — which is how the MDX table
 * renders its `thead` (`mdx-components.tsx`) — and it is the only thing that
 * decides boldness here, so a `thead`-less markdown table simply has none.
 *
 * Rows are padded to the widest one. A ragged row would otherwise stretch its
 * last cell across the missing columns and break the grid the eye follows down
 * the page; an empty cell is the honest rendering of a missing one.
 */
function collectTable(table: Element, out: PrintBlock[]): void {
  const rows: PrintTableRow[] = [];

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const cellElements = Array.from(row.children);
    const cells = cellElements.map((cell) => inlineRuns(cell));
    if (!cells.some((cell) => runsText(cell).length > 0)) continue;

    rows.push({
      cells,
      isHeader: cellElements.every((cell) => cell.tagName === "TH"),
    });
  }

  if (rows.length === 0) return;

  const columns = Math.max(...rows.map((row) => row.cells.length));
  for (const row of rows) {
    while (row.cells.length < columns) row.cells.push([]);
  }

  out.push({ kind: "table", rows });
}

function pushBlock(out: PrintBlock[], block: PrintBlock): void {
  if ("text" in block && block.text.length === 0) return;
  if ("runs" in block && runsText(block.runs).length === 0) return;
  out.push(block);
}

// --- the column model -------------------------------------------------------

/** Narrowest and widest a column may be asked for, in "characters". */
const MIN_COLUMN_WEIGHT = 8;
const MAX_COLUMN_WEIGHT = 44;

/**
 * Column widths as percentages of the table, summing to 100.
 *
 * `@react-pdf/renderer` has no table primitive and no content-driven sizing, so
 * the widths have to be decided before layout. The longest cell in a column is
 * the only signal available without measuring glyphs, and it is clamped at both
 * ends: without a floor a one-word column ("1", "Yes") collapses to a hairline
 * and wraps every character; without a ceiling one long paragraph cell starves
 * every other column. The clamp bounds the widest-to-narrowest ratio at 5.5:1.
 */
export function columnWidths(rows: PrintTableRow[]): number[] {
  const columns = Math.max(0, ...rows.map((row) => row.cells.length));
  if (columns === 0) return [];

  const weights = Array.from({ length: columns }, (_, column) => {
    const longest = Math.max(
      0,
      ...rows.map((row) => runsText(row.cells[column] ?? []).length)
    );
    return Math.min(Math.max(longest, MIN_COLUMN_WEIGHT), MAX_COLUMN_WEIGHT);
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map(
    (weight) => Math.round((weight / total) * 10_000) / 100
  );

  // Rounding leaves a few hundredths on the table; the last column absorbs
  // them, so the row is exactly full and never overflows into a wrap.
  const used = widths.slice(0, -1).reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.round((100 - used) * 100) / 100;

  return widths;
}

// --- inline emphasis --------------------------------------------------------

type Emphasis = Omit<PrintRun, "text">;

/**
 * The tags that change how a run READS, and nothing else.
 *
 * `<b>` and `<i>` sit beside `<strong>` and `<em>` because MDX lets an author
 * write raw HTML; every other inline tag (`<a>`, `<span>`, a component's
 * wrapper) is transparent here and contributes only its words.
 */
const EMPHASIS_BY_TAG: Record<string, Emphasis> = {
  STRONG: { bold: true },
  B: { bold: true },
  EM: { italic: true },
  I: { italic: true },
  CODE: { mono: true },
};

/**
 * Flatten an element to a line of runs — text plus the emphasis it carries.
 *
 * Emphasis ACCUMULATES down the tree, so `<strong><em>` arrives as one run that
 * is both, rather than as the innermost tag alone.
 *
 * A link contributes its destination as well as its label — on paper an anchor
 * is just underlined words, and the URL is the part the reader cannot recover.
 * Same-page anchors are left bare: `#section` names nothing off the page. The
 * destination takes the emphasis SURROUNDING the link, not the label's: it is
 * an aside this renderer adds, not something the author emphasized.
 */
function inlineRuns(
  element: Element,
  options: { skipLists?: boolean } = {}
): PrintRun[] {
  const runs: PrintRun[] = [];
  collectRuns(element, {}, runs, options);
  return tidyRuns(runs);
}

function collectRuns(
  element: Element,
  emphasis: Emphasis,
  out: PrintRun[],
  options: { skipLists?: boolean }
): void {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      out.push({ ...emphasis, text: node.textContent ?? "" });
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;

    const child = node as Element;
    if (child.hasAttribute("data-print-hide")) continue;
    if (NON_PROSE_TAGS.has(child.tagName)) continue;
    if (options.skipLists && (child.tagName === "UL" || child.tagName === "OL"))
      continue;

    collectRuns(
      child,
      { ...emphasis, ...EMPHASIS_BY_TAG[child.tagName] },
      out,
      options
    );

    const href = child.getAttribute("href");
    if (child.tagName === "A" && href && !href.startsWith("#")) {
      out.push({ ...emphasis, text: ` (${href})` });
    }
  }
}

/**
 * Collapse whitespace, merge neighbours that read alike, trim the ends.
 *
 * Whitespace is squeezed PER RUN and trimmed only at the two ends of the line,
 * never per run: the space before a bold word lives in the plain run before it,
 * and trimming each run in turn would weld "See the" to "launch guide".
 *
 * A per-run squeeze is not enough on its own, because the run BOUNDARY is a
 * place two spaces can meet: `See the<strong> launch </strong>guide` reaches
 * here as `"See the "`, `" launch "`, `"guide"`, and each of those is already
 * single-spaced. The browser collapses the pair across the seam and so does
 * this — otherwise the downloaded file carries a double space the printed page
 * does not, a parity gap in the one direction nothing else would catch.
 */
function tidyRuns(runs: PrintRun[]): PrintRun[] {
  const tidied: PrintRun[] = [];

  for (const run of runs) {
    let text = run.text.replace(/\s+/g, " ");
    if (text.length === 0) continue;

    const previous = tidied[tidied.length - 1];
    if (previous && previous.text.endsWith(" ") && text.startsWith(" ")) {
      text = text.slice(1);
      if (text.length === 0) continue;
    }

    if (previous && readsAlike(previous, run)) {
      previous.text += text;
      continue;
    }
    tidied.push({ ...run, text });
  }

  const first = tidied[0];
  const last = tidied[tidied.length - 1];
  if (first) first.text = first.text.replace(/^\s+/, "");
  if (last) last.text = last.text.replace(/\s+$/, "");

  return tidied.filter((run) => run.text.length > 0);
}

function readsAlike(a: Emphasis, b: Emphasis): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono;
}
