import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { constantTimeEquals, matchesBearerSecret } from "./constant-time";

// ----------------------------------------------------------------------------
// The primitive (#266)
//
// `crypto.timingSafeEqual` throws a RangeError on buffers of unequal length, so
// a helper that only ever saw the happy path would ship a 500 (or a crash loop)
// the first time a wrong-length token arrived. The wrong-length cases below are
// the proof that the lengths are reconciled BEFORE the call and that every bad
// shape lands on a plain `false`.
// ----------------------------------------------------------------------------

test("equal strings match", () => {
  assert.equal(constantTimeEquals("s3cret", "s3cret"), true);
  assert.equal(constantTimeEquals("", ""), true);
});

test("a string differing only in its last byte does not match", () => {
  // Same length, so nothing but the comparison itself can decide this.
  assert.equal(constantTimeEquals("s3cret", "s3creT"), false);
});

test("a shorter string does not match, and does not throw", () => {
  assert.equal(constantTimeEquals("s3cre", "s3cret"), false);
  assert.equal(constantTimeEquals("", "s3cret"), false);
});

test("a longer string does not match, and does not throw", () => {
  // The correct value with something appended: the prefix matches, which is the
  // case a byte-by-byte compare would answer fastest.
  assert.equal(constantTimeEquals("s3cretX", "s3cret"), false);
  assert.equal(constantTimeEquals("s3cret".repeat(2000), "s3cret"), false);
});

test("a long secret round-trips and still refuses a same-length near miss", () => {
  const secret = "a".repeat(64);
  assert.equal(constantTimeEquals(secret, secret), true);
  assert.equal(constantTimeEquals("a".repeat(63) + "b", secret), false);
});

test("multi-byte characters are compared by bytes, not code units", () => {
  assert.equal(constantTimeEquals("señor", "señor"), true);
  assert.equal(constantTimeEquals("señor", "senor"), false);
});

// ----------------------------------------------------------------------------
// The bearer guard both cron routes call
// ----------------------------------------------------------------------------

test("the exact Bearer header matches", () => {
  assert.equal(matchesBearerSecret("Bearer s3cret", "s3cret"), true);
});

test("a missing header is refused", () => {
  assert.equal(matchesBearerSecret(null, "s3cret"), false);
});

test("a wrong token is refused", () => {
  assert.equal(matchesBearerSecret("Bearer wrong", "s3cret"), false);
  assert.equal(matchesBearerSecret("Bearer s3creT", "s3cret"), false);
});

test("a wrong-length token is refused, in both directions", () => {
  assert.equal(matchesBearerSecret("Bearer s3cre", "s3cret"), false);
  assert.equal(matchesBearerSecret("Bearer s3cretX", "s3cret"), false);
  assert.equal(matchesBearerSecret("Bearer ", "s3cret"), false);
  assert.equal(matchesBearerSecret("", "s3cret"), false);
});

test("the scheme is part of the comparison", () => {
  // A bare token, or a different scheme, is not a valid credential.
  assert.equal(matchesBearerSecret("s3cret", "s3cret"), false);
  assert.equal(matchesBearerSecret("bearer s3cret", "s3cret"), false);
  assert.equal(matchesBearerSecret("Token s3cret", "s3cret"), false);
});

// ----------------------------------------------------------------------------
// Repo-wide regression: no route re-grows its own comparison (#266)
//
// This is the grep half of the AC, kept as a test so it cannot rot — and kept
// HERE, once, rather than inside one route's test file, because a per-route
// grep is exactly how `/api/phase-engine/assess` kept its `===` through the
// first pass at this issue. It scans EVERY route reading EVERY shared secret in
// `GUARDED_SECRETS`, so a third scheduled endpoint added later is covered the
// day it is written.
//
// `REVALIDATION_SECRET` joined the table with #310: the wiki revalidation route
// kept its `!==` for the whole of #266 because that pass scanned for one env
// var by name. A scan that knows about one secret proves nothing about the next
// one, which is the failure this table exists to stop repeating.
//
// It is scoped to the body of `isAuthorized` rather than the whole file: a
// whole-file grep passes as long as a constant-time helper is *defined*
// somewhere in the file, even if the guard has stopped calling it. The one
// whole-file assertion is a COUNT — the secret is read exactly once — so a
// second, inline comparison cannot grow up beside a compliant guard.
// ----------------------------------------------------------------------------

