import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MIGRATIONS_DIR,
  RESTAMP_GAP_MS,
  reconcileTail,
  retimeRollbackHeader,
  tailStamp,
  type JournalEntry,
  type Journal,
} from "./restamp-migration";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "restamp-migration.ts");
const REPO = path.dirname(HERE);

function entry(idx: number, when: number, tag = `${idx}_m`): JournalEntry {
  return { idx, version: "7", when, tag, breakpoints: true };
}

/** A migration whose header names its own ledger row, as 25 of ours do. */
function sqlWithRollback(when: number): string {
  return [
    "-- A fixture migration.",
    "--",
    "-- ROLLBACK:",
    '--   DROP TABLE IF EXISTS "thing";',
    `--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${when};`,
    "--",
    'CREATE TABLE "thing" ("id" uuid PRIMARY KEY);',
    "",
  ].join("\n");
}

/**
 * A migrations directory on disk: a journal, and one `.sql` per entry.
 * The real one is never the subject — a run that rewrites it is the bug.
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
// 2. THE ROLLBACK HEADER FOLLOWS THE STAMP

test("the rollback header is re-pointed at the new stamp", () => {
  const retimed = retimeRollbackHeader(sqlWithRollback(111), 222);
  assert.match(retimed, /created_at = 222;/);
  assert.doesNotMatch(retimed, /111/);
});

test("a migration with no rollback header is left alone", () => {
  const sql = 'CREATE TABLE "thing" ();\n';
  assert.equal(retimeRollbackHeader(sql, 222), sql);
});

test("only the ledger's created_at moves — other numbers are not stamps", () => {
  const sql = 'ALTER TABLE "t" ADD COLUMN "c" integer DEFAULT 1787257458645;\n';
  assert.equal(retimeRollbackHeader(sql, 5), sql);
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
  const after = readFileSync(path.join(dir, "meta", "_journal.json"), "utf8");
  const sql = readFileSync(path.join(dir, "2_m.sql"), "utf8");

  const second = reconcileTail(dir);

  assert.deepEqual(second.wrote, [], "a rerun rewrote a file");
  assert.equal(second.from, second.to);
  assert.equal(
    readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
    after
  );
  assert.equal(readFileSync(path.join(dir, "2_m.sql"), "utf8"), sql);
});

test("entries behind the tail are never re-stamped", () => {
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
    "a tag changed"
  );
});

test("a drifted header is repaired even when the journal is in order", () => {
  const dir = fixture([entry(0, 1_000), entry(1, 90_000)]);
  writeFileSync(path.join(dir, "1_m.sql"), sqlWithRollback(12_345));

  const result = reconcileTail(dir);

  assert.deepEqual(result.wrote, ["1_m.sql"]);
  assert.match(
    readFileSync(path.join(dir, "1_m.sql"), "utf8"),
    /created_at = 90000;/
  );
});

test("a tail with no rollback header re-stamps the journal alone", () => {
  const dir = fixture([entry(0, 90_000), entry(1, 2_000)], { header: false });

  const result = reconcileTail(dir);

  assert.deepEqual(result.wrote, ["meta/_journal.json"]);
  assert.equal(journalOf(dir).entries.at(-1)?.when, 90_000 + RESTAMP_GAP_MS);
});

// ----------------------------------------------------------------------------
// 4. THE CLI — WHAT `pnpm db:generate` ACTUALLY RUNS

test("the CLI re-stamps a fixture directory, and says so", () => {
  const dir = fixture([entry(0, 90_000), entry(1, 2_000)]);

  const run = () =>
    execFileSync("pnpm", ["exec", "tsx", SCRIPT, "--dir", dir], {
      cwd: REPO,
      encoding: "utf8",
    });

  assert.match(run(), /re-stamped to 91000/);
  assert.match(run(), /already sorts last at 91000/);
  assert.equal(journalOf(dir).entries.at(-1)?.when, 91_000);
});

test("the default directory is the repo's, so a bare run needs no flag", () => {
  assert.equal(DEFAULT_MIGRATIONS_DIR, "src/db/migrations");
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
