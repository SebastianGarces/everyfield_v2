import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ----------------------------------------------------------------------------
// The wiki's two write paths, and the guard they cannot carry at runtime (#411)
//
// `progress.ts` and `bookmarks.ts` are `"use server"` modules: every export is
// a server action, so nothing here can be imported into a plain unit test and
// nothing non-async may be exported from them to make one possible. Their races
// are also invisible to a single-threaded test — the defect is two requests
// arriving at once, which needs a database and concurrency to observe.
//
// So the SHAPE is pinned instead, which is the technique `tenancy.test.ts` and
// `service.test.ts` already use for call-site facts no runtime surface exposes.
// What it pins is a rule, not a comment: `memory/invariants.md` → Transactions /
// Atomicity, "SELECT-then-INSERT is not a concurrency guard. Make duplicates
// impossible with a (partial) unique index" — and both tables have one
// (`wiki_progress_user_article_idx`, `wiki_bookmarks_user_article_idx`). Before
// this, a first view saved from two tabs and a star pressed twice both raced a
// bare INSERT into a unique-violation, which reaches the reader as a thrown
// server action.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src", "lib", "wiki");

const read = (file: string) =>
  readFileSync(path.join(SRC, file), "utf8")
    // Comments name the shape they forbid, so they must not satisfy the guard.
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const PROGRESS = read("progress.ts");
const BOOKMARKS = read("bookmarks.ts");

/** An INSERT with no conflict clause anywhere after it. */
const UNGUARDED_INSERT = /\.insert\((?:(?!onConflict)[\s\S])*?\.returning\(\)/;

test("a progress save is one upsert, not a read followed by an insert", () => {
  assert.match(
    PROGRESS,
    /onConflictDoUpdate\(/,
    "wiki_progress has a unique index on (user_id, article_slug): a racing first view must update, not throw"
  );
  assert.doesNotMatch(
    PROGRESS,
    UNGUARDED_INSERT,
    "an INSERT into wiki_progress with no ON CONFLICT clause dies on the unique index"
  );
});

test("adding a bookmark twice is a no-op, not a unique violation", () => {
  // `toggleBookmark` and `addBookmark` write the same row; both say the same
  // thing about a duplicate, so pressing the star twice cannot throw.
  const clauses = BOOKMARKS.match(/onConflictDoNothing\(\)/g) ?? [];
  const inserts = BOOKMARKS.match(/\.insert\(wikiBookmarks\)/g) ?? [];

  assert.equal(inserts.length, 2, "the bookmark write paths have moved");
  assert.equal(
    clauses.length,
    inserts.length,
    "every bookmark insert must tolerate the row already being there"
  );
});
