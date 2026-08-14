import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { inArray, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, wikiArticles } from "@/db/schema";

import {
  articleBySlugQuery,
  getArticles,
  getArticlesByPrefix,
  getPublishedArticleRefs,
  getWikiNavigation,
} from "./get-articles";
import { searchArticles } from "./search";
import type { ArticleNavItem, NavGroup } from "./types";
import { wikiSlugSchema } from "./write-input";

// ----------------------------------------------------------------------------
// The multi-tenant boundary on the wiki read path (#317, from #16) — the half
// that EXECUTES against a database.
//
// Seeds two churches and four articles and reads them back through the same
// functions the wiki pages call. This is the only way to observe the ABSENCE
// the acceptance criterion is really about: church B's user must not see
// church A's article. `.toSQL()` can prove the predicate has the right shape
// (`tenancy.test.ts`) but not that the rows come back the right way.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// The PR check runs `pnpm test` with a placeholder URL
// (`postgresql://ci:ci@localhost:5432/ci`, `pull-request-checks.yml`) and no
// Postgres behind it, so these assertions do not execute on the pull request.
// A green check therefore means the predicate SHAPE held (`tenancy.test.ts`,
// which needs no database and runs everywhere) — it is NOT evidence that the
// cross-tenant read was observed to be absent. That evidence comes from
// running this file where a real database is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/wiki/*.test.ts"
//
// in a worktree with `.env.local` linked (`scripts/worktree-env.sh`), and
// `skipped 0` in that output is the thing worth quoting. Say so in the PR body
// rather than letting the check imply it.
//
// `getArticle` itself cannot be imported here: `get-article.ts` pulls in
// `next-mdx-remote/rsc`, whose dependency chain does not load under `tsx
// --test`. That is why `articleBySlugQuery` — everything `getArticle` does
// before it maps to `Article`, the church override included since the decision
// collapsed into the statement (#411 round 3) — lives in `get-articles.ts` and
// is exercised directly.
// ----------------------------------------------------------------------------

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

/**
 * What `/wiki` does with the session before it reads.
 *
 * The page is an RSC importing next/link and cannot be loaded under `tsx
 * --test`, so its one line of tenancy logic is reproduced here — that the
 * churchId handed to `getArticles` is the session user's, and that a reader
 * with no church (or no session) narrows to the global corpus rather than
 * widening to everything. That this is the expression the page actually
 * contains is pinned separately, on the source, in `tenancy.test.ts`.
 */
function articlesAsIndexPageReadsThem(session: {
  user: { churchId: string | null } | null;
}) {
  return getArticles(session.user?.churchId ?? null);
}

/** Every article slug reachable in the sidebar, nesting included. */
function navigableSlugs(groups: NavGroup[]): string[] {
  const slugs: string[] = [];

  const walk = (items: ArticleNavItem[]) => {
    for (const item of items) {
      slugs.push(item.slug);
      if (item.children) walk(item.children);
    }
  };

  for (const group of groups) {
    for (const section of group.sections) walk(section.items);
  }

  return slugs;
}

