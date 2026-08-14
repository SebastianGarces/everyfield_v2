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
// A BLOCK-LEVEL callout carries across FRAME AND TYPE, not only its words: the
// download draws the box and sets the type as a label ("Warning", "Insight")
// where the screen draws a lucide icon, because an icon is the one thing a
// document built from text cannot carry. `callout.tsx` names the type in
// `data-print-callout` so neither renderer has to recognise a callout by its
// markup (ruling on PR #391, 2026-08-12 — option (c), "the file must match the
// page"). Before that ruling a Warning arrived in the file as ordinary prose.
// A callout NESTED inside a list item, a blockquote or a table cell is
// divergence 2 below: those three reduce to a single line of text, so nothing
// inside one can stay a block.
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
//   1. Images print and do not download. `globals.css` keeps `img` on the
//      printed page, but `collectBlocks` has no `IMG` case, so an image falls
//      to the recursive default, has no children, and drops silently. Carrying
//      it across means fetching and embedding the bytes, so it stayed out of
//      scope; the PR body lists it as a limitation. This reaches INSIDE a
//      callout: a callout holding nothing but an image contributes no blocks
//      and no runs, so the whole aside drops — frame, type label and all —
//      rather than downloading as an empty box. Owned by
//      `article-pdf/extract.ts`.
//   2. Nesting inside a list item, a blockquote or a table cell FLATTENS. Those
//      three are read out as one line of runs, so anything structural inside
//      one loses its structure: a callout there keeps its words and loses its
//      box, a table there loses its grid. The browser draws all of it on paper.
//      Unflattening means those three becoming block containers like a callout
//      is, which is a change to the block model rather than a missing case.
//      Owned by `article-pdf/extract.ts`.
//
// WHERE THE REST OF THE PIPELINE LIVES
//
//   `article-pdf/extract.ts`  DOM → blocks and runs, and the column model.
//                             Pure: no React, no renderer, no browser.
//   `article-pdf/render.tsx`  blocks → a page. Owns the palette, the styles and
//                             the font names emphasis resolves to.
//   `callout.tsx`             the framed aside, and the marker that tells this
//                             path its type in words.
//   `@/lib/documents/pdf/fonts`
//                             the eight faces, shared with the F6 templates.
//                             Import-free, so naming it here costs the bundle
//                             nothing.
//
// This file is only the control: it finds the prose, joins those two, and hands
// the reader a file.
//
// THE FONT IS FETCHED ON CLICK TOO
//
// The standard-14 fonts `@react-pdf/renderer` ships carry WinAnsi encoding
// only, and they do not REFUSE a character outside it — they write the wrong
// glyph (`→` became `’`, box drawing became NUL). That was the first item on
// the list above until #398 closed it, and renumbered the two that remain. The
// fix is a real Unicode font, so the eight faces under `public/fonts/` are
// fetched from this app's own origin alongside the renderer.
//
// A face that will not load is not fatal: `registerPdfFonts` points the eight
// families back at the standard-14 ones, and the reader gets the file they got
// before #398 rather than an error toast.
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
import {
  PDF_FONT_BASE_PATH,
  registerPdfFonts,
} from "@/lib/documents/pdf/fonts";
import { wikiHref } from "@/lib/wiki/href";

import { extractPrintBlocks } from "./article-pdf/extract";
import { pdfStyles, renderBlock } from "./article-pdf/render";

/** The element holding the article's rendered prose — the PDF's only source. */
export const PRINT_BODY_SELECTOR = "[data-print-body]";

/**
 * One font face's bytes, from THIS app's origin.
 *
 * A relative path, never an absolute URL: the renderer runs in the reader's
 * browser, so a third-party font host would be a request to somebody else on
 * every download. `force-cache` is what stops the second download re-fetching
 * ~590 KB the browser already has.
 */
async function fetchFontFile(file: string): Promise<Uint8Array> {
  const response = await fetch(`${PDF_FONT_BASE_PATH}/${file}`, {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Font ${file} responded ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

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
      const { pdf, Document, Font, Page, Text, View } =
        await import("@react-pdf/renderer");

      // Before `pdf()`: `pdfStyles` already names the Unicode families, so they
      // have to resolve to something by layout time. The result is deliberately
      // ignored — `false` means every face fell back to its standard-14 family,
      // which is a file with corrupt arrows rather than no file at all.
      await registerPdfFonts(Font, fetchFontFile);

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
        // The visible label is "Download PDF", and WCAG 2.5.3 (Label in Name)
        // asks the accessible name to START with the words a speech-input user
        // would say. "Download this article as PDF" breaks the phrase in two.
        aria-label="Download PDF of this article"
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
