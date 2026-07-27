import assert from "node:assert/strict";
import { test } from "node:test";

import {
  markAllNotificationsReadQuery,
  markNotificationReadQuery,
} from "./mark-read";

// ----------------------------------------------------------------------------
// Read state (N-009) at the SQL level.
//
// Same technique as `queries.test.ts`: each statement is rendered with
// `.toSQL()` and inspected, so what is asserted is the UPDATE that would reach
// Postgres. A write that stopped scoping to the church, stopped scoping to the
// recipient, or grew a second table would fail here while still type-checking.
//
// No statement is EXECUTED — `.toSQL()` renders, it does not connect. A
// DATABASE_URL must be present because importing this module pulls in `@/db`,
// which constructs the Neon client at module load; `pnpm test` supplies a
// placeholder.
// ----------------------------------------------------------------------------

const CHURCH_A = "church-a";
const CHURCH_B = "church-b";
const USER = "user-1";
const OTHER_USER = "user-2";
const NOTIFICATION = "notification-1";
const NOW = new Date("2026-07-27T12:00:00Z");

const SCOPE = { churchId: CHURCH_A, recipientUserId: USER };

const CHURCH_PREDICATE = /"church_id" = \$\d/;
const RECIPIENT_PREDICATE = /"recipient_user_id" = \$\d/;

// ----------------------------------------------------------------------------
// What the write touches — and what it must leave alone
// ----------------------------------------------------------------------------

test("marking read writes read_at on the notification and nothing else", () => {
  const { sql } = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();

  assert.match(sql, /^update "notifications" set/i);
  assert.match(sql, /"read_at" = \$\d/);
  // `updated_at` moves with it because this schema has no trigger — every
  // writer sets it, and a stale one would misreport when the row last changed.
  assert.match(sql, /"updated_at" = \$\d/);
});

test("marking read never touches the delivery log", () => {
  // The AC in prose: "marking read does not alter delivery records". The
  // structural version: `notification_deliveries` cannot appear in a statement
  // that never names it, and nothing in `./mark-read` imports that table.
  //
  // This matters because read state and delivery state are genuinely different
  // facts. A delivery row says "we handed this to Resend at 09:04"; `read_at`
  // says "a human looked at the feed row". An email that was sent does not make
  // the feed row read, and reading the feed row does not retract, re-send or
  // re-status the email that was already delivered.
  const single = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();
  const all = markAllNotificationsReadQuery(SCOPE, { now: NOW }).toSQL();

  for (const { sql } of [single, all]) {
    assert.doesNotMatch(sql, /notification_deliveries/);
    assert.doesNotMatch(sql, /provider_message_id/);
    assert.doesNotMatch(sql, /attempt_count/);
    assert.doesNotMatch(sql, /sent_at/);
    // Nor does it touch the queue's own dispatch state: a read notification is
    // still pending, claimed or delivered exactly as it was.
    assert.doesNotMatch(sql, /set[^]*"status" =/i);
  }
});

// ----------------------------------------------------------------------------
// The write is scoped no more loosely than the read that surfaced the row
// ----------------------------------------------------------------------------

test("mark-one is scoped by church AND recipient, not by id alone", () => {
  const { sql, params } = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
  assert.ok(params.includes(NOTIFICATION));
});

test("a cross-church mark-read binds the asking church, so it updates nothing", () => {
  // The id is not a capability across tenants: the row lives in CHURCH_A, the
  // session says CHURCH_B, and the predicate carries CHURCH_B — zero rows
  // match, and the caller learns nothing about whether the id exists.
  const { params } = markNotificationReadQuery(
    { churchId: CHURCH_B, recipientUserId: USER },
    NOTIFICATION,
    { now: NOW }
  ).toSQL();

  assert.ok(params.includes(CHURCH_B));
  assert.ok(!params.includes(CHURCH_A));
});

test("a same-church, other-user mark-read cannot reach that user's row", () => {
  const { sql, params } = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();

  assert.match(sql, RECIPIENT_PREDICATE);
  assert.ok(params.includes(USER));
  assert.ok(!params.includes(OTHER_USER));
});

test("mark-all is scoped by church AND recipient, and names no id", () => {
  const { sql, params } = markAllNotificationsReadQuery(SCOPE, {
    now: NOW,
  }).toSQL();

  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.doesNotMatch(sql, /"id" = \$\d/);
  assert.ok(params.includes(CHURCH_A));
  assert.ok(params.includes(USER));
});

// ----------------------------------------------------------------------------
// Idempotency, and the feed's visibility rules
// ----------------------------------------------------------------------------

