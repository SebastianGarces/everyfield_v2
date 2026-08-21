/**
 * The wiki content pass behind #472 (C03) — run once, kept as the record
 *
 * `wiki_articles` is a protected table with no repo seed, so a content change
 * to the global corpus leaves NO diff a reviewer can read. This script is the
 * diff. Every edit is an exact find→replace, asserted to match exactly once, so
 * re-reading this file tells you precisely what changed in the corpus and
 * re-running it after the fact is a no-op that proves nothing drifted.
 *
 * What it changes: sentences that turn this methodology's 50/100 benchmark into
 * a universal requirement. The NUMBERS DO NOT CHANGE — Bryan was explicit that
 * they are fine as long as the product says whose benchmarks they are.
 *
 * Usage:
 *   pnpm exec tsx scripts/reframe-benchmark-language.ts --dry-run
 *   pnpm exec tsx scripts/reframe-benchmark-language.ts
 *
 * Options:
 *   --dry-run   Report what would change; write nothing.
 *
 * Verify with `scripts/audit-benchmark-language.ts`, which is read-only and
 * stays as the regression guard.
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { wikiArticles } from "../src/db/schema/wiki";

config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The one sentence this pass adds where an article states the benchmark as a
 * bare goal. Written once so all four copies say the same thing.
 */
const FRAMING =
  "These are the benchmarks of this planting methodology, not a universal " +
  "definition of a healthy church. Different contexts and models reasonably " +
  "launch at very different sizes.";

interface Edit {
  find: string;
  replace: string;
}

/**
 * Per-article edits, keyed by slug.
 *
 * `promotion-channels-guide` is on #472's list but is NOT here: both of its
 * 50/100 mentions are quantities of flyers and yard signs, not people. Nothing
 * about it frames a benchmark, so nothing about it changes — recorded here
 * rather than silently skipped.
 */
