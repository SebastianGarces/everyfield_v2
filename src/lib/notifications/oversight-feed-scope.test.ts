import assert from "node:assert/strict";
import { test } from "node:test";

import { OVERSIGHT_SHARING_EXEMPT_TYPES } from "./categories";
import {
  markAllNotificationsReadQuery,
  markNotificationReadQuery,
} from "./mark-read";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

import {
  DEFAULT_FEED_LIMIT,
  hasAnyNotificationsQuery,
  notificationByIdQuery,
  notificationFeedQuery,
  unreadCountQuery,
  type OversightNotificationScope,
} from "./queries";

// ----------------------------------------------------------------------------
// The oversight feed's boundary (N-027, #308 WS1) — asserted as SQL.
//
// These are query-level assertions: each builder is rendered with `.toSQL()`,
// so what is checked is the statement that would reach Postgres. A read path
// that stopped filtering on the recipient, or on the plant's consent, would
// fail here even though it still type-checked and still returned rows.
//
// The property under test is the one the plant was promised. An oversight
// account reads across a PORTFOLIO rather than a single church, so "which rows
// may I see" stopped being one equality and became a disjunction — and a
// disjunction is exactly the shape where an arm gets widened by accident. Six
// paths compose it (the feed, the badge, the cold-start probe, the by-id read
// and both mark-read writes) and every one of them is asserted below, because
// the by-id path is where a bad boundary is cheapest to exploit: a row hidden
// from the list is worth nothing if its id fetches it.
//
// No query is EXECUTED — `.toSQL()` renders, it does not connect — but the
// suite needs a DATABASE_URL present, because importing `./queries` constructs
// the Neon client at module load. `pnpm test` supplies a placeholder.
// ----------------------------------------------------------------------------

const NETWORK = "network-1";
const SENDING_CHURCH = "sending-church-1";
const ADMIN = "oversight-admin-1";
const OTHER_CHURCH = "church-not-opted-in";

const NETWORK_SCOPE: OversightNotificationScope = {
  org: { type: "network", id: NETWORK },
  recipientUserId: ADMIN,
};

const SENDING_CHURCH_SCOPE: OversightNotificationScope = {
  org: { type: "sending_church", id: SENDING_CHURCH },
  recipientUserId: ADMIN,
};

const NOW = new Date("2026-08-20T12:00:00.000Z");

/** Every path an oversight viewer's rows can reach the app through. */
function everyOversightPath(scope: OversightNotificationScope) {
  return {
    feed: notificationFeedQuery(scope, { now: NOW }).toSQL(),
    badge: unreadCountQuery(scope, { now: NOW }).toSQL(),
    coldStart: hasAnyNotificationsQuery(scope, { now: NOW }).toSQL(),
    byId: notificationByIdQuery(scope, "notification-1", { now: NOW }).toSQL(),
    markOne: markNotificationReadQuery(scope, "notification-1", {
      now: NOW,
    }).toSQL(),
    markAll: markAllNotificationsReadQuery(scope, { now: NOW }).toSQL(),
  };
}

