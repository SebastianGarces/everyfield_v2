import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { inArray, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, wikiArticles, type WikiArticle } from "@/db/schema";

import {
  articleBySlugQuery,
  getArticles,
  getArticlesByPrefix,
  preferChurchOverride,
  visibleArticlesQuery,
} from "./get-articles";

// ----------------------------------------------------------------------------
// The multi-tenant boundary on the wiki read path (#317, from #16).
//
// `get-article.ts` used to call `getArticleBySlug(slug, null)` with the null
// hardcoded, so a church-scoped article was unreachable — including to the
// church that owns it. Threading a churchId fixes that and simultaneously
// opens the failure mode worth guarding: handing the read the WRONG church is
// a cross-tenant read, and nothing behind it would catch the mistake
// (isolation is application-layer — `memory/invariants.md` → Multi-Tenancy).
//
// Two layers of assertion, because they fail differently:
//
//  1. QUERY LEVEL (always runs). Each builder is rendered with `.toSQL()` and
//     inspected, so what is asserted is the SQL that would reach Postgres.
//     A read that stopped ORing on church_id — or that started admitting a
//     church it was not given — fails here even though it still type-checks
//     and still returns rows. No query is executed; `.toSQL()` renders, it
//     does not connect. A DATABASE_URL must be PRESENT (importing `@/db`
//     constructs the Neon client at module load), which `pnpm test` and CI
//     both supply as a placeholder.
//
//  2. LIVE (skips when that placeholder points nowhere). Seeds two churches
//     and four articles and reads them back through the same functions the
//     wiki pages call, which is the only way to observe the ABSENCE the
//     acceptance criterion is really about: church B's user must not see
//     church A's article. CI's DATABASE_URL is unreachable by design, so the
//     live half skips there and runs wherever a real database is configured
//     (a worktree with `.env.local` — `scripts/worktree-env.sh`).
//
// `getArticle` itself cannot be imported here: `get-article.ts` pulls in
// `next-mdx-remote/rsc`, whose dependency chain does not load under `tsx
// --test`. That is why `articleBySlugQuery` and `preferChurchOverride` — the
// two halves of what `getArticle` does before it maps to `Article` — live in
// `get-articles.ts` and are exercised directly.
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
// 3. Live — the seeded article, and the absence of the other church's
// ============================================================================

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Enough columns to satisfy the table's NOT NULLs; the rest is scaffolding. */
function seedArticle(slug: string, churchId: string | null, title: string) {
  return {
    slug,
    churchId,
    title,
    content: `# ${title}`,
    contentType: "reference" as const,
    status: "published" as const,
  };
}

test("a church-scoped article reaches its own church and no other", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "no reachable DATABASE_URL — run in a worktree with .env.local linked (scripts/worktree-env.sh)"
    );
  }

  // Namespaced per run so concurrent runs cannot see each other's fixtures,
  // and so cleanup can be a prefix match that never touches real content.
  const prefix = `__t317-${randomUUID().slice(0, 8)}`;
  const [churchA, churchB] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }, { name: `${prefix} B` }])
    .returning();

  try {
    await db
      .insert(wikiArticles)
      .values([
        seedArticle(`${prefix}/global`, null, "Global article"),
        seedArticle(`${prefix}/global`, churchA.id, "Church A's version"),
        seedArticle(`${prefix}/a-only`, churchA.id, "Church A only"),
        seedArticle(`${prefix}/b-only`, churchB.id, "Church B only"),
      ]);

    const mine = (articles: { slug: string }[]) =>
      articles
        .filter((article) => article.slug.startsWith(`${prefix}/`))
        .map((article) => article.slug)
        .sort();

    // --- the list, as `/wiki/<section>` renders it -------------------------
    const forA = await getArticles(churchA.id);
    const forB = await getArticles(churchB.id);
    const forNobody = await getArticles(null);

    assert.deepEqual(
      mine(forA),
      [`${prefix}/a-only`, `${prefix}/global`],
      "church A sees its own article and the global one, exactly once each"
    );
    assert.deepEqual(
      mine(forB),
      [`${prefix}/b-only`, `${prefix}/global`],
      "church B must not see church A's article"
    );
    assert.deepEqual(
      mine(forNobody),
      [`${prefix}/global`],
      "with no church the list is the global corpus alone"
    );

    // The override is resolved per reader, not globally.
    assert.equal(
      forA.find((article) => article.slug === `${prefix}/global`)?.title,
      "Church A's version"
    );
    assert.equal(
      forB.find((article) => article.slug === `${prefix}/global`)?.title,
      "Global article"
    );

    // --- the section index, which is the same read through a prefix --------
    assert.deepEqual(mine(await getArticlesByPrefix(prefix, churchA.id)), [
      `${prefix}/a-only`,
      `${prefix}/global`,
    ]);
    assert.deepEqual(mine(await getArticlesByPrefix(prefix, churchB.id)), [
      `${prefix}/b-only`,
      `${prefix}/global`,
    ]);

    // --- the detail route -------------------------------------------------
    const detail = async (slug: string, churchId: string | null) =>
      preferChurchOverride(await articleBySlugQuery(slug, churchId))[0] ?? null;

    assert.equal(
      (await detail(`${prefix}/a-only`, churchA.id))?.title,
      "Church A only",
      "church A cannot reach its own article by slug"
    );
    assert.equal(
      await detail(`${prefix}/a-only`, churchB.id),
      null,
      "church B reached church A's article — cross-tenant read"
    );
    assert.equal(
      await detail(`${prefix}/a-only`, null),
      null,
      "a churchless reader reached a church-scoped article"
    );
    assert.equal(
      (await detail(`${prefix}/global`, churchB.id))?.title,
      "Global article",
      "a global article must stay reachable by everyone"
    );
    assert.equal(
      (await detail(`${prefix}/global`, churchA.id))?.title,
      "Church A's version",
      "the church's own copy of a global slug must win for that church"
    );
  } finally {
    await db.delete(wikiArticles).where(like(wikiArticles.slug, `${prefix}/%`));
    await db
      .delete(churches)
      .where(inArray(churches.id, [churchA.id, churchB.id]));
  }
});
