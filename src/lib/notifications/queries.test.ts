import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationCategory } from "@/db/schema";

import {
  DEFAULT_FEED_LIMIT,
  dispatchQueueQuery,
  feedCursorFrom,
  feedPageFrom,
  feedPageLimit,
  hasAnyNotificationsQuery,
  MAX_FEED_LIMIT,
  notificationByIdQuery,
  notificationFeedQuery,
  unreadCountQuery,
  type FeedNotification,
} from "./queries";

// ----------------------------------------------------------------------------
// The two boundaries on every read path (N-008, N-010).
//
// These are query-level assertions: each builder is rendered with `.toSQL()`
// and inspected, so what is asserted is the SQL that would reach Postgres, not
// a stand-in for it. A read path that stopped filtering on church_id OR on
// recipient_user_id would fail here even though it still type-checked and still
// returned rows.
//
// No query is EXECUTED — `.toSQL()` renders, it does not connect. The suite
// does, however, need a DATABASE_URL present: importing `./queries` pulls in
// `@/db`, which constructs the Neon client at module load, and that throws
// without one. `pnpm test` supplies a placeholder (CI too), so this is a
// module-graph fact rather than a live dependency — but it is a real one, and
// claiming otherwise would mislead the next person who tries to run this file
// in isolation.
// ----------------------------------------------------------------------------

const CHURCH_A = "church-a";
const CHURCH_B = "church-b";
const USER = "user-1";
const OTHER_USER = "user-2";
const NOTIFICATION = "notification-1";

const SCOPE = { churchId: CHURCH_A, recipientUserId: USER };

const CHURCH_PREDICATE = /"notifications"\."church_id" = \$\d/;
const RECIPIENT_PREDICATE = /"notifications"\."recipient_user_id" = \$\d/;

/**
 * Timestamps are bound as driver-formatted strings, not `Date`s, so compare by
 * instant rather than by identity — this stays true whichever string form the
 * driver picks.
 */
function boundInstant(params: unknown[], instant: Date): boolean {
  return params.some(
    (param) =>
      typeof param === "string" &&
      new Date(param).getTime() === instant.getTime()
  );
}

// ----------------------------------------------------------------------------
// Fetch by id — the id is not a capability, in EITHER direction
// ----------------------------------------------------------------------------

test("fetch-by-id filters on church_id and recipient_user_id, not the id alone", () => {
  const { sql, params } = notificationByIdQuery(SCOPE, NOTIFICATION).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"notifications"\."id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes(NOTIFICATION));
});

test("a cross-church fetch by id binds the asking church, not the row's", () => {
  const { params } = notificationByIdQuery(
    { churchId: CHURCH_B, recipientUserId: USER },
    NOTIFICATION
  ).toSQL();

  assert.ok(params.includes(CHURCH_B));
  assert.ok(!params.includes(CHURCH_A));
});

test("a same-church, other-user fetch by id cannot match that user's row", () => {
  // The intra-church case the church-only scoping used to miss entirely: a
  // team_member asking for the planter's notification. The recipient predicate
  // binds the ASKER, so the row belonging to OTHER_USER is not "hidden from the
  // UI" — it is absent from the result set.
  const { sql, params } = notificationByIdQuery(SCOPE, NOTIFICATION).toSQL();

  assert.match(sql, RECIPIENT_PREDICATE);
  assert.ok(params.includes(USER));
  assert.ok(!params.includes(OTHER_USER));
});

test("a scope without a recipient does not type-check", () => {
  // @ts-expect-error recipientUserId is required — a user-facing read cannot
  // omit it, so the fail-open path does not exist to be tested at runtime.
  const build = () => notificationByIdQuery({ churchId: CHURCH_A }, "id");

  // The type error IS the assertion (pnpm typecheck fails without it); this
  // keeps the builder referenced so lint does not strip it.
  assert.equal(typeof build, "function");
});

// ----------------------------------------------------------------------------
// The feed
// ----------------------------------------------------------------------------

test("the feed filters on church_id and recipient, newest first and bounded", () => {
  const { sql, params } = notificationFeedQuery(SCOPE).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /order by .*"created_at" desc/i);
  assert.match(sql, /limit/i);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes(DEFAULT_FEED_LIMIT));
});

test("the feed carries no queue internals off the server", () => {
  // The feed row lands in an RSC payload. `dedupe_key` is caller-composed and
  // embeds entity ids by convention, so it — and the rest of the queue's
  // bookkeeping — is projected out rather than trusted to a later unit to strip.
  const { sql } = notificationFeedQuery(SCOPE).toSQL();
  const projection = sql.slice(0, sql.indexOf(" from "));

  assert.ok(!projection.includes("dedupe_key"), projection);
  assert.ok(!projection.includes("updated_at"), projection);
  assert.ok(projection.includes("title"), projection);
  assert.ok(projection.includes("body"), projection);
});