test("the helper itself still compares in constant time", () => {
  // The behavioural tests above cannot tell `timingSafeEqual` from `===` —
  // both answer every case identically, which is the whole problem. So the one
  // place the mechanism is asserted directly is here, on the source.
  const source = readFileSync(path.join(__dirname, "constant-time.ts"), "utf8");

  assert.match(
    source,
    /timingSafeEqual\(/,
    "the comparison no longer uses crypto.timingSafeEqual (#266)"
  );
  assert.doesNotMatch(
    source,
    /\b(?:presented|expected|header|secret)\s*[!=]==\s*[`"'(]?(?:presented|expected|header|Bearer)/,
    "a secret is compared with ===/!== again — that is a timing oracle (#266)"
  );
});

const API_ROOT = path.join(process.cwd(), "src/app/api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** The text of `isAuthorized`, from its signature to its closing brace. */
function guardBody(source: string): string | null {
  const start = source.indexOf("export function isAuthorized");
  if (start === -1) return null;
  const end = source.indexOf("\n}", start);
  return end === -1 ? source.slice(start) : source.slice(start, end + 2);
}

/** The file with its comments removed — these assertions are about CODE. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Every shared secret compared by a route, and the helper its guard must call.
 *
 * `CRON_SECRET` arrives in an `Authorization` header, `REVALIDATION_SECRET` in
 * the request body, so they reach the primitive through different front doors —
 * but the property is identical and so is the way it regresses, which is why
 * they are one table and not two hand-written tests. A new shared secret is
 * added here on the day the route that reads it is written.
 */
const GUARDED_SECRETS = [
  {
    env: "CRON_SECRET",
    helper: /matchesBearerSecret\(/,
    minimumRoutes: 2,
    issue: "#266",
    note: "the two cron routes",
  },
  {
    env: "REVALIDATION_SECRET",
    helper: /constantTimeEquals\(/,
    minimumRoutes: 1,
    issue: "#310",
    note: "the wiki revalidation route",
  },
] as const;

for (const { env, helper, minimumRoutes, issue, note } of GUARDED_SECRETS) {
  test(`every route guarded by ${env} compares it in constant time`, () => {
    const guarded = routeFiles(API_ROOT)
      .map((file) => ({
        file,
        source: stripComments(readFileSync(file, "utf8")),
      }))
      .filter(({ source }) => source.includes(`process.env.${env}`));

    // If this ever hits 0 the test has stopped testing anything.
    assert.ok(
      guarded.length >= minimumRoutes,
      `expected at least ${note} to read ${env}, found ${guarded.length}`
    );

    for (const { file, source } of guarded) {
      const where = path.relative(process.cwd(), file);
      const body = guardBody(source);

      assert.ok(body, `${where}: no exported isAuthorized to check`);

      // The secret is read in exactly ONE place, the guard. Without this a
      // handler could keep the constant-time guard and still re-grow its own
      // inline `secret !== process.env.X` beside it, which is precisely the
      // shape #310 found in `/api/wiki/revalidate` — the check was inline and
      // duplicated across POST and DELETE.
      const reads = source.split(`process.env.${env}`).length - 1;
      assert.equal(
        reads,
        1,
        `${where}: ${env} is read ${reads} times; it belongs to the guard alone (${issue})`
      );
      assert.match(
        body,
        new RegExp(`process\\.env\\.${env}`),
        `${where}: the guard does not read ${env} (${issue})`
      );

      assert.match(
        body,
        helper,
        `${where}: the guard does not call the constant-time helper (${issue})`
      );
      assert.doesNotMatch(
        body,
        /[!=]==/,
        `${where}: the guard compares with ===/!== again — that is a timing oracle (${issue})`
      );
      assert.doesNotMatch(
        body,
        /\b(?:startsWith|endsWith|includes|indexOf|localeCompare)\(/,
        `${where}: the guard matches the secret with a short-circuiting string method (${issue})`
      );
    }
  });
}
