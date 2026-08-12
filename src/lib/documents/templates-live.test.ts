import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { and, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { wikiArticles } from "@/db/schema";

import { DOCUMENT_TEMPLATES } from "./templates";

// ----------------------------------------------------------------------------
// Catalog → wiki links (ruling 406-1-1) — the half that EXECUTES against a
// database.
//
// `relatedWikiSlug` is authored text with no foreign key into `wiki_articles`.
// A value naming an article the corpus does not have is the exact rot this
// field already suffered once: every value named a slug no published article
// had, so the generate dialog's "Read the related wiki article →" link was
// dead on all 7 templates that carry one — while type-checking, linting, and
// passing every unit test. The wiki's own map is pinned against the corpus in
// `src/components/wiki/article-templates-live.test.ts`; this is the same pin
// for the catalog's direction.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// The PR check runs `pnpm test` against a placeholder URL with no Postgres
// behind it. Run it where a real database is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/documents/*.test.ts"
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

test("every relatedWikiSlug names a published global article", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the corpus assertion did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const slugs = [
    ...new Set(
      DOCUMENT_TEMPLATES.flatMap((template) =>
        template.relatedWikiSlug ? [template.relatedWikiSlug] : []
      )
    ),
  ];
  assert.ok(slugs.length > 0, "no template carries a relatedWikiSlug");

  // Global (`church_id IS NULL`) and published: the catalog is product
  // content, so a slug may only name an article every reader can open.
  const rows = await db
    .select({ slug: wikiArticles.slug })
    .from(wikiArticles)
    .where(
      and(
        inArray(wikiArticles.slug, slugs),
        isNull(wikiArticles.churchId),
        sql`${wikiArticles.status} = 'published'`
      )
    );

  const found = new Set(rows.map((r) => r.slug));
  const dead = DOCUMENT_TEMPLATES.filter(
    (template) =>
      template.relatedWikiSlug && !found.has(template.relatedWikiSlug)
  ).map((template) => `${template.id} → ${template.relatedWikiSlug}`);

  assert.deepEqual(
    dead,
    [],
    `these templates link a wiki article that is not published globally, so the dialog renders a dead link:\n${dead.join("\n")}`
  );
});
