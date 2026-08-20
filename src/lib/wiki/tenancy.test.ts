import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  codeOf,
  valueExportStatements,
} from "@/lib/auth/server-action-surface";

import * as getArticlesModule from "./get-articles";
import {
  articleBySlugQuery,
  publishedArticleRefsQuery,
  visibleArticlesQuery,
} from "./get-articles";
import * as searchModule from "./search";
import { searchArticlesQuery, type SearchResult } from "./search";

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

test("the search read carries the same boundary (#411)", () => {
  // Search is a reader-facing article read and was the one that did not obey
  // the predicate: it was hardcoded to `church_id IS NULL`, so a church's own
  // article could be opened from the sidebar but never found by searching for
  // it — and where a church overrides a global slug, the result row and the
  // article the click opens were two different documents.
  const { sql: text, params } = searchArticlesQuery("elders", CHURCH_A).toSQL();

  assert.match(text, VISIBILITY);
  assert.ok(
    params.includes(CHURCH_A),
    "the church being searched for is not bound to the query"
  );
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the search read"
  );
});

test("the search read with no church narrows to global", () => {
  const { sql: text } = searchArticlesQuery("elders", null).toSQL();

  assert.match(text, /"wiki_articles"\."church_id" is null/);
  assert.doesNotMatch(text, CHURCH_EQUALITY);
});

test("the insight slug index carries the same boundary (#411 round 6)", () => {
  // PE-024's "how to improve" link resolves a stored slug to a TITLE while the
  // click goes to the detail route, which answers with the church's own row. So
  // a global-only slug index is not the quiet under-fetch the fail-closed
  // default usually is: it names one document and links to another. It was the
  // last reader-facing read outside `get-articles.ts` (it lived in
  // `service.ts`), and the one this loop's name was untrue about.
  const { sql: text, params } = publishedArticleRefsQuery(CHURCH_A).toSQL();

  assert.match(text, VISIBILITY);
  assert.ok(
    params.includes(CHURCH_A),
    "the church the index is read for is not bound to the query"
  );
  assert.ok(
    !params.includes(CHURCH_B),
    "another church's id reached the slug index"
  );
});

test("the insight slug index with no church narrows to global", () => {
  const { sql: text } = publishedArticleRefsQuery(null).toSQL();

  assert.match(text, /"wiki_articles"\."church_id" is null/);
  assert.doesNotMatch(text, CHURCH_EQUALITY);
});

test("the insight slug index projects no article body", () => {
  // The projection is the reason this read exists at all: a caller that only
  // needs to know whether a slug still resolves must not pull ~90 article
  // bodies to find out.
  const { sql: text } = publishedArticleRefsQuery(CHURCH_A).toSQL();
  const projection = text.slice(0, text.search(/\bfrom\b/i));

  assert.match(projection, /"slug"/);
  assert.match(projection, /"title"/);
  assert.doesNotMatch(
    projection,
    /"content"/,
    "the slug index pulls article bodies it never reads"
  );
});

/**
 * Every reader-facing read, keyed on the BUILDER'S OWN NAME so the list's
 * completeness is checkable rather than asserted in prose.
 *
 * "Every" is the load-bearing word and it had twice been untrue: the four dead
 * reads in `service.ts` sat outside it (deleted, #411 round 5) and so did the
 * PE-024 slug index, which was live behind the insight cards (moved in and
 * predicated, round 6). Both times the list was corrected and nothing stopped a
 * third — the docblock stated the problem and left three loops claiming to cover
 * a set nobody counted.
 *
 * It is counted now, against the module namespaces the reads live in. The
 * mechanism is the one `write-paths.test.ts` uses for the writes one file over
 * (`satisfies Record<keyof typeof writeQueries, …>` plus a runtime
 * `deepEqual` of the key sets); the reads cannot use `keyof typeof` across two
 * modules, so the whole check is the runtime one below.
 */
const READER_FACING = {
  visibleArticlesQuery: (churchId: string | null) =>
    visibleArticlesQuery(churchId),
  articleBySlugQuery: (churchId: string | null) =>
    articleBySlugQuery("discovery/x", churchId),
  searchArticlesQuery: (churchId: string | null) =>
    searchArticlesQuery("elders", churchId),
  publishedArticleRefsQuery: (churchId: string | null) =>
    publishedArticleRefsQuery(churchId),
};

/**
 * The `*Query` exports of the two modules a reader-facing read may live in.
 *
 * The suffix is the seam: a statement BUILDER ends in `Query` throughout this
 * domain, and `getArticles`/`getWikiNavigation`/`visibleToChurch` — the readers
 * and the predicates built on them — do not. Read off the live namespaces, so a
 * builder that is added, renamed or dropped moves this set without anybody
 * remembering to.
 */