test("the feed limit is clamped — a caller cannot ask for everything", () => {
  const huge = notificationFeedQuery(SCOPE, { limit: 10_000 }).toSQL();
  assert.ok(huge.params.includes(100));

  const zero = notificationFeedQuery(SCOPE, { limit: 0 }).toSQL();
  assert.ok(zero.params.includes(1));
});

test("feed options narrow further without ever dropping either boundary", () => {
  const before = feedCursorFrom({
    id: NOTIFICATION,
    category: "tasks",
    type: "task.overdue",
    title: "t",
    body: "b",
    entityType: null,
    entityId: null,
    readAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  });

  const { sql, params } = notificationFeedQuery(SCOPE, {
    before,
    category: "tasks",
    unreadOnly: true,
  }).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"notifications"\."created_at" < \$\d/);
  assert.match(sql, /"notifications"\."category" = \$\d/);
  assert.match(sql, /"notifications"\."read_at" is null/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes("tasks"));
});

// ----------------------------------------------------------------------------
// Feed visibility — the queue row and the feed row are one record
// ----------------------------------------------------------------------------

test("the feed excludes cancelled rows and rows that are not due yet", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = notificationFeedQuery(SCOPE, { now }).toSQL();

  // N-011: a cancelled notification is never delivered, and the in-app feed is
  // a delivery channel.
  assert.match(sql, /"notifications"\."status" <> \$\d/);
  assert.ok(params.includes("cancelled"));

  // A reminder scheduled three days out must not appear (or be counted) today.
  assert.match(sql, /"notifications"\."scheduled_for" <= \$\d/);
  assert.ok(boundInstant(params, now));
});

test("fetch-by-id applies exactly the feed's visibility rules too", () => {
  // The by-id path returns the SAME projection the list does — title, body,
  // entity link — so it is a delivery channel in its own right. Without these
  // predicates, a cancelled notification (one N-011 says is never delivered)
  // and a reminder scheduled three days out are both readable by anyone
  // holding the id, undoing on this path what the feed enforces on its own.
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = notificationByIdQuery(SCOPE, NOTIFICATION, {
    now,
  }).toSQL();

  assert.match(sql, /"notifications"\."status" <> \$\d/);
  assert.ok(params.includes("cancelled"));

  assert.match(sql, /"notifications"\."scheduled_for" <= \$\d/);
  assert.ok(boundInstant(params, now));
});

test("the unread count applies exactly the feed's visibility rules", () => {
  // The badge and the list it counts cannot be allowed to disagree.
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = unreadCountQuery(SCOPE, { now }).toSQL();

  assert.match(sql, /count\(\*\)/i);
  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"notifications"\."read_at" is null/);
  assert.match(sql, /"notifications"\."status" <> \$\d/);
  assert.match(sql, /"notifications"\."scheduled_for" <= \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes("cancelled"));
  assert.ok(boundInstant(params, now));
});

// ----------------------------------------------------------------------------
// Keyset pagination
// ----------------------------------------------------------------------------

test("the feed orders by (created_at, id) so a tie cannot skip rows", () => {
  // `created_at` defaults to now(), which in Postgres is the TRANSACTION
  // timestamp, and invariants mandate db.batch([...]) for writes known up
  // front — so a fan-out enqueue produces byte-identical timestamps. Without a
  // tiebreaker, siblings straddling a page boundary are never returned.
  const { sql } = notificationFeedQuery(SCOPE).toSQL();

  assert.match(
    sql,
    /order by "notifications"\."created_at" desc, "notifications"\."id" desc/
  );
});

test("the cursor is the pair, so the tie is resolved on the next page too", () => {
  const before = { createdAt: new Date("2026-07-01T00:00:00.000Z"), id: "n-9" };
  const { sql, params } = notificationFeedQuery(SCOPE, { before }).toSQL();

  assert.match(sql, /"notifications"\."created_at" < \$\d/);
  assert.match(sql, /"notifications"\."created_at" = \$\d/);
  assert.match(sql, /"notifications"\."id" < \$\d/);
  assert.ok(boundInstant(params, before.createdAt));
  assert.ok(params.includes("n-9"));
});

// ----------------------------------------------------------------------------
// The exception, and the fact that it is one
// ----------------------------------------------------------------------------

