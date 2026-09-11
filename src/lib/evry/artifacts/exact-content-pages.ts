/**
 * Maximum UTF-16 length of one literal confirmation page. This matches the
 * artifact schema while keeping page boundaries out of surrogate pairs and
 * extended grapheme clusters.
 */
export const EVRY_EXACT_CONTENT_PAGE_CHARACTERS = 4_000;

/**
 * Largest legal single grapheme in exact disclosures. Import target snapshots
 * admit 40,000 UTF-16 code units, so the artifact must admit one unsplittable
 * cluster of the same size even though ordinary pages target 4,000.
 */
export const EVRY_EXACT_CONTENT_MAX_PAGE_CHARACTERS = 40_000;

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
    if (segment.length > EVRY_EXACT_CONTENT_MAX_PAGE_CHARACTERS)
      throw new Error("Exact disclosure contains an oversized grapheme");
    page += segment;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