const READER_FACING_QUERY_EXPORTS = [
  ...Object.keys(getArticlesModule),
  ...Object.keys(searchModule),
]
  .filter((name) => name.endsWith("Query"))
  .sort();

function readerFacingReads(churchId: string | null) {
  return Object.entries(READER_FACING).map(
    ([name, build]) => [name, build(churchId)] as const
  );
}

test("every reader-facing read is in the list the tenancy loops drive off (#411)", () => {
  assert.deepEqual(
    Object.keys(READER_FACING).sort(),
    READER_FACING_QUERY_EXPORTS,
    "a reader-facing wiki read exists that the tenancy loops never assert anything about — add it to READER_FACING and it joins all three at once"
  );
});

/**
 * Where a `*Query` builder may be DECLARED — the check above reads two module
 * namespaces, so a fifth read added to a THIRD wiki module would be outside it
 * as well as outside the list.
 *
 * `write-queries.ts` is here because the wiki's WRITE builders share the suffix
 * (`progressUpsertQuery`); they are covered by `write-paths.test.ts`, which owns
 * that module the way this file owns these two.
 */
const QUERY_BUILDER_MODULES = [
  "get-articles.ts",
  "search.ts",
  "write-queries.ts",
];

/** `export function visibleDraftsQuery(…)` / `export async function …Query(…)`. */
const QUERY_FUNCTION_DECLARATION =
  /export\s+(?:async\s+)?function\s+\w+Query\b/;

/** `export const visibleDraftsQuery = (churchId) => db.select()…`. */
const QUERY_VALUE_BINDING = /^export\s+(?:const|let|var)\s+\w+Query\b/;

/**
 * Does this module publish a `*Query` builder, IN EITHER SPELLING?
 *
 * The function-declaration regex above is the same blind spot `functionBodies`
 * has one file over, and this guard had it for the same reason: `export const
 * visibleDraftsQuery = (churchId) => …` is a statement builder by every rule
 * this domain has and matches no `function` pattern, so a third wiki module
 * publishing one would have sat outside the tenancy loops AND outside the guard
 * written to catch exactly that — with the suite green. `valueExportStatements`
 * is the repo's shared reader for the forms a declaration scan cannot read, and
 * it is the one `write-paths.test.ts` and `service.test.ts` close the same hole
 * with (`memory/invariants.md` → Wiki Articles: a guard's own completeness is
 * derived, never asserted in prose).
 */
function declaresQueryBuilder(code: string): boolean {
  return (
    QUERY_FUNCTION_DECLARATION.test(code) ||
    valueExportStatements(code).some((statement) =>
      QUERY_VALUE_BINDING.test(statement)
    )
  );
}

test("a wiki statement builder is declared only where a suite owns it (#411)", () => {
  const declaring = wikiSourceFiles()
    .filter((file) => declaresQueryBuilder(codeOf(file)))
    .map((file) => path.basename(file))
    .sort();

  assert.deepEqual(
    declaring,
    [...QUERY_BUILDER_MODULES].sort(),
    "a wiki module declares a statement builder — as a function or as a value binding — that neither tenancy.test.ts nor write-paths.test.ts renders: a reader-facing read belongs in get-articles.ts, where the predicates that must travel together are declared"
  );
});

test("EVERY reader-facing read suppresses a global row this church overrides, IN THE STATEMENT (#411)", () => {
  // The override decision used to have two implementations: a JS collapse of
  // (slug, church_id) pairs for the reads that fetch the whole corpus, and this
  // predicate for search. A JS collapse is unusable on a RANKED read — it only
  // sees the rows that survived the `ts_rank` cut, and the church's copy need
  // not be among them (a rewritten copy may not match the tsquery at all), so
  // the global row comes back alone with nothing to collapse it against and the
  // result row and the article the click opens are two different documents.
  // Observed against a real database; the absence is asserted in
  // `tenancy-live.test.ts`.
  //
  // So the SQL form is the survivor and it is now on EVERY reader-facing read,
  // which is what makes the lists, the detail route and search unable to
  // disagree about which row a reader gets.
  for (const [name, query] of readerFacingReads(CHURCH_A)) {
    const { sql: text, params } = query.toSQL();

    assert.match(
      text,
      /not exists/i,
      `${name} does not suppress the overridden global row in SQL — the church's copy and the global one both come back`
    );
    assert.match(
      text,
      /"override"\."church_id" = \$\d/,
      `${name}'s suppressing subquery is not bound to a church`
    );
    assert.match(
      text,
      /"override"\."status" = \$\d/,
      `${name}'s suppressing subquery must carry the same status term the read does — a DRAFT church copy would otherwise hide a global article the reader can still open`
    );
    assert.ok(
      params.includes(CHURCH_A),
      `the reader's church is not bound to ${name}'s suppressing subquery`
    );
    assert.ok(
      !params.includes(CHURCH_B),
      `another church's id reached ${name}'s suppressing subquery`
    );
  }
});

