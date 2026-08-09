/**
 * Reading the AUTHORED "## Related Articles" section out of an article's MDX.
 *
 * Every article in the corpus ends with a hand-written cross-link section:
 *
 *     ...prose...
 *
 *     ---
 *
 *     ## Related Articles
 *
 *     - [The Final 3-4 Weeks](/wiki/pre-launch/the-final-3-4-weeks)
 *
 *     ---
 *
 *     <Callout type="scripture">...</Callout>
 *
 * `RelatedArticles` (W-009) now renders the same links from
 * `related_article_slugs`, so the prose copy is a duplicate. This module is the
 * parser that lifts those links into the column and removes the prose — used
 * once by `scripts/migrate-wiki-related-sections.ts`, and kept here (rather
 * than in the script) so the boundary rules below are unit-tested.
 *
 * Two boundary rules are load-bearing, and both are the opposite of the obvious
 * reading:
 *
 *   - The section does NOT run to the next heading. It is the LAST heading in
 *     every article, so "delete through the next heading of the same level"
 *     would delete the closing Callout and the final paragraph with it. The
 *     section ends where its link list ends.
 *
 *   - The heading sits BETWEEN two thematic breaks. Removing only the heading
 *     and its list leaves the two `---` rules adjacent, so the leading one goes
 *     with the section.
 *
 * Anything unexpected inside the section aborts rather than guesses: a list
 * item that is not a markdown link is reported so the caller can skip the
 * article, because a partial strip would silently destroy prose.
 */

/** `## Related Articles`, `### Related articles` — the authored variants. */
const RELATED_HEADING = /^\s{0,3}#{2,3}\s+related\s+articles\s*$/i;

/** `---`, `***`, `___` — a markdown thematic break. */
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** The bullet of any list item, ordered or not. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** A list item that is nothing but a markdown link. */
const LIST_LINK = /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]*\]\(([^)]+)\)\s*$/;

export type ParsedRelatedSection = {
  /** Raw hrefs, in authored order. */
  hrefs: string[];
  /** The article's content with the authored section removed. */
  content: string;
  /**
   * A list item inside the section that was not a plain markdown link. When
   * set, `content` is NOT safe to write — the caller should skip the article
   * and report this line.
   */
  unparsedListItem: string | null;
};

/**
 * Lift the authored related-articles section out of `content`.
 *
 * Returns `null` when the article has no such section — which is what makes a
 * second run of the migration a no-op.
 */
export function parseRelatedSection(
  content: string
): ParsedRelatedSection | null {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => RELATED_HEADING.test(line));
  if (headingIndex === -1) {
    return null;
  }

  const hrefs: string[] = [];
  let unparsedListItem: string | null = null;

  // Consume blank lines and link list items. The first line that is neither
  // ends the section — in practice the `---` before the closing Callout.
  let cursor = headingIndex + 1;
  let sectionEnd = headingIndex + 1; // exclusive; the last line worth removing
  while (cursor < lines.length) {
    const line = lines[cursor];

    if (line.trim() === "") {
      cursor++;
      continue;
    }
    if (!LIST_ITEM.test(line)) {
      break;
    }

    const link = line.match(LIST_LINK);
    if (!link) {
      unparsedListItem = line.trim();
      break;
    }

    hrefs.push(link[1].trim());
    cursor++;
    sectionEnd = cursor;
  }

  // The trailing rule stays (it separates the prose from the closing Callout),
  // so the leading one goes — otherwise the two end up adjacent. Same when the
  // section runs to EOF, where the leading rule would dangle.
  let after = sectionEnd;
  while (after < lines.length && lines[after].trim() === "") after++;
  const closesTheArticle =
    after >= lines.length || THEMATIC_BREAK.test(lines[after]);

  let before = headingIndex - 1;
  while (before >= 0 && lines[before].trim() === "") before--;
  const precededByRule = before >= 0 && THEMATIC_BREAK.test(lines[before]);

  const removeFrom = precededByRule && closesTheArticle ? before : headingIndex;

  const kept = [...lines.slice(0, removeFrom), ...lines.slice(sectionEnd)];

  // The splice joins the blank line above the removed block to the blank line
  // below it. Collapse that seam only — a blank run anywhere else is authored.
  while (
    removeFrom > 0 &&
    removeFrom < kept.length &&
    kept[removeFrom - 1].trim() === "" &&
    kept[removeFrom].trim() === ""
  ) {
    kept.splice(removeFrom, 1);
  }

  return {
    hrefs,
    content: kept.join("\n").trimEnd(),
    unparsedListItem,
  };
}

/**
 * Turn an authored href into the slug it names, or `null` when it does not name
 * an article at all (an external URL, an anchor, an empty href).
 *
 * Resolution against the real corpus is the caller's job: this only normalises
 * the shape. `/wiki/a/b`, `/a/b` and `a/b` all name the same article.
 */
export function relatedHrefToSlug(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  // Protocol-relative or absolute URLs point off the wiki entirely.
  if (trimmed.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }

  const path = trimmed.split(/[#?]/)[0];
  const slug = path
    .replace(/^\/?wiki\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return slug || null;
}