test("every user-facing read emits exactly one church_id AND one recipient predicate", () => {
  const builders = [
    notificationByIdQuery(SCOPE, NOTIFICATION),
    notificationFeedQuery(SCOPE),
    unreadCountQuery(SCOPE),
    hasAnyNotificationsQuery(SCOPE),
  ];

  for (const builder of builders) {
    const { sql } = builder.toSQL();
    assert.equal(
      (sql.match(/"notifications"\."church_id" = \$\d/g) ?? []).length,
      1,
      sql
    );
    assert.equal(
      (sql.match(/"notifications"\."recipient_user_id" = \$\d/g) ?? []).length,
      1,
      sql
    );
  }
});

test("the dispatcher read is church-wide, and that is why it has its own name", () => {
  // The one legitimate reader across recipients. It takes a DispatcherScope, so
  // it cannot be reached by leaving a field off a NotificationScope — a
  // church-wide read is something a caller asks for by name.
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = dispatchQueueQuery(
    { churchId: CHURCH_A },
    { now }
  ).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.doesNotMatch(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"notifications"\."status" = \$\d/);
  assert.ok(params.includes("pending"));
  assert.ok(boundInstant(params, now));
});

// ----------------------------------------------------------------------------
// Cold start — "nothing yet" is a different sentence from "all caught up"
// ----------------------------------------------------------------------------

test("the cold-start probe is scoped and bounded like every other read", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = hasAnyNotificationsQuery(SCOPE, { now }).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  // A boolean question does not need a count, and must not scan the table for
  // one: the feed page asks it on every render.
  assert.match(sql, /limit \$\d/i);
  assert.ok(params.includes(1));
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
});

test("the cold-start probe agrees with the feed about what is visible", () => {
  // `hasAny === false` has to IMPLY "the feed is empty", or the UI could claim
  // a brand-new church while listing rows — or, worse, say "all caught up" to a
  // church that has never been notified of anything. The two answers come from
  // the same visibility rules, so they cannot drift apart.
  const now = new Date("2026-07-27T12:00:00.000Z");
  const { sql, params } = hasAnyNotificationsQuery(SCOPE, { now }).toSQL();

  assert.match(sql, /"notifications"\."status" <> \$\d/);
  assert.match(sql, /"notifications"\."scheduled_for" <= \$\d/);
  assert.ok(params.includes("cancelled"));
  assert.ok(boundInstant(params, now));
});

test("the cold-start probe carries no notification content", () => {
  // It answers "is there anything?", so it has no business selecting a title or
  // a body — the answer is a row's existence, not its contents.
  const { sql } = hasAnyNotificationsQuery(SCOPE).toSQL();
  const projection = sql.slice(0, sql.indexOf(" from "));

  assert.ok(!projection.includes("title"), projection);
  assert.ok(!projection.includes("body"), projection);
});

// ----------------------------------------------------------------------------
// The in-app preference allow-list (N-005 at read time, ruled 2026-07-27)
//
// A category switched off for `in_app` leaves the feed AND the badge AND the
// cold-start probe together. These assert the predicate reaches SQL on all
// three, because a filter applied to only some of them is worse than none: the
// badge would count rows the list refuses to show, and no amount of clicking
// would clear it.
// ----------------------------------------------------------------------------

const ENABLED: NotificationCategory[] = ["tasks", "meetings"];

test("the feed filters to the categories the recipient still wants in-app", () => {
  const { sql, params } = notificationFeedQuery(SCOPE, {
    categories: ENABLED,
  }).toSQL();

  assert.match(sql, /"notifications"\."category" in \(\$\d, \$\d\)/);
  assert.ok(params.includes("tasks"));
  assert.ok(params.includes("meetings"));

  // Never at the expense of the boundaries that were already there.
  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"notifications"\."status" <> \$\d/);
});

test("the badge counts exactly the categories the feed lists", () => {
  // The failure this pins: filtering the list but not the count, which leaves a
  // badge showing unread rows that cannot be reached, opened or cleared.
  const { sql, params } = unreadCountQuery(SCOPE, {
    categories: ENABLED,
  }).toSQL();

  assert.match(sql, /count\(\*\)/i);
  assert.match(sql, /"notifications"\."category" in \(\$\d, \$\d\)/);
  assert.match(sql, /"notifications"\."read_at" is null/);
  assert.ok(params.includes("tasks"));
});

test("the cold-start probe honours the allow-list too", () => {
  // Otherwise a user who has turned every category off is told "all caught up"
  // — a sentence about having read things — when the truth is that they asked
  // not to be shown any of it.
  const { sql, params } = hasAnyNotificationsQuery(SCOPE, {
    categories: ENABLED,
  }).toSQL();

  assert.match(sql, /"notifications"\."category" in \(\$\d, \$\d\)/);
  assert.ok(params.includes("meetings"));
});

