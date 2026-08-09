import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { type WikiArticle } from "@/db/schema";

import {
  articleBySlugQuery,
  preferChurchOverride,
  visibleArticlesQuery,
} from "./get-articles";

// ----------------------------------------------------------------------------
// The multi-tenant boundary on the wiki read path (#317, from #16) — the half
// that needs no database and therefore runs EVERYWHERE, CI included.
//
// `get-article.ts` used to call `getArticleBySlug(slug, null)` with the null
// hardcoded, so a church-scoped article was unreachable — including to the
// church that owns it. Threading a churchId fixes that and simultaneously
// opens the failure mode worth guarding: handing the read the WRONG church is
// a cross-tenant read, and nothing behind it would catch the mistake
// (isolation is application-layer — `memory/invariants.md` → Multi-Tenancy).
//
// Three things are asserted here, none of which touch Postgres:
//
//  1. PREDICATE SHAPE. Each builder is rendered with `.toSQL()` and inspected,
//     so what is asserted is the SQL that would reach the database. A read
//     that stopped ORing on church_id — or that started admitting a church it
//     was not given — fails here even though it still type-checks and still
//     returns rows. `.toSQL()` renders; it does not connect. A DATABASE_URL
//     must be PRESENT (importing `@/db` constructs the Neon client at module
//     load), which `pnpm test` and CI both supply as a placeholder.
//
//  2. THE OVERRIDE RULE, as a pure function over rows.
//
//  3. CALL-SITE WIRING. AC1 says "the wiki pages" pass the session's church —
//     plural — and a page that quietly drops back to the global-only default
//     is a silent under-fetch, not a crash. Those call sites cannot be
//     imported here (they are RSCs pulling in MDX and next/link), so the
//     wiring is pinned on the source, the technique `service.test.ts` uses for
//     the `revalidatePath` form it likewise cannot observe.
//
// The seeded, executing half lives in `tenancy-live.test.ts` — it is the only
// way to observe the ABSENCE the acceptance criterion is about, and it SKIPS
// wherever DATABASE_URL points nowhere (CI, by design). This file is what
// anchors the PR check; a green CI here is not evidence that the live half
// ran. See that file's header.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";

/** `church_id IS NULL OR church_id = $n` — the FRD's visibility predicate. */
const VISIBILITY =
  /"wiki_articles"\."church_id" is null or "wiki_articles"\."church_id" = \$\d/;

/** Any equality test against church_id at all. */
const CHURCH_EQUALITY = /"wiki_articles"\."church_id" = \$\d/;

// ============================================================================
// 1. Query level
// ============================================================================

test("the corpus read admits global articles plus the caller's church", () => {
  const { sql: text, params } = visibleArticlesQuery(CHURCH_A).toSQL();

  assert.match(text, VISIBILITY);
  assert.ok(
    params.includes(CHURCH_A),
    "the church being read for is not bound to the query"
  );
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the corpus read"
  );
});

test("the corpus read with no church narrows to global — not to everything", () => {
  // The dangerous mistake is a falsy churchId dropping the predicate instead
  // of pinning it to NULL, which would hand every church's private content to
  // a signed-out reader.
  const { sql: text, params } = visibleArticlesQuery(null).toSQL();

  assert.match(text, /"wiki_articles"\."church_id" is null/);
  assert.doesNotMatch(text, CHURCH_EQUALITY);
  assert.ok(!params.includes(CHURCH_A) && !params.includes(CHURCH_B));
});

test("the single-article read carries the same boundary", () => {
  const { sql: text, params } = articleBySlugQuery(
    "discovery/x",
    CHURCH_A
  ).toSQL();

  assert.match(text, VISIBILITY);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the article read"
  );
});

test("the single-article read with no church narrows to global", () => {
  const { sql: text } = articleBySlugQuery("discovery/x", null).toSQL();

  assert.match(text, /"wiki_articles"\."church_id" is null/);
  assert.doesNotMatch(text, CHURCH_EQUALITY);
});

