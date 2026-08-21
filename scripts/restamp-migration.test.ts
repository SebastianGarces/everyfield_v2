import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  RESTAMP_GAP_MS,
  reconcileTail,
  retimeOwnStamp,
  tailStamp,
  type Journal,
  type JournalEntry,
} from "./restamp-migration";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "restamp-migration.ts");
const REPO = path.dirname(HERE);
const REAL_JOURNAL = path.join(REPO, "src/db/migrations/meta/_journal.json");

/** Read at load, asserted at the end: importing this module must not write it. */
const REAL_JOURNAL_BYTES = readFileSync(REAL_JOURNAL, "utf8");

function entry(idx: number, when: number, tag = `${idx}_m`): JournalEntry {
  return { idx, version: "7", when, tag, breakpoints: true };
}

/**
 * A header shaped like 0048's: this migration's own ledger row, then three
 * SIBLINGS an operator must delete in the same session. The siblings are the
 * reason the rewrite anchors on the old stamp rather than on `created_at = `.
 */
const SIBLING_STAMPS = [1786866300000, 1786865400000, 1786859124814];

function sqlWithRollback(when: number): string {
  return [
    "-- A fixture migration.",
    "--",
    "-- ROLLBACK:",
    '--   DROP TABLE IF EXISTS "thing";',
    `--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${when};`,
    "--",
    "-- A database that applied an earlier stamp also holds one of these:",
    ...SIBLING_STAMPS.map(
      (s) =>
        `--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${s};`
    ),
    "--",
    'CREATE TABLE "thing" ("id" uuid PRIMARY KEY);',
    "",
  ].join("\n");
}

/**
 * A migrations directory on disk: a journal, and one `.sql` per entry.
 * The repo's own is never the subject — a run that rewrites it is the bug.
 */