test("an EMPTY allow-list shows nothing, rather than everything", () => {
  // The dangerous shape. `category IN ()` is not valid SQL, and an ORM asked to
  // build it may drop the clause instead — turning "I want no notifications at
  // all" into "show me all of them". The predicate is `false` on purpose.
  const feed = notificationFeedQuery(SCOPE, { categories: [] }).toSQL();
  const count = unreadCountQuery(SCOPE, { categories: [] }).toSQL();

  assert.match(feed.sql, /\bfalse\b/);
  assert.match(count.sql, /\bfalse\b/);
  assert.match(feed.sql, CHURCH_PREDICATE);
});

test("an omitted allow-list is not a filter — the dispatcher-side reads are unchanged", () => {
  // `categories` is an option, not a default. Leaving it out has to mean "no
  // preference filter" so the by-id path and any non-feed reader behave exactly
  // as they did before this existed.
  const { sql } = notificationFeedQuery(SCOPE).toSQL();

  assert.doesNotMatch(sql, /"notifications"\."category" in /);
  assert.doesNotMatch(sql, /\bfalse\b/);
});

// ----------------------------------------------------------------------------
// Paging — the page, and knowing whether there is another one
// ----------------------------------------------------------------------------

function feedRow(id: string, iso: string): FeedNotification {
  return {
    id,
    category: "tasks",
    type: "task.overdue",
    title: `title ${id}`,
    body: "b",
    entityType: null,
    entityId: null,
    readAt: null,
    createdAt: new Date(iso),
  };
}

const PAGE = [
  feedRow("n-3", "2026-07-27T12:00:00.000Z"),
  feedRow("n-2", "2026-07-27T11:00:00.000Z"),
  feedRow("n-1", "2026-07-27T10:00:00.000Z"),
];

test("a full page plus a peek yields the page and a cursor to the next one", () => {
  const peeked = [...PAGE, feedRow("n-0", "2026-07-27T09:00:00.000Z")];
  const page = feedPageFrom(peeked, 3);

  assert.equal(page.rows.length, 3);
  assert.deepEqual(
    page.rows.map((row) => row.id),
    ["n-3", "n-2", "n-1"]
  );

  // The cursor is the LAST ROW OF THE PAGE, not the peek: the next page starts
  // strictly after what the user has seen, so the peeked row is fetched again
  // rather than skipped.
  assert.deepEqual(page.nextCursor, {
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    id: "n-1",
  });
});

test("a short page is the last page — no cursor, so no dead Load more", () => {
  const page = feedPageFrom(PAGE, 10);

  assert.equal(page.rows.length, 3);
  assert.equal(page.nextCursor, null);
});

test("an exactly-full page with no peek is also the last page", () => {
  // The off-by-one that would show a "Load more" returning nothing at all.
  const page = feedPageFrom(PAGE, 3);

  assert.equal(page.rows.length, 3);
  assert.equal(page.nextCursor, null);
});

test("an empty result pages to nothing without inventing a cursor", () => {
  const page = feedPageFrom([], 30);

  assert.deepEqual(page.rows, []);
  assert.equal(page.nextCursor, null);
});

test("the cursor carries the pair, so tied timestamps still page correctly", () => {
  // Byte-identical `created_at` is the normal case for a fan-out enqueue, not a
  // corner: `id` is what makes the next page resumable at all.
  const tied = [
    feedRow("n-c", "2026-07-27T12:00:00.000Z"),
    feedRow("n-b", "2026-07-27T12:00:00.000Z"),
    feedRow("n-a", "2026-07-27T12:00:00.000Z"),
  ];

  const page = feedPageFrom(tied, 2);

  assert.equal(page.nextCursor?.id, "n-b");
  assert.equal(
    page.nextCursor?.createdAt.getTime(),
    new Date("2026-07-27T12:00:00.000Z").getTime()
  );
});

test("a page at the ceiling still leaves room for its peek row", () => {
  // `listNotificationPage` reads limit + 1. If the page limit could equal the
  // hard cap, the clamp inside `notificationFeedQuery` would eat the peek and
  // the feed would report "that is everything" with rows still unread.
  assert.equal(feedPageLimit(MAX_FEED_LIMIT), MAX_FEED_LIMIT - 1);
  assert.equal(feedPageLimit(10_000), MAX_FEED_LIMIT - 1);
  assert.ok(feedPageLimit(10_000) + 1 <= MAX_FEED_LIMIT);

  // And the query itself still clamps whatever it is handed.
  const asked = notificationFeedQuery(SCOPE, { limit: 10_000 }).toSQL();
  assert.ok(asked.params.includes(MAX_FEED_LIMIT));
});

test("the page limit floors at one and defaults without being asked", () => {
  assert.equal(feedPageLimit(), DEFAULT_FEED_LIMIT);
  assert.equal(feedPageLimit(0), 1);
  assert.equal(feedPageLimit(-5), 1);
});