const CONSENT_SUBQUERY =
  /"notifications"\."church_id" in \(select "churches"\."id" from "churches" inner join "church_privacy_settings" on "church_privacy_settings"\."church_id" = "churches"\."id"/;

const CONSENT_ON =
  /"church_privacy_settings"\."share_activity_with_oversight" = \$\d/;

// ----------------------------------------------------------------------------
// 1. A church that has not opted in is not reachable — on ANY path
// ----------------------------------------------------------------------------

test("every oversight path filters plant rows through the consent toggle", () => {
  for (const [path, { sql, params }] of Object.entries(
    everyOversightPath(NETWORK_SCOPE)
  )) {
    assert.match(
      sql,
      CONSENT_SUBQUERY,
      `${path} reads plant rows without the consent subquery`
    );
    assert.match(
      sql,
      CONSENT_ON,
      `${path} does not require share_activity_with_oversight`
    );
    assert.ok(
      params.includes(true),
      `${path} binds something other than TRUE to the consent toggle`
    );
  }
});

test("the by-id read is bounded exactly as the list is — an id is not a key", () => {
  // The one that matters most. A row kept out of the list is worth nothing if
  // its uuid fetches it, so the single-row path carries the identical boundary
  // rather than a weaker "it is mine" check.
  const { feed, byId } = everyOversightPath(NETWORK_SCOPE);

  const boundary = sourceReader(feed.sql, "notificationFeedQuery").span(
    "where (",
    ' and "notifications"."status"'
  );

  assert.ok(
    byId.sql.includes(boundary),
    "the by-id read does not carry the list's boundary verbatim"
  );
  // …and the id is an EXTRA predicate on top of it, never a substitute.
  assert.match(byId.sql, /and "notifications"\."id" = \$\d/);
});

test("both mark-read WRITES carry the same boundary as the reads", () => {
  // A write is never permitted to be looser than the read that surfaced the
  // row: an oversight admin cannot stamp read_at on a plant that has not opted
  // in, because the UPDATE's WHERE holds the same consent subquery.
  const { markOne, markAll } = everyOversightPath(NETWORK_SCOPE);

  for (const [path, { sql }] of Object.entries({ markOne, markAll })) {
    assert.match(
      sql,
      /^update "notifications" set/,
      `${path} is not an UPDATE`
    );
    assert.match(sql, CONSENT_SUBQUERY, `${path} skipped the consent subquery`);
  }
});

test("consent is a SUBQUERY, never an id list a caller assembled", () => {
  // `OversightNotificationScope` carries the ORG, not church ids. An array of
  // ids is something a caller can widen, stale-cache or forget to intersect
  // with the toggle; a subquery is evaluated by Postgres at the instant of the
  // read. The scope's own parameters prove nothing else was smuggled in.
  const { params } = notificationFeedQuery(NETWORK_SCOPE, {
    now: NOW,
  }).toSQL();

  assert.ok(!params.includes(OTHER_CHURCH));
  assert.deepEqual(params, [
    ADMIN,
    NETWORK,
    true,
    ...OVERSIGHT_SHARING_EXEMPT_TYPES,
    NETWORK,
    "cancelled",
    NOW.toISOString(),
    DEFAULT_FEED_LIMIT,
  ]);
});

// ----------------------------------------------------------------------------
// 2. The recipient boundary survives the widening
// ----------------------------------------------------------------------------

test("every oversight path still names the recipient, unconditionally", () => {
  // The disjunction is over ANCHORS. The recipient predicate sits outside it
  // and is ANDed, so no arm can widen a read past one account — which is what
  // an optional recipient inside an `or()` would have done.
  for (const [path, { sql, params }] of Object.entries(
    everyOversightPath(NETWORK_SCOPE)
  )) {
    assert.match(
      sql,
      /"notifications"\."recipient_user_id" = \$\d/,
      `${path} does not name the recipient`
    );
    assert.ok(params.includes(ADMIN), `${path} bound a different recipient`);

    // …and it is the FIRST predicate, ahead of the anchor disjunction — a
    // recipient inside an `or()` is one an arm can be widened past.
    assertInOrder(
      sourceReader(sql, path).span("where (", ' and "notifications"."status"'),
      path,
      ['"notifications"."recipient_user_id" = ', " or "],
      "the recipient must bound every anchor arm, not sit inside one"
    );
  }
});

// ----------------------------------------------------------------------------
// 3. The org KIND picks the column — a network never reads a sending church's
// ----------------------------------------------------------------------------

test("the portfolio arm follows the org kind, not a hand-written column", () => {
  const network = notificationFeedQuery(NETWORK_SCOPE, { now: NOW }).toSQL();
  const sendingChurch = notificationFeedQuery(SENDING_CHURCH_SCOPE, {
    now: NOW,
  }).toSQL();

  assert.match(network.sql, /"churches"\."sending_network_id" = \$\d/);
  assert.doesNotMatch(network.sql, /"churches"\."sending_church_id"/);

  assert.match(sendingChurch.sql, /"churches"\."sending_church_id" = \$\d/);
  assert.doesNotMatch(sendingChurch.sql, /"churches"\."sending_network_id"/);

  // Swap the column and the two statements are the same statement: the kind is
  // the only thing that varies, which is what keeps a third org kind from
  // needing a second copy of this read.
  assert.equal(
    network.sql.replace('"churches"."sending_network_id"', "COL"),
    sendingChurch.sql.replace('"churches"."sending_church_id"', "COL")
  );
});

// ----------------------------------------------------------------------------
// 4. The consent-exempt arm is the one `enqueue` writes with
// ----------------------------------------------------------------------------

test("the exempt arm names exactly the types the write gate exempts", () => {
  // Read and write share ONE constant. A fourth exemption added to
  // `OVERSIGHT_SHARING_EXEMPT_TYPES` reaches this predicate with no edit here,
  // and an exemption removed from it disappears from the feed at the same
  // moment it stops being written — the two cannot drift into a row that is
  // written and never shown, which is the failure the 2026-08-01 ruling was
  // made to prevent.
  const { sql, params } = notificationFeedQuery(NETWORK_SCOPE, {
    now: NOW,
  }).toSQL();

  assert.match(sql, /"notifications"\."type" in \(/);
  for (const type of OVERSIGHT_SHARING_EXEMPT_TYPES) {
    assert.ok(params.includes(type), `${type} is not visible to its own org`);
  }

  // …and nothing else. The arm is not a general "milestones are always shown".
  const placeholders = sourceReader(sql, "notificationFeedQuery")
    .after('"notifications"."type" in (')
    .split(")")[0]
    .split(",").length;
  assert.equal(placeholders, OVERSIGHT_SHARING_EXEMPT_TYPES.length);
});

test("the org-anchored arm names anchor_org_id and never coalesces", () => {
  // The third arm — a sending church's own membership of a network (#304 WS3),
  // filed under `anchor_org_id` because it names no plant. The two anchor
  // columns stay separate predicates: coalescing them would make the two
  // tenancy spaces one namespace.
  const { sql } = notificationFeedQuery(NETWORK_SCOPE, { now: NOW }).toSQL();

  assert.match(sql, /"notifications"\."anchor_org_id" = \$\d/);
  assert.doesNotMatch(sql, /coalesce/i);
});

// ----------------------------------------------------------------------------
// 5. The church arm is untouched
// ----------------------------------------------------------------------------

test("a seat in a plant reads exactly what it read before", () => {
  // `feedScopedWhere` is total over the two arms, and widening it must not have
  // moved the church boundary: church_id AND recipient_user_id, both required,
  // both in the WHERE, and no mention of consent — a plant's own team is not
  // subject to a toggle that governs what leaves the plant.
  const { sql, params } = notificationFeedQuery(
    { churchId: "church-a", recipientUserId: "user-1" },
    { now: NOW }
  ).toSQL();

  assert.match(sql, /"notifications"\."church_id" = \$\d/);
  assert.match(sql, /"notifications"\."recipient_user_id" = \$\d/);
  assert.doesNotMatch(sql, /share_activity_with_oversight/);
  assert.doesNotMatch(sql, /"church_privacy_settings"/);
  assert.ok(params.includes("church-a"));
  assert.ok(params.includes("user-1"));
});
