import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  loadUserPreferences,
  preferenceOwnerFromSession,
  setDigestCadenceQuery,
  setPreferenceQuery,
} from "@/lib/notifications/preferences";

// ============================================================================
// The settings screen's write path — ownership (N-006).
//
// The AC: "a user cannot read or write another user's preferences (write-path
// assertion with a foreign user id)". There are two halves to proving that, and
// this file covers both.
//
// 1. STRUCTURAL — the actions never accept a user id, so there is no foreign id
//    to supply. `src/app/(dashboard)/settings/actions.ts` is a `"use server"`
//    module: importing it here would drag `next/cache` into a bare node:test
//    process, so its shape is asserted from its source. That is the same
//    technique `preferences.test.ts` and `enqueue.test.ts` use where the
//    property lives in a place a unit test cannot call into.
//
// 2. BEHAVIOURAL — the statements those actions produce are scoped to the
//    session's own user, and a foreign id smuggled through the input is
//    discarded rather than honoured.
//
// The compile-time half — that a bare `string` is not assignable to
// `PreferenceOwner` at all — is asserted in `preferences.test.ts` with
// `@ts-expect-error`, which `pnpm typecheck` enforces.
// ============================================================================

const ACTIONS_PATH = path.join(
  process.cwd(),
  "src/app/(dashboard)/settings/actions.ts"
);

const ACTIONS_SOURCE = readFileSync(ACTIONS_PATH, "utf8");

/**
 * The module with its comments removed.
 *
 * The absence assertions below are about CODE. Without this they would also be
 * about prose, and the module's header explains the ownership rule by naming
 * the shape it forbids (`formData.get("userId")`) — so documenting the rule
 * would break the test that enforces it, and the cheapest way to keep the test
 * green would be to delete the explanation.
 */
const ACTIONS_CODE = ACTIONS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|\s)\/\/.*$/gm,
  "$1"
);

/** The session whose preferences are legitimately being edited. */
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = preferenceOwnerFromSession({ user: { id: OWNER_ID } });

/** Someone else entirely. Nothing on this screen may ever reach them. */
const FOREIGN_ID = "22222222-2222-4222-8222-222222222222";

test("every exported settings action mints its owner from the session", () => {
  // Not "most of them". A second action added later that resolved its user any
  // other way would be the one loose write path, and that is exactly the shape
  // of bug this counts.
  const exported = ACTIONS_CODE.match(/export async function /g) ?? [];
  const minted = ACTIONS_CODE.match(/preferenceOwnerFromSession\(/g) ?? [];

  assert.ok(exported.length > 0, "no exported actions found — check the path");
  assert.equal(minted.length, exported.length);
  assert.match(
    ACTIONS_CODE,
    /preferenceOwnerFromSession\(await verifySession\(\)\)/
  );
});

test("no settings action names a user, anywhere", () => {
  // A user id in this module could only have come from the client — a form
  // field, a query string or a route param — and a preference is a consent
  // record: reading or flipping someone else's is the whole risk. The absence
  // is the assertion.
  for (const forbidden of [
    /userId/,
    /user_id/,
    /searchParams/,
    /\bparams\b/,
    /formData/,
  ]) {
    assert.doesNotMatch(ACTIONS_CODE, forbidden, String(forbidden));
  }
});

test("the settings actions do not reach the database directly", () => {
  // Every write goes through `@/lib/notifications/preferences`, which is where
  // the `PreferenceOwner` boundary is. A raw `db.update(notificationPreferences)`
  // here would bypass it entirely while still type-checking.
  assert.doesNotMatch(ACTIONS_CODE, /from "@\/db"/);
  assert.doesNotMatch(ACTIONS_CODE, /\bdb\./);
});

test("a foreign user id in the input is discarded, not written", () => {
  // The write-path assertion the AC asks for. `setPreferenceSchema` parses at
  // the boundary and knows nothing about a user, so an extra `userId` on the
  // payload is stripped — the id in the statement is the OWNER's, minted from
  // the session, and the foreign one appears nowhere in it.
  const { params } = setPreferenceQuery(OWNER, {
    // @ts-expect-error the point of the test: a client cannot address a user
    userId: FOREIGN_ID,
    category: "tasks",
    channel: "email",
    enabled: false,
  }).toSQL();

  assert.ok(params.includes(OWNER_ID));
  assert.ok(!params.includes(FOREIGN_ID));
});

test("the cadence write is scoped to the session's own user too", () => {
  const { params } = setDigestCadenceQuery(OWNER, "daily").toSQL();

  assert.ok(params.includes(OWNER_ID));
  assert.ok(!params.includes(FOREIGN_ID));
});

test("two sessions produce two disjoint owners", () => {
  // There is no path from holding a foreign id to writing as that user, and no
  // path from a session to any id but its own: the mint is the identity
  // function on the session's user, and nothing else can produce the brand.
  const foreignOwner = preferenceOwnerFromSession({
    user: { id: FOREIGN_ID },
  });

  assert.equal(String(OWNER), OWNER_ID);
  assert.equal(String(foreignOwner), FOREIGN_ID);
  assert.notEqual(String(OWNER), String(foreignOwner));
});

test("the read path takes an owner and nothing else", () => {
  // The read half of the AC. `loadUserPreferences` has one parameter and it is
  // branded, so a page cannot ask for "the preferences of user X" — the
  // `@ts-expect-error` is the assertion, and an unused directive is itself an
  // error, so it cannot rot into a comment.
  assert.equal(loadUserPreferences.length, 1);

  // @ts-expect-error a plain string is not proof of ownership
  const call = () => loadUserPreferences(FOREIGN_ID);

  assert.equal(typeof call, "function");
});
