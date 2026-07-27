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
// The characters that actually break a raw `/wiki/${slug}` — one test each, as
// the acceptance criterion requires.
// ----------------------------------------------------------------------------

test("wikiHref encodes a space so the href is not a broken link", () => {
  const slug = "core group/building momentum";
  assert.equal(wikiHref(slug), "/wiki/core%20group/building%20momentum");
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);
});

test("wikiHref encodes # so the path is not truncated into a fragment", () => {
  const slug = "notes/draft #2";
  // Raw interpolation would yield "/wiki/notes/draft #2" — everything from `#`
  // onward is a fragment, so the router only ever sees "/wiki/notes/draft ".
  assert.equal(wikiHref(slug), "/wiki/notes/draft%20%232");
  assert.ok(!wikiHref(slug).includes("#"));
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);
});

test("wikiHref encodes ? so the path is not truncated into a query string", () => {
  const slug = "faq/what now?";
  assert.equal(wikiHref(slug), "/wiki/faq/what%20now%3F");
  assert.ok(!wikiHref(slug).includes("?"));
  assert.equal(resolveSlugFromHref(wikiHref(slug)), slug);
});

test("wikiHref encodes the other path-hostile characters too", () => {
  // `%` first: a literal percent must become %25 or decoding mangles the slug.
  assert.equal(wikiHref("odd/100%"), "/wiki/odd/100%25");
  assert.equal(resolveSlugFromHref(wikiHref("odd/100%")), "odd/100%");

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
