import assert from "node:assert/strict";
import { test } from "node:test";

import { PG_UNIQUE_VIOLATION, isUniqueViolation } from "./errors";

// ----------------------------------------------------------------------------
// The canonical "the unique index just did its job" predicate.
//
// The shapes pinned here are the two the drivers actually produce: the raw
// Postgres error at the top, and the same error buried under Drizzle's
// wrapping as a `cause`.
// ----------------------------------------------------------------------------

const CONSTRAINT = "users_email_unique";

test("a top-level unique violation naming the constraint matches", () => {
  assert.equal(
    isUniqueViolation(
      { code: PG_UNIQUE_VIOLATION, constraint: CONSTRAINT },
      CONSTRAINT
    ),
    true
  );
});

test("the constraint may arrive in the message instead of the field", () => {
  assert.equal(
    isUniqueViolation(
      {
        code: PG_UNIQUE_VIOLATION,
        message: `duplicate key value violates unique constraint "${CONSTRAINT}"`,
      },
      CONSTRAINT
    ),
    true
  );
});

test("a violation wrapped as a cause is still found", () => {
  const wrapped = new Error("Failed query", {
    cause: { code: PG_UNIQUE_VIOLATION, constraint: CONSTRAINT },
  });

  assert.equal(isUniqueViolation(wrapped, CONSTRAINT), true);
});

test("a violation on a DIFFERENT constraint does not match", () => {
  // Narrowness is the point: swallowing someone else's unique violation would
  // turn a real bug into a polite refusal.
  assert.equal(
    isUniqueViolation(
      { code: PG_UNIQUE_VIOLATION, constraint: "other_index" },
      CONSTRAINT
    ),
    false
  );
});

test("a non-unique-violation error never matches, whatever it mentions", () => {
  assert.equal(
    isUniqueViolation(
      { code: "23503", message: `fk mentions ${CONSTRAINT}` },
      CONSTRAINT
    ),
    false
  );
});

test("garbage shapes are refused, not crashed on", () => {
  for (const value of [null, undefined, "boom", 42, new Error("plain")]) {
    assert.equal(isUniqueViolation(value, CONSTRAINT), false, String(value));
  }
});

test("the cause walk is bounded — a cycle cannot hang it", () => {
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;

  assert.equal(isUniqueViolation(cyclic, CONSTRAINT), false);
});
