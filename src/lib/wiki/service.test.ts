import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Deep import into Next on purpose: this is the ACTUAL function that decides
// what implicit path tag a rendered page carries, so asserting against it is
// evidence rather than a restatement of our own belief. If a Next upgrade
// changes the derivation, this file fails loudly instead of the wiki quietly
// going stale again — which is exactly the regression #310 exists to prevent.
import { decodePathParams } from "next/dist/server/lib/router-utils/decode-path-params";

import {
  codeOf,
  functionBodies,
  staticValueSpecifiers,
  valueExportStatements,
} from "@/lib/auth/server-action-surface";

import { wikiHref } from "./href";
import { wikiRevalidationPath } from "./service";

// ============================================================================
// Which form `revalidatePath` expects (#310, from #172).
//
// The claim under test, established by reading next@16.1.4 rather than assumed
// (the full citation chain lives at the Revalidation Helpers section of
// `service.ts`):
//
//   `revalidatePath(p)` tags `_N_T_${removeTrailingSlash(p)}` verbatim, and the
//   tag a rendered page carries is `_N_T_${resolvedPathname}`, where
//   `resolvedPathname` = per segment `escapePathDelimiters(decodeURIComponent(
//   segment), true)`. So the argument must be the DECODED path with only the
//   path delimiters escaped — not the percent-encoded href.
//
// `simulateNextResolvedPathname` below reproduces Next's own pipeline for a
// request to `/wiki/[...slug]`, using Next's `decodePathParams` for the half
// that matters. Every assertion about the correct form is made against it.
// ============================================================================

/**
 * The implicit-tag pathname Next computes for a request to a wiki article.
 *
 * Two steps, both Next's:
 *  1. `interpolateDynamicPath` fills `/wiki/[...slug]` by
 *     `value.map(encodeURIComponent).join("/")` — which is byte-for-byte what
 *     `wikiHref()` produces, i.e. the encoded URL the browser actually requests;
 *  2. `decodePathParams` turns that back into the cache-key form.
 */
function simulateNextResolvedPathname(slug: string): string {
  const requestedPath = `/wiki/${slug.split("/").map(encodeURIComponent).join("/")}`;
  assert.equal(
    requestedPath,
    wikiHref(slug),
    "wikiHref must equal what Next interpolates into the URL"
  );
  return decodePathParams(requestedPath);
}

/**
 * Slugs whose every character is URL-unreserved, so both encodings are the
 * identity and the href form and the revalidation form coincide.
 */
const URL_SAFE_SLUGS = [
  "core-group",
  "core-group/building-momentum",
  "journey/phase-1/vision-meetings",
  "getting-started/launch_process_goals",
  "phases/phase-0.5",
];

/**
 * Slugs that separate the two forms. Each is legal today — a wiki slug is
 * authored content, not a sanitized identifier (`memory/invariants.md` → Wiki
 * Articles) — and each was silently un-revalidatable before this fix.
 */
const DIVERGENT_SLUGS = [
  "faq/what now?", // space + query delimiter
  "notes/draft #2", // space + fragment delimiter
  "guías/año", // non-ASCII: encoded as %C3%AD…, decoded back by Next
  "faq/50% and rising", // a bare percent sign
];

/**
 * Not URL-safe, yet the two forms still coincide: `escapePathDelimiters`
 * re-escapes a literal `%2f` exactly as `encodeURIComponent` did, so the round
 * trip lands back on the encoded byte. Kept in the Next-derived table because
 * it is the one branch of Next's regex that a naive "just decode it"
 * implementation would get wrong.
 */
const COINCIDENTAL_SLUGS = ["faq/a%2fb"];

const SPECIAL_CHARACTER_SLUGS = [...DIVERGENT_SLUGS, ...COINCIDENTAL_SLUGS];

// ----------------------------------------------------------------------------
// AC: the form is established against Next's implicit-tag derivation.
// ----------------------------------------------------------------------------

test("wikiRevalidationPath equals the pathname Next derives the implicit tag from", () => {
  for (const slug of [...URL_SAFE_SLUGS, ...SPECIAL_CHARACTER_SLUGS]) {
    assert.equal(
      wikiRevalidationPath(slug),
      simulateNextResolvedPathname(slug),
      `revalidatePath argument must match Next's resolved pathname for ${JSON.stringify(slug)}`
    );
  }
});

// ----------------------------------------------------------------------------
// AC: the recorded note that the two forms coincide for URL-safe slugs — as an
// assertion, not prose, so "this only matters for exotic slugs" stays true by
// test rather than by memory.
// ----------------------------------------------------------------------------

test("for a URL-safe slug the revalidation form and the href form coincide", () => {
  for (const slug of URL_SAFE_SLUGS) {
    assert.equal(wikiRevalidationPath(slug), wikiHref(slug));
    assert.equal(wikiRevalidationPath(slug), `/wiki/${slug}`);
  }
});

// ----------------------------------------------------------------------------
// AC: the encoded form was wrong — pinned for the special-character slugs, so
// re-introducing `revalidatePath(wikiHref(slug))` fails here.
// ----------------------------------------------------------------------------

test("for a special-character slug the href form is NOT the revalidation form", () => {
  for (const slug of DIVERGENT_SLUGS) {
    assert.notEqual(
      wikiHref(slug),
      wikiRevalidationPath(slug),
      `the two forms must be distinguishable for ${JSON.stringify(slug)}`
    );
  }
});

