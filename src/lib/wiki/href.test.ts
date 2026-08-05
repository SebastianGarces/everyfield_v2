import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeWikiSlug, wikiHref } from "./href";

// ----------------------------------------------------------------------------
// Stand-in for the router's half of the round trip.
//
// `/wiki/[...slug]` is a catch-all: Next splits the request path on `/` and
// percent-DECODES each segment before handing them over, and the page rebuilds
// the lookup key with `slug.join("/")` (see `src/app/(dashboard)/wiki/
// [...slug]/page.tsx`). Recreating that here is what turns "the href is encoded"
// into the claim that actually matters — "the href still resolves to the article".
// ----------------------------------------------------------------------------

/** Given an href produced by `wikiHref`, recover the slug the page will look up. */
function resolveSlugFromHref(href: string): string {
  const prefix = "/wiki/";
  assert.ok(href.startsWith(prefix), `href must be under ${prefix}: ${href}`);
  return href.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
}

// ----------------------------------------------------------------------------
// Normal slugs must be byte-identical to the pre-fix raw interpolation, or this
// change silently invalidates every stored progress row, bookmark and link.
// ----------------------------------------------------------------------------

test("wikiHref leaves an ordinary slug byte-identical to raw interpolation", () => {
  for (const slug of [
    "core-group",
    "core-group/building-momentum",
    "journey/phase-1/vision-meetings",
    "frameworks/the-4-cs",
    "getting-started/launch_process_goals",
    "phases/phase-0.5",
    "teams/team-10",
  ]) {
    assert.equal(wikiHref(slug), `/wiki/${slug}`);
    assert.equal(encodeWikiSlug(slug), slug);
  }
});

test("encodeWikiSlug keeps / as a live segment separator", () => {
  // The catch-all needs the separators intact — whole-path encoding (which would
  // yield %2F) would collapse the route into a single unmatched segment.
  assert.equal(
    encodeWikiSlug("journey/phase-1/vision-meetings"),
    "journey/phase-1/vision-meetings"
  );
  assert.equal(wikiHref("a/b/c").split("/").length, 5); // "", "wiki", "a", "b", "c"
});

// ----------------------------------------------------------------------------
// The characters that actually break a raw `/wiki/${slug}` — one test each, and
// each named for the damage it actually does, not a generic "broken link".
//
// `rawParsed` is the WHATWG URL parser's verdict on the un-encoded
// interpolation: exactly what an `<a href>`, a `router.push` or Next's
// `openGraph.url` resolver (`new URL(path, metadataBase)`) would have produced
// had the call site skipped `wikiHref`. It is the oracle these tests measure
// against, so the docblock's causal story is pinned rather than asserted.
// ----------------------------------------------------------------------------

/** Parse `/wiki/${slug}` the way a browser/`new URL` would. Origin is a stand-in. */
function rawParsed(slug: string): URL {
  return new URL(`/wiki/${slug}`, "https://everyfield.test");
}

test("wikiHref encodes a space, which only the PARSED call sites would have survived without it", () => {
  const slug = "core group/building momentum";
  assert.equal(wikiHref(slug), "/wiki/core%20group/building%20momentum");
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);

  // A space is in the path percent-encode set, so the URL parser escapes it and
  // reaches the same path we do: inside an `<a href>` the raw interpolation
  // would have worked. This is the claim `memory/invariants.md` used to
  // overstate as "a space breaks the link outright".
  assert.equal(rawParsed(slug).pathname, wikiHref(slug));

  // But the LITERAL call sites never run the parser: `revalidatePath` matches
  // its argument as a cache key against the request's already-encoded path, and
  // the sidebar compares `usePathname()` (already encoded) with `===`. There the
  // raw string is a silent mismatch — which is why the rule covers every use.
  assert.notEqual(`/wiki/${slug}`, wikiHref(slug));
  assert.notEqual(`/wiki/${slug}`, rawParsed(slug).pathname);
});

test("wikiHref encodes # so the path is not truncated into a fragment", () => {
  const slug = "notes/draft #2";
  assert.equal(wikiHref(slug), "/wiki/notes/draft%20%232");
  assert.ok(!wikiHref(slug).includes("#"));
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);

  // Raw, the parser ends the path at `#`: a valid URL aimed at a missing
  // article, with the rest of the slug demoted to a fragment.
  assert.equal(rawParsed(slug).pathname, "/wiki/notes/draft%20");
  assert.equal(rawParsed(slug).hash, "#2");
});

test("wikiHref encodes ? so the path is not truncated into a query string", () => {
  const slug = "faq/what now?";
  assert.equal(wikiHref(slug), "/wiki/faq/what%20now%3F");
  assert.ok(!wikiHref(slug).includes("?"));
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);

  // Same truncation, into the query rather than the fragment.
  assert.equal(rawParsed(slug).pathname, "/wiki/faq/what%20now");
});

test("wikiHref encodes % so the router's decode does not throw or silently mangle", () => {
  // The parser passes `%` through verbatim — the damage lands one step later,
  // when Next percent-decodes the route param.
  assert.equal(rawParsed("odd/100%").pathname, "/wiki/odd/100%");
  assert.throws(() => decodeURIComponent("100%"), URIError);
  // Worse than throwing: a slug that reads as an escape decodes to something else.
  assert.equal(decodeURIComponent("50%20off"), "50 off");

  // Encoding first makes both cases round-trip.
  assert.equal(wikiHref("odd/100%"), "/wiki/odd/100%25");
  assert.equal(resolveSlugFromHref(wikiHref("odd/100%")), "odd/100%");
  assert.equal(resolveSlugFromHref(wikiHref("odd/50%20off")), "odd/50%20off");
});

test("wikiHref encodes the other path-hostile characters too", () => {
  for (const slug of [
    "a/b&c",
    "a/b+c",
    "a/b c",
    "a/b#c",
    "a/b?c",
    "a/b%c",
    "a/café",
    "a/b:c",
  ]) {
    assert.equal(
      resolveSlugFromHref(wikiHref(slug)),
      slug,
      `round trip failed for ${slug}`
    );
  }
});

// ----------------------------------------------------------------------------
// Degenerate shapes must round-trip rather than be silently normalized.
// ----------------------------------------------------------------------------

test("wikiHref round-trips empty and irregular segments losslessly", () => {
  for (const slug of ["", "a//b", "/leading", "trailing/"]) {
    assert.equal(
      resolveSlugFromHref(wikiHref(slug)),
      slug,
      `round trip failed for ${JSON.stringify(slug)}`
    );
  }
});
