/**
 * Re-stamp the newest migration so it sorts above every sibling — by ONE
 * SECOND, never by a day (#566, ruled 2026-08-21).
 *
 * WHY THIS EXISTS. `drizzle-kit migrate` applies an entry only while the
 * ledger's MAXIMUM `created_at` is below that entry's `when`, so a migration
 * stamped at or below a sibling that reached the database first is skipped in
 * SILENCE — exit 0, nothing applied. Parallel tracks mint migrations against
 * the same trunk, so the loser of a rebase lands with a `when` below the tail
 * and has to be re-stamped. Every hand re-stamp so far added +24h, and four of
 * them put the journal ~46h into the future: real `Date.now()` from the NEXT
 * generate then lands below the tail through no fault of its own, and the
 * reflex fix compounds the drift. One second is the smallest stamp that
 * restores the order, so the gap to wall-clock time stops growing and closes
 * on its own.
 *
 * WHAT A `when` TOUCHES. Exactly two files, and this script keeps them equal:
 *   1. the entry in `meta/_journal.json`, which decides apply order;
 *   2. the ROLLBACK header in the migration's own `.sql`, which names the
 *      ledger row to delete by `created_at` — a number, not a file hash.
 * Snapshots carry no timestamp. Nothing else does either.
 *
 * IT IS THE TAIL'S STAMP ONLY. Entries already behind the tail are history:
 * their stamps match rows in databases that applied them, so this script never
 * touches them, and it never touches a `tag`. It reads them to find the floor
 * the tail has to clear.
 *
 * Rerunning is a no-op: the tail's stamp converges, and a second pass finds it
 * already above the floor. `pnpm db:generate` runs it for exactly that reason,
 * which makes generation stamp `max(Date.now(), floor + 1s)` without forking
 * drizzle-kit.
 *
 * Usage: `tsx scripts/restamp-migration.ts [--dir <migrations-dir>]`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The smallest stamp that restores order. Never a day. See #566. */
export const RESTAMP_GAP_MS = 1000;

export const DEFAULT_MIGRATIONS_DIR = "src/db/migrations";

export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

/**
 * The stamp the newest entry must carry: its own, when that already clears
 * every sibling, otherwise one second above the HIGHEST of them.
 *
 * The floor is the maximum, not the previous entry — `drizzle-kit migrate`
 * compares against the ledger's maximum `created_at`, so an earlier entry that
 * drifted above its neighbour still shadows the tail.
 */
export function tailStamp(entries: readonly JournalEntry[]): number {
  const tail = entries.at(-1);
  if (!tail) throw new Error("the journal has no entries");

  const floor = entries
    .slice(0, -1)
    .reduce((highest, entry) => Math.max(highest, entry.when), -Infinity);

  return Math.max(tail.when, floor + RESTAMP_GAP_MS);
}

/**
 * The rollback header's `created_at`, re-pointed at `when`.
 *
 * The header names this migration's OWN ledger row, so the journal's stamp is
 * the only right answer for it. That makes the rewrite unconditional and
 * self-healing rather than a search for one specific old number. A migration
 * carrying no such header (29 of the first 54) comes back unchanged.
 */
export function retimeRollbackHeader(sql: string, when: number): string {
  return sql.replace(
    /(__drizzle_migrations WHERE created_at = )\d+/g,
    `$1${when}`
  );
}

export type Restamp = {
  tag: string;
  from: number;
  to: number;
  /** What this run rewrote, relative to the migrations directory. */
  wrote: string[];
};

/**
 * Read the journal, bring the tail's stamp and its rollback header into
 * agreement with {@link tailStamp}, and report what moved.
 */
export function reconcileTail(dir: string): Restamp {
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

  const tail = journal.entries.at(-1);
  if (!tail) throw new Error(`${journalPath} has no entries`);

  const from = tail.when;
  const to = tailStamp(journal.entries);
  const wrote: string[] = [];

  if (to !== from) {
    tail.when = to;
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    wrote.push("meta/_journal.json");
  }

  const sqlName = `${tail.tag}.sql`;
  const sqlPath = join(dir, sqlName);
  const sql = readFileSync(sqlPath, "utf8");
  const retimed = retimeRollbackHeader(sql, to);
  if (retimed !== sql) {
    writeFileSync(sqlPath, retimed);
    wrote.push(sqlName);
  }

  return { tag: tail.tag, from, to, wrote };
}

function main(argv: readonly string[]): void {
  const flag = argv.indexOf("--dir");
  const dir = flag === -1 ? DEFAULT_MIGRATIONS_DIR : argv[flag + 1];

  if (!dir) {
    console.error("restamp-migration: --dir needs a path");
    process.exitCode = 2;
    return;
  }

  const { tag, to, wrote } = reconcileTail(dir);

  console.log(
    wrote.length === 0
      ? `restamp-migration: ${tag} already sorts last at ${to}. Nothing to do.`
      : `restamp-migration: ${tag} re-stamped to ${to} (${new Date(to).toISOString()}) in ${wrote.join(", ")}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
