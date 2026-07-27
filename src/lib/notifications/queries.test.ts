import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FEED_LIMIT,
  notificationByIdQuery,
  notificationFeedQuery,
  unreadCountQuery,
} from "./queries";

// ----------------------------------------------------------------------------
// Tenancy on every read path (N-010).
//
// These are query-level assertions: each builder is rendered with `.toSQL()`
// and inspected. No connection is opened — `pnpm test` supplies a placeholder
// DATABASE_URL — so what is asserted is the SQL that would reach Postgres, not
// a stand-in for it. A read path that stopped filtering on church_id would fail
// here even though it still type-checked and still returned rows.
// ----------------------------------------------------------------------------

const CHURCH_A = "church-a";
const CHURCH_B = "church-b";
const USER = "user-1";
const NOTIFICATION = "notification-1";

test("fetch-by-id filters on church_id, not the id alone", () => {
  const { sql, params } = notificationByIdQuery(
    { churchId: CHURCH_A },
    NOTIFICATION
  ).toSQL();

  assert.match(sql, /"notifications"\."church_id" = \$\d/);
  assert.match(sql, /"notifications"\."id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(NOTIFICATION));
  // Tenancy comes first — the id narrows within a church, never across.
  assert.ok(sql.indexOf("church_id") < sql.indexOf('"id" ='));
});

test("a cross-church fetch by id binds the asking church, not the row's", () => {
  // The id is not a capability: asking as church B for a row that belongs to
  // church A produces SQL that cannot match it, so the read returns nothing
  // rather than relying on the caller to check ownership afterwards.
  const { params } = notificationByIdQuery(
    { churchId: CHURCH_B },
    NOTIFICATION
  ).toSQL();

  assert.ok(params.includes(CHURCH_B));
  assert.ok(!params.includes(CHURCH_A));
});

test("the feed filters on church_id and recipient, newest first and bounded", () => {
  const { sql, params } = notificationFeedQuery({
    churchId: CHURCH_A,
    recipientUserId: USER,
  }).toSQL();

  assert.match(sql, /"notifications"\."church_id" = \$\d/);
  assert.match(sql, /"notifications"\."recipient_user_id" = \$\d/);
  assert.match(sql, /order by .*"created_at" desc/i);
  assert.match(sql, /limit/i);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes(DEFAULT_FEED_LIMIT));
});

test("the feed limit is clamped — a caller cannot ask for everything", () => {
  const huge = notificationFeedQuery(
    { churchId: CHURCH_A, recipientUserId: USER },
    { limit: 10_000 }
  ).toSQL();
  assert.ok(huge.params.includes(100));

  const zero = notificationFeedQuery(
    { churchId: CHURCH_A, recipientUserId: USER },
    { limit: 0 }
  ).toSQL();
  assert.ok(zero.params.includes(1));
});

test("feed options narrow further without ever dropping the tenancy filter", () => {
  const before = new Date("2026-07-01T00:00:00.000Z");
  const { sql, params } = notificationFeedQuery(
    { churchId: CHURCH_A, recipientUserId: USER },
    { before, category: "tasks", unreadOnly: true }
  ).toSQL();

  assert.match(sql, /"notifications"\."church_id" = \$\d/);
  assert.match(sql, /"notifications"\."created_at" < \$\d/);
  assert.match(sql, /"notifications"\."category" = \$\d/);
  assert.match(sql, /"notifications"\."read_at" is null/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes("tasks"));
});

test("the unread count is church- and recipient-scoped", () => {
  const { sql, params } = unreadCountQuery({
    churchId: CHURCH_A,
    recipientUserId: USER,
  }).toSQL();

  assert.match(sql, /count\(\*\)/i);
  assert.match(sql, /"notifications"\."church_id" = \$\d/);
  assert.match(sql, /"notifications"\."recipient_user_id" = \$\d/);
  assert.match(sql, /"notifications"\."read_at" is null/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
});

test("every read path emits exactly one church_id predicate", () => {
  const builders = [
    notificationByIdQuery({ churchId: CHURCH_A }, NOTIFICATION),
    notificationFeedQuery({ churchId: CHURCH_A, recipientUserId: USER }),
    unreadCountQuery({ churchId: CHURCH_A, recipientUserId: USER }),
  ];

  for (const builder of builders) {
    const { sql } = builder.toSQL();
    const matches = sql.match(/"notifications"\."church_id" = \$\d/g) ?? [];
    assert.equal(matches.length, 1, sql);
  }
});
