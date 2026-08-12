"use client";

// ============================================================================
// Article actions — print and download (W-018, W-020)
// ============================================================================
//
// Two controls on one pipeline: what the reader sees on paper and what they get
// in the file are the same article, taken from the same place. Prose, lists,
// callouts, code, link destinations, inline emphasis and tables all carry
// across.
//
//   Print     hands the page to the browser. The print stylesheet in
//             `globals.css` drops the shell, the wiki sidebar, the table of
//             contents and this toolbar, and sets the prose as ink on paper.
//   Download  builds a PDF in the browser from the rendered prose and saves it.
//
// The two renderers are independent, so "the same article" is a claim that has
// to be maintained: `article-actions.test.ts` reads this file, its two
// `article-pdf/` halves and `globals.css`, and fails when only one of them
// draws the grid or keeps a word bold.
//
// TWO KNOWN DIVERGENCES, tracked rather than hidden:
//
//   1. Characters outside WinAnsi (`→`, `↓`, box drawing) print correctly and
//      corrupt in the downloaded file, because the standard-14 fonts this
//      document pins cannot encode them. The fix is a registered Unicode TTF,
//      which means shipping a font asset — deferred by the ruling on PR #391
//      and tracked as #398. Owned by `article-pdf/render.tsx`.
//   2. Images print and do not download. `globals.css` keeps `img` on the
//      printed page, but `collectBlocks` has no `IMG` case, so an image falls
//      to the recursive default, has no children, and drops silently. Carrying
//      it across means fetching and embedding the bytes, so it stayed out of
//      scope; the PR body lists it as a limitation. Owned by
//      `article-pdf/extract.ts`.
//
// WHERE THE REST OF THE PIPELINE LIVES
//
//   `article-pdf/extract.ts`  DOM → blocks and runs, and the column model.
//                             Pure: no React, no renderer, no browser.
//   `article-pdf/render.tsx`  blocks → a page. Owns the palette, the styles and
//                             the font names emphasis resolves to.
//
// This file is only the control: it finds the prose, joins those two, and hands
// the reader a file.
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
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { wikiHref } from "@/lib/wiki/href";

import { extractPrintBlocks } from "./article-pdf/extract";
import { pdfStyles, renderBlock } from "./article-pdf/render";

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