test("the escaping is exactly the path delimiters, nothing else", () => {
  // Spot values, so a future refactor cannot satisfy the Next-derived test above
  // by accidentally matching a changed derivation on both sides.
  assert.equal(wikiRevalidationPath("faq/what now?"), "/wiki/faq/what now%3F");
  assert.equal(
    wikiRevalidationPath("notes/draft #2"),
    "/wiki/notes/draft %232"
  );
  assert.equal(wikiRevalidationPath("guías/año"), "/wiki/guías/año");
  assert.equal(
    wikiRevalidationPath("faq/50% and rising"),
    "/wiki/faq/50% and rising"
  );
  assert.equal(wikiRevalidationPath("faq/a%2fb"), "/wiki/faq/a%252fb");
});

test("a slug's own `/` stays a segment separator", () => {
  // `/wiki/[...slug]` is a catch-all: the separator must survive, which is why
  // the escaping is per segment rather than over the whole path.
  assert.equal(
    wikiRevalidationPath("a/b/c").split("/").length,
    "/wiki/a/b/c".split("/").length
  );
  assert.equal(wikiRevalidationPath("a/b/c"), "/wiki/a/b/c");
});

// ----------------------------------------------------------------------------
// AC: the result cannot regress silently.
//
// The two call sites that turn a slug into a `revalidatePath` argument are this
// module's own `revalidateArticle` and the tokened route handler. Neither can be
// exercised without a request scope (`revalidatePath` throws outside one), so
// the wiring is pinned on the source — the same technique
// `src/lib/security/constant-time.test.ts` uses for the guard it cannot observe.
// ----------------------------------------------------------------------------

const REVALIDATE_WITH_HREF = /revalidatePath\(\s*wikiHref\(/;

/** Reads a repo file; `pnpm test` always runs from the repo root. */
function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("no wiki revalidation call is built with wikiHref", () => {
  for (const file of [
    "src/lib/wiki/service.ts",
    "src/app/api/wiki/revalidate/route.ts",
  ]) {
    const source = readRepoFile(file);
    assert.equal(
      REVALIDATE_WITH_HREF.test(source),
      false,
      `${file} builds a revalidatePath argument with wikiHref — see #310`
    );
    assert.ok(
      source.includes("wikiRevalidationPath("),
      `${file} must build its article revalidation path with wikiRevalidationPath`
    );
  }
});

test("revalidateArticle passes the revalidation form", () => {
  const source = readRepoFile("src/lib/wiki/service.ts");
  assert.match(
    source,
    /export function revalidateArticle\(slug: string\): void \{\s*revalidatePath\(wikiRevalidationPath\(slug\)\);/
  );
});

// ----------------------------------------------------------------------------
// What this module is ALLOWED to hold (#411, quality round 1).
//
// Round 5 deleted four dead reads from `service.ts` and wrote the rule into the
// file it emptied: a zero-caller export of a DB statement is not dead code, it
// is a barrel export (`index.ts` does `export * from "./service"`) handing the
// next caller an un-predicated read. The rule was then applied to the reads and
// stopped — thirteen exports below the deletion had no caller repo-wide, and
// three carried exactly the defects the workstream had just removed one screen
// above: `updateArticle`/`updateSection` spread a caller-supplied object into a
// `.set()` (mass assignment over every column, `church_id` included) and
// `createArticle` inserted a caller-named `churchId` with no session behind it.
//
// They are gone. What is pinned here is the PROPERTY rather than those names: a
// module holding no database edge cannot regrow an un-predicated read or an
// untenanted write, whatever the next one is called. Its two survivors are the
// `revalidatePath` form and the one wrapper that applies it.
// ----------------------------------------------------------------------------

/** `db.select(` / `db.insert(` / `db.update(` / `db.delete(`. */
const DB_STATEMENT = /\bdb\s*\.\s*(?:select|insert|update|delete)\s*\(/;

test("service.ts reaches no database, so no read or write can regrow here", () => {
  // CODE, not source: the header explains the rule by naming the shapes it
  // forbids, and `codeOf` is the repo's comment stripper.
  const file = path.join(process.cwd(), "src/lib/wiki/service.ts");
  const code = codeOf(file);

  assert.deepEqual(
    staticValueSpecifiers(code).filter((specifier) =>
      specifier.startsWith("@/db")
    ),
    [],
    "service.ts imports the schema or the client again — a reader-facing read belongs in get-articles.ts carrying the tenancy pair, and a write belongs with the session-scoped surface that calls it (#411)"
  );
  assert.doesNotMatch(
    code,
    DB_STATEMENT,
    "service.ts builds a database statement — the barrel re-exports this module, so an export of it is handed to the next caller un-predicated (#411)"
  );
});

test("service.ts exports the revalidation form and its one wrapper, nothing else", () => {
  const code = codeOf(path.join(process.cwd(), "src/lib/wiki/service.ts"));

  assert.deepEqual(
    functionBodies(code)
      .filter((fn) => fn.exported)
      .map((fn) => fn.name)
      .sort(),
    ["revalidateArticle", "wikiRevalidationPath"],
    "an export joined service.ts — every one of them is re-exported by `@/lib/wiki`, so it must be something a caller asked for rather than a companion that reads well (#411)"
  );

  // `functionBodies` reads `function` DECLARATIONS only, so a value binding or a
  // re-export would be invisible to the list above — the same blind spot
  // `write-paths.test.ts` closes for the two `"use server"` modules.
  assert.deepEqual(
    valueExportStatements(code),
    [],
    "service.ts publishes an export the walk above cannot read, so the export list it asserts is not the module's export list (#411)"
  );
});
