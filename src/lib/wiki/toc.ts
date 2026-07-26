/**
 * Table of contents extraction for wiki articles (W-014).
 *
 * Articles are MDX compiled at request time by `next-mdx-remote`, and the
 * compiler gives us no heading manifest. So the headings are read straight off
 * the MDX source with a small ATX-heading scanner, and the anchor ids are
 * derived from the heading text with `slugifyHeading()`.
 *
 * The same `slugifyHeading()` is used by the MDX `h2`/`h3` renderers
 * (`src/components/wiki/mdx-components.tsx`) so a TOC entry's `#id` always
 * matches the id stamped on the rendered heading. Change the slug rules in one
 * place and both sides move together — that is the point of it living here.
 */

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
// block. Trailing `#`s are the optional closing sequence.
const HEADING_RE = /^ {0,3}(#{2,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Extract the H2/H3 headings of an MDX document, in document order.
 *
 * Fenced code blocks are skipped so a `## comment` inside a shell sample never
 * becomes a TOC entry.
 */
export function extractHeadings(source: string): TocHeading[] {
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

    headings.push({
      id: slugifyHeading(text),
      text,
      level: match[1].length as TocLevel,
    });
  }

  return headings;
}

/**
 * Turn heading text into a URL fragment.
 *
 * Deliberately lossy and deliberately simple: lowercase, accents folded,
 * anything that is not a letter/number/space/hyphen dropped, spaces collapsed
 * to single hyphens. Two headings with the same text produce the same id — the
 * anchor then lands on the first of them, which is a better failure than a
 * dead link.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKD")
    // Strip combining marks left behind by NFKD (é -> e).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

  return slug || "section";
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
