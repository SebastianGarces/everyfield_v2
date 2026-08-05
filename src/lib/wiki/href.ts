// ============================================================================
// Wiki path construction — the single place a slug becomes a URL.
//
// Wiki routing is slug-based (`memory/invariants.md` → Wiki Articles) and the
// slug is stored raw: it is authored content, not a sanitized identifier, so it
// can legitimately contain a space, `#`, `?`, `%` or any other character that
// means something else inside a URL path. `/wiki/${slug}` is therefore never
// safe — but the exact damage differs per character, and knowing which is which
// is what keeps the rule below from reading as superstition.
//
// What the WHATWG URL parser does to a raw `/wiki/${slug}` (path state):
//
//   `#`  ENDS the path and starts the fragment. `/wiki/notes/draft #2` parses
//        to pathname `/wiki/notes/draft%20` + hash `#2` — a valid URL pointing
//        at an article that does not exist.
//   `?`  ENDS the path and starts the query, the same way: `/wiki/faq/what now?`
//        parses to pathname `/wiki/faq/what%20now`. Truncated, not broken.
//   `%`  is passed through VERBATIM — the parser does not escape it. The damage
//        lands one step later, when Next percent-DECODES each route param:
//        `100%` throws `URIError` in `decodeURIComponent`, and a slug that
//        happens to read `50%20off` silently decodes to a different string
//        (`50 off`), so the lookup misses.
//   ` `  IS in the path percent-encode set, so the parser escapes it to `%20`
//        for you. A space is the one character a *parsed* URL survives.
//
// That last line is why the docblock this replaced ("a space breaks the link
// outright") was wrong, and it is also why the always-go-through-`wikiHref`
// rule stands unchanged: only some of the call sites are ever parsed as a URL.
//
//   PARSED  — `<a href>` / `<Link href>`, `router.push`, and `openGraph.url`
//             (Next resolves it with `new URL(path, metadataBase)`, and
//             `metadataBase` is set in `src/app/layout.tsx`). Here a raw space
//             would have been fixed for us; `#`, `?` and `%` still would not.
//   LITERAL — the active-item test `pathname === wikiHref(item.slug)` in
//             `src/components/wiki/wiki-sidebar.tsx`. Nothing parses this: it is
//             a string compare against `usePathname()`, which is already
//             encoded, so a raw space is a silent mismatch — no highlighted
//             item, no error anywhere.
//
// So: build every wiki path here, whatever the call site. The encoding is a
// no-op for well-formed slugs (see `encodeWikiSlug`), so there is no cost to
// routing the parsed call sites through it too, and no judgement call at the
// point of use about which kind of site this one is.
//
// ONE path is deliberately NOT built here: the argument to `revalidatePath()`.
// It is literal like the sidebar compare, but it is matched against a different
// encoding — Next derives its implicit cache tag from the DECODED pathname with
// only the path delimiters re-escaped, not from the encoded href. Passing the
// href form silently revalidated nothing for any slug that is not URL-safe
// (#310). That form has its own builder, `wikiRevalidationPath()` in
// `src/lib/wiki/service.ts`, where the derivation is documented against Next's
// source and pinned by `service.test.ts`.
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
 * Use this everywhere a slug becomes an `href`, a `router.push` target or an
 * OpenGraph `url` — never `` `/wiki/${slug}` ``. The one exception is a
 * `revalidatePath` argument, which needs a different encoding: build that with
 * `wikiRevalidationPath()` from `src/lib/wiki/service.ts` (#310).
 *
 * @example
 * wikiHref("core-group/building-momentum") // "/wiki/core-group/building-momentum"
 * wikiHref("notes/draft #2")               // "/wiki/notes/draft%20%232"
 */
export function wikiHref(slug: string): string {
  return `/wiki/${encodeWikiSlug(slug)}`;
}
