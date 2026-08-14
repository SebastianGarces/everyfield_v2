import { revalidatePath } from "next/cache";

// ============================================================================
// Article Queries
// ============================================================================

// FIVE article reads used to live here, and none of them is a read this module
// should ever have held.
//
// `getPublishedArticleRefs` — the PE-024 slug index, and the only one of the
// five with a live caller — was hardcoded to `church_id IS NULL`. Global-only
// looks like the fail-closed default the wiki uses everywhere else, and here it
// was not: the card resolves a stored slug to a TITLE and links to
// `/wiki/<slug>`, which the detail route resolves through `articleBySlugQuery`
// and answers with the church's own row when it has one. So a church that
// overrides a global slug was shown the global title on a link that opened its
// own article — the two-documents mismatch #411 exists to close. It now lives in
// `get-articles.ts` carrying `visibleToChurch` + `notOverriddenByChurch`
// + the published filter, takes the reader's church, and is asserted by the
// `readerFacingReads()` loop in `tenancy.test.ts` (#411 round 6).
//
// Four more went with #411 and simply died — `getArticleBySlug`,
// `getAllPublishedArticles`, `getArticlesBySection`, `getArticlesByPhase`.
// All four were dead repo-wide, and none carried the reader-facing tenancy
// pair (`visibleToChurch` + `notOverriddenByChurch`); `getArticlesBySection`
// had no church predicate at all. Left in place they were a barrel export that
// handed the next caller a cross-tenant read, and they sat outside the
// `readerFacingReads()` list in `tenancy.test.ts` that is supposed to cover
// EVERY reader-facing read — so the test's name was broader than its reach.
// Deleted with #411 rather than predicated, because nothing wanted them.
//
// A reader-facing article read belongs in `get-articles.ts`, where the three
// predicates that must travel together are declared, and it must be added to
// `readerFacingReads()` so the tenancy loop asserts it.

// ============================================================================
// Article and Section Mutations
// ============================================================================

// ELEVEN of them used to live here, and the rule the reads above were deleted
// under is the same rule, applied late: an export nothing calls is not dead
// code, it is a barrel export waiting for its first caller. `index.ts` does
// `export * from "./service"`, so `@/lib/wiki` handed every one of them out.
//
// Gone with #411 (quality round 1): `createArticle`, `updateArticle`,
// `archiveArticle`, `deleteArticle`, `getAllSections`, `getSectionBySlug`,
// `getChildSections`, `getRootSections`, `createSection`, `updateSection`,
// `deleteSection` — all zero-caller repo-wide, none named by any test.
//
// Three of them carried the defects this workstream had just removed one screen
// above:
//
//   - `updateArticle` and `updateSection` did `.set({ ...data, updatedAt })`
//     over a caller-supplied `Partial<New…>` — the mass-assignment shape round 5
//     removed from `progressUpsertQuery` (`write-queries.ts`), here reaching
//     EVERY column, `church_id` and `status` included.
//   - `createArticle` inserted whatever `churchId` the caller passed: no
//     session, no tenancy predicate, in a domain whose invariant says the
//     application layer IS the boundary (`memory/invariants.md` →
//     Multi-Tenancy).
//
// They were not predicated instead of deleted, for the reason the four dead
// reads were not: nothing wants them, and predicating dead code doubles the
// tenancy surface a reviewer has to hold. An admin write surface will bring its
// own, session-scoped, with the church stamped from the actor rather than taken
// as an argument.
//
// `service.test.ts` pins the ABSENCE — this module reaches no database at all
// now — so a write cannot quietly come back here instead of arriving with the
// surface that needs it.

