import assert from "node:assert/strict";
import { test } from "node:test";

import * as writeQueries from "./write-queries";
import {
  bookmarkInsertQuery,
  progressUpsertQuery,
  recordViewUpsertQuery,
} from "./write-queries";

// ----------------------------------------------------------------------------
// The wiki's write paths (#411), asserted as SQL.
//
// `progress.ts` and `bookmarks.ts` are `"use server"` modules, so their
// statements cannot be imported here and nothing may be exported from them to
// make that possible (`memory/invariants.md` → Authentication: the export list
// IS the auth surface). The statements therefore live in `write-queries.ts`,
// which carries no directive — the seam `visibleArticlesQuery` and
// `searchArticlesQuery` already use for the read paths.
//
// What that buys is the same thing `tenancy.test.ts` gets: each builder is
// rendered with `.toSQL()` and the emitted SQL is inspected, so what is
// asserted is what would reach the database. The previous version of this file
// grepped the two modules' SOURCE TEXT for `.insert(` and `onConflict`, and a
// regex over source is a guess about SQL — that one only recognised an INSERT
// terminated by `.returning()`, so a bare `db.insert(wikiProgress).values({})`
// passed it. `.toSQL()` has no such hole: an unguarded insert renders without
// an `on conflict` clause and fails outright.
//
// The rule being pinned is `memory/invariants.md` → Transactions / Atomicity:
// "SELECT-then-INSERT is not a concurrency guard. Make duplicates impossible
// with a (partial) unique index, keeping that row in the SAME INSERT as the
// rows it speaks for." Both tables have that index
// (`wiki_progress_user_article_idx`, `wiki_bookmarks_user_article_idx`).
//
// `.toSQL()` renders; it does not connect. DATABASE_URL must be PRESENT
// (importing `@/db` builds the Neon client at module load), which `pnpm test`
// and CI both supply as a placeholder.
// ----------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const SLUG = "discovery/values";
const NOW = new Date("2026-08-13T12:00:00.000Z");

/**
 * Every write path the wiki has, with arguments to render it.
 *
 * `satisfies Record<keyof typeof writeQueries, …>` is what keeps this list
 * complete: adding a builder to `write-queries.ts` without adding it here is a
 * compile error, so a new write cannot join the module unguarded. Type-only
 * exports do not appear in the module namespace and so are not listed.
 */
const WRITE_PATHS = {
  progressUpsertQuery: () =>
    progressUpsertQuery(USER, SLUG, { scrollPosition: 0.4 }, NOW),
  recordViewUpsertQuery: () => recordViewUpsertQuery(USER, SLUG, NOW),
  bookmarkInsertQuery: () => bookmarkInsertQuery(USER, SLUG),
} satisfies Record<
  keyof typeof writeQueries,
  () => { toSQL(): { sql: string } }
>;

/** `on conflict … do update` or `on conflict … do nothing` — either is a guard. */
const CONFLICT_GUARDED = /on conflict[\s\S]*?do (update|nothing)/i;

test("every wiki write is one conflict-safe INSERT", () => {
  // The list is checked at RUNTIME as well as by `satisfies`: a builder added
  // to `write-queries.ts` and not rendered here would otherwise be a write this
  // file never sees, which is how the previous source-regex guard went blind.
  assert.deepEqual(
    Object.keys(writeQueries).sort(),
    Object.keys(WRITE_PATHS).sort(),
    "a wiki write path exists that this test never renders"
  );

  for (const [name, build] of Object.entries(WRITE_PATHS)) {
    const { sql: text } = build().toSQL();

    assert.match(
      text,
      /^insert into/i,
      `${name} is not a single INSERT — a read followed by a write is not a concurrency guard`
    );
    assert.match(
      text,
      CONFLICT_GUARDED,
      `${name} renders an INSERT with no ON CONFLICT clause: it dies on the unique index the moment two requests arrive together`
    );
  }
});

test("a progress save conflicts on (user_id, article_slug)", () => {
  // The unique index is on the pair, so that pair is the conflict target: any
  // other target (or none) leaves the duplicate possible.
  const { sql: text } = WRITE_PATHS.progressUpsertQuery().toSQL();

  assert.match(text, /on conflict \("user_id","article_slug"\) do update/i);
});

test("a progress save writes only the fields the caller passed", () => {
  // An intermediate scroll save must not rewrite `status`, and completing an
  // article must not reset the position it was read to.
  const scroll = progressUpsertQuery(
    USER,
    SLUG,
    { scrollPosition: 0.4 },
    NOW
  ).toSQL().sql;
  const updateClause = scroll.slice(scroll.search(/do update/i));

  assert.match(updateClause, /"scroll_position" =/);
  assert.doesNotMatch(
    updateClause,
    /"status" =/,
    "a scroll save must not rewrite the article's status"
  );

  const completed = progressUpsertQuery(
    USER,
    SLUG,
    { status: "completed" },
    NOW
  ).toSQL().sql;
  const completedClause = completed.slice(completed.search(/do update/i));

  assert.match(completedClause, /"status" =/);
  assert.match(completedClause, /"completed_at" =/);
  assert.doesNotMatch(
    completedClause,
    /"scroll_position" =/,
    "completing an article must not reset the scroll position it was read to"
  );
});

test("recording a view cannot downgrade a completed article", () => {
  // This used to be a JS branch over a row read one statement earlier, which a
  // completion landing in the gap simply overwrote. The rule is now a CASE over
  // the row Postgres holds at write time — inside DO UPDATE SET a
  // table-qualified column is the EXISTING row, `excluded.*` the proposed one —
  // so the comparison and the write cannot be interleaved.
  const { sql: text } = recordViewUpsertQuery(USER, SLUG, NOW).toSQL();
  const updateClause = text.slice(text.search(/do update/i));

  assert.match(text, /on conflict \("user_id","article_slug"\) do update/i);
  assert.match(
    updateClause,
    /"status" = case when "wiki_progress"\."status" = 'completed' then "wiki_progress"\."status" else 'in_progress' end/i,
    "the no-downgrade rule must live in the statement, not in a branch over an earlier read"
  );
  assert.doesNotMatch(
    updateClause,
    /excluded/i,
    "the CASE must read the STORED row; `excluded` is the row being proposed, which is always in_progress"
  );
  assert.doesNotMatch(
    updateClause,
    /"completed_at" =|"scroll_position" =/,
    "a view is not a reading position and must not erase when the reader finished"
  );
});

test("adding a bookmark twice is a no-op, not a unique violation", () => {
  const { sql: text } = bookmarkInsertQuery(USER, SLUG).toSQL();

  assert.match(text, /insert into "wiki_bookmarks"/i);
  assert.match(text, /on conflict do nothing/i);
});