test("a churchless read has nothing to suppress (#411)", () => {
  // With no church there is no override, and a stray `NOT EXISTS` would only be
  // a way to lose global rows.
  for (const [name, query] of readerFacingReads(null)) {
    const { sql: text } = query.toSQL();

    assert.doesNotMatch(text, /not exists/i, name);
    assert.doesNotMatch(text, /"override"/, name);
  }
});

test("every read still filters to published articles", () => {
  // Tenancy is not the only predicate on these paths, and an override that
  // dropped `status` would publish drafts to the church that wrote them. Driven
  // off the same list as the override loop, so a read joining one joins both.
  for (const [name, query] of readerFacingReads(CHURCH_A)) {
    const { sql: text, params } = query.toSQL();
    assert.match(text, /"wiki_articles"\."status" = \$\d/, name);
    assert.ok(params.includes("published"), name);
  }
});

// ============================================================================
// 2. The override rule — ONE implementation (#411 round 3)
//
// The decision "a church's published row of a slug replaces the global row of
// that name" had two implementations: the SQL predicate above and a JS collapse
// (`preferChurchOverride`) the lists and the detail route ran afterwards. A SQL
// builder and a JS predicate cannot share an implementation — they can only
// share a DECISION — and here they could not even do that, because the JS form
// cannot answer for a ranked read at all. So the JS form is GONE rather than
// kept in parallel, and what is asserted here is the absence: a second site
// that decides the same thing is how the detail route and search drift apart
// again.
// ============================================================================

/** Wiki modules, derived from the directory rather than listed by hand. */
function wikiSourceFiles(): string[] {
  const dir = path.join(process.cwd(), "src", "lib", "wiki");

  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(dir, name));
}

test("exactly one module decides the church override (#411)", () => {
  // Derived from the directory, not from a list of the modules that happen to
  // have carried the rule: a hand-list is blind to the module a later change
  // adds, which is the failure the collapse exists to end.
  const declaring = wikiSourceFiles().filter((file) =>
    /function notOverriddenByChurch\b/.test(codeOf(file))
  );

  assert.deepEqual(
    declaring.map((file) => path.basename(file)),
    ["get-articles.ts"],
    "the church-override decision must be declared exactly once, beside the visibility predicate it qualifies — every other read imports it"
  );
});

test("no wiki read collapses the override in JS (#411)", () => {
  // The JS collapse ran AFTER the read, so on a ranked read it only ever saw
  // the rows that survived the cut. Its shape is recognisable: a per-slug map
  // that prefers a non-null `churchId`. Any return of it is a second decision
  // site, whatever it is called.
  for (const file of wikiSourceFiles()) {
    const code = codeOf(file);

    assert.doesNotMatch(
      code,
      /preferChurchOverride/,
      `${path.basename(file)} still collapses the override in JS — the decision belongs to the statement (#411)`
    );
    assert.doesNotMatch(
      code,
      /churchId === null && \w+\.churchId !== null/,
      `${path.basename(file)} re-implements the override rule as a JS comparison (#411)`
    );
  }
});

test("a search result carries no owner column (#411)", () => {
  // An owner column in a SEARCH RESULT exists only to feed a JS collapse, so
  // its presence would mean the second decision site came back.
  const { sql: text } = searchArticlesQuery("elders", CHURCH_A).toSQL();
  const projection = text.slice(0, text.search(/\bfrom\b/i));

  assert.doesNotMatch(
    projection,
    /"church_id"/,
    "the search projection carries an owner column, which only a JS collapse needs"
  );

  const shape: SearchResult = {
    id: "",
    slug: "",
    title: "",
    excerpt: null,
    phase: null,
    contentType: "reference",
    sectionId: null,
    readTimeMinutes: null,
    rank: 0,
  };
  assert.ok(
    !("churchId" in shape),
    "which church owns a result is not part of the result"
  );
});

