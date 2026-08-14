import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  codeOf,
  functionBodies,
  TS_FILES,
} from "@/lib/auth/server-action-surface";

import { progressPatchSchema } from "./write-input";
import * as writeQueries from "./write-queries";
import {
  bookmarkDeleteQuery,
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
  bookmarkDeleteQuery: () => bookmarkDeleteQuery(USER, SLUG),
} satisfies Record<
  keyof typeof writeQueries,
  () => { toSQL(): { sql: string } }
>;

/** `on conflict … do update` or `on conflict … do nothing` — either is a guard. */
const CONFLICT_GUARDED = /on conflict[\s\S]*?do (update|nothing)/i;

test("every wiki write is ONE statement, and every INSERT is conflict-safe", () => {
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

    // A DELETE is a write too (#411 r2). What the rule is about is that ONE
    // statement does the work — `^insert into` alone said so by accident, and
    // said it by excluding the two bookmark deletes from the module rather than
    // by proving anything about them.
    assert.match(
      text,
      /^(insert into|delete from)/i,
      `${name} is not a single statement — a read followed by a write is not a concurrency guard`
    );

    // ON CONFLICT is an INSERT's guard and only an INSERT's: a DELETE keyed on
    // the unique pair cannot collide with itself, and requiring the clause of
    // it would only invite one to be written that Postgres rejects.
    if (/^insert into/i.test(text)) {
      assert.match(
        text,
        CONFLICT_GUARDED,
        `${name} renders an INSERT with no ON CONFLICT clause: it dies on the unique index the moment two requests arrive together`
      );
    }
  }
});

/**
 * The `"use server"` modules whose writes must all live in the seam.
 *
 * This is the assertion the previous version of this file could not make. The
 * `satisfies` above only proves that everything IN `write-queries.ts` is
 * rendered here; it says nothing about a statement written somewhere else, and
 * for one round that was exactly the hole — `write-queries.ts` and this test
 * both claimed "every wiki write path" while `bookmarks.ts` held two DELETEs of
 * its own, one of them the reason `toggleBookmark` still opened with a SELECT.
 *
 * `codeOf` strips comments (the repo's own stripper, from
 * `server-action-surface.ts`) so a module that NAMES the shape it forbids does
 * not trip the check that forbids it.
 */
const WRITE_MODULES = ["src/lib/wiki/progress.ts", "src/lib/wiki/bookmarks.ts"];

