/**
 * Maximum UTF-16 length of one literal confirmation page. This matches the
 * artifact schema while keeping page boundaries out of surrogate pairs and
 * extended grapheme clusters.
 */
export const EVRY_EXACT_CONTENT_PAGE_CHARACTERS = 4_000;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split literal content into bounded pages that concatenate to the original. */
export function exactEvryContentPages(value: string): readonly string[] {
  if (value.length === 0) return [""];
  const pages: string[] = [];
  let page = "";
  for (const { segment } of graphemes.segment(value)) {
    if (
      page.length > 0 &&
      page.length + segment.length > EVRY_EXACT_CONTENT_PAGE_CHARACTERS
    ) {
      pages.push(page);
      page = "";
    }
    // A single pathological grapheme can exceed the page limit. Split it on
    // code-point boundaries so no page can violate the wire contract.
    if (segment.length > EVRY_EXACT_CONTENT_PAGE_CHARACTERS) {
      for (const codePoint of segment) {
        if (
          page.length > 0 &&
          page.length + codePoint.length > EVRY_EXACT_CONTENT_PAGE_CHARACTERS
        ) {
          pages.push(page);
          page = "";
        }
        page += codePoint;
      }
    } else {
      page += segment;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
