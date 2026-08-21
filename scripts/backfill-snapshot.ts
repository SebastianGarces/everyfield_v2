/**
 * Write the `meta/<n>_snapshot.json` a migration shipped without (#592).
 *
 * WHY THIS EXISTS. A migration is two artifacts: the `.sql` an operator
 * applies, and the snapshot recording the schema it leaves behind.
 * `drizzle-kit generate` diffs `src/db/schema` against the NEWEST snapshot on
 * disk, so a schema-changing migration that lands without one makes the next
 * generate re-emit its DDL inside somebody else's migration — 0059 landed bare
 * and 0060 re-created `plant_assessments.planter_seen_at` by hand (PR #575).
 * `src/db/migrations.test.ts` catches that now; this is the repair it names.
 *
 * WHY NOT `pnpm db:generate` AND A RENAME. That was the hand recipe, and three
 * of its four steps are undo: generate mints a migration, so it appends a
 * journal entry, writes a `.sql`, and re-stamps the tail — all of which have to
 * be reverted, and a journal entry left naming a deleted `.sql` makes
 * `drizzle-kit migrate` fail on a missing file. `generateDrizzleJson` is the
 * same serializer with none of that: schema in, snapshot out, one file written.
 *
 * IT ONLY EVER WRITES ABOVE THE NEWEST SNAPSHOT, because only the newest is
 * read. A bare migration BELOW one that has a snapshot is already absorbed —
 * 0060's snapshot describes the schema after 0059, so backfilling 0059 would
 * change no diff base and break the `prevId` chain that runs through it. That
 * is the #592 ruling, and this script refuses rather than repeats it.
 *
 * Usage: `pnpm exec tsx scripts/backfill-snapshot.ts [<number>]`
 *        (default: the journal's newest entry, which is where the gap is)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateDrizzleJson } from "drizzle-kit/api";
import { format, resolveConfig } from "prettier";

import * as schema from "@/db/schema";

const MIGRATIONS = path.join(process.cwd(), "src", "db", "migrations");
const META = path.join(MIGRATIONS, "meta");

/** The snapshots drizzle-kit reads, in the order it reads them. */
function snapshotFiles(): string[] {
  return readdirSync(META)
    .filter((name) => !name.startsWith("_"))
    .sort();
}

function journalTag(): string {
  const journal = JSON.parse(
    readFileSync(path.join(META, "_journal.json"), "utf8")
  ) as { entries: { tag: string }[] };

  const tail = journal.entries.at(-1);
  if (!tail) throw new Error("_journal.json has no entries");
  return tail.tag;
}

async function main(argv: readonly string[]): Promise<void> {
  const target = (argv[0] ?? journalTag()).slice(0, 4);
  if (!/^\d{4}$/.test(target)) {
    throw new Error(`"${argv[0]}" is not a migration number`);
  }

  const files = snapshotFiles();
  const newest = files.at(-1);
  if (!newest) throw new Error(`${META} holds no snapshots`);

  const name = `${target}_snapshot.json`;
  if (existsSync(path.join(META, name))) {
    throw new Error(`${name} already exists — nothing to backfill`);
  }
  if (name <= newest) {
    throw new Error(
      [
        `${newest} is newer than ${name}, so ${name} would never be read.`,
        `A snapshot below the newest one is already absorbed by it: the diff base`,
        `is correct, and writing this would only break the prevId chain (#592).`,
      ].join("\n  ")
    );
  }

  const previous = JSON.parse(
    readFileSync(path.join(META, newest), "utf8")
  ) as {
    id: string;
  };
  const snapshot = generateDrizzleJson(schema, previous.id);
  const file = path.join(META, name);

  // Formatted on the way out, because CI's `format:check` walks this folder and
  // the editor hooks only fire on a file an agent typed. `drizzle-kit generate`
  // leaves this to those hooks and its output arrives unformatted, which is a
  // red CI run for whoever runs it next.
  writeFileSync(
    file,
    await format(JSON.stringify(snapshot, null, 2), {
      ...(await resolveConfig(file)),
      filepath: file,
    })
  );

  console.log(
    [
      `backfill-snapshot: wrote meta/${name} (after ${newest}).`,
      `  Prove it: pnpm exec tsx --test src/db/migrations.test.ts`,
      `  Nothing else moved — no journal entry, no .sql, no stamp.`,
    ].join("\n")
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `backfill-snapshot: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