const EDITS: Record<string, Edit[]> = {
  "core-group/building-your-core-group/growing-your-core-group": [
    {
      find:
        "You need to build toward 50-100 committed adults before you can launch " +
        "effectively.",
      replace:
        "This methodology builds toward 50-100 committed adults before launch.",
    },
    {
      find: "### Critical Mass: 50-100 Adults",
      replace: "### Critical Mass: the 50-100 Adult Benchmark",
    },
    {
      find:
        "This number isn't arbitrary. Research and experience show that launching " +
        "with fewer than 50 adults creates significant challenges:",
      replace:
        "This number isn't arbitrary, and it isn't universal either — it is this " +
        "methodology's benchmark. Within this model, experience shows that " +
        "launching with fewer than 50 adults creates significant challenges:",
    },
    {
      find: "**The target is 100 adults.** 50 is the minimum. The more, the better.",
      replace: `**The target is 100 adults, with 50 at the lower end of the benchmark range.** The more, the better. ${FRAMING}`,
    },
    {
      find: "The final push to 50-100 adults requires sustained, intensive effort.",
      replace:
        "The final push toward the 50-100 benchmark takes sustained, intensive effort.",
    },
  ],

  "core-group/building-your-core-group/what-is-a-core-group": [
    {
      find: "You need 50-100 committed adults to launch effectively.",
      replace: "This methodology plans on 50-100 committed adults at launch.",
    },
  ],

  "core-group/building-your-core-group/the-core-group-funnel": [
    {
      find: "**Size:** Building toward 50-100 adults.",
      replace:
        "**Size:** Building toward this methodology's 50-100 adult benchmark.",
    },
  ],

  "core-group/vision-meetings/what-is-a-vision-meeting": [
    {
      find:
        "Continue until the Lord brings a critical mass of **COMMITTED, COMPELLED, " +
        "CONTAGIOUS, and COURAGEOUS** individuals—typically 50-100 adults.",
      replace:
        "Continue until the Lord brings a critical mass of **COMMITTED, COMPELLED, " +
        "CONTAGIOUS, and COURAGEOUS** individuals. This methodology's benchmark for " +
        "that critical mass is 50-100 adults.",
    },
  ],

  "discovery/setting-your-initial-goals": [
    {
      find:
        "  50 is the minimum. 100 is the target. Below 50 adults, you're likely " +
        "underpowered for a sustainable launch. Every person is critical, and " +
        "normal attrition can create crisis.",
      replace:
        "  Within this methodology, 50 is the lower end of the benchmark range and " +
        "100 is the target. Below 50 adults this model treats a plant as " +
        "underpowered for launch: every person is critical, and normal attrition " +
        `can create crisis. ${FRAMING}`,
    },
  ],

  "frameworks/8-critical-success-factors-overview": [
    {
      find:
        "**Core Group grows to a minimum of 50 COMMITTED, COMPELLED, CONTAGIOUS, " +
        "and COURAGEOUS adults (target goal: 100 adults).**",
      replace:
        "**Core Group grows to this methodology's benchmark of 50 COMMITTED, " +
        "COMPELLED, CONTAGIOUS, and COURAGEOUS adults, with 100 as the target.**",
    },
  ],

  "getting-started/launch-process-goals": [
    {
      // ANCHORED ON THE LINE AFTER, so the edit is idempotent. An insertion
      // whose `find` survives inside its own `replace` matches itself on the
      // next run and inserts the framing a second time — and the
      // already-applied check cannot see the difference. Carrying the following
      // line through the replacement means the original pair is gone afterwards.
      find:
        "**Launch the church with a cohesive, mature group of 50-100 adult " +
        "believers fully aligned with the vision, mission, and distinctives.**" +
        "\n\nNotice what this objective emphasizes:",
      replace:
        "**Launch the church with a cohesive, mature group of 50-100 adult " +
        "believers fully aligned with the vision, mission, and distinctives.**" +
        `\n\n${FRAMING}` +
        "\n\nNotice what this objective emphasizes:",
    },
  ],

  "launch-team/launch-date/setting-your-launch-date": [
    {
      find:
        "- [ ] **Critical mass is building** — You have 30-40 adults with a " +
        "trajectory toward 50-100",
      replace:
        "- [ ] **Critical mass is building** — You have 30-40 adults with a " +
        "trajectory toward this methodology's 50-100 benchmark",
    },
  ],

  "launch-team/launch-date/variables-that-drive-your-launch-date": [
    {
      find: "**Target: 30-40 adults minimum, with goal of 50-100**",
      replace:
        "**Benchmark: 30-40 adults, with a goal of 50-100 — this methodology's numbers, not a universal rule**",
    },
  ],
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set");
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL));

  console.log(
    `\n📏 Reframing 50/100 as this methodology's benchmark${DRY_RUN ? " (DRY RUN)" : ""}\n`
  );

  let changed = 0;
  let alreadyDone = 0;

  for (const [slug, edits] of Object.entries(EDITS)) {
    const [row] = await db
      .select({ id: wikiArticles.id, content: wikiArticles.content })
      .from(wikiArticles)
      .where(and(eq(wikiArticles.slug, slug), isNull(wikiArticles.churchId)))
      .limit(1);

    if (!row) {
      console.error(`❌ ${slug} — no global article with that slug`);
      process.exit(1);
    }

    let content = row.content;
    const applied: string[] = [];

    for (const edit of edits) {
      const hits = content.split(edit.find).length - 1;

      // A SECOND RUN IS A NO-OP, NOT A FAILURE. The replacement text is already
      // in place, so the original is gone and this reports "done" rather than
      // refusing — the script has to be safe to re-run, because a reviewer will.
      if (hits === 0) {
        if (!content.includes(edit.replace)) {
          console.error(
            `❌ ${slug} — neither the original nor the replacement is present:\n   ${edit.find.slice(0, 90)}…`
          );
          process.exit(1);
        }
        alreadyDone += 1;
        continue;
      }

      if (hits > 1) {
        console.error(
          `❌ ${slug} — matched ${hits} times, expected exactly 1:\n   ${edit.find.slice(0, 90)}…`
        );
        process.exit(1);
      }

      content = content.replace(edit.find, edit.replace);
      applied.push(edit.find);
    }

    if (applied.length === 0) {
      console.log(`  ${slug} — already reframed`);
      continue;
    }

    console.log(`  ${slug} — ${applied.length} edit(s)`);
    for (const find of applied) console.log(`      − ${find.slice(0, 100)}`);

    if (!DRY_RUN) {
      await db
        .update(wikiArticles)
        .set({ content, updatedAt: new Date() })
        .where(eq(wikiArticles.id, row.id));
    }
    changed += 1;
  }

  console.log(
    `\n${DRY_RUN ? "Would update" : "Updated"} ${changed} article(s)` +
      (alreadyDone > 0 ? `; ${alreadyDone} edit(s) were already applied` : "") +
      ".\n"
  );
  console.log("Now run: pnpm exec tsx scripts/audit-benchmark-language.ts\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
