"use client";

// ============================================================================
// Article actions — print and download (W-018, W-020)
// ============================================================================
//
// Two controls on one pipeline: what the reader sees on paper and what they get
// in the file are the same article, taken from the same place. Prose, lists,
// callouts, code, link destinations, INLINE EMPHASIS and TABLES all carry
// across — a table is a bordered grid on both paths, because a flattened one
// (cells joined with a pipe) loses the column a fragment belongs to, and bold,
// italic and inline code keep their weight and face, because emphasis in this
// corpus is what marks the one step in a checklist that must not be skipped
// (rulings on PR #391, 2026-08-10).
//
//   Print     hands the page to the browser. The print stylesheet in
//             `globals.css` drops the shell, the wiki sidebar, the table of
//             contents and this toolbar, and sets the prose as ink on paper.
//   Download  builds a PDF in the browser from the rendered prose and saves it.
//
// The two renderers are independent, so "the same article" is a claim that has
// to be maintained: `article-actions.test.ts` reads this file and `globals.css`
// and fails when only one of them draws the grid.
//
// TWO KNOWN DIVERGENCES, tracked rather than hidden:
//
//   1. Characters outside WinAnsi (`→`, `↓`, box drawing) print correctly and
//      corrupt in the downloaded file, because the standard-14 fonts this
//      document pins cannot encode them. The fix is a registered Unicode TTF,
//      which means shipping a font asset — deferred by the same ruling and
//      tracked as #398.
//   2. Images print and do not download. `globals.css` keeps `img` on the
//      printed page, but `collectBlocks` below has no `IMG` case, so an image
//      falls to the recursive default, has no children, and drops silently.
//      Carrying it across means fetching and embedding the bytes, so it is out
//      of scope for the table ruling; the PR body lists it as a limitation.
//
// HOW EMPHASIS SURVIVES: RUNS, AND FONT NAMES RATHER THAN WEIGHTS
//
// A block of prose is not one string but an ordered list of RUNS — a piece of
// text plus the emphasis it carries — so `<strong>`, `<em>` and inline `<code>`
// each become their own `Text` inside the block's `Text` instead of dissolving
// into it. Nesting is what keeps a run in the sentence: it wraps with the words
// around it, which a sibling element could not do.
//
// Each styled run names a STANDARD-14 FONT outright (`Helvetica-Bold`,
// `Helvetica-Oblique`, …) and never sets `fontWeight` or `fontStyle`. That is
// not a stylistic preference. `@react-pdf/font` registers those names as
// single-source compatibility families, and it resolves a face by filtering on
// `fontStyle` FIRST — so asking a `Helvetica-Bold` block for an italic child
// finds nothing and THROWS, turning a bold heading with one italic word into a
// failed download. Naming the combined face cannot miss. It also needs no font
// asset, which is what kept this fix inside the ruling.
//
// WHY THE PDF IS BUILT CLIENT-SIDE, FROM THE DOM
//
// F6 already renders PDFs with `@react-pdf/renderer` (`src/lib/documents/pdf`),
// but that path takes a CODE-DEFINED template and merge values. An article is
// neither: it is arbitrary MDX, compiled at request time, whose components
// (`Callout`, tables, code blocks) exist only once React has rendered them. The
// dependency still fits — it is a React renderer, and it has a browser build —
// so it is reused, but it is fed the rendered article instead of a template.
// Reading the DOM under `[data-print-body]` is what makes the file agree with
// the screen: an MDX component nobody remembered to teach a parser about still
// arrives here as text.
//
// The renderer is imported ON CLICK. It is a large bundle and every wiki reader
// would otherwise pay for it whether or not they ever download anything.
// ============================================================================

import { Download, Loader2, Printer } from "lucide-react";
import { useCallback, useState, type ReactElement } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { wikiHref } from "@/lib/wiki/href";

/** The element holding the article's rendered prose — the PDF's only source. */
export const PRINT_BODY_SELECTOR = "[data-print-body]";

