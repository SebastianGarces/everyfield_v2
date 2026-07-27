/**
 * Table of contents extraction for wiki articles (W-014).
 *
 * Articles are MDX compiled at request time by `next-mdx-remote`, and the
 * compiler gives us no heading manifest. So the headings are read straight off
 * the MDX source with a small ATX-heading scanner.
 *
 * The anchor ids on the rendered headings are stamped by `rehype-slug` at
 * compile time (`src/lib/wiki/get-article.ts`), which dedupes repeats with
 * `github-slugger` (`purpose`, `purpose-1`, `purpose-2`). `extractHeadings`
 * therefore runs its own `GithubSlugger` over the same heading sequence so a
 * TOC entry's `#id` always matches — including the counter suffixes, which is
 * why EVERY heading level is slugged here even though only H2/H3 become TOC
 * entries: rehype-slug's counters see H1/H4–H6 too, and skipping them here
 * would let the two sides drift apart on articles that repeat heading text
 * across levels.
 */

import GithubSlugger from "github-slugger";

/** Heading levels that appear in the table of contents. */
export type TocLevel = 2 | 3;

export type TocHeading = {
  /** Anchor id, matching the id rendered on the heading element. */
  id: string;
  /** Heading text with inline markdown stripped. */
  text: string;
  level: TocLevel;
};

/**
 * A one-entry list is a table of contents that tells the reader nothing they
 * cannot already see, so the TOC only appears from two headings up.
 */
export const TOC_MIN_HEADINGS = 2;

// Up to three leading spaces is still an ATX heading; four makes it a code
// block. Trailing `#`s are the optional closing sequence. All six levels are
// matched — see the module docblock for why H1/H4–H6 must still be slugged.
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Extract the H2/H3 headings of an MDX document, in document order, with ids
 * matching what `rehype-slug` stamps on the rendered headings.
 *
 * Fenced code blocks are skipped so a `## comment` inside a shell sample never
 * becomes a TOC entry. A heading whose text slugs to nothing (all punctuation)
 * gets no usable anchor and is omitted rather than rendered as `href="#"`.
 */
export function extractHeadings(source: string): TocHeading[] {
  const slugger = new GithubSlugger();
  const headings: TocHeading[] = [];
  let fence: string | null = null;

  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = FENCE_RE.exec(line);

    if (fence) {
      // Inside a fence: only a matching closing fence of the same character
      // ends it.
      if (fenceMatch && fenceMatch[1][0] === fence[0]) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const match = HEADING_RE.exec(line);
    if (!match) continue;

    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;

    // Slug EVERY heading level so this slugger's dedupe counters stay in step
    // with rehype-slug's, which sees every level.
    const id = slugger.slug(text);

    const level = match[1].length;
    if (level !== 2 && level !== 3) continue;
    if (!id) continue;

    headings.push({ id, text, level });
  }

  return headings;
}

/** A rendered heading's id and the distance from its top to the viewport top. */
export type MeasuredHeading = {
  id: string;
  /** `getBoundingClientRect().top`, in CSS px. */
  top: number;
};

/**
 * Fallback for the "you are reading this" line, in px from the top of the
 * viewport, used when the live geometry cannot be measured.
 *
 * A heading reached by clicking its TOC entry does not land at the top of the
 * viewport: the browser scrolls it to the top of its scroll container plus its
 * own `scroll-margin-top`. In the wiki layout that is the ~64px sticky topbar
 * plus the 80px of `scroll-m-20` the MDX headings carry — 144px. The line has
 * to sit *below* that landing position or the heading just jumped to is never
 * counted as reached.
 */
export const TOC_ACTIVE_LINE_FALLBACK_PX = 160;

/**
 * Which heading the reader is under: the last one to have reached the active
 * line, else the first.
 *
 * The comparison is inclusive (`top <= activeLinePx`) because a heading
 * arrived at by clicking its own TOC entry sits *exactly* on its landing
 * position, and that click must highlight the heading it targeted rather than
 * the one above it.
 *
 * `atScrollEnd` covers the last section of an article: once the container can
 * scroll no further, its heading may never climb to the line, and the honest
 * answer for a reader at the bottom of the page is the final heading.
 */
export function activeHeadingId(
  headings: readonly MeasuredHeading[],
  {
    activeLinePx,
    atScrollEnd = false,
  }: { activeLinePx: number; atScrollEnd?: boolean }
): string | null {
  if (headings.length === 0) return null;
  if (atScrollEnd) return headings[headings.length - 1].id;

  let current = headings[0].id;

  for (const heading of headings) {
    if (heading.top > activeLinePx) break;
    current = heading.id;
  }

  return current;
}

/**
 * Strip the inline markdown a heading may carry, so the TOC label matches the
 * text content the browser renders for that heading.
 */
function stripInlineMarkdown(input: string): string {
  return (
    input
      // Images first: keep the alt text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Links: keep the label.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Inline code.
      .replace(/`+/g, "")
      // Emphasis / strong / strikethrough markers.
      .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, "")
      // Raw HTML/JSX tags.
      .replace(/<[^>]*>/g, "")
      // Backslash escapes.
      .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}
