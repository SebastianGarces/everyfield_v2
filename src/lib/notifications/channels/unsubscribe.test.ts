import assert from "node:assert/strict";
import { test } from "node:test";

import { preferenceOwnerFromUnsubscribeToken } from "../preferences";
import { unsubscribeWriteQuery } from "./unsubscribe";
import { mintUnsubscribeToken } from "./unsubscribe-token";

// ============================================================================
// Scope of effect on the unauthenticated surface (N-007).
//
// The statements below are rendered with `.toSQL()` and inspected, so what is
// asserted is the UPDATE that would actually reach Postgres — parameters
// included — rather than a description of it. Nothing is EXECUTED: `.toSQL()`
// renders, it does not connect.
//
// The claim under test is the one the FRD makes and the one a reviewer of an
// unauthenticated mutation has to be able to check by reading: following an
// unsubscribe link disables ONE category's email channel for ONE user, and
// touches nothing else.
// ============================================================================

const SECRET = "test-unsubscribe-secret-0123456789";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-30T09:00:00.000Z");

function ownerFor(category: "tasks" | "meetings", userId = USER) {
  const token = mintUnsubscribeToken({
    userId,
    category,
    now: NOW,
    secret: SECRET,
  });
  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    now: NOW,
    secret: SECRET,
  });
  assert.ok(resolved.ok);
  return resolved;
}

test("the write names exactly one user, one category and the email channel", () => {
  const resolved = ownerFor("tasks");
  const { sql, params } = unsubscribeWriteQuery(
    resolved.owner,
    resolved.category,
    false
  ).toSQL();

  assert.match(sql, /insert into "notification_preferences"/i);
  assert.match(sql, /on conflict/i);

  // The three coordinates of the affected cell, and the value.
  assert.ok(params.includes(USER));
  assert.ok(params.includes("tasks"));
  assert.ok(params.includes("email"));
  assert.ok(params.includes(false));

  // Nothing that would widen it: no other user, no other category, and above
  // all no `in_app` — a link that could reach the feed would be a different
  // and much larger capability.
  assert.ok(!params.includes(OTHER_USER));
  assert.ok(!params.includes("meetings"));
  assert.ok(!params.includes("in_app"));
});

test("the category written is the token's, not a parameter a caller chose", () => {
  const tasks = ownerFor("tasks");
  const meetings = ownerFor("meetings");

  const tasksParams = unsubscribeWriteQuery(
    tasks.owner,
    tasks.category,
    false
  ).toSQL().params;
  const meetingsParams = unsubscribeWriteQuery(
    meetings.owner,
    meetings.category,
    false
  ).toSQL().params;

  assert.ok(tasksParams.includes("tasks"));
  assert.ok(!tasksParams.includes("meetings"));
  assert.ok(meetingsParams.includes("meetings"));
  assert.ok(!meetingsParams.includes("tasks"));
});

test("two users' links produce writes that cannot reach each other", () => {
  const mine = ownerFor("tasks", USER);
  const theirs = ownerFor("tasks", OTHER_USER);

  const mineParams = unsubscribeWriteQuery(
    mine.owner,
    mine.category,
    false
  ).toSQL().params;
  const theirsParams = unsubscribeWriteQuery(
    theirs.owner,
    theirs.category,
    false
  ).toSQL().params;

  assert.ok(mineParams.includes(USER) && !mineParams.includes(OTHER_USER));
  assert.ok(theirsParams.includes(OTHER_USER) && !theirsParams.includes(USER));
});

test("undo is the same one-cell write in the other direction", () => {
  const resolved = ownerFor("tasks");

  const off = unsubscribeWriteQuery(resolved.owner, resolved.category, false);
  const on = unsubscribeWriteQuery(resolved.owner, resolved.category, true);

  // Same statement, same coordinates — only the value differs. There is no
  // second code path for the undo to get wrong.
  assert.equal(off.toSQL().sql, on.toSQL().sql);
  assert.ok(off.toSQL().params.includes(false));
  assert.ok(on.toSQL().params.includes(true));
});

test("a tampered token yields no owner, so no write can be built at all", () => {
  const raw = Buffer.from(
    mintUnsubscribeToken({
      userId: USER,
      category: "tasks",
      now: NOW,
      secret: SECRET,
    }),
    "base64url"
  );
  raw[raw.length - 2] ^= 0b0000_0001;

  const resolved = preferenceOwnerFromUnsubscribeToken(
    raw.toString("base64url"),
    { now: NOW, secret: SECRET }
  );

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.reason, "tampered");
  // `unsubscribeWriteQuery` takes a `PreferenceOwner`, which only a successful
  // resolution can mint — there is nothing to pass it here, and the compiler
  // says so. That is what makes "a tampered token changes nothing" structural
  // rather than a branch someone has to remember to write.
});

test("an expired token yields no owner either", () => {
  const token = mintUnsubscribeToken({
    userId: USER,
    category: "tasks",
    now: NOW,
    ttlMs: 1_000,
    secret: SECRET,
  });

  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    now: new Date(NOW.getTime() + 2_000),
    secret: SECRET,
  });

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.reason, "expired");
});
