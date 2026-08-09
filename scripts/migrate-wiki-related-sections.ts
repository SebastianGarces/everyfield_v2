/**
 * Authored "## Related Articles" prose → `related_article_slugs` (#317)
 *
 * `RelatedArticles` (W-009) renders an article's cross-links from
 * `wiki_articles.related_article_slugs`. Every article in the corpus ALSO ends
 * with a hand-written "## Related Articles" section listing the same links, so
 * shipping the component as-is shows the reader the section twice.
 *
 * The ruling was to make the derived component canonical. This script is the
 * one-time move: for every article it lifts the authored links into the column
 * and deletes the prose section. Afterwards the prose is gone, so a second run
 * finds no section and changes nothing.
 *
 * The parsing lives in `src/lib/wiki/related-sections.ts` (and is unit-tested
 * there) rather than here, because its two boundary rules are the whole risk:
 * the section ends at its link list, NOT at the next heading — it is the last
 * heading in every article, so the obvious rule would delete the closing
 * Callout with it.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-wiki-related-sections.ts --dry-run
 *   pnpm exec tsx scripts/migrate-wiki-related-sections.ts
 *
 * Options:
 *   --dry-run       Report what would change; write nothing.
 *   --backup-dir    Where the pre-write backup lands (default: ./backups).
 *
 * A JSON backup of every row about to be modified — id, slug, content and the
 * previous related_article_slugs — is written BEFORE the first update, even on
 * a real run, and its path is printed. Restoring is a straight replay of it.
 */

import fs from "fs/promises";
import path from "path";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { wikiArticles } from "../src/db/schema/wiki";
import {
  parseRelatedSection,
  relatedHrefToSlug,
} from "../src/lib/wiki/related-sections";

config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");

const backupDirArg = process.argv.indexOf("--backup-dir");
const BACKUP_DIR =
  backupDirArg !== -1 && process.argv[backupDirArg + 1]
    ? process.argv[backupDirArg + 1]
    : path.join(process.cwd(), "backups");

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

type ArticleRow = {
  id: string;
  slug: string;
  content: string;
  relatedArticleSlugs: string[] | null;
};

type PlannedChange = {
  row: ArticleRow;
  slugs: string[];
  content: string;
  dropped: string[];
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
  }

  console.log(
    `\n🔗 Wiki related-articles migration${DRY_RUN ? " (DRY RUN)" : ""}\n`
  );

  const rows: ArticleRow[] = await db
    .select({
      id: wikiArticles.id,
      slug: wikiArticles.slug,
      content: wikiArticles.content,
      relatedArticleSlugs: wikiArticles.relatedArticleSlugs,
    })
    .from(wikiArticles);

  console.log(`   ${rows.length} articles in the table`);

  // Resolution target: every slug that exists. A cross-link naming an article
  // the reader cannot see is dropped at render time anyway (W-009), so the
  // column only needs to hold slugs that name a real row.
  const knownSlugs = new Set(rows.map((row) => row.slug));

  const planned: PlannedChange[] = [];
  const skipped: string[] = [];
  const aborted: string[] = [];
  const allDropped: string[] = [];

  for (const row of rows) {
    const parsed = parseRelatedSection(row.content ?? "");

    if (!parsed) {
      skipped.push(row.slug);
      continue;
    }

    if (parsed.unparsedListItem) {
      // A partial strip would delete prose. Leave the article untouched and
      // report it instead.
      aborted.push(`${row.slug}: ${parsed.unparsedListItem}`);
      continue;
    }

    const slugs: string[] = [];
    const dropped: string[] = [];

    for (const href of parsed.hrefs) {
      const slug = relatedHrefToSlug(href);

      if (!slug || !knownSlugs.has(slug)) {
        dropped.push(`${row.slug} → ${href}`);
        continue;
      }
      if (slug === row.slug || slugs.includes(slug)) {
        continue;
      }

      slugs.push(slug);
    }

    allDropped.push(...dropped);
    planned.push({ row, slugs, content: parsed.content, dropped });
  }

  console.log(`   ${planned.length} carry an authored section`);
  console.log(`   ${skipped.length} have none (left untouched)`);
  if (aborted.length > 0) {
    console.log(`   ${aborted.length} ABORTED — unparsable list item:`);
    for (const line of aborted) console.log(`      ⚠️  ${line}`);
  }

  const resolved = planned.reduce((n, change) => n + change.slugs.length, 0);
  console.log(`\n   ${resolved} links resolved to a real article`);
  if (allDropped.length > 0) {
    console.log(`   ${allDropped.length} unresolvable link(s) dropped:`);
    for (const line of allDropped) console.log(`      ✗ ${line}`);
  } else {
    console.log("   0 unresolvable links");
  }

  const overwritten = planned.filter(
    (change) => (change.row.relatedArticleSlugs ?? []).length > 0
  );
  if (overwritten.length > 0) {
    console.log(
      `\n   ${overwritten.length} article(s) already had a column value, now overwritten:`
    );
    for (const change of overwritten) {
      console.log(
        `      ${change.row.slug}: [${(change.row.relatedArticleSlugs ?? []).join(", ")}] → [${change.slugs.join(", ")}]`
      );
    }
  }

  if (planned.length === 0) {
    console.log("\n✅ Nothing to do.\n");
    return;
  }

  // The backup goes down before the first write, on dry runs too — a dry run
  // that produced no artefact would leave the real run unrehearsed.
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    BACKUP_DIR,
    `wiki-related-backup-${stamp}${DRY_RUN ? "-dry-run" : ""}.json`
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      planned.map((change) => ({
        id: change.row.id,
        slug: change.row.slug,
        content: change.row.content,
        related_article_slugs: change.row.relatedArticleSlugs,
      })),
      null,
      2
    ),
    "utf8"
  );
  console.log(`\n💾 Backup of ${planned.length} row(s): ${backupPath}`);

  if (DRY_RUN) {
    console.log("\n📋 DRY RUN — no rows were written.\n");
    return;
  }

  console.log("\n✍️  Writing...");
  let written = 0;
  const failures: string[] = [];

  for (const change of planned) {
    try {
      await db
        .update(wikiArticles)
        .set({
          content: change.content,
          relatedArticleSlugs: change.slugs.length > 0 ? change.slugs : null,
          updatedAt: new Date(),
        })
        .where(eq(wikiArticles.id, change.row.id));
      written++;
    } catch (error) {
      failures.push(`${change.row.slug}: ${error}`);
    }
  }

  console.log(`   ${written} article(s) updated`);
  if (failures.length > 0) {
    console.log(`   ${failures.length} FAILED:`);
    for (const line of failures) console.log(`      ❌ ${line}`);
    process.exit(1);
  }

  console.log("\n✅ Done.\n");
}

main().catch((error) => {
  console.error("\n❌ Migration failed:", error);
  process.exit(1);
});
