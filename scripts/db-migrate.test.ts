import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createdObjects, pendingAfter } from "./db-migrate";
import { readJournal, type JournalEntry } from "./restamp-migration";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS = path.join(REPO, "src/db/migrations");

function entry(idx: number, when: number): JournalEntry {
  return { idx, version: "7", when, tag: `${idx}_m`, breakpoints: true };
}

// ============================================================================
// pendingAfter — drizzle-kit's own apply rule, restated
// ============================================================================

test("an entry is pending only while its `when` is ABOVE the ledger maximum", () => {
  const entries = [entry(0, 100), entry(1, 200), entry(2, 300)];

  // Strictly above: drizzle-kit writes `created_at = when`, so an entry whose
  // stamp EQUALS the maximum is the one that just landed, not one still owed.
  assert.deepEqual(
    pendingAfter(entries, 200).map((e) => e.when),
    [300]
  );
  assert.deepEqual(pendingAfter(entries, 300), []);
});

test("a database with no ledger rows owes every entry, in journal order", () => {
  const entries = [entry(0, 100), entry(1, 200), entry(2, 300)];

  assert.deepEqual(
    pendingAfter(entries, -1).map((e) => e.when),
    [100, 200, 300]
  );
});

test("the MAXIMUM decides, not the last row — an entry under a drifted sibling is not pending", () => {
  // 0055–0057 walked two days ahead once (#190). An entry below that high-water
  // mark is skipped in silence by drizzle-kit, so it must not be reported as
  // the migration that failed.
  const entries = [entry(0, 100), entry(1, 900), entry(2, 300)];

  assert.deepEqual(pendingAfter(entries, 900), []);
});

// ============================================================================
// createdObjects — what a migration would create, as the catalog names it
// ============================================================================

test("a renumbered migration's collisions are named with the table they sit on", () => {
  const sql = [
    'ALTER TABLE "churches" ADD COLUMN "digest_send_weekday" integer DEFAULT 0 NOT NULL;--> statement-breakpoint',
    'ALTER TABLE "churches" ADD CONSTRAINT "churches_digest_send_weekday_check" CHECK ("churches"."digest_send_weekday" between 0 and 6);',
  ].join("\n");

  assert.deepEqual(createdObjects(sql), [
    { kind: "column", name: "churches.digest_send_weekday" },
    { kind: "constraint", name: "churches_digest_send_weekday_check" },
  ]);
});

test("tables and indexes are both relations — one namespace, one lookup", () => {
  const sql = [
    'CREATE TABLE "wiki_progress" (',
    '\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL',
    ");--> statement-breakpoint",
    'CREATE INDEX "wiki_progress_user_idx" ON "wiki_progress" USING btree ("user_id");--> statement-breakpoint',
    'CREATE UNIQUE INDEX "wiki_progress_slug_idx" ON "wiki_progress" USING btree ("slug");',
  ].join("\n");

  assert.deepEqual(
    new Set(createdObjects(sql).map((c) => c.kind)),
    new Set(["relation"])
  );
  assert.deepEqual(
    createdObjects(sql)
      .map((c) => c.name)
      .sort(),
    ["wiki_progress", "wiki_progress_slug_idx", "wiki_progress_user_idx"]
  );
});

test("`IF NOT EXISTS` and `CONCURRENTLY` do not hide the object", () => {
  const sql = [
    'CREATE TABLE IF NOT EXISTS "meetings" ("id" uuid PRIMARY KEY);--> statement-breakpoint',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "meetings_idx" ON "meetings" USING btree ("id");--> statement-breakpoint',
    'ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "note" text;',
  ].join("\n");

  assert.deepEqual(createdObjects(sql), [
    { kind: "relation", name: "meetings_idx" },
    { kind: "relation", name: "meetings" },
    { kind: "column", name: "meetings.note" },
  ]);
});

test("an object dropped and recreated in the same file is not a collision", () => {
  // 0025 is the live case: it drops `notifications_dedupe_key_unique_idx` and
  // recreates it. On every database that ran 0023 and not 0025 that index IS
  // present, so without subtracting the drop the report accuses a migration
  // that cannot collide — and points at an attended ledger write.
  const sql = [
    'DROP INDEX "notifications_dedupe_key_unique_idx";--> statement-breakpoint',
    'CREATE UNIQUE INDEX "notifications_dedupe_key_unique_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint',
    'ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_category_check";--> statement-breakpoint',
    'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_category_check" CHECK (true);--> statement-breakpoint',
    'ALTER TABLE "churches" DROP COLUMN IF EXISTS "share_phase";--> statement-breakpoint',
    'ALTER TABLE "churches" ADD COLUMN "share_phase" boolean;--> statement-breakpoint',
    'CREATE TABLE "genuinely_new" ("id" uuid PRIMARY KEY);',
  ].join("\n");

  assert.deepEqual(createdObjects(sql), [
    { kind: "relation", name: "genuinely_new" },
  ]);
});

test("`ALTER COLUMN ... DROP NOT NULL` drops nothing that is named", () => {
  const sql = [
    'ALTER TABLE "notifications" ALTER COLUMN "church_id" DROP NOT NULL;--> statement-breakpoint',
    'ALTER TABLE "notifications" ADD COLUMN "church_id_note" text;',
  ].join("\n");

  assert.deepEqual(createdObjects(sql), [
    { kind: "column", name: "notifications.church_id_note" },
  ]);
});

test("0025 as committed reports no collision on its own index", () => {
  const sql = readFileSync(
    path.join(MIGRATIONS, "0025_notification_dedupe_liveness.sql"),
    "utf8"
  );

  assert.ok(
    sql.includes('DROP INDEX "notifications_dedupe_key_unique_idx"'),
    "fixture drifted: 0025 no longer drops that index"
  );
  assert.equal(
    createdObjects(sql).filter(
      (c) => c.name === "notifications_dedupe_key_unique_idx"
    ).length,
    0
  );
});

test("DDL quoted inside a comment creates nothing", () => {
  // 0058's header quotes all four of its own statements to explain them, and
  // several headers quote a ROLLBACK's `DROP`/`CREATE` pair. A probe that read
  // those would report a collision for a statement nobody is running.
  const sql = [
    "-- ROLLBACK:",
    '--   CREATE TABLE "ghost" ("id" uuid PRIMARY KEY);',
    '--   ALTER TABLE "churches" ADD COLUMN "ghost_column" integer;',
    "",
    'CREATE TABLE "real" ("id" uuid PRIMARY KEY);',
  ].join("\n");

  assert.deepEqual(createdObjects(sql), [{ kind: "relation", name: "real" }]);
});

// ============================================================================
// Against the repository's own migrations
// ============================================================================

test("every committed migration parses, and names nothing that only exists in a comment", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length > 50, "expected the real migrations directory");

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const executable = sql
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");

    for (const { name } of createdObjects(sql)) {
      // The bare identifier, so `churches.digest_send_weekday` is checked as
      // the column name the DDL actually quotes.
      const identifier = name.split(".").at(-1)!;
      assert.ok(
        executable.includes(`"${identifier}"`),
        `${file}: reported "${identifier}" but no executable line quotes it`
      );
    }
  }
});

test("the journal's tail is what a failed migrate would name first on a fresh database", () => {
  const { entries } = readJournal(MIGRATIONS);
  const pending = pendingAfter(entries, -1);

  assert.equal(pending.length, entries.length);
  assert.equal(pending[0]!.tag, entries[0]!.tag);
});