/**
 * How long the blob URL stays alive after the click.
 *
 * Revoking synchronously cancels the download in Chromium — the URL has to
 * survive until the browser has actually read it — so it is released on a
 * timer instead of immediately.
 */
const BLOB_URL_LIFETIME_MS = 30_000;

type Primitives = Pick<typeof import("@react-pdf/renderer"), "Text" | "View">;

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

type PrintBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; runs: PrintRun[] }
  | { kind: "paragraph"; runs: PrintRun[] }
  | { kind: "listItem"; depth: number; marker: string; runs: PrintRun[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; runs: PrintRun[] }
  | { kind: "table"; rows: PrintTableRow[] }
  | { kind: "divider" };

// --- PDF styling ------------------------------------------------------------
//
// Point sizes, not the app's tokens: this is paper. `ink`, `muted` and `line`
// are the values in `src/lib/documents/pdf/styles.ts`, so a downloaded article
// and a downloaded template look like the same product; `grid` below is the one
// value this file adds, and it answers to the print stylesheet instead.

const ink = "#111827";
const muted = "#6b7280";
const line = "#d1d5db";

/**
 * The table grid, and only the table grid.
 *
 * Darker than `line`, because it is the same hairline the print stylesheet
 * draws (`0.5pt solid #999` on every `th`/`td`) and a rule that has to read as
 * a cell boundary at 0.5pt cannot be as faint as a section divider.
 */
const grid = "#9ca3af";

/** Hairline weight, in points — `globals.css` prints cell borders at 0.5pt. */
const TABLE_BORDER = 0.5;

// The faces, by name. Every one of these is a standard-14 font, so the document
// carries no font asset; see the header comment for why an emphasized run names
// its face instead of asking for a weight or a style.
const FONT_BODY = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_ITALIC = "Helvetica-Oblique";
const FONT_BOLD_ITALIC = "Helvetica-BoldOblique";
const FONT_MONO = "Courier";
const FONT_MONO_BOLD = "Courier-Bold";
const FONT_MONO_ITALIC = "Courier-Oblique";
const FONT_MONO_BOLD_ITALIC = "Courier-BoldOblique";

const pdfStyles = {
  page: {
    paddingTop: 54,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontFamily: FONT_BODY,
    fontSize: 11,
    lineHeight: 1.5,
    color: ink,
  },
  title: { fontFamily: FONT_BOLD, fontSize: 20, marginBottom: 6 },
  description: { fontSize: 11, color: muted, marginBottom: 6 },
  source: { fontSize: 9, color: muted, marginBottom: 16 },
  rule: { borderBottomWidth: 1, borderBottomColor: line, marginBottom: 18 },
  h1: {
    fontFamily: FONT_BOLD,
    fontSize: 16,
    marginTop: 16,
    marginBottom: 6,
  },
  h2: {
    fontFamily: FONT_BOLD,
    fontSize: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  h3: {
    fontFamily: FONT_BOLD,
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  h4: {
    fontFamily: FONT_BOLD,
    fontSize: 11,
    marginTop: 10,
    marginBottom: 4,
  },
  paragraph: { marginBottom: 8 },
  listRow: { flexDirection: "row" as const, marginBottom: 4 },
  listMarker: { width: 16 },
  listText: { flex: 1 },
  code: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    lineHeight: 1.4,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: line,
  },
  quote: {
    marginBottom: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: line,
    color: muted,
  },
  // A table is drawn as a collapsed grid: the container owns the top and left
  // hairlines, every cell owns its right and bottom one. Giving each cell all
  // four would double every interior rule to 1pt while the outer edge stayed
  // 0.5pt — visibly heavier inside than out.
  table: {
    marginBottom: 10,
    borderTopWidth: TABLE_BORDER,
    borderTopColor: grid,
    borderLeftWidth: TABLE_BORDER,
    borderLeftColor: grid,
  },
  tableRow: { flexDirection: "row" as const },
  tableCell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: TABLE_BORDER,
    borderRightColor: grid,
    borderBottomWidth: TABLE_BORDER,
    borderBottomColor: grid,
  },
  tableCellText: { fontSize: 10, lineHeight: 1.35 },
  tableHeaderText: {
    fontFamily: FONT_BOLD,
    fontSize: 10,
    lineHeight: 1.35,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: line,
    marginVertical: 12,
  },
  footer: {
    position: "absolute" as const,
    bottom: 32,
    left: 56,
    right: 56,
    fontSize: 9,
    color: muted,
    textAlign: "center" as const,
  },
};

// --- extraction -------------------------------------------------------------

/**
 * Reduce rendered prose to an ordered list of printable blocks.
 *
 * Unknown elements are RECURSED INTO rather than skipped, which is what keeps
 * MDX components working without being enumerated here: a `Callout` is a `div`
 * wrapping paragraphs, so its paragraphs arrive on their own.
 */
export function extractPrintBlocks(root: Element): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  collectBlocks(root, blocks);
  return blocks;
}

