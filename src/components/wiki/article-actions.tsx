"use client";

// ============================================================================
// Article actions — print and download (W-018, W-020)
// ============================================================================
//
// Two controls on one pipeline: what the reader sees on paper and what they get
// in the file are the same article, taken from the same place.
//
//   Print     hands the page to the browser. The print stylesheet in
//             `globals.css` drops the shell, the wiki sidebar, the table of
//             contents and this toolbar, and sets the prose as ink on paper.
//   Download  builds a PDF in the browser from the rendered prose and saves it.
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

type PrintBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "listItem"; depth: number; marker: string; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "tableRow"; cells: string[] }
  | { kind: "divider" };

// --- PDF styling ------------------------------------------------------------
//
// Point sizes, not the app's tokens: this is paper. The palette matches
// `src/lib/documents/pdf/styles.ts` so a downloaded article and a downloaded
// template look like the same product.

const ink = "#111827";
const muted = "#4b5563";
const line = "#d1d5db";

const pdfStyles = {
  page: {
    paddingTop: 54,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.5,
    color: ink,
  },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, marginBottom: 6 },
  description: { fontSize: 11, color: muted, marginBottom: 6 },
  source: { fontSize: 9, color: muted, marginBottom: 16 },
  rule: { borderBottomWidth: 1, borderBottomColor: line, marginBottom: 18 },
  h1: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginTop: 16,
    marginBottom: 6,
  },
  h2: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  h3: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  h4: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 10,
    marginBottom: 4,
  },
  paragraph: { marginBottom: 8 },
  listRow: { flexDirection: "row" as const, marginBottom: 4 },
  listMarker: { width: 16 },
  listText: { flex: 1 },
  code: {
    fontFamily: "Courier",
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
  tableRow: { marginBottom: 4, fontSize: 10 },
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
        pushText(out, { kind: "heading", level, text: inlineText(child) });
        break;
      }
      case "P":
        pushText(out, { kind: "paragraph", text: inlineText(child) });
        break;
      case "UL":
      case "OL":
        collectList(child, out, 0);
        break;
      case "PRE":
        pushText(out, {
          kind: "code",
          text: (child.textContent ?? "").replace(/\s+$/, ""),
        });
        break;
      case "BLOCKQUOTE":
        pushText(out, { kind: "quote", text: inlineText(child) });
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
    pushText(out, {
      kind: "listItem",
      depth,
      marker,
      text: inlineText(item, { skipLists: true }),
    });

    for (const nested of Array.from(item.children)) {
      if (nested.tagName === "UL" || nested.tagName === "OL") {
        collectList(nested, out, depth + 1);
      }
    }
  }
}

function collectTable(table: Element, out: PrintBlock[]): void {
  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(row.children).map((cell) => inlineText(cell));
    if (cells.some((cell) => cell.length > 0)) {
      out.push({ kind: "tableRow", cells });
    }
  }
}

/**
 * Flatten an element to a single line of text.
 *
 * A link contributes its destination as well as its label — on paper an anchor
 * is just underlined words, and the URL is the part the reader cannot recover.
 * Same-page anchors are left bare: `#section` names nothing off the page.
 */
function inlineText(
  element: Element,
  options: { skipLists?: boolean } = {}
): string {
  let text = "";

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;

    const child = node as Element;
    if (child.hasAttribute("data-print-hide")) continue;
    if (options.skipLists && (child.tagName === "UL" || child.tagName === "OL"))
      continue;

    text += inlineText(child, options);

    const href = child.getAttribute("href");
    if (child.tagName === "A" && href && !href.startsWith("#")) {
      text += ` (${href})`;
    }
  }

  return text.replace(/\s+/g, " ").trim();
}

function pushText(out: PrintBlock[], block: PrintBlock): void {
  if ("text" in block && block.text.length === 0) return;
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

function renderBlock(
  block: PrintBlock,
  key: number,
  { Text, View }: Primitives
): ReactElement {
  switch (block.kind) {
    case "heading":
      return (
        <Text key={key} style={pdfStyles[`h${block.level}`]}>
          {block.text}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={pdfStyles.paragraph}>
          {block.text}
        </Text>
      );
    case "listItem":
      return (
        <View
          key={key}
          style={{ ...pdfStyles.listRow, marginLeft: 12 + block.depth * 14 }}
        >
          <Text style={pdfStyles.listMarker}>{block.marker}</Text>
          <Text style={pdfStyles.listText}>{block.text}</Text>
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
          {block.text}
        </Text>
      );
    case "tableRow":
      return (
        <Text key={key} style={pdfStyles.tableRow}>
          {block.cells.join("  |  ")}
        </Text>
      );
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