test("both reads still filter to published articles", () => {
  // Tenancy is not the only predicate on these paths, and an override that
  // dropped `status` would publish drafts to the church that wrote them.
  for (const query of [
    visibleArticlesQuery(CHURCH_A),
    articleBySlugQuery("discovery/x", CHURCH_A),
  ]) {
    const { sql: text, params } = query.toSQL();
    assert.match(text, /"wiki_articles"\."status" = \$\d/);
    assert.ok(params.includes("published"));
  }
});

// ============================================================================
// 2. The override rule
// ============================================================================

function row(slug: string, churchId: string | null, title: string) {
  return { slug, churchId, title } as WikiArticle;
}

test("a church's copy of a slug wins over the global article of that name", () => {
  // (slug, church_id) is unique, not slug alone, so both rows can exist and
  // both satisfy the visibility predicate. Returning both would duplicate the
  // article in every list, in the navigation and in React keys.
  const both = preferChurchOverride([
    row("discovery/values", null, "Global"),
    row("discovery/values", CHURCH_A, "Ours"),
  ]);

  assert.equal(both.length, 1);
  assert.equal(both[0].title, "Ours");

  // Order of arrival must not change the answer.
  const reversed = preferChurchOverride([
    row("discovery/values", CHURCH_A, "Ours"),
    row("discovery/values", null, "Global"),
  ]);
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0].title, "Ours");
});

test("articles with no override pass through in sort order", () => {
  const articles = preferChurchOverride([
    row("a", null, "A"),
    row("b", CHURCH_A, "B"),
    row("c", null, "C"),
  ]);

  assert.deepEqual(
    articles.map((article) => article.slug),
    ["a", "b", "c"]
  );
});

// ============================================================================
// 3. Call-site wiring — every wiki read passes a church
// ============================================================================

/**
 * A wiki read invoked with NO argument at all: `getArticles()`.
 *
 * The parameters default to `null`, which fails CLOSED — the caller gets the
 * global corpus rather than someone else's content — so this regression is
 * invisible at runtime and invisible to `tsc`. It is exactly the bug #317
 * fixes, and the only thing that can catch it coming back is the source.
 */
const UNSCOPED_LIST = /\b(?:getArticles|getWikiNavigation)\(\s*\)/;

/** A slug-taking read invoked with one argument: `getArticle(slug)`. */
const UNSCOPED_SLUG_READ = /\b(?:getArticle|getArticlesByPrefix)\(\s*[^,)]*\)/;

/**
 * Every module that turns a wiki read into rendered output. `[...slug]/page.tsx`
 * is WS2/WS3 territory at the file level but is listed here anyway: the point
 * of the assertion is the set being complete, and a workstream that removes the
 * church argument there should fail this test rather than ship a detail route
 * that cannot open its own church's article.
 */
const WIKI_READ_CALL_SITES = [
  "src/app/(dashboard)/wiki/layout.tsx",
  "src/app/(dashboard)/wiki/page.tsx",
  "src/app/(dashboard)/wiki/progress/page.tsx",
  "src/app/(dashboard)/wiki/[...slug]/page.tsx",
  "src/app/api/wiki/article/route.ts",
  "src/lib/wiki/bookmarks.ts",
  "src/lib/wiki/progress.ts",
];

/** Reads a repo file; `pnpm test` always runs from the repo root. */
function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("no wiki read is called without a church", () => {
  for (const file of WIKI_READ_CALL_SITES) {
    const source = readRepoFile(file);

    assert.doesNotMatch(
      source,
      UNSCOPED_LIST,
      `${file} lists wiki articles without passing a church — it will silently show the global corpus only (#317)`
    );
    assert.doesNotMatch(
      source,
      UNSCOPED_SLUG_READ,
      `${file} reads a wiki article by slug without passing a church — a church-scoped article resolves to null there (#317)`
    );
    assert.match(
      source,
      /churchId/,
      `${file} never mentions churchId, so it cannot be passing the session's church (#317)`
    );
  }
});