function collectBlocks(parent: Element, out: PrintBlock[]): void {
  for (const child of Array.from(parent.children)) {
    if (child.hasAttribute("data-print-hide")) continue;

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
      case "SVG":
      case "svg":
      case "BUTTON":
      case "SCRIPT":
      case "STYLE":
        break;
      default:
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
 */
function tidyRuns(runs: PrintRun[]): PrintRun[] {
  const tidied: PrintRun[] = [];

  for (const run of runs) {
    const text = run.text.replace(/\s+/g, " ");
    if (text.length === 0) continue;

    const previous = tidied[tidied.length - 1];
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

function pushBlock(out: PrintBlock[], block: PrintBlock): void {
  if ("text" in block && block.text.length === 0) return;
  if ("runs" in block && runsText(block.runs).length === 0) return;
  out.push(block);
}

// --- file naming ------------------------------------------------------------

/**
 * The saved file's name, derived from the slug.
 *
 * A slug is authored content and may hold a `/`, a space or a `%`
 * (`src/lib/wiki/href.ts`), none of which belong in a file name — so every run
 * of anything but a letter or a digit collapses to a single hyphen.
 */
export function pdfFileName(slug: string): string {
  const base = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "article"}.pdf`;
}

// --- rendering --------------------------------------------------------------

/**
 * The face a run is set in, or nothing when it is set in the block's own.
 *
 * `isBold` is what the SURROUNDING block already is — a heading, a header cell
 * — so an italic word inside a bold heading resolves to the bold italic face
 * rather than dropping back to a regular one.
 */
export function runFontFamily(
  run: PrintRun,
  isBold = false
): string | undefined {
  if (!run.bold && !run.italic && !run.mono) return undefined;

  const bold = run.bold === true || isBold;
  if (run.mono) {
    if (bold && run.italic) return FONT_MONO_BOLD_ITALIC;
    if (bold) return FONT_MONO_BOLD;
    return run.italic ? FONT_MONO_ITALIC : FONT_MONO;
  }
  if (bold && run.italic) return FONT_BOLD_ITALIC;
  if (bold) return FONT_BOLD;
  return FONT_ITALIC;
}

/**
 * A run list as the children of one `Text`.
 *
 * A run with no emphasis stays a bare string, so an unemphasized paragraph is
 * the single piece of text it always was; only the emphasized spans cost a
 * nested `Text`.
 */
function renderRuns(
  runs: PrintRun[],
  Text: Primitives["Text"],
  isBold = false
): (string | ReactElement)[] {
  return runs.map((run, index) => {
    const fontFamily = runFontFamily(run, isBold);
    if (!fontFamily) return run.text;
    return (
      <Text key={index} style={{ fontFamily }}>
        {run.text}
      </Text>
    );
  });
}

export function renderBlock(
  block: PrintBlock,
  key: number,
  { Text, View }: Primitives
): ReactElement {
  switch (block.kind) {
    case "heading":
      return (
        <Text key={key} style={pdfStyles[`h${block.level}`]}>
          {renderRuns(block.runs, Text, true)}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={pdfStyles.paragraph}>
          {renderRuns(block.runs, Text)}
        </Text>
      );
    case "listItem":
      return (
        <View
          key={key}
          style={{ ...pdfStyles.listRow, marginLeft: 12 + block.depth * 14 }}
        >
          <Text style={pdfStyles.listMarker}>{block.marker}</Text>
          <Text style={pdfStyles.listText}>{renderRuns(block.runs, Text)}</Text>
        </View>
      );
    case "code":
      return (
        <Text key={key} style={pdfStyles.code}>
          {block.text}
        </Text>
      );
    case "quote":
      return (
        <Text key={key} style={pdfStyles.quote}>
          {renderRuns(block.runs, Text)}
        </Text>
      );
    case "table": {
      const widths = columnWidths(block.rows);
      return (
        <View key={key} style={pdfStyles.table}>
          {block.rows.map((row, rowIndex) => (
            // A row never splits across a page: half a row on each sheet reads
            // as two wrong rows. The table itself still wraps, so a long one
            // continues on the next page.
            <View key={rowIndex} style={pdfStyles.tableRow} wrap={false}>
              {row.cells.map((cell, cellIndex) => (
                <View
                  key={cellIndex}
                  style={{
                    ...pdfStyles.tableCell,
                    width: `${widths[cellIndex]}%`,
                  }}
                >
                  <Text
                    style={
                      row.isHeader
                        ? pdfStyles.tableHeaderText
                        : pdfStyles.tableCellText
                    }
                  >
                    {renderRuns(cell, Text, row.isHeader)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    case "divider":
      return <View key={key} style={pdfStyles.divider} />;
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
}

// --- the control ------------------------------------------------------------

type ArticleActionsProps = {
  slug: string;
  title: string;
  description: string;
};

export function ArticleActions({
  slug,
  title,
  description,
}: ArticleActionsProps) {
  const [isPreparing, setIsPreparing] = useState(false);

  const handleDownload = useCallback(async () => {
    setIsPreparing(true);
    try {
      const body = document.querySelector(PRINT_BODY_SELECTOR);
      if (!body) {
        throw new Error("This article has no printable body.");
      }

      const blocks = extractPrintBlocks(body);
      const { pdf, Document, Page, Text, View } =
        await import("@react-pdf/renderer");

      const document_ = (
        <Document title={title} subject={description} author="EveryField">
          <Page size="LETTER" style={pdfStyles.page}>
            <Text style={pdfStyles.title}>{title}</Text>
            {description ? (
              <Text style={pdfStyles.description}>{description}</Text>
            ) : null}
            <Text style={pdfStyles.source}>
              {`${window.location.origin}${wikiHref(slug)}`}
            </Text>
            <View style={pdfStyles.rule} />
            {blocks.map((block, index) =>
              renderBlock(block, index, { Text, View })
            )}
            <Text
              style={pdfStyles.footer}
              fixed
              render={({ pageNumber, totalPages }) =>
                `${pageNumber} of ${totalPages}`
              }
            />
          </Page>
        </Document>
      );

      downloadBlob(await pdf(document_).toBlob(), pdfFileName(slug));
    } catch (error) {
      console.error("Failed to build the article PDF", error);
      toast.error("Could not build the PDF. Try printing the article instead.");
    } finally {
      setIsPreparing(false);
    }
  }, [description, slug, title]);

  return (
    <div className="flex items-center gap-1" data-testid="article-actions">
      <Button
        variant="ghost"
        size="sm"
        className="cursor-pointer"
        onClick={() => window.print()}
        aria-label="Print this article"
      >
        <Printer aria-hidden="true" />
        <span className="hidden sm:inline">Print</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="cursor-pointer"
        onClick={handleDownload}
        disabled={isPreparing}
        aria-busy={isPreparing}
        aria-label="Download this article as PDF"
        data-testid="download-pdf"
      >
        {isPreparing ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Download aria-hidden="true" />
        )}
        <span className="hidden sm:inline">
          {isPreparing ? "Preparing…" : "Download PDF"}
        </span>
      </Button>
    </div>
  );
}
