// ============================================================================
// Wiki path construction — the single place a slug becomes a URL.
//
// Wiki routing is slug-based (`memory/invariants.md` → Wiki Articles) and the
// slug is stored raw: it is authored content, not a sanitized identifier, so it
// can legitimately contain a space, `#`, `?`, `%` or any other character that
// means something else inside a URL path. Interpolating such a slug straight
// into `/wiki/${slug}` produces a malformed href — `#` truncates the path into
// a fragment, `?` into a query string, a space breaks the link outright.
//
// `/wiki/[...slug]` is a catch-all, so `/` must stay a live separator while
// every other unsafe byte is escaped. That means encoding per SEGMENT, never
// the whole path. Next decodes route params, so the segments the page reassembles
// with `slug.join("/")` are byte-identical to the stored slug — the link resolves.
//
// This module is deliberately dependency-free (no DB, no `next/*`) so client
// components, server components and the node:test harness can all import it.
// ============================================================================

/**
 * Percent-encode a wiki slug for use inside a URL path, preserving `/` as the
 * segment separator.
 *
 * Slugs made only of unreserved characters (`A-Z a-z 0-9 - _ . ~` plus `/`) come
 * back byte-identical, so this is a no-op for every well-formed slug.
 *
 * @example
 * encodeWikiSlug("core-group/building-momentum") // "core-group/building-momentum"
 * encodeWikiSlug("faq/what now?")                // "faq/what%20now%3F"
 */
export function encodeWikiSlug(slug: string): string {
  // Split/map/join rather than a global replace: an empty segment (from a
  // leading or doubled `/`) must survive untouched so round-tripping a slug is
  // lossless rather than silently normalized.
  return slug.split("/").map(encodeURIComponent).join("/");
}

/**
 * Build the in-app path for a wiki article slug.
 *
 * Use this everywhere a slug becomes an `href`, a `router.push` target, an
 * OpenGraph `url` or a `revalidatePath` argument — never `` `/wiki/${slug}` ``.
 *
 * @example
 * wikiHref("core-group/building-momentum") // "/wiki/core-group/building-momentum"
 * wikiHref("notes/draft #2")               // "/wiki/notes/draft%20%232"
 */
export function wikiHref(slug: string): string {
  return `/wiki/${encodeWikiSlug(slug)}`;
}
