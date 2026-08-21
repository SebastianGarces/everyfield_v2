/**
 * "50 is a benchmark, not a gate" — the audit (#472, C03)
 *
 * Bryan is fine with 50/100 as long as the product says they are THIS
 * methodology's benchmarks rather than a universal definition of a healthy
 * plant. His own plant launched at 25.
 *
 * The rubric and the app copy are ordinary diffs. The wiki is not: the corpus
 * lives in `wiki_articles`, a protected table with no repo seed, so the content
 * pass leaves no reviewable trace. THIS SCRIPT IS THAT TRACE. It is read-only,
 * it re-runs for free, and its zero-finding output is the claim a reviewer can
 * check for themselves rather than take on trust.
 *
 * It also stays as the regression guard: an article written next year that
 * says a plant "must reach 50 committed adults" shows up here.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-benchmark-language.ts
 *   pnpm exec tsx scripts/audit-benchmark-language.ts --all-scopes
 *
 * Options:
 *   --all-scopes   Include church-scoped articles. The default is the GLOBAL
 *                  corpus (`church_id IS NULL`) — the only one #472 swept, and
 *                  the only one a planter cannot have written themselves.
 *   --mentions     List EVERY sentence naming 50 or 100 about people, flagged
 *                  or not, and change nothing about the exit code. This is the
 *                  worklist a content pass reads: gate grammar is the failure,
 *                  but an unframed mention is what a content author has to
 *                  decide about.
 *
 * Exit code is 1 when anything is flagged, so it can gate a content pass.
 * The detector is `src/lib/wiki/benchmark-language.ts`, unit-tested there.
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { wikiArticles } from "../src/db/schema/wiki";
import {
  findBenchmarkMentions,
  findGatePhrasing,
} from "../src/lib/wiki/benchmark-language";

config({ path: ".env.local" });

const ALL_SCOPES = process.argv.includes("--all-scopes");
const MENTIONS = process.argv.includes("--mentions");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL));

  const rows = await db
    .select({
      slug: wikiArticles.slug,
      title: wikiArticles.title,
      content: wikiArticles.content,
    })
    .from(wikiArticles)
    .where(ALL_SCOPES ? undefined : isNull(wikiArticles.churchId))
    .orderBy(wikiArticles.slug);

  console.log(
    `\n📏 Benchmark-language audit — ${rows.length} ${
      ALL_SCOPES ? "articles (all scopes)" : "global articles"
    }\n`
  );

  if (MENTIONS) {
    for (const row of rows) {
      const mentions = findBenchmarkMentions(row.content);
      if (mentions.length === 0) continue;
      console.log(`  ${row.slug} — ${row.title}`);
      for (const sentence of mentions) console.log(`    ${sentence}`);
      console.log("");
    }
  }

  let flagged = 0;
  for (const row of rows) {
    const findings = findGatePhrasing(row.content);
    if (findings.length === 0) continue;

    flagged += 1;
    console.log(`  ${row.slug} — ${row.title}`);
    for (const finding of findings) {
      console.log(`    [${finding.trigger}] ${finding.sentence}`);
    }
    console.log("");
  }

  if (flagged === 0) {
    console.log(
      "✅ No article states 50 or 100 as a gate. The numbers may appear as this\n" +
        "   methodology's benchmarks; nothing says a plant must reach them.\n"
    );
    return;
  }

  console.log(
    `❌ ${flagged} article(s) frame a benchmark as a requirement.\n` +
      "   Keep the number; change the grammar around it (#472, C03).\n"
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
