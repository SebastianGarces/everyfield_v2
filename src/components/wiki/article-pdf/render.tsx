// ============================================================================
// Article PDF — turning extracted blocks into a page (W-018, W-020)
// ============================================================================
//
// The other half of the download path: `extract.ts` decides what is in the
// file, this decides how it looks. `@react-pdf/renderer` is never imported
// here — the caller passes `Text` and `View` in, which keeps the large bundle
// on the click path (`article-actions.tsx`) and lets a plain unit test inspect
// the tree these functions build without a browser or a rendered file.
//
// A TABLE IS A BORDERED GRID ON BOTH PATHS. A flattened one (cells joined with
// a pipe) loses the column a fragment belongs to, so the download draws the
// same hairline the print stylesheet does — `TABLE_BORDER` below is the 0.5pt
// `globals.css` sets on every `th`/`td` (ruling on PR #391).
//
// A CALLOUT IS A BOX ON BOTH PATHS, AND ITS TYPE IS A WORD ON THIS ONE. The
// screen draws the type as a lucide icon; a document built from text cannot
// carry an icon, so the box is redrawn here as a bordered `View` and the type
// is set as the label the icon stood for ("Warning", "Insight"). That label is
// not invented here — `extract.ts` reads it off the callout itself, so the two
// renderers name the same type (ruling on PR #391, 2026-08-12). Only a callout
// that reached `extract.ts` as a BLOCK arrives here: one nested in a list item,
// a blockquote or a table cell was flattened to text before this file sees it
// (divergence 3 in `article-actions.tsx`).
//
// EMPHASIS IS A FONT NAME, NEVER AN AXIS.
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
// KNOWN DIVERGENCE FROM THE PRINTED PAGE, owned here: the standard-14 faces
// cannot encode characters outside WinAnsi (`→`, `↓`, box drawing), so those
// print correctly and corrupt in the downloaded file. It is divergence 1 of the
// two listed in `article-actions.tsx`; the fix is a registered Unicode TTF,
// which means shipping a font asset (#398).
// ============================================================================

import { type ReactElement } from "react";

import type { PrintBlock, PrintRun } from "./extract";
import { columnWidths } from "./extract";

export type Primitives = Pick<
  typeof import("@react-pdf/renderer"),
  "Text" | "View"
>;

// --- the palette ------------------------------------------------------------
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

/**
 * The callout box, in points.
 *
 * Heavier than the table hairline on purpose: a cell boundary is a rule inside
 * one object, while a callout border is the edge of a separate one, and the
 * printed page draws it at the browser's 1px default too.
 */
const CALLOUT_BORDER = 1;

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

export const pdfStyles = {
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
  // A callout is the only nested block, so its box carries the padding and the
  // blocks inside it keep the spacing they have anywhere else. The bottom
  // padding is short because the last child brings its own bottom margin.
  callout: {
    marginTop: 4,
    marginBottom: 12,
    paddingTop: 8,
    paddingBottom: 2,
    paddingHorizontal: 10,
    borderWidth: CALLOUT_BORDER,
    borderColor: grid,
  },
  // The word the icon stood for. Bold and tracked out so it reads as a label on
  // the box rather than as the callout's first sentence.
  calloutLabel: {
    fontFamily: FONT_BOLD,
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 4,
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

// --- runs -------------------------------------------------------------------

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
 * Nesting is what keeps a run in the sentence: it wraps with the words around
 * it, which a sibling element could not do. A run with no emphasis stays a bare
 * string, so an unemphasized paragraph is the single piece of text it always
 * was; only the emphasized spans cost a nested `Text`.
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

// --- blocks -----------------------------------------------------------------

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
    case "callout":
      return (
        // The children are rendered by the same function, so a callout holding
        // a list or a table draws them exactly as it would outside the box —
        // there is no second, poorer renderer for framed content.
        <View key={key} style={pdfStyles.callout}>
          {block.label ? (
            <Text style={pdfStyles.calloutLabel}>{block.label}</Text>
          ) : null}
          {block.blocks.map((child, index) =>
            renderBlock(child, index, { Text, View })
          )}
        </View>
      );
    case "divider":
      return <View key={key} style={pdfStyles.divider} />;
  }
}