function fixture(entries: JournalEntry[], { header = true } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "restamp-"));
  mkdirSync(path.join(dir, "meta"));
  const journal: Journal = { version: "7", dialect: "postgresql", entries };
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`
  );
  for (const e of entries) {
    writeFileSync(
      path.join(dir, `${e.tag}.sql`),
      header ? sqlWithRollback(e.when) : 'CREATE TABLE "thing" ();\n'
    );
  }
  return dir;
}

function journalOf(dir: string): Journal {
  return JSON.parse(
    readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")
  ) as Journal;
}

// ----------------------------------------------------------------------------
// 1. THE STAMP: ONE SECOND ABOVE THE HIGHEST SIBLING, NEVER A DAY

test("an out-of-order tail is re-stamped one second above the sibling", () => {
  const when = tailStamp([entry(0, 5_000), entry(1, 9_000), entry(2, 6_000)]);
  assert.equal(when, 9_000 + RESTAMP_GAP_MS);
});

test("the floor is the MAXIMUM sibling, not the previous entry", () => {
  // 1 drifted above 2. Clearing only 2 still leaves the tail shadowed, because
  // `drizzle-kit migrate` compares against the ledger's maximum `created_at`.
  const when = tailStamp([entry(0, 1_000), entry(1, 80_000), entry(2, 2_000)]);
  assert.equal(when, 80_000 + RESTAMP_GAP_MS);
});

test("a tail that already sorts last keeps its own stamp", () => {
  const when = tailStamp([entry(0, 5_000), entry(1, 400_000)]);
  assert.equal(when, 400_000);
});

test("an equal stamp is out of order — a tie is a silent skip", () => {
  const when = tailStamp([entry(0, 7_000), entry(1, 7_000)]);
  assert.equal(when, 7_000 + RESTAMP_GAP_MS);
});

test("a lone entry has no floor to clear", () => {
  assert.equal(tailStamp([entry(0, 42)]), 42);
});

test("an empty journal is refused, not silently accepted", () => {
  assert.throws(() => tailStamp([]), /no entries/);
});

// ----------------------------------------------------------------------------
// 2. THE HEADER FOLLOWS THE STAMP — AND ONLY THIS MIGRATION'S OWN

test("the migration's own ledger row is re-pointed at the new stamp", () => {
  const retimed = retimeOwnStamp(sqlWithRollback(111), 111, 222);
  assert.match(retimed, /created_at = 222;/);
  assert.doesNotMatch(retimed, /created_at = 111;/);
});

test("a SIBLING's ledger row in the same header is never touched", () => {
  const retimed = retimeOwnStamp(sqlWithRollback(111), 111, 222);
  for (const sibling of SIBLING_STAMPS) {
    assert.match(
      retimed,
      new RegExp(`created_at = ${sibling};`),
      `sibling ${sibling} was rewritten — the operator reconcile is now three no-ops`
    );
  }
  assert.equal((retimed.match(/created_at = 222;/g) ?? []).length, 1);
});

test("a lowercase `in (…)` reconcile list keeps every sibling", () => {
  // 0049's real shape: ten stamps, this migration's among them, lowercase.
  const sql = [
    "--    where created_at in (",
    "--            1786859369921,  -- old 0043",
    "--            1786866900000   -- this file",
    "--          )",
  ].join("\n");

  const retimed = retimeOwnStamp(sql, 1786866900000, 5);

  assert.match(retimed, /1786859369921,/);
  assert.match(retimed, /5 {3}-- this file/);
});

test("a stamp-shaped literal in executable DDL is not a stamp", () => {
  const sql = 'ALTER TABLE "t" ADD COLUMN "c" bigint DEFAULT 111;\n';
  assert.equal(retimeOwnStamp(sql, 111, 222), sql);
});

test("a longer number merely containing the stamp is left alone", () => {
  const sql = "--   created_at = 1119;\n";
  assert.equal(retimeOwnStamp(sql, 111, 222), sql);
});

test("a migration with no ledger line is left alone", () => {
  const sql = 'CREATE TABLE "thing" ();\n';
  assert.equal(retimeOwnStamp(sql, 111, 222), sql);
});

// ----------------------------------------------------------------------------
// 3. ON DISK: BOTH FILES MOVE TOGETHER, AND RERUNNING CHANGES NOTHING

test("the journal and the header land on the same number", () => {
  const dir = fixture([entry(0, 1_000), entry(1, 90_000), entry(2, 2_000)]);

  const first = reconcileTail(dir);

  assert.equal(first.from, 2_000);
  assert.equal(first.to, 90_000 + RESTAMP_GAP_MS);
  assert.deepEqual(first.wrote, ["meta/_journal.json", "2_m.sql"]);
  assert.equal(journalOf(dir).entries.at(-1)?.when, first.to);
  assert.match(
    readFileSync(path.join(dir, "2_m.sql"), "utf8"),
    new RegExp(`created_at = ${first.to};`)
  );
});

test("a second run is a no-op — the stamp converges", () => {
  const dir = fixture([entry(0, 1_000), entry(1, 90_000), entry(2, 2_000)]);

  reconcileTail(dir);
  const journal = readFileSync(path.join(dir, "meta", "_journal.json"), "utf8");
  const sql = readFileSync(path.join(dir, "2_m.sql"), "utf8");

  const second = reconcileTail(dir);

  assert.deepEqual(second.wrote, [], "a rerun rewrote a file");
  assert.equal(second.from, second.to);
  assert.equal(
    readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
    journal
  );
  assert.equal(readFileSync(path.join(dir, "2_m.sql"), "utf8"), sql);
});

test("entries behind the tail are never re-stamped, and no tag moves", () => {
  const before = [entry(0, 1_000), entry(1, 90_000), entry(2, 2_000)];
  const dir = fixture(before);

  reconcileTail(dir);

  const after = journalOf(dir).entries;
  assert.deepEqual(
    after.slice(0, -1),
    before.slice(0, -1).map((e) => ({ ...e })),
    "a historical entry moved — its stamp names a row in an applied database"
  );
  assert.deepEqual(
    after.map((e) => e.tag),
    ["0_m", "1_m", "2_m"],
    "a tag moved"
  );
});

test("a sibling's .sql is never opened for writing", () => {
  const dir = fixture([entry(0, 90_000), entry(1, 2_000)]);
  const sibling = readFileSync(path.join(dir, "0_m.sql"), "utf8");

  reconcileTail(dir);

  assert.equal(readFileSync(path.join(dir, "0_m.sql"), "utf8"), sibling);
});

test("a tail with no ledger line re-stamps the journal alone", () => {
  const dir = fixture([entry(0, 90_000), entry(1, 2_000)], { header: false });

  const result = reconcileTail(dir);

  assert.deepEqual(result.wrote, ["meta/_journal.json"]);
  assert.equal(journalOf(dir).entries.at(-1)?.when, 90_000 + RESTAMP_GAP_MS);
});

// ----------------------------------------------------------------------------
// 4. THE CLI — WHAT `pnpm db:generate` ACTUALLY RUNS

test("the CLI re-stamps a fixture directory, and names the ledger reconcile", () => {
  const dir = fixture([entry(0, 90_000), entry(1, 2_000)]);

  const run = () =>
    execFileSync("pnpm", ["exec", "tsx", SCRIPT, dir], {
      cwd: REPO,
      encoding: "utf8",
    });

  const first = run();
  assert.match(first, /re-stamped 2000 → 91000/);
  assert.match(first, /SET created_at = 91000 WHERE created_at = 2000;/);
  assert.match(run(), /already sorts last at 91000/);
  assert.equal(journalOf(dir).entries.at(-1)?.when, 91_000);
});

test("db:generate runs the re-stamp, so a collision resolves itself", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(REPO, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };

  assert.match(pkg.scripts["db:generate"] ?? "", /drizzle-kit generate/);
  assert.match(
    pkg.scripts["db:generate"] ?? "",
    /scripts\/restamp-migration\.ts/,
    "generation must stamp max(Date.now(), floor + 1s) — see #566"
  );
});

// ----------------------------------------------------------------------------
// 5. THE FENCE — THIS SUITE IS THE ONE THING THAT IMPORTS THE MODULE

test("the repo's own journal is untouched by this suite", () => {
  assert.equal(
    readFileSync(REAL_JOURNAL, "utf8"),
    REAL_JOURNAL_BYTES,
    "importing restamp-migration ran main() against src/db/migrations"
  );
});