test("a church-scoped article reaches its own church and no other", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the live tenancy assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
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

    // --- the list, as `/wiki` composes it from the session ------------------
    // AC4's "appears in that church's list", read through the composition the
    // index page performs rather than through `getArticles` alone.
    const forA = await articlesAsIndexPageReadsThem({
      user: { churchId: churchA.id },
    });
    const forB = await articlesAsIndexPageReadsThem({
      user: { churchId: churchB.id },
    });
    const forChurchless = await articlesAsIndexPageReadsThem({
      user: { churchId: null },
    });
    const forSignedOut = await articlesAsIndexPageReadsThem({ user: null });

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
      mine(forChurchless),
      [`${prefix}/global`],
      "a user with no church gets the global corpus alone"
    );
    assert.deepEqual(
      mine(forSignedOut),
      [`${prefix}/global`],
      "no session must narrow to global — not widen to everything"
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

    // --- the sidebar, which is the same read shaped into nav groups --------
    const navA = navigableSlugs(await getWikiNavigation(churchA.id));
    const navB = navigableSlugs(await getWikiNavigation(churchB.id));

    assert.ok(
      navA.includes(`${prefix}/a-only`),
      "church A's own article is missing from its sidebar"
    );
    assert.ok(
      !navB.includes(`${prefix}/a-only`),
      "church A's article appeared in church B's sidebar — cross-tenant read"
    );
    assert.ok(
      navB.includes(`${prefix}/b-only`),
      "church B's own article is missing from its sidebar"
    );
    assert.ok(
      navA.includes(`${prefix}/global`) && navB.includes(`${prefix}/global`),
      "a global article must be navigable by everyone"
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
      (await articleBySlugQuery(slug, churchId))[0] ?? null;

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

// ----------------------------------------------------------------------------
// The override rule on the RANKED read (#411 round 2).
//
// The list reads used to collapse (slug, church_id) pairs in JS, which works
// only because they read the whole visible corpus. Search does not: it reads
// the top N by `ts_rank`, so a JS collapse only ever sees rows that survived
// the cut, and the church's copy of a slug is not guaranteed to be among them —
// a rewritten copy may not match the tsquery at all. The failure that leaves is
// precisely the one #411 set out to close: the result row and the article the
// click opens are two different documents. That is why the SQL predicate is the
// one that survived the collapse to a single implementation (round 3).
//
// It cannot be observed with `.toSQL()` — the predicate SHAPE was right the
// whole time — so it is asserted here, against rows. This test FAILED before
// the override moved into the statement (observed 2026-08-13: the search row
// read "Elders and Deacons", the opened article read "Our Leadership Team").
// ----------------------------------------------------------------------------

test("a search result is always the document the click opens (#411)", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the live search-override assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const prefix = `__t411-${randomUUID().slice(0, 8)}`;
  const [church] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }])
    .returning();

  /** What the wiki detail route resolves a slug to, for this reader. */
  const opens = async (slug: string) =>
    (await articleBySlugQuery(slug, church.id))[0] ?? null;

  try {
    const rewritten = `${prefix}/rewritten`;
    const kept = `${prefix}/kept`;

    await db.insert(wikiArticles).values([
      {
        // The church REWROTE this one, so its copy does not contain the word
        // the reader searches for and never matches the tsquery.
        ...seedArticle(rewritten, null, `${prefix} Elders and Deacons`),
        content: `${prefix} elders elders deacons qualifications`,
      },
      {
        ...seedArticle(rewritten, church.id, `${prefix} Our Leadership Team`),
        content: `${prefix} our leadership team shepherds the flock`,
      },
      {
        // This one the church kept close to the original, so BOTH rows match.
        ...seedArticle(kept, null, `${prefix} Elders global`),
        content: `${prefix} elders global text`,
      },
      {
        ...seedArticle(kept, church.id, `${prefix} Elders ours`),
        content: `${prefix} elders our own text`,
      },
    ]);

    const results = await searchArticles(`${prefix} elders`, church.id);
    const rows = results.filter((result) =>
      result.slug.startsWith(`${prefix}/`)
    );

    // 1. The overridden-and-rewritten slug: the global row must NOT be offered.
    //    Showing it is the two-documents bug — its title advertises an article
    //    that no click can reach.
    assert.deepEqual(
      rows.filter((row) => row.slug === rewritten).map((row) => row.title),
      [],
      "search offered the GLOBAL row of a slug this church overrides — the click opens the church's rewrite instead"
    );
    assert.equal(
      (await opens(rewritten))?.title,
      `${prefix} Our Leadership Team`,
      "the church's copy is what that slug opens"
    );

    // 2. The overridden-and-still-matching slug: exactly one row, the church's.
    const keptRows = rows.filter((row) => row.slug === kept);
    assert.equal(keptRows.length, 1, "one slug must produce one result row");
    assert.equal(keptRows[0].title, `${prefix} Elders ours`);
    assert.equal(
      keptRows[0].title,
      (await opens(kept))?.title,
      "the result row and the article the click opens must be one document"
    );

    // 3. The same corpus with no church is the global one, unsuppressed.
    const globalRows = (await searchArticles(`${prefix} elders`, null))
      .filter((result) => result.slug.startsWith(`${prefix}/`))
      .map((result) => result.title)
      .sort();
    assert.deepEqual(
      globalRows,
      [`${prefix} Elders and Deacons`, `${prefix} Elders global`].sort(),
      "a churchless reader searches the global corpus, where nothing is overridden"
    );
  } finally {
    await db.delete(wikiArticles).where(like(wikiArticles.slug, `${prefix}/%`));
    await db.delete(churches).where(inArray(churches.id, [church.id]));
  }
});

// ----------------------------------------------------------------------------
// The PE-024 slug index, against rows (#411 round 6).
//
// The index feeds the insight card's "how to improve" link: it turns a stored
// slug into the TITLE the card renders, while the click goes to the detail
// route. So the two must resolve the same document for the same reader, which is
// the property this file already asserts for search. While the index was
// `church_id IS NULL` in `service.ts` it could not: a church that overrode a
// global slug was shown the global title over a link that opened its own
// article. And the fix is a tenancy change, so the other direction is asserted
// too — no church-private row may reach a reader from another church.
// ----------------------------------------------------------------------------