test("both writes only touch rows that are still unread", () => {
  // Not an optimisation: it is what keeps the returned ids honest ("what this
  // click changed"), what stops a double click double-counting, and what
  // preserves the FIRST read instant instead of sliding it forward on a retry.
  for (const { sql } of [
    markNotificationReadQuery(SCOPE, NOTIFICATION, { now: NOW }).toSQL(),
    markAllNotificationsReadQuery(SCOPE, { now: NOW }).toSQL(),
  ]) {
    assert.match(sql, /"read_at" is null/i);
  }
});

test("you cannot mark read what the feed was not allowed to show you", () => {
  // Without these two predicates, "mark all read" would stamp `read_at` on a
  // reminder scheduled for next week: it would then arrive already-read,
  // un-bolded and uncounted — delivered to a feed that had already dismissed
  // it. A cancelled row is likewise not something a user has "read".
  for (const { sql } of [
    markNotificationReadQuery(SCOPE, NOTIFICATION, { now: NOW }).toSQL(),
    markAllNotificationsReadQuery(SCOPE, { now: NOW }).toSQL(),
  ]) {
    assert.match(sql, /"status" <> \$\d/);
    assert.match(sql, /"scheduled_for" <= \$\d/);
  }

  const { params } = markAllNotificationsReadQuery(SCOPE, { now: NOW }).toSQL();
  assert.ok(params.includes("cancelled"));
});

test("the same instant is used for the cutoff and for the stamp", () => {
  // One `now` per call: a row is marked read as of the moment it was eligible,
  // not as of two different clock reads.
  const { params } = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();

  const instants = params.filter(
    (param) =>
      typeof param === "string" && new Date(param).getTime() === NOW.getTime()
  );

  assert.ok(
    instants.length >= 2,
    "expected read_at, updated_at and the cutoff"
  );
});

// ----------------------------------------------------------------------------
// The boundary is a type, not a habit
// ----------------------------------------------------------------------------

test("a mark-read scope without a recipient does not type-check", () => {
  // @ts-expect-error recipientUserId is required — there is no code path that
  // marks "this church's notifications" read without naming whose they are.
  const build = () => markAllNotificationsReadQuery({ churchId: CHURCH_A });

  assert.equal(typeof build, "function");
});
// ----------------------------------------------------------------------------
// The preference allow-list rides the same predicate (N-005)
// ----------------------------------------------------------------------------

test("mark-all leaves a hidden category's unread state alone", () => {
  // A category the user has switched off for `in_app` is not on their screen,
  // so "mark all read" is not a statement about it. Stamping it anyway would
  // hand them a pile of already-read rows the day they switch it back on —
  // the unread state destroyed by a click that never claimed to touch it.
  const { sql, params } = markAllNotificationsReadQuery(SCOPE, {
    now: NOW,
    categories: ["tasks", "meetings"],
  }).toSQL();

  assert.match(sql, /"category" in \(\$\d, \$\d\)/);
  assert.ok(params.includes("tasks"));
  assert.ok(params.includes("meetings"));

  // And never in place of the boundaries.
  assert.match(sql, CHURCH_PREDICATE);
  assert.match(sql, RECIPIENT_PREDICATE);
  assert.match(sql, /"read_at" is null/i);
});

test("a viewer who has hidden everything marks nothing read", () => {
  const { sql } = markAllNotificationsReadQuery(SCOPE, {
    now: NOW,
    categories: [],
  }).toSQL();

  assert.match(sql, /\bfalse\b/);
});

test("mark-one carries the allow-list too, and is unfiltered without one", () => {
  const filtered = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
    categories: ["tasks"],
  }).toSQL();
  assert.match(filtered.sql, /"category" in \(\$\d\)/);

  const plain = markNotificationReadQuery(SCOPE, NOTIFICATION, {
    now: NOW,
  }).toSQL();
  assert.doesNotMatch(plain.sql, /"category" in /);
});

test("neither write mentions the delivery log", () => {
  // Read state lives on the notification. A preference filter narrows WHICH
  // rows a click can touch; it does not turn a read path into a writer of
  // `notification_deliveries`, which records what a channel attempted and is
  // not the feed's to edit.
  for (const { sql } of [
    markNotificationReadQuery(SCOPE, NOTIFICATION, {
      now: NOW,
      categories: ["tasks"],
    }).toSQL(),
    markAllNotificationsReadQuery(SCOPE, {
      now: NOW,
      categories: ["tasks"],
    }).toSQL(),
  ]) {
    assert.ok(!sql.includes("notification_deliveries"), sql);
    assert.match(sql, /update "notifications"/i);
  }
});
