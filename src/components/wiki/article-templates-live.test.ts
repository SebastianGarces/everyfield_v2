import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { and, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { wikiArticles } from "@/db/schema";

import { ARTICLE_TEMPLATE_IDS } from "./article-templates";

// ----------------------------------------------------------------------------
// Wiki → template links (W-010, #317) — the half that EXECUTES against a
// database.
//
// `ARTICLE_TEMPLATE_IDS` is keyed by article slug with nothing enforcing that
// the slug exists. A key naming an article the corpus does not have is the
// worst failure this feature has: it type-checks, it lints, every unit test
// above still passes, and the section simply never appears for anyone. That is
// exactly how the catalog's own `relatedWikiSlug` values rotted — all of them
// name slugs no published article has (see the header of `article-templates.ts`)
// — so the map that replaced them is pinned against the real corpus here.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// The PR check runs `pnpm test` against a placeholder URL with no Postgres
// behind it. Run it where a real database is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/components/wiki/*.test.ts"
//
// in a worktree with `.env.local` linked (`scripts/worktree-env.sh`), and
// `skipped 0` in that output is the thing worth quoting.
// ----------------------------------------------------------------------------

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

test("every article offering templates is a published global article", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the corpus assertion did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const mapped = Object.keys(ARTICLE_TEMPLATE_IDS);
  assert.ok(mapped.length > 0, "the map is empty — nothing to verify");

  // Global (`church_id IS NULL`) and published: the map is product content, so
  // a key may only name an article every reader can open. A church-scoped
  // article of the same slug would show the section to that church only.
  const rows = await db
    .select({ slug: wikiArticles.slug })
    .from(wikiArticles)
    .where(
      and(
        inArray(wikiArticles.slug, mapped),
        isNull(wikiArticles.churchId),
        sql`${wikiArticles.status} = 'published'`
      )
    );

  const found = new Set(rows.map((r) => r.slug));
  const unreachable = mapped.filter((slug) => !found.has(slug));

  assert.deepEqual(
    unreachable,
    [],
    `these slugs have templates mapped to them but no published global article, so the section can never render:\n${unreachable.join("\n")}`
  );
});