// ============================================================================
// Revalidation Helpers
//
// `revalidatePath()` does NOT take the same string as an `href` (#310, from
// #172). The two used to be built with the same `wikiHref()` on the assumption
// that they were interchangeable; the Next docs never say so, and reading the
// implementation shows they are not. The evidence, in next@16.1.4:
//
//  1. `revalidatePath(path)` uses `path` VERBATIM. It builds the cache tag
//     `` `${NEXT_CACHE_IMPLICIT_TAG_ID}${removeTrailingSlash(path)}` `` and never
//     encodes or decodes it — `node_modules/next/dist/server/web/spec-extension/
//     revalidate.js`, `function revalidatePath`.
//  2. The tag a RENDERED page carries comes from `getImplicitTags(page,
//     pathname, …)` (`next/dist/server/lib/implicit-tags.js`), which likewise
//     concatenates the pathname it is handed.
//  3. That pathname is `resolvedPathname` from request metadata
//     (`next/dist/server/app-render/app-render.js`), and
//     `next/dist/server/route-modules/route-module.js` builds it in three steps,
//     with its own comment "we decode for cache key/manifest usage, encoded is
//     for URL building":
//       - `interpolateDynamicPath` fills `/wiki/[...slug]` with the params,
//         `encodeURIComponent`-ing each one (`next/dist/server/server-utils.js`);
//       - `decodePathParams` splits on `/` and, per segment,
//         `escapePathDelimiters(decodeURIComponent(seg), true)`
//         (`next/dist/server/lib/router-utils/decode-path-params.js`);
//       - `removeTrailingSlash`.
//     `escapePathDelimiters(seg, true)` re-encodes only `/`, `#`, `?` and the
//     literal sequences `%2f`, `%23`, `%3f`, `%5c`
//     (`next/dist/shared/lib/router/utils/escape-path-delimiters.js`).
//
// So the form `revalidatePath` matches is neither the fully-encoded href nor the
// raw slug: it is the slug with ONLY the path delimiters escaped. Observed
// against Next's own `decodePathParams` (this is what `service.test.ts` pins):
//
//   slug "faq/what now?"  href "/wiki/faq/what%20now%3F"  tag "/wiki/faq/what now%3F"
//   slug "guías/año"      href "/wiki/gu%C3%ADas/a%C3%B1o" tag "/wiki/guías/año"
//
// The encoded form was therefore WRONG, and silently so: for every URL-safe slug
// (`A-Z a-z 0-9 - _ . ~` and `/`) both encodings are the identity, so the two
// forms coincide and every article we ship today revalidated correctly. The
// moment a slug contains a space, `#`, `?`, `%` or a non-ASCII character the tag
// missed and the article stayed stale until its own TTL — a no-op with a 200
// response, which is why nothing noticed. Fixed here rather than left latent.
//
// `wikiHref()` is still the ONLY way to build an href/`router.push`/OG url —
// this helper is for `revalidatePath` and nothing else.
// ============================================================================

/**
 * The path form `revalidatePath()` must be given for a wiki article slug.
 *
 * Mirrors Next's `escapePathDelimiters(decodeURIComponent(seg), true)` per
 * segment. Since `encodeURIComponent`/`decodeURIComponent` round-trip exactly,
 * that composition reduces to "escape the delimiters in the raw segment", which
 * is what this does — the regex is Next's, character for character.
 *
 * @example
 * wikiRevalidationPath("core-group/building-momentum") // "/wiki/core-group/building-momentum"
 * wikiRevalidationPath("faq/what now?")                // "/wiki/faq/what now%3F"
 */
export function wikiRevalidationPath(slug: string): string {
  const escaped = slug
    .split("/")
    // `/` cannot appear inside a segment after the split; it is kept in the
    // class so this stays a byte-for-byte copy of Next's own expression.
    .map((segment) =>
      segment.replace(/[/#?]|%(?:2f|23|3f|5c)/gi, (delimiter) =>
        encodeURIComponent(delimiter)
      )
    )
    .join("/");

  return `/wiki/${escaped}`;
}

/**
 * Revalidate a specific article page.
 *
 * The one wrapper that survives, because it is the only place the two halves of
 * the rule above are put together: the builder and the `revalidatePath` call.
 * `service.test.ts` pins its body character for character, which is what stops
 * the href form being handed to `revalidatePath` again — that assertion reads
 * the SOURCE, comments included, so do not spell the forbidden call here.
 *
 * `revalidateWikiIndex()` and `revalidateAllWiki()` sat beside it with no
 * caller anywhere and were deleted with the mutations above (#411): they wrapped
 * a literal string, so re-adding one costs a line at the site that needs it.
 */
export function revalidateArticle(slug: string): void {
  revalidatePath(wikiRevalidationPath(slug));
}
