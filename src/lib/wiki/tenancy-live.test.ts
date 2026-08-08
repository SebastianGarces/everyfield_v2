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
  getWikiNavigation,
  preferChurchOverride,
} from "./get-articles";
import type { ArticleNavItem, NavGroup } from "./types";

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
// --test`. That is why `articleBySlugQuery` and `preferChurchOverride` — the
// two halves of what `getArticle` does before it maps to `Article` — live in
// `get-articles.ts` and are exercised directly.
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