/** A statement built inline: `db.insert(`, `db.update(`, `db.delete(`. */
const INLINE_WRITE = /db\s*\.\s*(insert|update|delete)\s*\(/;

test("no wiki write is built outside the seam", () => {
  for (const file of WRITE_MODULES) {
    assert.doesNotMatch(
      codeOf(path.join(process.cwd(), file)),
      INLINE_WRITE,
      `${file} builds a write statement inline, so it is a wiki write path this file never renders and never asserts (#411)`
    );
  }
});

/**
 * A file that could CALL an endpoint. Two exclusions, both deliberate:
 *
 *  - `index.ts`, the wiki barrel, RE-EXPORTS these modules. A re-export moves an
 *    endpoint's name; it is not a caller and must not keep a dead one alive.
 *  - test files. A dead endpoint whose only reference is the test asserting it
 *    exists is exactly the shape this guard is for.
 */
const couldCall = (file: string) =>
  !file.endsWith(".test.ts") &&
  !file.endsWith(".test.tsx") &&
  !file.endsWith(path.join("lib", "wiki", "index.ts"));

test("every endpoint on the wiki's write surface has a caller (#411 round 6)", () => {
  // Every export of a `"use server"` module is a POSTable endpoint, reachable
  // with no session cookie and no UI in front of it (`memory/invariants.md` →
  // Authentication) — so a dead export is not dead code, it is an endpoint
  // nobody is looking at. Four of them survived the sweep that deleted four dead
  // READS from `service.ts` for the same reason, and two of the four were
  // WRITES: `markCompleted` marked any slug complete for whoever posted it, and
  // `addBookmark`/`removeBookmark` were the toggle's two halves with nothing
  // calling either.
  //
  // Derived from the source, not from a list: a hand-list of "the endpoints we
  // meant to keep" goes stale the moment somebody adds one.
  for (const relative of WRITE_MODULES) {
    const full = path.join(process.cwd(), relative);
    const endpoints = functionBodies(codeOf(full))
      .filter((fn) => fn.exported)
      .map((fn) => fn.name);

    assert.ok(
      endpoints.length > 0,
      `${relative} exports no endpoint the walk can read — an export the parser cannot see is an endpoint nothing here checks`
    );

    for (const name of endpoints) {
      const callers = TS_FILES.filter(
        (file) =>
          file !== full &&
          couldCall(file) &&
          new RegExp(`\\b${name}\\b`).test(codeOf(file))
      );

      assert.ok(
        callers.length > 0,
        `${relative} exports ${name}, which nothing in src/ calls — every export of a "use server" module is a public POST endpoint, so delete it rather than leave it reachable (#411)`
      );
    }
  }
});

test("a progress save conflicts on (user_id, article_slug)", () => {
  // The unique index is on the pair, so that pair is the conflict target: any
  // other target (or none) leaves the duplicate possible.
  const { sql: text } = WRITE_PATHS.progressUpsertQuery().toSQL();

  assert.match(text, /on conflict \("user_id","article_slug"\) do update/i);
});

test("a progress save cannot be made to write a column the caller named", () => {
  // `updateProgress` (`progress.ts`) is an export of a `"use server"` module —
  // a public POST endpoint — and it hands its `data` parameter straight to this
  // builder. A TypeScript parameter type constrains a forged body not at all
  // (`memory/invariants.md` → Multi-Tenancy), so a SET built by spreading that
  // object is mass assignment: while it was `set: { ...patch, … }` this exact
  // call rendered `do update set "user_id" = $6` with the hostile uuid bound to
  // it, which rewrites who owns the progress row.
  const hostile = {
    userId: "99999999-9999-4999-8999-999999999999",
    articleSlug: "someone/elses-article",
    scrollPosition: 0.4,
  } as unknown as Parameters<typeof progressUpsertQuery>[2];

  const { sql: text } = progressUpsertQuery(USER, SLUG, hostile, NOW).toSQL();
  const updateClause = text.slice(text.search(/do update/i));

  assert.doesNotMatch(
    updateClause,
    /"user_id" =/,
    "a caller-supplied field reached the DO UPDATE SET: a forged body can rewrite the row's owner"
  );
  assert.doesNotMatch(
    updateClause,
    /"article_slug" =/,
    "a caller-supplied field reached the DO UPDATE SET: a forged body can re-point the row at another article"
  );

  // The fields that ARE the caller's to set still land, so this is a narrowing
  // of the SET and not a disabling of it.
  assert.match(updateClause, /"scroll_position" =/);
});

// ----------------------------------------------------------------------------
// The other half of the same POST body: its VALUES (#411 round 6).
//
// Naming the two writable columns answers "which columns" and says nothing at
// all about "which values". `wiki_progress.status` is a plain `text` column with
// no CHECK behind it (`migrations/0002_mixed_hemingway.sql`), so a forged status
// persisted verbatim into the caller's own row and every reader of that column
// then had a fourth state to meet. `updateProgress` parses
// `progressPatchSchema` straight after its session mint and passes only
// `parsed.data` on, which is why the schema lives in `write-input.ts` — a module
// with no directive can be imported here and run against a hostile body, where a
// schema inside the `"use server"` module could only be asserted about as source
// text.
// ----------------------------------------------------------------------------

test("a progress save refuses a value the column cannot mean", () => {
  // `status` is a three-value vocabulary the whole progress UI switches on.
  assert.equal(
    progressPatchSchema.safeParse({ status: "certified_prophet" }).success,
    false,
    "a forged status parses, and the column has no CHECK behind it to catch it"
  );
  assert.equal(
    progressPatchSchema.safeParse({ scrollPosition: 42 }).success,
    false,
    "a scroll position outside [0,1] parses — the progress UI divides by that number"
  );
  assert.equal(
    progressPatchSchema.safeParse({ scrollPosition: -1 }).success,
    false
  );

  // An unknown key is a REFUSAL, not a silently-dropped field: the builder
  // already makes the column unreachable, and a body carrying `userId` is a
  // caller probing for mass assignment.
  assert.equal(
    progressPatchSchema.safeParse({
      scrollPosition: 0.4,
      userId: "99999999-9999-4999-8999-999999999999",
    }).success,
    false,
    "an unknown key survives the parse, so a probe cannot be told apart from a save"
  );

  // A body that is not an object at all — the parameter type promises one and
  // the wire promises nothing.
  assert.equal(progressPatchSchema.safeParse("completed").success, false);
  assert.equal(progressPatchSchema.safeParse(null).success, false);

  // And the two shapes the product actually sends still pass, so this is a
  // narrowing of what a POST may say and not a disabling of the endpoint.
  assert.deepEqual(progressPatchSchema.parse({ scrollPosition: 0.4 }), {
    scrollPosition: 0.4,
  });
  assert.deepEqual(
    progressPatchSchema.parse({ status: "completed", scrollPosition: 1 }),
    { status: "completed", scrollPosition: 1 }
  );
});

test("the parsed value is what reaches the statement", () => {
  // The parse is only worth anything if nothing routes around it: what the
  // builder renders must be the parsed object, so a refused body produces NO
  // statement rather than a partial one.
  const hostile = { status: "certified_prophet", scrollPosition: 0.4 };
  const parsed = progressPatchSchema.safeParse(hostile);

  assert.equal(parsed.success, false, "the hostile body must not parse");

  // Rendered as `updateProgress` would render it if the parse were skipped —
  // which is the regression this test exists to catch.
  const { sql: text, params } = progressUpsertQuery(
    USER,
    SLUG,
    hostile as unknown as Parameters<typeof progressUpsertQuery>[2],
    NOW
  ).toSQL();
  const updateClause = text.slice(text.search(/do update/i));

  assert.match(
    updateClause,
    /"status" =/,
    "the builder names status, so an unparsed body decides its VALUE"
  );
  assert.ok(
    params.includes("certified_prophet"),
    "a forged status binds straight into the statement when nothing parses it — which is why the parse sits above the builder in updateProgress"
  );

  // …and the source is where that ordering is pinned: the module cannot be
  // imported here (`"use server"`, and it reaches `@/db`), so the assertion is
  // that the endpoint hands the BUILDER a parsed value and never its parameter.
  const body = functionBodies(
    codeOf(path.join(process.cwd(), "src/lib/wiki/progress.ts"))
  ).find((fn) => fn.name === "updateProgress");

  assert.ok(body, "updateProgress is gone from progress.ts");
  assert.match(
    body.body,
    /progressPatchSchema\.safeParse\(\s*data\s*\)/,
    "updateProgress does not parse its body — a TypeScript parameter type constrains a forged POST not at all"
  );
  assert.match(
    body.body,
    /progressUpsertQuery\([\s\S]*parsed\.data/,
    "updateProgress passes something other than the parsed value to the builder"
  );
  assert.ok(
    body.body.indexOf("getCurrentSession()") <
      body.body.indexOf("progressPatchSchema.safeParse("),
    "the parse runs above the session mint, so an anonymous POST can tell a malformed body from a well-formed one (`memory/invariants.md` → Authentication)"
  );
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

test("removing a bookmark is keyed on the pair and reports what it removed", () => {
  // `toggleBookmark` branches on the RETURNING rows, which is what let its
  // leading SELECT go: the direction of the toggle is decided by the write. A
  // delete keyed on an id read a statement earlier would put that read back.
  const { sql: text, params } = bookmarkDeleteQuery(USER, SLUG).toSQL();

  assert.match(text, /^delete from "wiki_bookmarks"/i);
  assert.match(
    text,
    /"user_id" = \$\d and "wiki_bookmarks"\."article_slug" = \$\d/i,
    "the delete must be keyed on (user_id, article_slug) — the pair the unique index covers — not on an id read elsewhere"
  );
  assert.match(
    text,
    /returning "id"/i,
    "without RETURNING, the toggle has to read before it writes to know which way it went"
  );
  assert.deepEqual(params, [USER, SLUG]);
});
