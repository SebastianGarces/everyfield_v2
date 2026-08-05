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
// first pass at this issue. It scans EVERY route that reads CRON_SECRET, so a
// third scheduled endpoint added later is covered the day it is written.
//
// It is scoped to the body of `isAuthorized` rather than the whole file: a
// whole-file grep passes as long as a constant-time helper is *defined*
// somewhere in the file, even if the guard has stopped calling it.
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

test("every route guarded by CRON_SECRET compares it in constant time", () => {
  const guarded = routeFiles(API_ROOT)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("process.env.CRON_SECRET"));

  // If this ever hits 0 the test has stopped testing anything.
  assert.ok(
    guarded.length >= 2,
    `expected at least the two cron routes to read CRON_SECRET, found ${guarded.length}`
  );

  for (const { file, source } of guarded) {
    const where = path.relative(process.cwd(), file);
    const body = guardBody(source);

    assert.ok(body, `${where}: no exported isAuthorized to check`);
    assert.match(
      body,
      /matchesBearerSecret\(/,
      `${where}: the guard does not call the constant-time helper (#266)`
    );
    assert.doesNotMatch(
      body,
      /[!=]==/,
      `${where}: the guard compares with ===/!== again — that is a timing oracle (#266)`
    );
    assert.doesNotMatch(
      body,
      /\b(?:startsWith|endsWith|includes|indexOf|localeCompare)\(/,
      `${where}: the guard matches the secret with a short-circuiting string method (#266)`
    );
  }
});