test("the single-article read returns the winner, not a pair to collapse (#411)", () => {
  // While the override was decided in JS this read took `LIMIT 2` and handed
  // both rows to the collapse. With the predicate in the statement at most one
  // row can match, and the limit says so — a `LIMIT 2` here would mean a caller
  // is expected to choose, which is the second decision site by another name.
  const { sql: text, params } = articleBySlugQuery(
    "discovery/x",
    CHURCH_A
  ).toSQL();

  assert.match(text, /limit \$\d/i);
  assert.ok(
    !params.includes(2),
    "the single-article read still takes a second row for a JS collapse to pick from"
  );
  assert.ok(
    params.includes(1),
    "the single-article read must take exactly the row the statement decided on"
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
const UNSCOPED_LIST =
  /\b(?:getArticles|getWikiNavigation|getPublishedArticleRefs)\(\s*\)/;

/** A slug-taking read invoked with one argument: `getArticle(slug)`. */
const UNSCOPED_SLUG_READ = /\b(?:getArticle|getArticlesByPrefix)\(\s*[^,)]*\)/;

/**
 * Every module that turns a wiki read into rendered output. `[...slug]/page.tsx`
 * is WS2/WS3 territory at the file level but is listed here anyway: the point
 * of the assertion is the set being complete, and a workstream that removes the
 * church argument there should fail this test rather than ship a detail route
 * that cannot open its own church's article.
 *
 * `insight-card.tsx` is not a wiki surface at all, and that is exactly why it is
 * on the list (#411 round 6): it renders a wiki TITLE and a wiki LINK from the
 * PE-024 slug index, and it read that index unscoped for as long as the index
 * was global-only — so the card named the global article and the click opened
 * the church's. The read is scoped now; dropping the argument again type-checks
 * and brings the mismatch straight back.
 */
const WIKI_READ_CALL_SITES = [
  "src/app/(dashboard)/wiki/layout.tsx",
  "src/app/(dashboard)/wiki/page.tsx",
  "src/app/(dashboard)/wiki/progress/page.tsx",
  "src/app/(dashboard)/wiki/[...slug]/page.tsx",
  "src/app/(dashboard)/wiki/actions.ts",
  "src/app/api/wiki/article/route.ts",
  // The per-reader reads. They lived in `bookmarks.ts` / `progress.ts` until
  // #498's review moved them out: those two are `"use server"` modules, and a
  // guard that throws on a session-less caller has no business on `/wiki`'s
  // render path (`wiki-read-graph.test.ts`). The two writers left behind
  // resolve no articles, so there is no church for them to drop.
  "src/lib/wiki/reads.ts",
  "src/components/phase-engine/insight-card.tsx",
];

/**
 * The search action invoked with the query alone: `searchArticles(q)`.
 *
 * Same failure shape as the reads above and the same reason the source is what
 * catches it — the parameter defaults to `null`, so dropping it type-checks and
 * silently searches the global corpus only (#411).
 */
const UNSCOPED_SEARCH = /\bsearchArticles\(\s*[^,)]*\)/;

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

test("the search action passes the session's church, never the query alone", () => {
  // CODE, not source: the module explains the rule by naming the shape it
  // forbids, and `codeOf` is the repo's comment stripper — the same one
  // `server-action-surface.test.ts` walks every action module with.
  const code = codeOf(
    path.join(process.cwd(), "src/app/(dashboard)/wiki/actions.ts")
  );

  assert.doesNotMatch(
    code,
    UNSCOPED_SEARCH,
    "the search action searches without a church — a church's own articles become unfindable (#411)"
  );
  assert.match(
    code,
    /const \{ user \} = await requireSeat\("[\w.]+"\);/,
    "the church a search is scoped to must be read off the session, not taken as an argument"
  );

  // SESSION FIRST, and above the `try` (`memory/invariants.md` →
  // Authentication). `src/proxy.ts` redirects unauthenticated callers on GET
  // only, so this export is POST-reachable with no session cookie; minting
  // inside the `try` would hand an anonymous caller the global corpus, and
  // minting below the guards would answer a malformed argument differently
  // from a well-formed one (#411).
  const body = code.slice(code.indexOf("export async function"));
  const mint = body.indexOf("await requireSeat(");
  assert.ok(mint !== -1, "the search action never mints an actor");
  assert.ok(
    mint < body.indexOf("try {"),
    "the mint sits inside the try, so a sessionless POST is answered with results instead of a throw"
  );
  assert.ok(
    mint < body.indexOf("if ("),
    "a guard runs before the mint, so an anonymous caller can tell argument shapes apart"
  );
  assert.doesNotMatch(
    code,
    /getCurrentSession\(\)/,
    "getCurrentSession() tolerates no session — the search endpoint requires one"
  );
});