test("the insight slug index leaks no church's private article, and names the document the click opens (#411)", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the live slug-index assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const prefix = `__t411r-${randomUUID().slice(0, 8)}`;
  const [churchA, churchB] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }, { name: `${prefix} B` }])
    .returning();

  try {
    const overridden = `${prefix}/global`;
    const aOnly = `${prefix}/a-only`;

    await db.insert(wikiArticles).values([
      seedArticle(overridden, null, "Global article"),
      seedArticle(overridden, churchA.id, "Church A's version"),
      seedArticle(aOnly, churchA.id, "Church A only"),
      seedArticle(`${prefix}/b-only`, churchB.id, "Church B only"),
      {
        ...seedArticle(`${prefix}/a-draft`, churchA.id, "Church A draft"),
        status: "draft" as const,
      },
    ]);

    /** The index as the insight card reads it, for one reader. */
    const indexFor = async (churchId: string | null) =>
      (await getPublishedArticleRefs(churchId)).filter((ref) =>
        ref.slug.startsWith(`${prefix}/`)
      );

    const forA = await indexFor(churchA.id);
    const forB = await indexFor(churchB.id);
    const forChurchless = await indexFor(null);

    // --- no church-private row reaches another reader ------------------------
    assert.ok(
      !forB.some((ref) => ref.slug === aOnly),
      "church A's private article reached church B through the slug index — cross-tenant read"
    );
    assert.ok(
      !forB.some((ref) => ref.title === "Church A's version"),
      "church A's private OVERRIDE of a global slug reached church B through the slug index"
    );
    assert.deepEqual(
      forChurchless.map((ref) => ref.slug).sort(),
      [overridden],
      "a churchless reader gets the global corpus alone — not everything"
    );
    assert.equal(
      forChurchless[0]?.title,
      "Global article",
      "a churchless reader is shown the global title, which is the article its link opens"
    );

    // --- and the reader's own content is there, exactly once -----------------
    assert.deepEqual(
      forA.map((ref) => ref.slug).sort(),
      [aOnly, overridden],
      "church A must see its own published article and the global one, once each — a draft of its own is not published content"
    );

    // --- the title and the link are one document ----------------------------
    const opensFor = async (slug: string, churchId: string | null) =>
      (await articleBySlugQuery(slug, churchId))[0] ?? null;

    for (const [reader, index] of [
      [churchA.id, forA],
      [churchB.id, forB],
      [null, forChurchless],
    ] as const) {
      for (const ref of index) {
        assert.equal(
          ref.title,
          (await opensFor(ref.slug, reader))?.title,
          `the slug index named "${ref.title}" for a link that opens a different document`
        );
      }
    }
  } finally {
    await db.delete(wikiArticles).where(like(wikiArticles.slug, `${prefix}/%`));
    await db
      .delete(churches)
      .where(inArray(churches.id, [churchA.id, churchB.id]));
  }
});

test("a DRAFT church copy does not suppress the global article it replaces (#411)", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the live search-override assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  // The suppressing subquery carries `status = 'published'` for the same reason
  // `articleBySlugQuery` does. Without that term a church drafting its own copy
  // would delete the global article from its own search results while the
  // detail route still opened it — the same disagreement, other direction.
  const prefix = `__t411d-${randomUUID().slice(0, 8)}`;
  const [church] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }])
    .returning();

  try {
    const slug = `${prefix}/drafting`;
    await db.insert(wikiArticles).values([
      {
        ...seedArticle(slug, null, `${prefix} Elders global`),
        content: `${prefix} elders global text`,
      },
      {
        ...seedArticle(slug, church.id, `${prefix} Elders draft`),
        content: `${prefix} elders draft text`,
        status: "draft" as const,
      },
    ]);

    const titles = (await searchArticles(`${prefix} elders`, church.id))
      .filter((result) => result.slug === slug)
      .map((result) => result.title);

    assert.deepEqual(
      titles,
      [`${prefix} Elders global`],
      "an unpublished church copy hid the global article from search while the detail route still opened it"
    );
    assert.equal(
      (await articleBySlugQuery(slug, church.id))[0]?.title,
      `${prefix} Elders global`,
      "the detail route opens the global article while the church's copy is a draft"
    );
  } finally {
    await db.delete(wikiArticles).where(like(wikiArticles.slug, `${prefix}/%`));
    await db.delete(churches).where(inArray(churches.id, [church.id]));
  }
});

// ----------------------------------------------------------------------------
// The write path's slug domain, checked against the corpus that exists (#411
// round 7).
//
// `wikiSlugSchema` (`write-input.ts`) is what `updateProgress`, `recordView`
// and `toggleBookmark` refuse a slug by, and it is deliberately NARROWER than
// what `encodeWikiSlug` can address — `href.ts` documents that a stored slug may
// legitimately hold a space, `#`, `?` or `%`, and the read path still handles
// all four. The cost of that narrowing is silent: an article whose slug falls
// outside the schema is readable, and the reader's progress on it simply never
// saves.
//
// So the schema's domain claim is asserted against the real rows rather than
// asserted in prose. This is the only place it CAN be — the shape check needs
// the corpus, and `write-paths.test.ts` never connects.
// ----------------------------------------------------------------------------

test("every stored article slug is one the write path will accept", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the stored corpus was NOT checked against wikiSlugSchema. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const stored = await db
    .select({ slug: wikiArticles.slug })
    .from(wikiArticles);

  assert.ok(
    stored.length > 0,
    "no articles are stored, so this assertion proved nothing about the corpus"
  );

  const refused = stored
    .map((article) => article.slug)
    .filter((slug) => !wikiSlugSchema.safeParse(slug).success)
    // The suite seeds its own `__t…`-prefixed fixtures, which are read-path
    // scaffolding and are never written to by a progress or bookmark save.
    .filter((slug) => !slug.startsWith("__t"));

  assert.deepEqual(
    refused,
    [],
    "an article is stored under a slug the write path refuses: a reader can open it and their scroll position will silently never save (widen wikiSlugSchema in write-input.ts, or fix the slug)"
  );
});
